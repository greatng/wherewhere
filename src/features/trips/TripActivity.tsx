import { Button } from "../../shared/ui/Button";
import { ActionIcon } from "../../shared/ActionIcon";
import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import type { ComponentChildren } from "preact";
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
  currencyDigits,
  parseMajorAmount,
  splitAmount,
  suggestSettlements,
} from "../expenses/money";
import Plan from "../plan/Plan";
import { tripWallTimeToIso } from "../plan/timezone";
import { formatDateLabel } from "../plan/dates";
import {
  claimOperation,
  discardOperation,
  queuedOperationCount,
  retryOperation,
} from "../offline/actions";
import { todayStops, stopsForTripDay } from "./today";
import { revealEditor } from "../../shared/editor-navigation";

function revealOpenEditor(event: Event) {
  const details = event.currentTarget as HTMLDetailsElement;
  if (details.open) revealEditor(details.querySelector("form"));
}

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
  plan_date?: string | null;
};
type Expense = {
  id: string;
  trip_id: string;
  paid_by_member_id: string;
  amount_minor: number | string;
  currency: string;
  description: string;
  created_at: string;
  expense_date?: string | null;
  expense_time?: string | null;
  version?: number;
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
type ExpenseRevision = {
  id: string;
  expense_id: string;
  changed_at: string;
  previous_version: number;
  previous_values: {
    expense?: {
      amount_minor: number | string;
      currency: string;
      description: string;
    };
  };
  result_values: {
    expense?: {
      amount_minor: number | string;
      currency: string;
      description: string;
    };
  } | null;
};
type EmergencyCardData = {
  trip_id: string;
  hotel_name: string | null;
  hotel_address: string | null;
  hotel_phone: string | null;
  emergency_contact_name: string | null;
  emergency_contact_phone: string | null;
};
type NightDestination = {
  trip_id: string;
  night_date: string;
  city: string;
  transport_mode: string | null;
  version: number;
};
type StaySummary = {
  id: string;
  trip_id: string;
  check_in_date: string;
  check_out_date: string;
  name: string;
  address: string | null;
  phone: string | null;
  version: number;
};
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
function minorToMajorInput(
  amount: bigint | number | string,
  currency: string,
  locale: string,
) {
  const digits = currencyDigits(currency, locale);
  const value = BigInt(amount);
  const scale = 10n ** BigInt(digits);
  const whole = value / scale;
  if (!digits) return whole.toString();
  return `${whole}.${(value % scale).toString().padStart(digits, "0")}`;
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

export function TripActivity({
  trip,
  members,
  uid,
  thai,
  tripSettings,
}: {
  trip: Trip;
  members: Member[];
  uid: string;
  thai: boolean;
  tripSettings?: ComponentChildren;
}) {
  const tr = (en: string, th: string) => (thai ? th : en);
  const destinationTimezone = trip.timezone;
  const approved = members.filter(
    (m) => m.trip_id === trip.id && m.status === "approved",
  );
  const tripMembers = members.filter((m) => m.trip_id === trip.id);
  const me = approved.find((m) => m.user_id === uid);
  const organizer = me?.role === "organizer";
  const [tab, setTab] = useState<"today" | "plan" | "expenses" | "trip">(
    "today",
  );
  const seniorKey = `travelmate-senior:${uid}`;
  const [senior, setSenior] = useState(
    () => localStorage.getItem(seniorKey) === "true",
  );
  const [editing, setEditing] = useState<Item | null>(null);
  const stopEditor = useRef<HTMLDetailsElement>(null);
  const [stopEditorOpen, setStopEditorOpen] = useState(false);
  const [notice, setNotice] = useState("");
  const [offline, setOffline] = useState(!navigator.onLine);
  useEffect(() => {
    setSenior(localStorage.getItem(seniorKey) === "true");
  }, [seniorKey]);
  useEffect(() => {
    localStorage.setItem(seniorKey, String(senior));
    if (senior) setTab("today");
  }, [seniorKey, senior]);
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
  const [outbox, setOutbox] = useState<
    Awaited<ReturnType<typeof pendingOperations>>
  >([]);
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
  const expenseRevisionsQuery = useQuery({
    queryKey: ["expense-revisions", uid, trip.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("expense_revisions")
        .select(
          "id,expense_id,changed_at,previous_version,previous_values,result_values",
        )
        .eq("trip_id", trip.id)
        .order("changed_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as ExpenseRevision[];
    },
  });
  const tonightDate = (() => {
    const date = new Intl.DateTimeFormat("en-CA", {
      timeZone: destinationTimezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());
    return date < trip.start_date
      ? trip.start_date
      : date > trip.end_date
        ? trip.end_date
        : date;
  })();
  const tripToday = new Intl.DateTimeFormat("en-CA", {
    timeZone: destinationTimezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  const tonightLabel =
    tripToday < trip.start_date
      ? tr("First planned night", "คืนแรกตามแผน")
      : tripToday > trip.end_date
        ? tr("Last planned night", "คืนสุดท้ายตามแผน")
        : tr("Tonight", "คืนนี้");
  const tonightQuery = useQuery({
    queryKey: ["tonight", uid, trip.id],
    queryFn: async () => {
      const [
        { data: nights, error: nightError },
        { data: stays, error: stayError },
      ] = await Promise.all([
        supabase
          .from("nightly_destinations")
          .select("*")
          .eq("trip_id", trip.id)
          .order("night_date"),
        supabase
          .from("stays")
          .select("*")
          .eq("trip_id", trip.id)
          .order("check_in_date"),
      ]);
      if (
        (nightError && mayUseOfflineCache(nightError)) ||
        (stayError && mayUseOfflineCache(stayError))
      ) {
        const [cachedNights, cachedStays] = await Promise.all([
          readCachedTripData<NightDestination[]>(uid, trip.id, "nightly_plan"),
          readCachedTripData<StaySummary[]>(uid, trip.id, "stays"),
        ]);
        if (cachedNights || cachedStays)
          return {
            night: cachedNights?.find((x) => x.night_date === tonightDate),
            stay: cachedStays?.find(
              (x) =>
                x.check_in_date <= tonightDate &&
                x.check_out_date > tonightDate,
            ),
          };
      }
      if (nightError) throw nightError;
      if (stayError) throw stayError;
      const nightRows = (nights ?? []) as NightDestination[];
      const stayRows = (stays ?? []) as StaySummary[];
      await Promise.all([
        cacheTripData(uid, trip.id, "nightly_plan", nightRows),
        cacheTripData(uid, trip.id, "stays", stayRows),
      ]);
      return {
        night: nightRows.find((x) => x.night_date === tonightDate),
        stay: stayRows.find(
          (x) =>
            x.check_in_date <= tonightDate && x.check_out_date > tonightDate,
        ),
      };
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
  const refreshOutbox = async () => {
    const rows = await pendingOperations(uid, trip.id);
    setOutbox(rows);
    setPending(queuedOperationCount(rows));
  };
  useEffect(() => {
    void refreshOutbox();
    const refresh = () => void refreshOutbox();
    window.addEventListener("travelmate-outbox-updated", refresh);
    return () =>
      window.removeEventListener("travelmate-outbox-updated", refresh);
  }, [uid, trip.id]);
  useEffect(() => {
    let disposed = false;
    let syncing = false;
    const sync = async () => {
      if (!navigator.onLine || disposed || syncing) return;
      syncing = true;
      try {
        const ops = await pendingOperations(uid, trip.id);
        for (const op of ops) {
          if (disposed) break;
          if (op.state === "blocked") continue;
          try {
            if (!(await claimOperation(op.id, uid, trip.id))) continue;
            const { data: sessionData } = await supabase.auth.getSession();
            if (disposed || sessionData.session?.user.id !== uid) break;
            const { kind, payload } = op;
            const result =
              kind === "check_in"
                ? await supabase.rpc("check_in", { ...payload })
                : await supabase.rpc("create_expense", { ...payload });
            if (result.error) throw result.error;
            await localDb.outbox.delete(op.id);
            if (!disposed)
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
              if (!disposed)
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
            if (!disposed)
              setNotice(
                tr(
                  "Could not send yet. Your item is saved and will retry when connected.",
                  "ยังส่งไม่ได้ รายการถูกบันทึกและจะลองอีกครั้งเมื่อเชื่อมต่อ",
                ),
              );
            break;
          }
        }
        if (!disposed) await refreshOutbox();
      } finally {
        syncing = false;
      }
    };
    window.addEventListener("online", sync);
    window.addEventListener("focus", sync);
    window.addEventListener("travelmate-sync", sync);
    void sync();
    return () => {
      disposed = true;
      window.removeEventListener("online", sync);
      window.removeEventListener("focus", sync);
      window.removeEventListener("travelmate-sync", sync);
    };
  }, [uid, trip.id]);
  useEffect(() => {
    const refresh = () => {
      void itineraryQuery.refetch();
      void expensesQuery.refetch();
      void settlementsQuery.refetch();
      void serverBalancesQuery.refetch();
    };
    window.addEventListener("travelmate-data-updated", refresh);
    return () => window.removeEventListener("travelmate-data-updated", refresh);
  }, [
    itineraryQuery.refetch,
    expensesQuery.refetch,
    settlementsQuery.refetch,
    serverBalancesQuery.refetch,
  ]);

  async function saveItem(e: Event) {
    e.preventDefault();
    setNotice("");
    const f = new FormData(e.currentTarget as HTMLFormElement);
    const date = String(f.get("date") || "");
    const time = String(f.get("time") || "");
    let starts: string | null = null;
    try {
      if (time && !date)
        throw new RangeError(
          tr("Choose a day for this time.", "กรุณาเลือกวันที่สำหรับเวลานี้"),
        );
      starts =
        date && time
          ? tripWallTimeToIso(`${date}T${time}`, destinationTimezone)
          : null;
    } catch (error) {
      setNotice(
        error instanceof Error
          ? error.message
          : tr(
              "Check the activity date and time.",
              "กรุณาตรวจสอบวันที่และเวลากิจกรรม",
            ),
      );
      return;
    }
    const { error } = await supabase.rpc("upsert_itinerary_item", {
      p_trip_id: trip.id,
      p_title: f.get("title"),
      p_starts_at: starts,
      p_address: f.get("address") || null,
      p_meeting_info: f.get("meeting") || null,
      p_notes: f.get("notes") || null,
      p_transport_mode: f.get("transport") || null,
      p_position: editing?.position ?? items.length,
      p_item_id: editing?.id ?? null,
      p_expected_version: editing?.version ?? null,
      p_plan_date: date || null,
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
    setStopEditorOpen(false);
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
  async function saveExpense(e: Event) {
    e.preventDefault();
    setNotice("");
    const form = e.currentTarget as HTMLFormElement;
    const f = new FormData(form);
    const selected = approved
      .filter((m) => f.get(`share-${m.id}`) === "on")
      .map((m) => m.id);
    try {
      const amount = parseMajorAmount(
        String(f.get("amount")),
        trip.base_currency,
        thai ? "th-TH" : "en",
      );
      if (amount <= 0n)
        throw new Error(
          tr("Amount must be greater than zero.", "จำนวนเงินต้องมากกว่าศูนย์"),
        );
      if (amount > BigInt(Number.MAX_SAFE_INTEGER))
        throw new Error(
          tr(
            "Amount exceeds the supported limit.",
            "จำนวนเงินเกินขีดจำกัดที่รองรับ",
          ),
        );
      const shares = splitAmount(Number(amount), selected);
      const payer = String(f.get("payer"));
      const op = id();
      const payload = {
        p_trip_id: trip.id,
        p_payer_member_id: payer,
        p_amount_minor: amount.toString(),
        p_currency: trip.base_currency,
        p_description: String(f.get("description")),
        p_expense_date: f.get("expenseDate") || null,
        p_expense_time: f.get("expenseTime") || null,
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
      await refreshOutbox();
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
  async function correctExpense(e: Event, expense: Expense) {
    e.preventDefault();
    const f = new FormData(e.currentTarget as HTMLFormElement);
    try {
      const amount = parseMajorAmount(
        String(f.get("amount")),
        expense.currency,
        thai ? "th-TH" : "en",
      );
      if (amount <= 0n || amount > BigInt(Number.MAX_SAFE_INTEGER))
        throw new Error(
          tr("Enter a valid supported amount.", "กรุณากรอกจำนวนเงินที่รองรับ"),
        );
      const selected = approved
        .filter((m) => f.get(`share-${m.id}`) === "on")
        .map((m) => m.id);
      const { error } = await supabase.rpc("correct_expense", {
        p_trip_id: trip.id,
        p_expense_id: expense.id,
        p_expected_version: expense.version ?? 1,
        p_payer_member_id: String(f.get("payer")),
        p_amount_minor: amount.toString(),
        p_currency: expense.currency,
        p_description: String(f.get("description")),
        p_shares: splitAmount(Number(amount), selected).map((s) => ({
          member_id: s.memberId,
          owed_minor: String(s.owedMinor),
        })),
        p_operation_id: id(),
        p_expense_date: f.get("expenseDate") || null,
        p_expense_time: f.get("expenseTime") || null,
      });
      if (error) throw error;
      setNotice(tr("Expense corrected.", "แก้ไขค่าใช้จ่ายแล้ว"));
      await Promise.all([
        expensesQuery.refetch(),
        expenseRevisionsQuery.refetch(),
        serverBalancesQuery.refetch(),
      ]);
    } catch (error) {
      const code =
        typeof error === "object" && error !== null && "code" in error
          ? String((error as { code: unknown }).code)
          : "";
      setNotice(
        code === "40001"
          ? tr(
              "This expense changed elsewhere. Refresh and review the latest version.",
              "ค่าใช้จ่ายนี้ถูกแก้ไขจากอุปกรณ์อื่น กรุณารีเฟรชและตรวจสอบข้อมูลล่าสุด",
            )
          : errText(error),
      );
    }
  }
  const now = new Date();
  const chosenStopKey = `travelmate-current-stop:${uid}:${trip.id}`;
  const [chosenStopId, setChosenStopId] = useState(
    () => localStorage.getItem(chosenStopKey) ?? "",
  );
  useEffect(
    () => setChosenStopId(localStorage.getItem(chosenStopKey) ?? ""),
    [chosenStopKey],
  );
  const today = todayStops(
    items,
    trip,
    now,
    destinationTimezone,
    chosenStopId || undefined,
  );
  const todayItems =
    today.state === "trip-finished" || today.state === "before-trip"
      ? []
      : stopsForTripDay(items, today.day, destinationTimezone);
  const upcoming = today.next;
  const current = today.current;
  const heroStop = chosenStopId ? (current ?? upcoming) : upcoming;
  return (
    <section
      class={
        senior
          ? "activity senior"
          : tab === "plan"
            ? "activity activity-plan"
            : "activity"
      }
    >
      <div class="activity-heading">
        <div>
          <h2>{tr("Trip details", "รายละเอียดทริป")}</h2>
          <p>
            {trip.title} · {trip.base_currency}
          </p>
        </div>
        <Button
          type="button"
          aria-pressed={senior}
          onClick={() => setSenior(!senior)}
        >
          {senior
            ? tr("Exit senior view", "ออกจากมุมมองผู้สูงวัย")
            : tr("Senior view", "มุมมองผู้สูงวัย")}
        </Button>
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
      {outbox.length > 0 && (
        <details class="offline-queue">
          <summary>
            {tr("Saved on this device", "บันทึกไว้ในอุปกรณ์นี้")} (
            {outbox.length})
          </summary>
          {outbox.map((op) => (
            <article class="offline-operation" key={op.id}>
              <strong>
                {op.kind === "check_in"
                  ? tr("Previous check-in", "เช็กอินเดิม")
                  : tr("Expense", "ค่าใช้จ่าย")}
              </strong>
              <span>
                {tr(
                  op.state === "pending"
                    ? "Waiting to send"
                    : op.state === "sending"
                      ? "Sending"
                      : op.state === "failed"
                        ? "Failed"
                        : "Needs organizer help",
                  op.state === "pending"
                    ? "รอส่ง"
                    : op.state === "sending"
                      ? "กำลังส่ง"
                      : op.state === "failed"
                        ? "ส่งไม่สำเร็จ"
                        : "ต้องให้ผู้จัดช่วยเหลือ",
                )}
              </span>
              {op.error && <p role="alert">{op.error}</p>}
              {(op.state === "failed" || op.state === "blocked") && (
                <Button
                  type="button"
                  onClick={async () => {
                    await retryOperation(op.id, uid, trip.id);
                    await refreshOutbox();
                    window.dispatchEvent(new Event("travelmate-sync"));
                  }}
                >
                  {tr("Retry", "ลองอีกครั้ง")}
                </Button>
              )}
              {op.state !== "sending" && (
                <Button
                  type="button"
                  onClick={async () => {
                    await discardOperation(op.id, uid, trip.id, () =>
                      window.confirm(
                        tr(
                          "This item may already have reached the server. Check the trip before discarding. Discard this saved copy?",
                          "รายการนี้อาจถึงเซิร์ฟเวอร์แล้ว โปรดตรวจสอบทริปก่อนลบ ต้องการลบสำเนาที่บันทึกไว้นี้หรือไม่",
                        ),
                      ),
                    );
                    await refreshOutbox();
                  }}
                >
                  {tr("Discard", "ลบรายการ")}
                </Button>
              )}
            </article>
          ))}
        </details>
      )}
      {!senior && (
        <nav
          class="activity-tabs"
          aria-label={tr("Trip sections", "ส่วนของทริป")}
        >
          {!senior && (
            <Button
              type="button"
              aria-current={tab === "today" ? "page" : undefined}
              onClick={() => setTab("today")}
            >
              {tr("Today", "วันนี้")}
            </Button>
          )}
          {!senior && (
            <Button
              type="button"
              aria-current={tab === "plan" ? "page" : undefined}
              onClick={() => setTab("plan")}
            >
              {tr("Plan", "แผนการเดินทาง")}
            </Button>
          )}
          <Button
            type="button"
            aria-current={tab === "expenses" ? "page" : undefined}
            onClick={() => setTab("expenses")}
          >
            {tr("Expenses", "ค่าใช้จ่าย")}
          </Button>
          <Button
            type="button"
            aria-current={tab === "trip" ? "page" : undefined}
            onClick={() => setTab("trip")}
          >
            {tr("Trip", "ทริป")}
          </Button>
        </nav>
      )}
      {(tab === "today" || tab === "trip") && (
        <EmergencyCard
          tripId={trip.id}
          organizer={organizer && !senior}
          thai={thai}
          ownerId={uid}
        />
      )}
      {tab === "trip" && !senior && tripSettings}
      {tab === "plan" ? (
        <Plan trip={trip} uid={uid} thai={thai} organizer={organizer} />
      ) : tab === "today" ? (
        <>
          <div class="next-stop">
            {today.state === "trip-finished" ? (
              <strong>{tr("Trip finished", "จบทริปแล้ว")}</strong>
            ) : today.state === "before-trip" ? (
              <>
                <strong>{tr("Trip starts", "ทริปเริ่ม")}</strong>
                <p>{formatDateLabel(trip.start_date, thai ? "th-TH" : "en")}</p>
              </>
            ) : today.state === "day-finished" ? (
              <strong>{tr("Today is finished", "วันนี้จบแล้ว")}</strong>
            ) : null}
            {current && !chosenStopId && !senior && (
              <>
                <strong>{tr("Current stop", "จุดหมายปัจจุบัน")}</strong>
                <h3>{current.title}</h3>
              </>
            )}
            {organizer && !senior && todayItems.length > 0 && (
              <label>
                {tr(
                  "Current stop on this device",
                  "จุดหมายปัจจุบันในอุปกรณ์นี้",
                )}
                <select
                  value={chosenStopId}
                  onChange={(e) => {
                    const chosen = (e.currentTarget as HTMLSelectElement).value;
                    setChosenStopId(chosen);
                    if (chosen) localStorage.setItem(chosenStopKey, chosen);
                    else localStorage.removeItem(chosenStopKey);
                  }}
                >
                  <option value="">{tr("Automatic", "อัตโนมัติ")}</option>
                  {todayItems.map((item) => (
                    <option value={item.id}>{item.title}</option>
                  ))}
                </select>
              </label>
            )}
            {upcoming && !(chosenStopId && current) && (
              <strong>{tr("Next stop", "จุดหมายถัดไป")}</strong>
            )}
            {heroStop ? (
              <>
                {chosenStopId && current && (
                  <strong>
                    {tr(
                      "Current stop on this device",
                      "จุดหมายปัจจุบันในอุปกรณ์นี้",
                    )}
                  </strong>
                )}
                <h3>{heroStop.title}</h3>
                <p>
                  {heroStop.starts_at
                    ? new Date(heroStop.starts_at).toLocaleString(
                        thai ? "th-TH" : "en",
                        {
                          dateStyle: "medium",
                          timeStyle: "short",
                          timeZone: destinationTimezone,
                        },
                      )
                    : tr("Time to be confirmed", "รอยืนยันเวลา")}{" "}
                </p>
                {heroStop.address && <p>{heroStop.address}</p>}
                {heroStop.meeting_info && <p>{heroStop.meeting_info}</p>}
                <a
                  class="map-link"
                  href={
                    heroStop.latitude != null && heroStop.longitude != null
                      ? `https://www.google.com/maps/dir/?api=1&destination=${heroStop.latitude},${heroStop.longitude}`
                      : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(heroStop.address || heroStop.title)}`
                  }
                  target="_blank"
                  rel="noreferrer"
                >
                  {tr("Open directions", "เปิดเส้นทางในแผนที่")}
                </a>
              </>
            ) : today.state === "active" ? (
              <p>{tr("No stops added yet.", "ยังไม่มีจุดหมาย")}</p>
            ) : null}
          </div>
          <section
            class="tonight-card"
            aria-label={tr(
              "Tonight destination and accommodation",
              "เมืองและที่พักคืนนี้",
            )}
          >
            <strong>{tonightLabel}</strong>
            {tonightLabel !== tr("Tonight", "คืนนี้") && (
              <time dateTime={tonightDate}>
                {formatDateLabel(tonightDate, thai ? "th-TH" : "en")}
              </time>
            )}
            <p>
              {tonightQuery.data?.night?.city ??
                tr("City not set yet", "ยังไม่ได้กำหนดเมือง")}
            </p>
            {tonightQuery.data?.stay ? (
              <>
                <strong>{tonightQuery.data.stay.name}</strong>
                {tonightQuery.data.stay.address && (
                  <p>{tonightQuery.data.stay.address}</p>
                )}
                {tonightQuery.data.stay.phone && (
                  <a href={`tel:${tonightQuery.data.stay.phone}`}>
                    {tr("Call accommodation", "โทรหาที่พัก")}:{" "}
                    {tonightQuery.data.stay.phone}
                  </a>
                )}
              </>
            ) : (
              <p>{tr("Accommodation not set yet", "ยังไม่ได้กำหนดที่พัก")}</p>
            )}
          </section>
          {!senior && (
            <>
              <h3>{tr("Itinerary", "กำหนดการเดินทาง")}</h3>
              {itineraryQuery.isError && (
                <p role="alert">
                  {tr(
                    "Could not load itinerary. Try again when connected.",
                    "โหลดกำหนดการไม่ได้ กรุณาลองใหม่เมื่อเชื่อมต่ออินเทอร์เน็ต",
                  )}
                </p>
              )}
              {todayItems.map((item, index) => (
                <article class="stop" key={item.id}>
                  <div>
                    <span class="stop-number">{index + 1}</span>
                    <strong>{item.title}</strong>
                  </div>
                  {item.starts_at && (
                    <p>
                      {new Date(item.starts_at).toLocaleString(
                        thai ? "th-TH" : "en",
                        {
                          dateStyle: "medium",
                          timeStyle: "short",
                          timeZone: destinationTimezone,
                        },
                      )}{" "}
                    </p>
                  )}
                  {item.address && <p>{item.address}</p>}
                  {item.notes && <p>{item.notes}</p>}
                  {organizer && !senior && (
                    <>
                      <Button
                        type="button"
                        svgOnly appearance="tertiary"
                        class="plan-icon-button"
                        aria-label={tr("Edit stop", "แก้ไขจุดหมาย")}
                        title={tr("Edit stop", "แก้ไขจุดหมาย")}
                        onClick={() => {
                          setEditing(item);
                          setStopEditorOpen(true);
                          requestAnimationFrame(() => {
                            if (stopEditor.current) {
                              stopEditor.current.open = true;
                              revealEditor(
                                stopEditor.current.querySelector("form"),
                              );
                            }
                          });
                        }}
                      >
                        <ActionIcon kind="edit" />
                      </Button>
                      <Button
                        type="button"
                        svgOnly appearance="tertiary"
                        class="plan-icon-button danger"
                        aria-label={tr("Delete stop", "ลบจุดหมาย")}
                        title={tr("Delete stop", "ลบจุดหมาย")}
                        onClick={() => void deleteItem(item)}
                      >
                        <ActionIcon kind="remove" />
                      </Button>
                    </>
                  )}
                </article>
              ))}
              {organizer && !senior && (
                <details
                  class="stop-editor"
                  ref={stopEditor}
                  open={stopEditorOpen}
                  onToggle={(event) => {
                    setStopEditorOpen(event.currentTarget.open);
                    revealOpenEditor(event);
                  }}
                >
                  <summary>
                    {editing
                      ? tr("Edit stop", "แก้ไขจุดหมาย")
                      : tr("Add a stop", "เพิ่มจุดหมาย")}
                  </summary>
                  <form
                    class="editor-panel"
                    tabIndex={-1}
                    key={editing?.id ?? "new-stop"}
                    onSubmit={saveItem}
                  >
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
                      {tr("Day", "วันที่")}
                      <input
                        name="date"
                        type="date"
                        min={trip.start_date}
                        max={trip.end_date}
                        defaultValue={
                          editing?.starts_at
                            ? toTripLocal(
                                editing.starts_at,
                                destinationTimezone,
                              ).slice(0, 10)
                            : (editing?.plan_date ?? tonightDate)
                        }
                      />
                    </label>
                    <label>
                      {tr(
                        "Destination time (optional)",
                        "เวลาปลายทาง (ไม่บังคับ)",
                      )}
                      <input
                        name="time"
                        type="time"
                        defaultValue={
                          editing?.starts_at
                            ? toTripLocal(
                                editing.starts_at,
                                destinationTimezone,
                              ).slice(11)
                            : ""
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
                        {[
                          "walk",
                          "car",
                          "taxi",
                          "bus",
                          "train",
                          "boat",
                          "other",
                        ].map((x) => (
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
                        ))}
                      </select>
                    </label>
                    <Button>{tr("Save stop", "บันทึกจุดหมาย")}</Button>
                    {editing && (
                      <Button
                        type="button"
                        onClick={() => {
                          setEditing(null);
                          setStopEditorOpen(false);
                        }}
                      >
                        {tr("Cancel", "ยกเลิก")}
                      </Button>
                    )}
                  </form>
                </details>
              )}
            </>
          )}
        </>
      ) : tab === "expenses" ? (
        <>
          <details class="expense-entry" onToggle={revealOpenEditor}>
            <summary>
              {tr("Add shared expense", "เพิ่มค่าใช้จ่ายส่วนกลาง")}
            </summary>
            <h3>{tr("Add shared expense", "เพิ่มค่าใช้จ่ายส่วนกลาง")}</h3>
            <p>
              {tr(
                "Enter the amount in the trip currency. Splits use the smallest currency unit; any remainder goes to the first selected traveler.",
                "กรอกจำนวนเงินตามสกุลเงินของทริป เศษจากการหารจะแบ่งให้ผู้เดินทางคนแรกที่เลือก",
              )}
            </p>
            <form class="editor-panel" tabIndex={-1} onSubmit={saveExpense}>
              <label>
                {tr("What was it for?", "ค่าอะไร")}
                <input name="description" required maxLength={240} />
              </label>
              <label>
                {tr(
                  `Amount (${trip.base_currency})`,
                  `จำนวนเงิน (${trip.base_currency})`,
                )}
                <input
                  name="amount"
                  type="number"
                  min="0.01"
                  step={
                    currencyDigits(
                      trip.base_currency,
                      thai ? "th-TH" : "en",
                    ) === 0
                      ? "1"
                      : `0.${"0".repeat(Math.max(0, currencyDigits(trip.base_currency, thai ? "th-TH" : "en") - 1))}1`
                  }
                  inputMode="decimal"
                  required
                />
              </label>
              <label>
                {tr("Date (optional)", "วันที่ (ไม่บังคับ)")}
                <input
                  name="expenseDate"
                  type="date"
                  onInput={(event) => {
                    const time = event.currentTarget.form?.elements.namedItem(
                      "expenseTime",
                    ) as HTMLInputElement | null;
                    if (time) {
                      time.disabled = !event.currentTarget.value;
                      if (!event.currentTarget.value) time.value = "";
                    }
                  }}
                />
              </label>
              <label>
                {tr(
                  "Time (optional, requires date)",
                  "เวลา (ไม่บังคับ ต้องเลือกวันที่ก่อน",
                )}
                <input name="expenseTime" type="time" disabled />
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
              <Button>{tr("Save expense", "บันทึกค่าใช้จ่าย")}</Button>
            </form>
          </details>
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
                    <Button
                      type="button"
                      onClick={() =>
                        void recordSettlement(s.from, s.to, s.amountMinor)
                      }
                    >
                      {tr("Record payment", "บันทึกการชำระ")}
                    </Button>
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
                  <Button
                    type="button"
                    onClick={() => void confirmSettlement(s.id)}
                  >
                    {tr("Confirm received", "ยืนยันว่าได้รับแล้ว")}
                  </Button>
                )}
              </p>
            ))}
          <h3>{tr("Recent expenses", "ค่าใช้จ่ายล่าสุด")}</h3>
          {expenseRevisionsQuery.isError && (
            <p role="status">
              {tr(
                "Correction history could not be refreshed.",
                "โหลดประวัติการแก้ไขไม่สำเร็จ",
              )}
            </p>
          )}
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
                {(e.expense_date || e.expense_time) && (
                  <p>
                    {e.expense_date}
                    {e.expense_time ? ` · ${e.expense_time.slice(0, 5)}` : ""}
                  </p>
                )}
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
                {expenseRevisionsQuery.data?.filter(
                  (revision) => revision.expense_id === e.id,
                ).length ? (
                  <details class="expense-history">
                    <summary>
                      {tr("Correction history", "ประวัติการแก้ไข")}
                    </summary>
                    {expenseRevisionsQuery.data
                      .filter((revision) => revision.expense_id === e.id)
                      .map((revision) => {
                        const previous = revision.previous_values.expense;
                        const corrected = revision.result_values?.expense ?? e;
                        return (
                          <p key={revision.id}>
                            {new Date(revision.changed_at).toLocaleString(
                              thai ? "th-TH" : "en",
                              {
                                dateStyle: "medium",
                                timeStyle: "short",
                                timeZone: destinationTimezone,
                              },
                            )}
                            {previous && (
                              <>
                                <br />
                                {tr("Amount", "จำนวนเงิน")}:{" "}
                                {formatMinor(
                                  previous.amount_minor,
                                  previous.currency,
                                  thai ? "th-TH" : "en",
                                )}{" "}
                                →{" "}
                                {formatMinor(
                                  corrected.amount_minor,
                                  corrected.currency,
                                  thai ? "th-TH" : "en",
                                )}
                                {previous.description !==
                                corrected.description ? (
                                  <>
                                    <br />
                                    {tr("Description", "รายละเอียด")}:{" "}
                                    {previous.description} →{" "}
                                    {corrected.description}
                                  </>
                                ) : null}
                              </>
                            )}
                          </p>
                        );
                      })}
                  </details>
                ) : null}
                {organizer && !senior && (
                  <details onToggle={revealOpenEditor}>
                    <summary>
                      {tr("Correct expense", "แก้ไขค่าใช้จ่าย")}
                    </summary>
                    <form
                      class="editor-panel"
                      tabIndex={-1}
                      onSubmit={(event) => void correctExpense(event, e)}
                    >
                      <label>
                        {tr("Description", "รายละเอียด")}
                        <input
                          name="description"
                          required
                          maxLength={240}
                          defaultValue={e.description}
                        />
                      </label>
                      <label>
                        {tr(
                          `Amount (${e.currency})`,
                          `จำนวนเงิน (${e.currency})`,
                        )}
                        <input
                          name="amount"
                          type="number"
                          min="0.01"
                          step={
                            currencyDigits(
                              e.currency,
                              thai ? "th-TH" : "en",
                            ) === 0
                              ? "1"
                              : `0.${"0".repeat(Math.max(0, currencyDigits(e.currency, thai ? "th-TH" : "en") - 1))}1`
                          }
                          required
                          defaultValue={minorToMajorInput(
                            e.amount_minor,
                            e.currency,
                            thai ? "th-TH" : "en",
                          )}
                        />
                      </label>
                      <label>
                        {tr("Paid by", "ผู้จ่าย")}
                        <select
                          name="payer"
                          required
                          defaultValue={e.paid_by_member_id}
                        >
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
                              defaultChecked={e.shares?.some(
                                (s) => s.trip_member_id === m.id,
                              )}
                            />
                            {m.display_name}
                          </label>
                        ))}
                      </fieldset>
                      <label>
                        {tr("Date (optional)", "วันที่ (ไม่บังคับ)")}
                        <input
                          name="expenseDate"
                          type="date"
                          defaultValue={e.expense_date ?? ""}
                          onInput={(event) => {
                            const time =
                              event.currentTarget.form?.elements.namedItem(
                                "expenseTime",
                              ) as HTMLInputElement | null;
                            if (time) {
                              time.disabled = !event.currentTarget.value;
                              if (!event.currentTarget.value) time.value = "";
                            }
                          }}
                        />
                      </label>
                      <label>
                        {tr("Time (optional)", "เวลา (ไม่บังคับ)")}
                        <input
                          name="expenseTime"
                          type="time"
                          defaultValue={e.expense_time?.slice(0, 5) ?? ""}
                          disabled={!e.expense_date}
                        />
                      </label>
                      <Button>{tr("Save correction", "บันทึกการแก้ไข")}</Button>
                    </form>
                  </details>
                )}
              </article>
            ))
          ) : (
            <p>{tr("No expenses yet.", "ยังไม่มีค่าใช้จ่าย")}</p>
          )}
        </>
      ) : (
        <>
          <h3>{tr("Trip details", "รายละเอียดทริป")}</h3>
          <p>
            {trip.start_date} — {trip.end_date}
          </p>

          <p>
            {tr("Trip status", "สถานะทริป")}: {trip.status}
          </p>
          <h3>{tr("Travelers", "ผู้เดินทาง")}</h3>
          {tripMembers.map((m) => (
            <p class="attendance" key={m.id}>
              {m.display_name}
              {m.role === "organizer" ? ` · ${tr("Organizer", "ผู้จัด")}` : ""}
              {m.status !== "approved"
                ? ` · ${tr("removed", "นำออกแล้ว")}`
                : ""}
            </p>
          ))}
        </>
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
      p_hotel_name: card?.hotel_name ?? null,
      p_hotel_address: card?.hotel_address ?? null,
      p_hotel_phone: card?.hotel_phone ?? null,
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
      <strong>{tr("Family contact", "ผู้ติดต่อในครอบครัว")}</strong>
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
        <details onToggle={revealOpenEditor}>
          <summary>
            {tr("Edit family contact", "แก้ไขผู้ติดต่อในครอบครัว")}
          </summary>
          <form class="editor-panel" tabIndex={-1} onSubmit={save}>
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
            <Button>{tr("Save", "บันทึก")}</Button>
          </form>
        </details>
      )}
    </div>
  );
}
