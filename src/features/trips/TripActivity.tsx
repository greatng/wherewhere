import { useEffect, useMemo, useState } from "preact/hooks";
import { useQuery } from "@tanstack/preact-query";
import { supabase } from "../../shared/supabase/client";
import {
  cacheTripData,
  localDb,
  pendingOperations,
  queueOperation,
  readCachedTripData,
} from "../offline/db";
import {
  calculateBalances,
  splitAmount,
  suggestSettlements,
} from "../expenses/money";

type Member = {
  id: string;
  trip_id: string;
  user_id: string | null;
  display_name: string;
  role: string;
  status: string;
  managed_by_user_id: string | null;
};
type Trip = {
  id: string;
  title: string;
  base_currency: string;
  timezone: string;
  start_date: string;
  end_date: string;
  status: string;
};
type Item = {
  id: string;
  trip_id: string;
  title: string;
  starts_at: string | null;
  address: string | null;
  latitude: number | null;
  longitude: number | null;
  meeting_info: string | null;
  notes: string | null;
  transport_mode: string | null;
  position: number;
  version: number;
};
type Expense = {
  id: string;
  trip_id: string;
  paid_by_member_id: string;
  amount_minor: number | string;
  currency: string;
  description: string;
  created_at: string;
  shares?: { trip_member_id: string; owed_minor: number | string }[];
};
type BalanceRow = { trip_member_id: string; net_minor: string };
type Settlement = {
  id: string;
  from_member_id: string;
  to_member_id: string;
  amount_minor: string;
  status: string;
};
type EmergencyCardData = {
  trip_id: string;
  hotel_name: string | null;
  hotel_address: string | null;
  hotel_phone: string | null;
  emergency_contact_name: string | null;
  emergency_contact_phone: string | null;
};
function localDateTime(value: string) {
  const d = new Date(value);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 16);
}
const id = () => crypto.randomUUID();
const errText = (e: unknown) =>
  e instanceof Error ? e.message : "Please try again when connected.";
function mayUseOfflineCache(error: unknown) {
  const candidate = error as { status?: number; code?: string } | null;
  if (
    candidate?.status === 401 ||
    candidate?.status === 403 ||
    candidate?.code === "42501" ||
    candidate?.code === "PGRST301"
  )
    return false;
  return !navigator.onLine || !candidate?.status || candidate.status >= 500;
}
function formatMinor(
  amount: bigint | number | string,
  currency: string,
  locale: string,
) {
  const value = BigInt(amount);
  let digits = 2;
  try {
    digits =
      new Intl.NumberFormat(locale, {
        style: "currency",
        currency,
      }).resolvedOptions().maximumFractionDigits ?? 2;
  } catch {
    /* Currency metadata fallback. */
  }
  const scale = 10n ** BigInt(digits);
  const abs = value < 0n ? -value : value;
  const major = abs / scale;
  const fraction = digits
    ? `.${String(abs % scale).padStart(digits, "0")}`
    : "";
  const formatted = new Intl.NumberFormat(locale).format(major);
  return `${value < 0n ? "−" : ""}${formatted}${fraction} ${currency}`;
}

