import { useEffect, useRef, useState } from "preact/hooks";
import { useQuery, useQueryClient } from "@tanstack/preact-query";
import { supabase } from "../../shared/supabase/client";
import { cacheTripData, readCachedTripData } from "../offline/db";
import { expandDateRange, formatDateLabel } from "./dates";
import { tripWallTimeToIso } from "./timezone";
import { revealEditor } from "../../shared/editor-navigation";

export type TripLike = {
  id: string;
  title: string;
  base_currency: string;
  timezone: string;
  start_date: string;
  end_date: string;
  status: string;
};
type Night = {
  trip_id: string;
  night_date: string;
  city: string;
  transport_mode: string | null;
  version: number;
};
type Stay = {
  id: string;
  trip_id: string;
  check_in_date: string;
  check_out_date: string;
  name: string;
  address: string | null;
  phone: string | null;
  version: number;
};
type Activity = {
  id: string;
  trip_id: string;
  title: string;
  starts_at: string | null;
  plan_date: string | null;
  address: string | null;
  meeting_info: string | null;
  notes: string | null;
  transport_mode: string | null;
  position: number;
  version: number;
};
const modes = [
  "walk",
  "car",
  "taxi",
  "bus",
  "train",
  "boat",
  "flight",
  "other",
];
const trLabel: Record<string, string> = {
  walk: "Walk",
  car: "Car",
  taxi: "Taxi",
  bus: "Bus",
  train: "Train",
  boat: "Boat",
  flight: "Flight",
  other: "Other",
};
const thaiLabel: Record<string, string> = {
  walk: "เดิน",
  car: "รถยนต์",
  taxi: "แท็กซี่",
  bus: "รถบัส",
  train: "รถไฟ",
  boat: "เรือ",
  flight: "เครื่องบิน",
  other: "อื่น ๆ",
};
const errorMessage = (error: unknown) =>
  error instanceof Error ? error.message : "Please try again.";
function isOfflineEligible(error: unknown) {
  const e = error as { status?: number; code?: string } | null;
  if (
    e?.status === 401 ||
    e?.status === 403 ||
    e?.code === "42501" ||
    e?.code === "PGRST301"
  )
    return false;
  return !navigator.onLine || !e?.status || e.status >= 500;
}

