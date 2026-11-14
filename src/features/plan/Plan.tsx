import { Button } from "../../shared/ui/Button";
import { useEffect, useRef, useState } from "preact/hooks";
import { useQuery, useQueryClient } from "@tanstack/preact-query";
import { supabase } from "../../shared/supabase/client";
import { cacheTripData, readCachedTripData } from "../offline/db";
import { expandDateRange, formatDateLabel } from "./dates";
import { tripWallTimeToIso } from "./timezone";
import { revealEditor } from "../../shared/editor-navigation";
import { ActionIcon } from "../../shared/ActionIcon";
import { stayForDate } from "./day";

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
  const destinationTimezone = trip.timezone;
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
  const [planView, setPlanView] = useState<"daily" | "accommodation">("daily");
  const [stayDate, setStayDate] = useState(trip.start_date);
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
          ? tripWallTimeToIso(`${activityDate}T${raw}`, destinationTimezone)
          : null,
        p_address: f.get("address") || null,
        p_meeting_info: f.get("meeting") || null,
        p_notes: f.get("notes") || null,
        p_transport_mode: f.get("transport") || null,
        p_position:
          activityForm?.position ??
          activities.data?.filter(
            (a) =>
              activityDestinationDate(a, destinationTimezone) === activityDate,
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
      {notice && <p role="status">{notice}</p>}
      {(nights.isError || stays.isError || activities.isError) && (
        <p role="status">
          {t(
            "Could not refresh the plan. Cached details may be shown while offline.",
            "โหลดแผนไม่สำเร็จ หากออฟไลน์จะแสดงข้อมูลที่บันทึกไว้",
          )}
        </p>
      )}
      <nav class="plan-view-toggle" aria-label={t("Plan view", "มุมมองแผน")}>
        <Button
          type="button"
          aria-pressed={planView === "daily"}
          appearance={planView === "daily" ? "primary" : "tertiary"}
          onClick={() => setPlanView("daily")}
        >
          {t("Daily overview", "ภาพรวมรายวัน")}
        </Button>
        <Button
          type="button"
          aria-pressed={planView === "accommodation"}
          appearance={planView === "accommodation" ? "primary" : "tertiary"}
          onClick={() => setPlanView("accommodation")}
        >
          {t("Accommodation", "ที่พัก")}
        </Button>
      </nav>
      {planView === "daily" && (
        <div class="plan-nights">
          <h3>
            {t("Where are we staying each night?", "แต่ละคืนพักที่เมืองไหน")}
          </h3>
          {dates.map((date, dayIndex) => {
            const night = rows.find((x) => x.night_date === date);
            return (
              <article
                class="plan-night"
                key={date}
                aria-labelledby={`day-${trip.id}-${date}`}
              >
                <h4 class="plan-day-heading" id={`day-${trip.id}-${date}`}>
                  <span class="plan-day-number">
                    {t("Day", "วันที่")} {dayIndex + 1}
                  </span>
                  <time dateTime={date}>{formatDateLabel(date, locale)}</time>
                </h4>
                {night ? (
                  <>
                    <p>{night.city}</p>
                    {night.transport_mode && (
                      <p>{tLabel(night.transport_mode, thai)}</p>
                    )}
                    {organizer && (
                      <>
                        <Button
                          type="button"
                          svgOnly
                          appearance="tertiary"
                          class="plan-icon-button icon44"
                          aria-label={t("Edit this night", "แก้ไขคืนนี้")}
                          title={t("Edit this night", "แก้ไขคืนนี้")}
                          onClick={() => {
                            setNightForm(night);
                            setReplaceRange(false);
                            setShowNightEditor(true);
                            requestEditorNavigation("night");
                          }}
                        >
                          <ActionIcon kind="edit" />
                        </Button>
                        <Button
                          type="button"
                          svgOnly
                          appearance="tertiary"
                          class="plan-icon-button icon44 danger"
                          aria-label={t("Remove", "ลบ")}
                          title={t("Remove", "ลบ")}
                          onClick={() => void deleteNight(night)}
                        >
                          <ActionIcon kind="remove" />
                        </Button>
                      </>
                    )}
                  </>
                ) : (
                  <p>{t("Destination not set", "ยังไม่ได้กำหนดเมือง")}</p>
                )}
                {(() => {
                  const stay = stayForDate(stays.data ?? [], date);
                  return stay ? (
                    <div class="plan-daily-stay">
                      <strong>{stay.name}</strong>
                      {stay.address && <p>{stay.address}</p>}
                      {organizer && (
                        <Button
                          type="button"
                          svgOnly
                          appearance="tertiary"
                          class="plan-icon-button icon44"
                          aria-label={t("Edit accommodation", "แก้ไขที่พัก")}
                          title={t("Edit accommodation", "แก้ไขที่พัก")}
                          onClick={() => {
                            setPlanView("accommodation");
                            setStayForm(stay);
                            setStayDate(date);
                            setShowStayEditor(true);
                            requestEditorNavigation("stay");
                          }}
                        >
                          <ActionIcon kind="edit" />
                        </Button>
                      )}
                    </div>
                  ) : (
                    <div class="plan-daily-stay">
                      <p>
                        {t("Accommodation not set", "ยังไม่ได้กำหนดที่พัก")}
                      </p>
                      {organizer && (
                        <Button
                          type="button"
                          svgOnly
                          appearance="tertiary"
                          class="plan-icon-button icon44"
                          aria-label={t(
                            `Add accommodation for ${date}`,
                            `เพิ่มที่พักสำหรับ ${date}`,
                          )}
                          title={t("Add accommodation", "เพิ่มที่พัก")}
                          onClick={() => {
                            setPlanView("accommodation");
                            setStayForm(null);
                            setStayDate(date);
                            setShowStayEditor(true);
                            requestEditorNavigation("stay");
                          }}
                        >
                          <ActionIcon kind="add" />
                        </Button>
                      )}
                    </div>
                  );
                })()}
                {!activitiesByDate.some(
                  (activity) =>
                    activityDestinationDate(activity, destinationTimezone) ===
                    date,
                ) && <p>{t("Free day", "วันว่าง")}</p>}
                {activitiesByDate
                  .filter(
                    (a) =>
                      activityDestinationDate(a, destinationTimezone) === date,
                  )
                  .map((activity) => (
                    <div class="plan-activity" key={activity.id}>
                      <strong>{activity.title}</strong>
                      {activity.starts_at && (
                        <p>
                          {new Date(activity.starts_at).toLocaleTimeString(
                            locale,
                            {
                              timeZone: destinationTimezone,
                              timeStyle: "short",
                            },
                          )}
                        </p>
                      )}
                      {activity.address && <p>{activity.address}</p>}
                      {activity.notes && <p>{activity.notes}</p>}
                      {activity.transport_mode && (
                        <p>{tLabel(activity.transport_mode, thai)}</p>
                      )}
                      {organizer && (
                        <>
                          <Button
                            type="button"
                            svgOnly
                            appearance="tertiary"
                            class="plan-icon-button icon44"
                            aria-label={t("Edit activity", "แก้ไขกิจกรรม")}
                            title={t("Edit activity", "แก้ไขกิจกรรม")}
                            onClick={() => {
                              setActivityForm(activity);
                              setActivityDate(
                                activityDestinationDate(
                                  activity,
                                  destinationTimezone,
                                ) ?? date,
                              );
                              setShowActivityEditor(true);
                              requestEditorNavigation("activity");
                            }}
                          >
                            <ActionIcon kind="edit" />
                          </Button>
                          <Button
                            type="button"
                            svgOnly
                            appearance="tertiary"
                            class="plan-icon-button icon44 danger"
                            aria-label={t("Remove", "ลบ")}
                            title={t("Remove", "ลบ")}
                            onClick={() => void deleteActivity(activity)}
                          >
                            <ActionIcon kind="remove" />
                          </Button>
                        </>
                      )}
                    </div>
                  ))}
                {organizer && (
                  <Button
                    type="button"
                    svgOnly
                    appearance="tertiary"
                    class="plan-icon-button icon44"
                    aria-label={t("Add activity", "เพิ่มกิจกรรม")}
                    title={t("Add activity", "เพิ่มกิจกรรม")}
                    onClick={() => {
                      setActivityForm(null);
                      setActivityDate(date);
                      setShowActivityEditor(true);
                      requestEditorNavigation("activity");
                    }}
                  >
                    <ActionIcon kind="add" />
                  </Button>
                )}
              </article>
            );
          })}
          {organizer && (
            <>
              <Button
                type="button"
                svgOnly
                appearance="tertiary"
                class="plan-icon-button icon44"
                aria-label={t(
                  "Add city for a night or range",
                  "เพิ่มเมืองสำหรับหนึ่งคืนหรือช่วงวันที่",
                )}
                title={t(
                  "Add city for a night or range",
                  "เพิ่มเมืองสำหรับหนึ่งคืนหรือช่วงวันที่",
                )}
                aria-expanded={showNightEditor}
                onClick={() => {
                  setNightForm(null);
                  setShowNightEditor(true);
                  requestEditorNavigation("night");
                }}
              >
                <ActionIcon kind="add" />
              </Button>
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
                  <Button
                    type="submit"
                    svgOnly
                    appearance="tertiary"
                    class="plan-icon-button icon44"
                    aria-label={
                      nightForm
                        ? t("Save night or range", "บันทึกคืนหรือช่วงวันที่")
                        : t("Save destination", "บันทึกเมือง")
                    }
                    title={
                      nightForm
                        ? t("Save night or range", "บันทึกคืนหรือช่วงวันที่")
                        : t("Save destination", "บันทึกเมือง")
                    }
                  >
                    <ActionIcon kind="save" />
                  </Button>
                  <Button
                    type="button"
                    svgOnly
                    appearance="tertiary"
                    class="plan-icon-button icon44"
                    aria-label={t("Cancel", "ยกเลิก")}
                    title={t("Cancel", "ยกเลิก")}
                    onClick={() => {
                      setNightForm(null);
                      setShowNightEditor(false);
                    }}
                  >
                    <ActionIcon kind="cancel" />
                  </Button>
                </form>
              )}
            </>
          )}
        </div>
      )}
      {planView === "accommodation" && (
        <div class="plan-stays">
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
                  <Button
                    type="button"
                    svgOnly
                    appearance="tertiary"
                    class="plan-icon-button icon44"
                    aria-label={t("Edit accommodation", "แก้ไขที่พัก")}
                    title={t("Edit accommodation", "แก้ไขที่พัก")}
                    onClick={() => {
                      setStayForm(stay);
                      setStayDate(stay.check_in_date);
                      setShowStayEditor(true);
                      requestEditorNavigation("stay");
                    }}
                  >
                    <ActionIcon kind="edit" />
                  </Button>
                  <Button
                    type="button"
                    svgOnly
                    appearance="tertiary"
                    class="plan-icon-button icon44 danger"
                    aria-label={t("Remove", "ลบ")}
                    title={t("Remove", "ลบ")}
                    onClick={() => void deleteStay(stay)}
                  >
                    <ActionIcon kind="remove" />
                  </Button>
                </>
              )}
            </article>
          ))}
          {organizer && (
            <>
              <Button
                type="button"
                svgOnly
                appearance="tertiary"
                class="plan-icon-button icon44"
                aria-label={t("Add accommodation", "เพิ่มที่พัก")}
                title={t("Add accommodation", "เพิ่มที่พัก")}
                aria-expanded={showStayEditor}
                onClick={() => {
                  setStayForm(null);
                  setStayDate(trip.start_date);
                  setShowStayEditor(true);
                  requestEditorNavigation("stay");
                }}
              >
                <ActionIcon kind="add" />
              </Button>
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
                  {stayForm && (
                    <p>
                      {t(
                        "Changes apply to this stay's entire check-in/check-out range.",
                        "การแก้ไขมีผลกับที่พักนี้ตลอดช่วงวันเข้าและวันออกที่ระบุ",
                      )}
                    </p>
                  )}
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
                      defaultValue={stayForm?.check_in_date ?? stayDate}
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
                        stayForm?.check_out_date ?? addDate(stayDate, 1)
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
                  <Button
                    type="submit"
                    svgOnly
                    appearance="tertiary"
                    class="plan-icon-button icon44"
                    aria-label={t("Save accommodation", "บันทึกที่พัก")}
                    title={t("Save accommodation", "บันทึกที่พัก")}
                  >
                    <ActionIcon kind="save" />
                  </Button>
                  <Button
                    type="button"
                    svgOnly
                    appearance="tertiary"
                    class="plan-icon-button icon44"
                    aria-label={t("Cancel", "ยกเลิก")}
                    title={t("Cancel", "ยกเลิก")}
                    onClick={() => {
                      setStayForm(null);
                      setShowStayEditor(false);
                    }}
                  >
                    <ActionIcon kind="cancel" />
                  </Button>
                </form>
              )}
            </>
          )}
        </div>
      )}
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
              {t("Destination time", "เวลาปลายทาง")}
              <input
                name="starts"
                type="time"
                defaultValue={
                  activityForm?.starts_at
                    ? toTripLocal(
                        activityForm.starts_at,
                        destinationTimezone,
                      ).slice(11)
                    : ""
                }
              />
            </label>
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
            <Button
              type="submit"
              svgOnly
              appearance="tertiary"
              class="plan-icon-button icon44"
              aria-label={t("Save activity", "บันทึกกิจกรรม")}
              title={t("Save activity", "บันทึกกิจกรรม")}
            >
              <ActionIcon kind="save" />
            </Button>
            <Button
              type="button"
              svgOnly
              appearance="tertiary"
              class="plan-icon-button icon44"
              aria-label={t("Cancel", "ยกเลิก")}
              title={t("Cancel", "ยกเลิก")}
              onClick={() => {
                setActivityForm(null);
                setShowActivityEditor(false);
              }}
            >
              <ActionIcon kind="cancel" />
            </Button>
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
function activityDestinationDate(activity: Activity, timezone: string) {
  return activity.starts_at
    ? toTripLocal(activity.starts_at, timezone).slice(0, 10)
    : activity.plan_date;
}

export default Plan;