export function TripActivity({
  trip,
  members,
  uid,
  thai,
}: {
  trip: Trip;
  members: Member[];
  uid: string;
  thai: boolean;
}) {
  const tr = (en: string, th: string) => (thai ? th : en);
  const approved = members.filter(
    (m) => m.trip_id === trip.id && m.status === "approved",
  );
  const tripMembers = members.filter((m) => m.trip_id === trip.id);
  const me = approved.find((m) => m.user_id === uid);
  const organizer = me?.role === "organizer";
  const [tab, setTab] = useState<"today" | "expenses">("today");
  const [senior, setSenior] = useState(false);
  const [editing, setEditing] = useState<Item | null>(null);
  const [notice, setNotice] = useState("");
  const [offline, setOffline] = useState(!navigator.onLine);
  useEffect(() => {
    const update = () => setOffline(!navigator.onLine);
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);
  const [pending, setPending] = useState(0);
  const [usingCache, setUsingCache] = useState(false);
  const itineraryQuery = useQuery({
    queryKey: ["itinerary", uid, trip.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("itinerary_items")
        .select("*")
        .eq("trip_id", trip.id)
        .order("starts_at")
        .order("position");
      if (error && mayUseOfflineCache(error)) {
        const local = await readCachedTripData<Item[]>(
          uid,
          trip.id,
          "itinerary",
        );
        if (local) {
          setUsingCache(true);
          return local;
        }
      }
      if (error) {
        throw error;
      }
      const rows = (data ?? []) as Item[];
      setUsingCache(false);
      await cacheTripData(uid, trip.id, "itinerary", rows);
      return rows;
    },
  });
  const expensesQuery = useQuery({
    queryKey: ["expenses", uid, trip.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("expenses")
        .select(
          "*,amount_minor::text,expense_shares(trip_member_id,owed_minor::text)",
        )
        .eq("trip_id", trip.id)
        .order("created_at", { ascending: false });
      if (error && mayUseOfflineCache(error)) {
        const local = await readCachedTripData<Expense[]>(
          uid,
          trip.id,
          "expenses",
        );
        if (local) {
          setUsingCache(true);
          return local;
        }
      }
      if (error) {
        throw error;
      }
      const rows = (data ?? []).map((row) => ({
        ...row,
        shares: row.expense_shares,
      })) as unknown as Expense[];
      setUsingCache(false);
      await cacheTripData(uid, trip.id, "expenses", rows);
      return rows as Expense[];
    },
  });
  const checkInsQuery = useQuery({
    queryKey: ["checkins", uid, trip.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("check_ins")
        .select("*")
        .eq("trip_id", trip.id)
        .order("checked_in_at", { ascending: false });
      if (error && mayUseOfflineCache(error)) {
        const local = await readCachedTripData<
          Array<{
            id: string;
            trip_member_id: string;
            itinerary_item_id: string;
          }>
        >(uid, trip.id, "checkins");
        if (local) return local;
      }
      if (error) throw error;
      const rows = data ?? [];
      await cacheTripData(uid, trip.id, "checkins", rows);
      return rows;
    },
  });
  const settlementsQuery = useQuery({
    queryKey: ["settlements", uid, trip.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("settlements")
        .select("*,amount_minor::text")
        .eq("trip_id", trip.id);
      if (error && mayUseOfflineCache(error)) {
        const local = await readCachedTripData<Settlement[]>(
          uid,
          trip.id,
          "settlements",
        );
        if (local) return local;
      }
      if (error) throw error;
      const rows = (data ?? []) as Settlement[];
      await cacheTripData(uid, trip.id, "settlements", rows);
      return rows;
    },
  });
  useEffect(() => {
    void (async () => {
      const { data, error } = await supabase
        .from("emergency_cards")
        .select("*")
        .eq("trip_id", trip.id)
        .maybeSingle();
      if (!error) await cacheTripData(uid, trip.id, "emergency", data);
    })();
  }, [uid, trip.id]);
  const serverBalancesQuery = useQuery({
    queryKey: ["balances", uid, trip.id],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("trip_balances", {
        p_trip_id: trip.id,
      });
      if (error && mayUseOfflineCache(error)) {
        const local = await readCachedTripData<BalanceRow[]>(
          uid,
          trip.id,
          "balances",
        );
        if (local) return local;
      }
      if (error) throw error;
      const rows = (data ?? []) as BalanceRow[];
      await cacheTripData(uid, trip.id, "balances", rows);
      return rows;
    },
  });
  const items = itineraryQuery.data ?? [];
  const expenses = expensesQuery.data ?? [];
  const balances = useMemo(
    () =>
      serverBalancesQuery.data?.length
        ? new Map<string, bigint>(
            serverBalancesQuery.data.map((row) => [
              row.trip_member_id,
              BigInt(row.net_minor),
            ]),
          )
        : calculateBalances(
            tripMembers.map((m) => ({ id: m.id })),
            expenses.map((e) => ({
              paid_by_member_id: e.paid_by_member_id,
              amount_minor: e.amount_minor,
              shares: e.shares?.map((s) => ({
                trip_member_id: s.trip_member_id,
                owed_minor: s.owed_minor,
              })),
            })),
            settlementsQuery.data ?? [],
          ),
    [tripMembers, expenses, settlementsQuery.data, serverBalancesQuery.data],
  );
  const settlements = suggestSettlements(balances);
  useEffect(() => {
    void pendingOperations(uid, trip.id).then((rows) =>
      setPending(rows.length),
    );
  }, [uid, trip.id]);
  useEffect(() => {
    const sync = async () => {
      if (!navigator.onLine) return;
      const ops = await pendingOperations(uid, trip.id);
      for (const op of ops) {
        if (op.state === "blocked") continue;
        try {
          await localDb.outbox.update(op.id, {
            state: "sending",
            error: undefined,
          });
          const { kind, payload } = op;
          const result =
            kind === "check_in"
              ? await supabase.rpc("check_in", { ...payload })
              : await supabase.rpc("create_expense", { ...payload });
          if (result.error) throw result.error;
          await localDb.outbox.delete(op.id);
          setNotice(tr("Sent and confirmed.", "ส่งและยืนยันแล้ว"));
          window.dispatchEvent(new Event("travelmate-data-updated"));
        } catch (e) {
          const code =
            typeof e === "object" && e !== null && "code" in e
              ? String((e as { code: unknown }).code)
              : "";
          if (code === "42501" || code === "PGRST301") {
            await localDb.outbox.update(op.id, {
              state: "blocked",
              error: errText(e),
            });
            setNotice(
              tr(
                "This item needs organizer help and remains saved on this device.",
                "รายการนี้ต้องให้ผู้จัดช่วยเหลือ และยังบันทึกอยู่ในอุปกรณ์",
              ),
            );
            continue;
          }
          await localDb.outbox.update(op.id, {
            state: "failed",
            error: errText(e),
          });
          setNotice(
            tr(
              "Could not send yet. Your item is saved and will retry when connected.",
              "ยังส่งไม่ได้ รายการถูกบันทึกและจะลองอีกครั้งเมื่อเชื่อมต่อ",
            ),
          );
          break;
        }
      }
      setPending((await pendingOperations(uid, trip.id)).length);
    };
    window.addEventListener("online", sync);
    window.addEventListener("focus", sync);
    window.addEventListener("travelmate-sync", sync);
    void sync();
    return () => {
      window.removeEventListener("online", sync);
      window.removeEventListener("focus", sync);
      window.removeEventListener("travelmate-sync", sync);
    };
  }, [uid, trip.id]);
  useEffect(() => {
    const refresh = () => {
      void itineraryQuery.refetch();
      void expensesQuery.refetch();
      void checkInsQuery.refetch();
      void settlementsQuery.refetch();
      void serverBalancesQuery.refetch();
    };
    window.addEventListener("travelmate-data-updated", refresh);
    return () => window.removeEventListener("travelmate-data-updated", refresh);
  }, [
    itineraryQuery.refetch,
    expensesQuery.refetch,
    checkInsQuery.refetch,
    settlementsQuery.refetch,
    serverBalancesQuery.refetch,
  ]);

  async function saveItem(e: Event) {
    e.preventDefault();
    setNotice("");
    const f = new FormData(e.currentTarget as HTMLFormElement);
    const starts = f.get("starts") as string;
    const { error } = await supabase.rpc("upsert_itinerary_item", {
      p_trip_id: trip.id,
      p_title: f.get("title"),
      p_starts_at: starts ? new Date(starts).toISOString() : null,
      p_address: f.get("address") || null,
      p_meeting_info: f.get("meeting") || null,
      p_notes: f.get("notes") || null,
      p_transport_mode: f.get("transport") || null,
      p_position: editing?.position ?? items.length,
      p_item_id: editing?.id ?? null,
      p_expected_version: editing?.version ?? null,
    });
    if (error) {
      setNotice(
        error.code === "40001"
          ? tr(
              "This stop changed elsewhere. Refresh and review the latest version.",
              "จุดหมายนี้ถูกแก้ไขจากอุปกรณ์อื่น กรุณารีเฟรชและตรวจสอบข้อมูลล่าสุด",
            )
          : tr(
              `Could not save stop: ${error.message}`,
              `บันทึกจุดหมายไม่สำเร็จ: ${error.message}`,
            ),
      );
      return;
    }
    setEditing(null);
    setNotice(tr("Stop saved.", "บันทึกจุดหมายแล้ว"));
    await itineraryQuery.refetch();
  }
  async function deleteItem(item: Item) {
    const { error } = await supabase.rpc("delete_itinerary_item", {
      p_trip_id: trip.id,
      p_item_id: item.id,
      p_expected_version: item.version,
    });
    if (error) {
      setNotice(
        error.code === "40001"
          ? tr(
              "This stop changed elsewhere. Refresh before deleting.",
              "จุดหมายนี้ถูกแก้ไขจากอุปกรณ์อื่น กรุณารีเฟรชก่อนลบ",
            )
          : tr(
              `Could not delete stop: ${error.message}`,
              `ลบจุดหมายไม่สำเร็จ: ${error.message}`,
            ),
      );
      return;
    }
    setNotice(tr("Stop deleted.", "ลบจุดหมายแล้ว"));
    await itineraryQuery.refetch();
  }
  async function recordSettlement(
    from: string,
    to: string,
    amountMinor: bigint,
  ) {
    const { error } = await supabase.rpc("record_settlement", {
      p_trip_id: trip.id,
      p_from_member_id: from,
      p_to_member_id: to,
      p_amount_minor: amountMinor.toString(),
      p_operation_id: id(),
    });
    setNotice(
      error
        ? tr(
            `Could not record payment: ${error.message}`,
            `บันทึกการชำระไม่สำเร็จ: ${error.message}`,
          )
        : tr(
            "Payment recorded as pending confirmation.",
            "บันทึกการชำระแล้ว รอการยืนยัน",
          ),
    );
    if (!error) window.dispatchEvent(new Event("travelmate-data-updated"));
  }
  async function confirmSettlement(settlementId: string) {
    const { error } = await supabase.rpc("confirm_settlement", {
      p_trip_id: trip.id,
      p_settlement_id: settlementId,
    });
    setNotice(
      error
        ? tr(
            `Could not confirm payment: ${error.message}`,
            `ยืนยันการชำระไม่สำเร็จ: ${error.message}`,
          )
        : tr("Payment confirmed.", "ยืนยันการชำระแล้ว"),
    );
    if (!error) window.dispatchEvent(new Event("travelmate-data-updated"));
  }
  async function checkIn(item: Item) {
    if (!me) return;
    const op = id();
    const payload = {
      p_trip_id: trip.id,
      p_member_id: me.id,
      p_item_id: item.id,
      p_operation_id: op,
    };
    await queueOperation({
      id: op,
      ownerId: uid,
      tripId: trip.id,
      kind: "check_in",
      payload,
    });
    setPending((await pendingOperations(uid, trip.id)).length);
    setNotice(
      tr(
        "Saved locally. Waiting for server confirmation.",
        "บันทึกแล้ว กำลังรอการยืนยันจากเซิร์ฟเวอร์",
      ),
    );
    if (navigator.onLine) window.dispatchEvent(new Event("travelmate-sync"));
  }
  async function saveExpense(e: Event) {
    e.preventDefault();
    setNotice("");
    const form = e.currentTarget as HTMLFormElement;
    const f = new FormData(form);
    const selected = approved
      .filter((m) => f.get(`share-${m.id}`) === "on")
      .map((m) => m.id);
    const amount = Number(f.get("amount"));
    try {
      if (!Number.isSafeInteger(amount))
        throw new Error(
          tr(
            "Amount exceeds the safe supported limit.",
            "จำนวนเงินเกินขีดจำกัดที่รองรับ",
          ),
        );
      const shares = splitAmount(amount, selected);
      const payer = String(f.get("payer"));
      const op = id();
      const payload = {
        p_trip_id: trip.id,
        p_payer_member_id: payer,
        p_amount_minor: String(amount),
        p_currency: trip.base_currency,
        p_description: String(f.get("description")),
        p_shares: shares.map((s) => ({
          member_id: s.memberId,
          owed_minor: String(s.owedMinor),
        })),
        p_operation_id: op,
      };
      await queueOperation({
        id: op,
        ownerId: uid,
        tripId: trip.id,
        kind: "expense",
        payload,
      });
      setPending((await pendingOperations(uid, trip.id)).length);
      setNotice(
        tr(
          "Saved locally. Waiting for server confirmation.",
          "บันทึกแล้ว กำลังรอการยืนยันจากเซิร์ฟเวอร์",
        ),
      );
      form.reset();
      if (navigator.onLine) window.dispatchEvent(new Event("travelmate-sync"));
    } catch (e) {
      setNotice(errText(e));
    }
  }
  const now = Date.now();
  const upcoming =
    items.find(
      (item) => item.starts_at && new Date(item.starts_at).getTime() >= now,
    ) ?? items.at(-1);
  return (
    <section class={senior ? "activity senior" : "activity"}>
      <div class="activity-heading">
        <div>
          <h2>{tr("Trip details", "รายละเอียดทริป")}</h2>
          <p>
            {trip.title} · {trip.base_currency}
          </p>
        </div>
        <button
          type="button"
          aria-pressed={senior}
          onClick={() => setSenior(!senior)}
        >
          {senior
            ? tr("Standard view", "มุมมองปกติ")
            : tr("Senior view", "มุมมองผู้สูงวัย")}
        </button>
      </div>
      {offline && (
        <p role="status">
          {tr(
            "Offline — showing saved trip data. Updates will send when connected.",
            "ออฟไลน์ — แสดงข้อมูลที่บันทึกไว้ จะส่งรายการเมื่อเชื่อมต่อ",
          )}
        </p>
      )}
      {notice && (
        <p role="status" class="notice">
          {notice}
        </p>
      )}
      {usingCache && (
        <p role="status" class="pending">
          {tr(
            "Showing saved trip details from this device.",
            "กำลังแสดงข้อมูลทริปที่บันทึกไว้ในอุปกรณ์นี้",
          )}
        </p>
      )}
      {pending > 0 && (
        <p role="status" class="pending">
          {tr(
            `${pending} item(s) waiting to send`,
            `มี ${pending} รายการรอส่ง`,
          )}
        </p>
      )}
      <nav
        class="activity-tabs"
        aria-label={tr("Trip sections", "ส่วนของทริป")}
      >
        <button
          type="button"
          aria-current={tab === "today" ? "page" : undefined}
          onClick={() => setTab("today")}
        >
          {tr("Today & check-in", "วันนี้และเช็กอิน")}
        </button>
        <button
          type="button"
          aria-current={tab === "expenses" ? "page" : undefined}
          onClick={() => setTab("expenses")}
        >
          {tr("Expenses", "ค่าใช้จ่าย")}
        </button>
      </nav>
      {tab === "today" ? (
        <>
          <div class="next-stop">
            <strong>{tr("Next destination", "จุดหมายถัดไป")}</strong>
            {upcoming ? (
              <>
                <h3>{upcoming.title}</h3>
                <p>
                  {upcoming.starts_at
                    ? new Date(upcoming.starts_at).toLocaleString(
                        thai ? "th-TH" : "en",
                        { dateStyle: "medium", timeStyle: "short" },
                      )
                    : tr("Time to be confirmed", "รอยืนยันเวลา")}
                </p>
                {upcoming.address && <p>{upcoming.address}</p>}
                {upcoming.meeting_info && <p>{upcoming.meeting_info}</p>}
                <a
                  class="map-link"
                  href={
                    upcoming.latitude != null && upcoming.longitude != null
                      ? `https://www.google.com/maps/dir/?api=1&destination=${upcoming.latitude},${upcoming.longitude}`
                      : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(upcoming.address || upcoming.title)}`
                  }
                  target="_blank"
                  rel="noreferrer"
                >
                  {tr("Open directions", "เปิดเส้นทางในแผนที่")}
                </a>
                {me && (
                  <button
                    class="checkin"
                    type="button"
                    onClick={() => void checkIn(upcoming)}
                  >
                    {tr("I'm Here", "ฉันมาถึงแล้ว")}
                  </button>
                )}
              </>
            ) : (
              <p>{tr("No stops added yet.", "ยังไม่มีจุดหมาย")}</p>
            )}
          </div>
          <h3>{tr("Itinerary", "กำหนดการเดินทาง")}</h3>
          {itineraryQuery.isError && (
            <p role="alert">
              {tr(
                "Could not load itinerary. Try again when connected.",
                "โหลดกำหนดการไม่ได้ กรุณาลองใหม่เมื่อเชื่อมต่ออินเทอร์เน็ต",
              )}
            </p>
          )}
          {items.map((item, index) => (
            <article class="stop" key={item.id}>
              <div>
                <span class="stop-number">{index + 1}</span>
                <strong>{item.title}</strong>
              </div>
              {item.starts_at && (
                <p>
                  {new Date(item.starts_at).toLocaleString(
                    thai ? "th-TH" : "en",
                    { dateStyle: "medium", timeStyle: "short" },
                  )}
                </p>
              )}
              {item.address && <p>{item.address}</p>}
              {item.notes && <p>{item.notes}</p>}
              {!organizer && me && (
                <button type="button" onClick={() => void checkIn(item)}>
                  {tr("I'm Here", "ฉันมาถึงแล้ว")}
                </button>
              )}
              {organizer && (
                <>
                  <button type="button" onClick={() => setEditing(item)}>
                    {tr("Edit stop", "แก้ไขจุดหมาย")}
                  </button>
                  <button type="button" onClick={() => void deleteItem(item)}>
                    {tr("Delete stop", "ลบจุดหมาย")}
                  </button>
                </>
              )}
            </article>
          ))}
          {organizer && (
            <form key={editing?.id ?? "new-stop"} onSubmit={saveItem}>
              <h3>
                {editing
                  ? tr("Edit stop", "แก้ไขจุดหมาย")
                  : tr("Add a stop", "เพิ่มจุดหมาย")}
              </h3>
              <label>
                {tr("Place or activity", "สถานที่หรือกิจกรรม")}
                <input
                  required
                  name="title"
                  maxLength={160}
                  defaultValue={editing?.title}
                />
              </label>
              <label>
                {tr(
                  "Date and time (device timezone)",
                  "วันและเวลา (เขตเวลาของอุปกรณ์)",
                )}
                <input
                  name="starts"
                  type="datetime-local"
                  defaultValue={
                    editing?.starts_at ? localDateTime(editing.starts_at) : ""
                  }
                />
              </label>
              <label>
                {tr("Address", "ที่อยู่")}
                <input
                  name="address"
                  maxLength={500}
                  defaultValue={editing?.address ?? ""}
                />
              </label>
              <label>
                {tr("Meeting point", "จุดนัดพบ")}
                <input
                  name="meeting"
                  maxLength={300}
                  defaultValue={editing?.meeting_info ?? ""}
                />
              </label>
              <label>
                {tr("Notes", "หมายเหตุ")}
                <textarea
                  name="notes"
                  maxLength={1000}
                  defaultValue={editing?.notes ?? ""}
                />
              </label>
              <label>
                {tr("Transport", "การเดินทาง")}
                <select
                  name="transport"
                  defaultValue={editing?.transport_mode ?? ""}
                >
                  <option value="">
                    {tr("Choose (optional)", "เลือก (ไม่บังคับ)")}
                  </option>
                  {["walk", "car", "taxi", "bus", "train", "boat", "other"].map(
                    (x) => (
                      <option value={x}>
                        {tr(
                          x,
                          (
                            {
                              walk: "เดิน",
                              car: "รถยนต์",
                              taxi: "แท็กซี่",
                              bus: "รถบัส",
                              train: "รถไฟ",
                              boat: "เรือ",
                              other: "อื่น ๆ",
                            } as Record<string, string>
                          )[x],
                        )}
                      </option>
                    ),
                  )}
                </select>
              </label>
              <button>{tr("Save stop", "บันทึกจุดหมาย")}</button>
              {editing && (
                <button type="button" onClick={() => setEditing(null)}>
                  {tr("Cancel", "ยกเลิก")}
                </button>
              )}
            </form>
          )}
          <h3>{tr("Who's checked in", "ใครเช็กอินแล้ว")}</h3>
          {checkInsQuery.isError ? (
            <p role="status">
              {tr(
                "Attendance unavailable offline. Reconnect to refresh.",
                "ข้อมูลเช็กอินยังดูไม่ได้ขณะออฟไลน์ กรุณาเชื่อมต่อเพื่อโหลดใหม่",
              )}
            </p>
          ) : (
            <>
              <p>
                {upcoming
                  ? approved.filter((m) =>
                      checkInsQuery.data?.some(
                        (c) =>
                          c.trip_member_id === m.id &&
                          c.itinerary_item_id === upcoming.id,
                      ),
                    ).length
                  : 0}{" "}
                / {approved.length}{" "}
                {tr("checked in for next stop", "เช็กอินสำหรับจุดหมายถัดไป")}
              </p>
              {approved.map((m) => (
                <p class="attendance" key={m.id}>
                  {m.display_name} —{" "}
                  {checkInsQuery.data?.some(
                    (c) =>
                      c.trip_member_id === m.id &&
                      c.itinerary_item_id === upcoming?.id,
                  )
                    ? tr("Checked in", "เช็กอินแล้ว")
                    : tr("Not checked in", "ยังไม่เช็กอิน")}
                </p>
              ))}
            </>
          )}
        </>
      ) : (
        <>
          <h3>{tr("Add shared expense", "เพิ่มค่าใช้จ่ายส่วนกลาง")}</h3>
          <p>
            {tr(
              "Enter whole minor units (THB: satang). The split uses whole units; any remainder goes to the first selected travelers.",
              "กรอกจำนวนหน่วยย่อยเป็นจำนวนเต็ม (THB: สตางค์) เศษที่หารไม่ลงตัวจะเพิ่มให้ผู้เดินทางที่เลือกคนแรก",
            )}
          </p>
          <form onSubmit={saveExpense}>
            <label>
              {tr("What was it for?", "ค่าอะไร")}
              <input name="description" required maxLength={240} />
            </label>
            <label>
              {tr(
                `Amount in minor units (${trip.base_currency}${trip.base_currency === "THB" ? " satang" : ""})`,
                `จำนวนหน่วยย่อย (${trip.base_currency}${trip.base_currency === "THB" ? " สตางค์" : ""})`,
              )}
              <input name="amount" type="number" min="1" step="1" required />
            </label>
            <label>
              {tr("Paid by", "ผู้จ่าย")}
              <select name="payer" required>
                {approved.map((m) => (
                  <option value={m.id}>{m.display_name}</option>
                ))}
              </select>
            </label>
            <fieldset>
              <legend>{tr("Split between", "หารระหว่าง")}</legend>
              {approved.map((m) => (
                <label class="check-option">
                  <input
                    type="checkbox"
                    name={`share-${m.id}`}
                    defaultChecked
                  />
                  {m.display_name}
                </label>
              ))}
            </fieldset>
            <button>{tr("Save expense", "บันทึกค่าใช้จ่าย")}</button>
          </form>
          <h3>{tr("Balances", "ยอดคงเหลือ")}</h3>
          {tripMembers.map((m) => {
            const value = balances.get(m.id) ?? 0n;
            return (
              <p class="balance" key={m.id}>
                {m.display_name}
                {m.status !== "approved"
                  ? ` (${tr("removed", "นำออกแล้ว")})`
                  : ""}
                :{" "}
                <strong>
                  {value > 0n
                    ? tr("is owed", "มีคนต้องคืน")
                    : value < 0n
                      ? tr("owes", "ต้องจ่าย")
                      : tr("settled", "เรียบร้อย")}{" "}
                  {formatMinor(
                    value < 0n ? -value : value,
                    trip.base_currency,
                    thai ? "th-TH" : "en",
                  )}
                </strong>
              </p>
            );
          })}
          {settlements.length > 0 && (
            <>
              <h3>{tr("Suggested settlements", "รายการแนะนำให้ชำระ")}</h3>
              {settlements.map((s) => (
                <p>
                  {tripMembers.find((m) => m.id === s.from)?.display_name}{" "}
                  {tr("pays", "จ่ายให้")}{" "}
                  {tripMembers.find((m) => m.id === s.to)?.display_name}:{" "}
                  {formatMinor(
                    s.amountMinor,
                    trip.base_currency,
                    thai ? "th-TH" : "en",
                  )}{" "}
                  {(organizer || me?.id === s.from) && (
                    <button
                      type="button"
                      onClick={() =>
                        void recordSettlement(s.from, s.to, s.amountMinor)
                      }
                    >
                      {tr("Record payment", "บันทึกการชำระ")}
                    </button>
                  )}
                </p>
              ))}
            </>
          )}
          {(settlementsQuery.data as Settlement[] | undefined)
            ?.filter((s) => s.status === "pending")
            .map((s) => (
              <p class="pending">
                {
                  tripMembers.find((m) => m.id === s.from_member_id)
                    ?.display_name
                }{" "}
                {tr("paid", "ชำระแล้ว")}{" "}
                {tripMembers.find((m) => m.id === s.to_member_id)?.display_name}
                :{" "}
                {formatMinor(
                  s.amount_minor,
                  trip.base_currency,
                  thai ? "th-TH" : "en",
                )}{" "}
                · {tr("Awaiting confirmation", "รอการยืนยัน")}
                {(organizer ||
                  me?.id === s.to_member_id ||
                  tripMembers.some(
                    (m) =>
                      m.id === s.to_member_id && m.managed_by_user_id === uid,
                  )) && (
                  <button
                    type="button"
                    onClick={() => void confirmSettlement(s.id)}
                  >
                    {tr("Confirm received", "ยืนยันว่าได้รับแล้ว")}
                  </button>
                )}
              </p>
            ))}
          <h3>{tr("Recent expenses", "ค่าใช้จ่ายล่าสุด")}</h3>
          {expenses.length ? (
            expenses.map((e) => (
              <article class="stop">
                <strong>{e.description}</strong>
                <p>
                  {
                    approved.find((m) => m.id === e.paid_by_member_id)
                      ?.display_name
                  }{" "}
                  ·{" "}
                  {formatMinor(
                    e.amount_minor,
                    e.currency,
                    thai ? "th-TH" : "en",
                  )}
                </p>
                {e.shares?.map((s) => (
                  <small>
                    {
                      approved.find((m) => m.id === s.trip_member_id)
                        ?.display_name
                    }
                    :{" "}
                    {formatMinor(
                      s.owed_minor,
                      e.currency,
                      thai ? "th-TH" : "en",
                    )}{" "}
                    ·{" "}
                  </small>
                ))}
              </article>
            ))
          ) : (
            <p>{tr("No expenses yet.", "ยังไม่มีค่าใช้จ่าย")}</p>
          )}
        </>
      )}
      {senior && (
        <EmergencyCard
          tripId={trip.id}
          organizer={organizer}
          thai={thai}
          ownerId={uid}
        />
      )}
    </section>
  );
}

function EmergencyCard({
  tripId,
  organizer,
  thai,
  ownerId,
}: {
  tripId: string;
  organizer: boolean;
  thai: boolean;
  ownerId: string;
}) {
  const tr = (en: string, th: string) => (thai ? th : en);
  const [message, setMessage] = useState("");
  const [card, setCard] = useState<EmergencyCardData | null>();
  useEffect(() => {
    void (async () => {
      const { data, error } = await supabase
        .from("emergency_cards")
        .select("*")
        .eq("trip_id", tripId)
        .maybeSingle();
      if (!error) {
        setCard(data);
        await cacheTripData(ownerId, tripId, "emergency", data);
        return;
      }
      if (!navigator.onLine)
        setCard(await readCachedTripData(ownerId, tripId, "emergency"));
    })();
  }, [tripId]);
  async function save(e: Event) {
    e.preventDefault();
    const f = new FormData(e.currentTarget as HTMLFormElement);
    const { error } = await supabase.rpc("upsert_emergency_card", {
      p_trip_id: tripId,
      p_hotel_name: f.get("hotel") || null,
      p_hotel_address: f.get("address") || null,
      p_hotel_phone: f.get("hotelPhone") || null,
      p_emergency_contact_name: f.get("contact") || null,
      p_emergency_contact_phone: f.get("phone") || null,
    });
    setMessage(
      error
        ? tr(
            "Could not save emergency details.",
            "บันทึกข้อมูลฉุกเฉินไม่สำเร็จ",
          )
        : tr("Emergency details saved.", "บันทึกข้อมูลฉุกเฉินแล้ว"),
    );
    if (!error) {
      const { data } = await supabase
        .from("emergency_cards")
        .select("*")
        .eq("trip_id", tripId)
        .maybeSingle();
      setCard(data);
      await cacheTripData(ownerId, tripId, "emergency", data);
    }
  }
  return (
    <div class="help-card">
      <strong>
        {tr("Hotel & emergency contacts", "ที่พักและเบอร์ติดต่อฉุกเฉิน")}
      </strong>
      {card?.hotel_name && (
        <p>
          <strong>{card.hotel_name}</strong>
          <br />
          {card.hotel_address}
          <br />
          {card.hotel_phone && (
            <a href={`tel:${card.hotel_phone}`}>
              {tr("Call hotel", "โทรหาที่พัก")}: {card.hotel_phone}
            </a>
          )}
        </p>
      )}
      {card?.emergency_contact_name && (
        <p>
          {tr("Family contact", "ผู้ติดต่อในครอบครัว")}:{" "}
          {card.emergency_contact_name}
          <br />
          <a href={`tel:${card.emergency_contact_phone}`}>
            {tr("Call", "โทร")}: {card.emergency_contact_phone}
          </a>
        </p>
      )}
      {message && <p role="status">{message}</p>}
      {organizer && (
        <details>
          <summary>
            {tr("Edit emergency details", "แก้ไขข้อมูลฉุกเฉิน")}
          </summary>
          <form onSubmit={save}>
            <label>
              {tr("Hotel name", "ชื่อที่พัก")}
              <input name="hotel" defaultValue={card?.hotel_name ?? ""} />
            </label>
            <label>
              {tr("Hotel address", "ที่อยู่ที่พัก")}
              <input name="address" defaultValue={card?.hotel_address ?? ""} />
            </label>
            <label>
              {tr("Hotel phone", "โทรศัพท์ที่พัก")}
              <input
                name="hotelPhone"
                type="tel"
                defaultValue={card?.hotel_phone ?? ""}
              />
            </label>
            <label>
              {tr("Family contact", "ผู้ติดต่อในครอบครัว")}
              <input
                name="contact"
                defaultValue={card?.emergency_contact_name ?? ""}
              />
            </label>
            <label>
              {tr("Contact phone", "เบอร์ติดต่อ")}
              <input
                name="phone"
                type="tel"
                defaultValue={card?.emergency_contact_phone ?? ""}
              />
            </label>
            <button>{tr("Save", "บันทึก")}</button>
          </form>
        </details>
      )}
    </div>
  );
}