export function Plan({
  trip,
  uid,
  thai,
  organizer = false,
}: {
  trip: TripLike;
  uid: string;
  thai: boolean;
  organizer?: boolean;
}) {
  const t = (en: string, th: string) => (thai ? th : en);
  const locale = thai ? "th-TH" : "en";
  const localTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const qc = useQueryClient();
  const [notice, setNotice] = useState("");
  const [replaceRange, setReplaceRange] = useState(false);
  const [nightForm, setNightForm] = useState<Night | null>(null);
  const [stayForm, setStayForm] = useState<Stay | null>(null);
  const [activityForm, setActivityForm] = useState<Activity | null>(null);
  const [activityDate, setActivityDate] = useState(trip.start_date);
  const [showNightEditor, setShowNightEditor] = useState(false);
  const [showStayEditor, setShowStayEditor] = useState(false);
  const [showActivityEditor, setShowActivityEditor] = useState(false);
  const [editorNavigation, setEditorNavigation] = useState(0);
  const [editorNavigationTarget, setEditorNavigationTarget] = useState<
    "night" | "stay" | "activity" | null
  >(null);
  const requestEditorNavigation = (target: "night" | "stay" | "activity") => {
    setEditorNavigationTarget(target);
    setEditorNavigation((n) => n + 1);
  };
  const nightEditorRef = useRef<HTMLFormElement>(null);
  const stayEditorRef = useRef<HTMLFormElement>(null);
  const activityEditorRef = useRef<HTMLFormElement>(null);
  const nights = useQuery({
    queryKey: ["plan-nights", uid, trip.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("nightly_destinations")
        .select("*")
        .eq("trip_id", trip.id)
        .order("night_date");
      if (error) {
        if (isOfflineEligible(error)) {
          const cached = await readCachedTripData<Night[]>(
            uid,
            trip.id,
            "nightly_plan",
          );
          if (cached) return cached;
        }
        throw error;
      }
      const rows = (data ?? []) as Night[];
      await cacheTripData(uid, trip.id, "nightly_plan", rows);
      return rows;
    },
  });
  const stays = useQuery({
    queryKey: ["plan-stays", uid, trip.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("stays")
        .select("*")
        .eq("trip_id", trip.id)
        .order("check_in_date");
      if (error) {
        if (isOfflineEligible(error)) {
          const cached = await readCachedTripData<Stay[]>(
            uid,
            trip.id,
            "stays",
          );
          if (cached) return cached;
        }
        throw error;
      }
      const rows = (data ?? []) as Stay[];
      await cacheTripData(uid, trip.id, "stays", rows);
      return rows;
    },
  });
  const activities = useQuery({
    queryKey: ["plan-activities", uid, trip.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("itinerary_items")
        .select("*")
        .eq("trip_id", trip.id)
        .not("plan_date", "is", null)
        .order("plan_date")
        .order("starts_at")
        .order("position");
      if (error) {
        if (isOfflineEligible(error)) {
          const cached = await readCachedTripData<Activity[]>(
            uid,
            trip.id,
            "plan_activities",
          );
          if (cached) return cached;
        }
        throw error;
      }
      const rows = (data ?? []) as Activity[];
      await cacheTripData(uid, trip.id, "plan_activities", rows);
      return rows;
    },
  });
  const refresh = async () => {
    await Promise.all([
      nights.refetch(),
      stays.refetch(),
      activities.refetch(),
    ]);
    await qc.invalidateQueries({ queryKey: ["itinerary", uid, trip.id] });
    await qc.invalidateQueries({ queryKey: ["tonight", uid, trip.id] });
  };
  async function saveNights(e: Event) {
    e.preventDefault();
    setNotice("");
    const f = new FormData(e.currentTarget as HTMLFormElement);
    try {
      const dates = expandDateRange(String(f.get("from")), String(f.get("to")));
      if (dates.some((date) => date < trip.start_date || date > trip.end_date))
        throw new RangeError(
          t("Dates must be within the trip.", "วันที่ต้องอยู่ในช่วงทริป"),
        );
      if (nightForm && !replaceRange)
        throw new RangeError(
          t(
            "Confirm overwrite before editing planned nights.",
            "โปรดยืนยันการเขียนทับก่อนแก้ไขคืนที่วางแผนไว้",
          ),
        );
      const { error } = await supabase.rpc("set_nightly_destinations", {
        p_trip_id: trip.id,
        p_start_date: dates[0],
        p_end_date: dates.at(-1),
        p_city: f.get("city"),
        p_transport_mode: f.get("transport") || null,
        p_replace: replaceRange || nightForm !== null,
        p_expected_versions: Object.fromEntries(
          rows
            .filter(
              (row) =>
                row.night_date >= dates[0] && row.night_date <= dates.at(-1)!,
            )
            .map((row) => [row.night_date, row.version]),
        ),
      });
      if (error) throw error;
      setNightForm(null);
      setReplaceRange(false);
      setShowNightEditor(false);
      setNotice(t("Destination nights saved.", "บันทึกเมืองที่พักแล้ว"));
      await refresh();
    } catch (error) {
      setNotice(
        (error as { code?: string }).code === "40001"
          ? replaceRange || nightForm
            ? t(
                "A selected night changed elsewhere. Refresh and review the latest plan before overwriting.",
                "คืนที่เลือกถูกแก้ไขจากอุปกรณ์อื่น กรุณารีเฟรชและตรวจสอบก่อนเขียนทับ",
              )
            : t(
                "Some selected nights are already planned. Review the range and confirm overwrite to replace them.",
                "บางคืนมีแผนแล้ว กรุณาตรวจสอบช่วงวันที่และยืนยันการเขียนทับ",
              )
          : errorMessage(error),
      );
    }
  }
  async function deleteNight(night: Night) {
    const { error } = await supabase.rpc("delete_nightly_destination", {
      p_trip_id: trip.id,
      p_night_date: night.night_date,
      p_expected_version: night.version,
    });
    setNotice(
      error
        ? error.code === "40001"
          ? t(
              "This night changed elsewhere. Refresh first.",
              "คืนนี้ถูกแก้ไขจากอุปกรณ์อื่น กรุณารีเฟรช",
            )
          : error.message
        : t("Night removed.", "ลบเมืองคืนนี้แล้ว"),
    );
    if (!error) await refresh();
  }
  async function saveStay(e: Event) {
    e.preventDefault();
    setNotice("");
    const f = new FormData(e.currentTarget as HTMLFormElement);
    const from = String(f.get("from"));
    const to = String(f.get("to"));
    try {
      if (
        to <= from ||
        from < trip.start_date ||
        to > addDate(trip.end_date, 1)
      )
        throw new RangeError(
          t(
            "Use a valid stay range within the trip. Check-out is the next morning.",
            "กำหนดช่วงที่พักให้ถูกต้อง โดยวันออกจากที่พักคือเช้าวันถัดไป",
          ),
        );
      const { error } = await supabase.rpc("upsert_stay", {
        p_trip_id: trip.id,
        p_check_in_date: from,
        p_check_out_date: to,
        p_name: f.get("name"),
        p_address: f.get("address") || null,
        p_phone: f.get("phone") || null,
        p_stay_id: stayForm?.id ?? null,
        p_expected_version: stayForm?.version ?? null,
      });
      if (error) throw error;
      setStayForm(null);
      setShowStayEditor(false);
      setNotice(t("Accommodation saved.", "บันทึกที่พักแล้ว"));
      await refresh();
    } catch (error) {
      setNotice(
        (error as { code?: string }).code === "40001"
          ? t(
              "This accommodation changed elsewhere. Refresh and review it.",
              "ที่พักนี้ถูกแก้ไขจากอุปกรณ์อื่น กรุณารีเฟรชและตรวจสอบ",
            )
          : errorMessage(error),
      );
    }
  }
  async function deleteStay(stay: Stay) {
    const { error } = await supabase.rpc("delete_stay", {
      p_trip_id: trip.id,
      p_stay_id: stay.id,
      p_expected_version: stay.version,
    });
    setNotice(
      error
        ? error.code === "40001"
          ? t(
              "This accommodation changed elsewhere. Refresh first.",
              "ที่พักนี้ถูกแก้ไขจากอุปกรณ์อื่น กรุณารีเฟรช",
            )
          : error.message
        : t("Accommodation removed.", "ลบที่พักแล้ว"),
    );
    if (!error) await refresh();
  }
  async function saveActivity(e: Event) {
    e.preventDefault();
    setNotice("");
    const f = new FormData(e.currentTarget as HTMLFormElement);
    const raw = String(f.get("starts"));
    try {
      if (activityDate < trip.start_date || activityDate > trip.end_date)
        throw new RangeError(
          t(
            "Activity date must be within the trip.",
            "วันที่กิจกรรมต้องอยู่ในช่วงทริป",
          ),
        );
      const { error } = await supabase.rpc("upsert_itinerary_item", {
        p_trip_id: trip.id,
        p_title: f.get("title"),
        p_starts_at: raw
          ? tripWallTimeToIso(`${activityDate}T${raw}`, localTimezone)
          : null,
        p_address: f.get("address") || null,
        p_meeting_info: f.get("meeting") || null,
        p_notes: f.get("notes") || null,
        p_transport_mode: f.get("transport") || null,
        p_position:
          activityForm?.position ??
          activities.data?.filter(
            (a) => activityLocalDate(a, localTimezone) === activityDate,
          ).length ??
          0,
        p_item_id: activityForm?.id ?? null,
        p_expected_version: activityForm?.version ?? null,
        p_plan_date: activityDate,
      });
      if (error) throw error;
      setActivityForm(null);
      setShowActivityEditor(false);
      setNotice(t("Activity saved.", "บันทึกกิจกรรมแล้ว"));
      await refresh();
    } catch (error) {
      setNotice(
        (error as { code?: string }).code === "40001"
          ? t(
              "This activity changed elsewhere. Refresh and review it.",
              "กิจกรรมนี้ถูกแก้ไขจากอุปกรณ์อื่น กรุณารีเฟรชและตรวจสอบ",
            )
          : errorMessage(error),
      );
    }
  }
  async function deleteActivity(activity: Activity) {
    const { error } = await supabase.rpc("delete_itinerary_item", {
      p_trip_id: trip.id,
      p_item_id: activity.id,
      p_expected_version: activity.version,
    });
    setNotice(
      error
        ? error.code === "40001"
          ? t(
              "This activity changed elsewhere. Refresh first.",
              "กิจกรรมนี้ถูกแก้ไขจากอุปกรณ์อื่น กรุณารีเฟรช",
            )
          : error.message
        : t("Activity removed.", "ลบกิจกรรมแล้ว"),
    );
    if (!error) await refresh();
  }
  const dates = (() => {
    try {
      return expandDateRange(trip.start_date, trip.end_date);
    } catch {
      return [];
    }
  })();
  const rows = nights.data ?? [];
  const activitiesByDate = activities.data ?? [];
  useEffect(() => {
    if (nightForm) setReplaceRange(false);
  }, [nightForm]);
  useEffect(() => {
    if (showNightEditor && editorNavigationTarget === "night")
      revealEditor(nightEditorRef.current);
  }, [showNightEditor, editorNavigation, editorNavigationTarget]);
  useEffect(() => {
    if (showStayEditor && editorNavigationTarget === "stay")
      revealEditor(stayEditorRef.current);
  }, [showStayEditor, editorNavigation, editorNavigationTarget]);
  useEffect(() => {
    if (showActivityEditor && editorNavigationTarget === "activity")
      revealEditor(activityEditorRef.current);
  }, [showActivityEditor, editorNavigation, editorNavigationTarget]);
  return (
    <section class="plan" aria-label={t("Trip plan", "แผนการเดินทาง")}>
      <h2>{t("Plan", "แผนการเดินทาง")}</h2>
      <p>
        {t(
          "Dates are shown in this device's local timezone",
          "วันที่อ้างอิงเขตเวลาท้องถิ่นของอุปกรณ์นี้",
        )}
        : {localTimezone}
      </p>
      {notice && <p role="status">{notice}</p>}
      {(nights.isError || stays.isError || activities.isError) && (
        <p role="status">
          {t(
            "Could not refresh the plan. Cached details may be shown while offline.",
            "โหลดแผนไม่สำเร็จ หากออฟไลน์จะแสดงข้อมูลที่บันทึกไว้",
          )}
        </p>
      )}
      <section class="plan-nights">
        <h3>
          {t("Where are we staying each night?", "แต่ละคืนพักที่เมืองไหน")}
        </h3>
        {dates.map((date) => {
          const night = rows.find((x) => x.night_date === date);
          return (
            <article class="plan-night" key={date}>
              <h4>{formatDateLabel(date, locale)}</h4>
              {night ? (
                <>
                  <p>{night.city}</p>
                  <p>
                    {night.transport_mode
                      ? tLabel(night.transport_mode, thai)
                      : t("Travel mode not set", "ยังไม่ได้เลือกการเดินทาง")}
                  </p>
                  {organizer && (
                    <>
                      <button
                        type="button"
                        onClick={() => {
                          setNightForm(night);
                          setReplaceRange(false);
                          setShowNightEditor(true);
                          requestEditorNavigation("night");
                        }}
                      >
                        {t("Edit this night", "แก้ไขคืนนี้")}
                      </button>
                      <button
                        type="button"
                        onClick={() => void deleteNight(night)}
                      >
                        {t("Remove", "ลบ")}
                      </button>
                    </>
                  )}
                </>
              ) : (
                <p>{t("Destination not set", "ยังไม่ได้กำหนดเมือง")}</p>
              )}
              {activitiesByDate
                .filter((a) => activityLocalDate(a, localTimezone) === date)
                .map((activity) => (
                  <article class="plan-activity" key={activity.id}>
                    <strong>{activity.title}</strong>
                    {activity.starts_at && (
                      <p>
                        {new Date(activity.starts_at).toLocaleTimeString(locale, {
                          timeZone: localTimezone,
                          timeStyle: "short",
                        })}{" "}
                        · {localTimezone}
                      </p>
                    )}
                    {activity.address && <p>{activity.address}</p>}
                    {activity.notes && <p>{activity.notes}</p>}
                    <p>
                      {activity.transport_mode
                        ? tLabel(activity.transport_mode, thai)
                        : t("Travel mode not set", "ยังไม่ได้เลือกการเดินทาง")}
                    </p>
                    {organizer && (
                      <>
                        <button
                          type="button"
                          onClick={() => {
                            setActivityForm(activity);
                            setActivityDate(activityLocalDate(activity, localTimezone) ?? date);
                            setShowActivityEditor(true);
                            requestEditorNavigation("activity");
                          }}
                        >
                          {t("Edit activity", "แก้ไขกิจกรรม")}
                        </button>
                        <button
                          type="button"
                          onClick={() => void deleteActivity(activity)}
                        >
                          {t("Remove", "ลบ")}
                        </button>
                      </>
                    )}
                  </article>
                ))}
              {organizer && (
                <button
                  type="button"
                  onClick={() => {
                    setActivityForm(null);
                    setActivityDate(date);
                    setShowActivityEditor(true);
                    requestEditorNavigation("activity");
                  }}
                >
                  {t("Add activity", "เพิ่มกิจกรรม")}
                </button>
              )}
            </article>
          );
        })}
        {organizer && (
          <>
            <button
              type="button"
              aria-expanded={showNightEditor}
              onClick={() => {
                setNightForm(null);
                setShowNightEditor(true);
                requestEditorNavigation("night");
              }}
            >
              {t(
                "Add city for a night or range",
                "เพิ่มเมืองสำหรับหนึ่งคืนหรือช่วงวันที่",
              )}
            </button>
            {showNightEditor && (
              <form
                class="plan-form editor-panel"
                ref={nightEditorRef}
                key={nightForm?.night_date ?? "night-new"}
                onSubmit={saveNights}
              >
                <h4>
                  {nightForm
                    ? t("Edit destination night", "แก้ไขเมืองคืนนี้")
                    : t(
                        "Add destination for a night or range",
                        "เพิ่มเมืองสำหรับหนึ่งคืนหรือช่วงวันที่",
                      )}
                </h4>
                <label>
                  {t("From (night of)", "เริ่มคืนวันที่")}
                  <input
                    name="from"
                    type="date"
                    min={trip.start_date}
                    max={trip.end_date}
                    required
                    defaultValue={nightForm?.night_date ?? trip.start_date}
                  />
                </label>
                <label>
                  {t("Through (inclusive)", "ถึงวันที่ (รวมคืนนี้)")}
                  <input
                    name="to"
                    type="date"
                    min={trip.start_date}
                    max={trip.end_date}
                    required
                    defaultValue={nightForm?.night_date ?? trip.start_date}
                  />
                </label>
                <label>
                  {t("City", "เมือง")}
                  <input
                    name="city"
                    required
                    maxLength={160}
                    defaultValue={nightForm?.city ?? ""}
                  />
                </label>
                <label>
                  {t("Travel mode into this city", "การเดินทางเข้าเมืองนี้")}
                  <ModeSelect
                    name="transport"
                    value={nightForm?.transport_mode ?? ""}
                    thai={thai}
                    t={t}
                  />
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked={replaceRange}
                    onChange={(e) => setReplaceRange(e.currentTarget.checked)}
                  />
                  {t(
                    "I understand this will overwrite the selected nights",
                    "ฉันเข้าใจว่าการดำเนินการนี้จะเขียนทับเมืองในคืนที่เลือก",
                  )}
                </label>
                <button>
                  {nightForm
                    ? t("Save night or range", "บันทึกคืนหรือช่วงวันที่")
                    : t("Save destination", "บันทึกเมือง")}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setNightForm(null);
                    setShowNightEditor(false);
                  }}
                >
                  {t("Cancel", "ยกเลิก")}
                </button>
              </form>
            )}
          </>
        )}
      </section>
      <section class="plan-stays">
        <h3>{t("Accommodation", "ที่พัก")}</h3>
        {(stays.data ?? []).map((stay) => (
          <article class="plan-stay" key={stay.id}>
            <strong>{stay.name}</strong>
            <p>
              {stay.check_in_date} — {stay.check_out_date} ·{" "}
              {t("check-out", "วันออก")}
            </p>
            {stay.address && <p>{stay.address}</p>}
            {stay.phone && <p>{stay.phone}</p>}
            {organizer && (
              <>
                <button
                  type="button"
                  onClick={() => {
                    setStayForm(stay);
                    setShowStayEditor(true);
                    requestEditorNavigation("stay");
                  }}
                >
                  {t("Edit", "แก้ไข")}
                </button>
                <button type="button" onClick={() => void deleteStay(stay)}>
                  {t("Remove", "ลบ")}
                </button>
              </>
            )}
          </article>
        ))}
        {organizer && (
          <>
            <button
              type="button"
              aria-expanded={showStayEditor}
              onClick={() => {
                setStayForm(null);
                setShowStayEditor(true);
                requestEditorNavigation("stay");
              }}
            >
              {t("Add accommodation", "เพิ่มที่พัก")}
            </button>
            {showStayEditor && (
              <form
                class="plan-form editor-panel"
                ref={stayEditorRef}
                key={stayForm?.id ?? "stay-new"}
                onSubmit={saveStay}
              >
                <h4>
                  {stayForm
                    ? t("Edit accommodation", "แก้ไขที่พัก")
                    : t("Add accommodation", "เพิ่มที่พัก")}
                </h4>
                <label>
                  {t("Name", "ชื่อที่พัก")}
                  <input
                    name="name"
                    required
                    maxLength={160}
                    defaultValue={stayForm?.name ?? ""}
                  />
                </label>
                <label>
                  {t("Check-in", "วันเข้าพัก")}
                  <input
                    name="from"
                    type="date"
                    min={trip.start_date}
                    max={trip.end_date}
                    required
                    defaultValue={stayForm?.check_in_date ?? trip.start_date}
                  />
                </label>
                <label>
                  {t(
                    "Check-out (exclusive)",
                    "วันออกจากที่พัก (ไม่รวมคืนนั้น)",
                  )}
                  <input
                    name="to"
                    type="date"
                    min={trip.start_date}
                    max={addDate(trip.end_date, 1)}
                    required
                    defaultValue={
                      stayForm?.check_out_date ?? addDate(trip.start_date, 1)
                    }
                  />
                </label>
                <label>
                  {t("Address", "ที่อยู่")}
                  <input
                    name="address"
                    maxLength={500}
                    defaultValue={stayForm?.address ?? ""}
                  />
                </label>
                <label>
                  {t("Phone", "เบอร์โทรศัพท์")}
                  <input
                    name="phone"
                    maxLength={40}
                    defaultValue={stayForm?.phone ?? ""}
                  />
                </label>
                <button>{t("Save accommodation", "บันทึกที่พัก")}</button>
                <button
                  type="button"
                  onClick={() => {
                    setStayForm(null);
                    setShowStayEditor(false);
                  }}
                >
                  {t("Cancel", "ยกเลิก")}
                </button>
              </form>
            )}
          </>
        )}
      </section>
      {organizer && showActivityEditor && (
        <section class="plan-activity-editor">
          <h3>
            {activityForm
              ? t("Edit activity", "แก้ไขกิจกรรม")
              : t("Add activity", "เพิ่มกิจกรรม")}
          </h3>
          <form
            class="plan-form editor-panel"
            ref={activityEditorRef}
            key={activityForm?.id ?? "new-activity"}
            onSubmit={saveActivity}
          >
            <label>
              {t("Day", "วันที่")}
              <input
                type="date"
                min={trip.start_date}
                max={trip.end_date}
                value={activityDate}
                onChange={(e) => setActivityDate(e.currentTarget.value)}
                required
              />
            </label>
            <label>
              {t("Activity", "กิจกรรม")}
              <input
                name="title"
                required
                maxLength={160}
                defaultValue={activityForm?.title ?? ""}
              />
            </label>
            <label>
              {t("Local time", "เวลาท้องถิ่น")}
              <input
                name="starts"
                type="time"
                defaultValue={
                  activityForm?.starts_at
                    ? toTripLocal(activityForm.starts_at, localTimezone).slice(
                        11,
                      )
                    : ""
                }
              />
            </label>
            <p>
              {t(
                "Times use this device's local timezone",
                "เวลาอ้างอิงเขตเวลาท้องถิ่นของอุปกรณ์นี้",
              )}: {localTimezone}
            </p>
            <label>
              {t("Address", "ที่อยู่")}
              <input
                name="address"
                maxLength={500}
                defaultValue={activityForm?.address ?? ""}
              />
            </label>
            <label>
              {t("Meeting point", "จุดนัดพบ")}
              <input
                name="meeting"
                maxLength={300}
                defaultValue={activityForm?.meeting_info ?? ""}
              />
            </label>
            <label>
              {t("Notes", "หมายเหตุ")}
              <textarea
                name="notes"
                maxLength={1000}
                defaultValue={activityForm?.notes ?? ""}
              />
            </label>
            <label>
              {t("Travel mode into activity", "การเดินทางไปยังกิจกรรม")}
              <ModeSelect
                name="transport"
                value={activityForm?.transport_mode ?? ""}
                thai={thai}
                t={t}
              />
            </label>
            <button>{t("Save activity", "บันทึกกิจกรรม")}</button>
            <button
              type="button"
              onClick={() => {
                setActivityForm(null);
                setShowActivityEditor(false);
              }}
            >
              {t("Cancel", "ยกเลิก")}
            </button>
          </form>
        </section>
      )}
    </section>
  );
}
function ModeSelect({
  name,
  value,
  thai,
  t,
}: {
  name: string;
  value: string;
  thai: boolean;
  t: (en: string, th: string) => string;
}) {
  return (
    <select name={name} defaultValue={value}>
      <option value="">{t("Choose (optional)", "เลือก (ไม่บังคับ)")}</option>
      {modes.map((mode) => (
        <option key={mode} value={mode}>
          {thai ? thaiLabel[mode] : trLabel[mode]}
        </option>
      ))}
    </select>
  );
}
function tLabel(value: string, thai: boolean) {
  return thai ? (thaiLabel[value] ?? value) : (trLabel[value] ?? value);
}
function addDate(date: string, days: number) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
function toTripLocal(value: string, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(value));
  const p = Object.fromEntries(parts.map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}
function activityLocalDate(activity: Activity, timezone: string) {
  return activity.starts_at
    ? toTripLocal(activity.starts_at, timezone).slice(0, 10)
    : activity.plan_date;
}

export default Plan;
