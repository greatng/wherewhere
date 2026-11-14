import { Button } from "../../shared/ui/Button";
import { ThemeChoice } from "../../shared/ui/ThemeChoice";
import { revealEditor } from "../../shared/editor-navigation";
import { GuestRecovery } from "./GuestRecovery";
import { actionError } from "./errors";
import type { User } from "@supabase/supabase-js";
import { EmailAccess } from "../auth/EmailAccess";
import { canCreateTrip } from "../auth/email";
import { useMembers } from "../members/queries";
import { pages } from "../../shared/supabase/pages";
import { redeem } from "../invites/redeem";

import { useEffect, useRef, useState } from "preact/hooks";
import { signal } from "@preact/signals";
import { QueryClient, useQuery } from "@tanstack/preact-query";
import QRCode from "qrcode";
import { supabase as db } from "../../shared/supabase/client";
import { TripActivity } from "./TripActivity";
import { ThemeToggle } from "../../shared/ThemeToggle";
import { PwaUpdate } from "../../shared/PwaUpdate";
import {
  cacheTripData,
  clearAllLocalData,
  clearTripData,
  localDb,
  readCachedTripData,
} from "../offline/db";

export const qc = new QueryClient();
const thai = signal(false);
const t = (en: string, th: string) => (thai.value ? th : en);
type TripRow = {
  id: string;
  title: string;
  base_currency: string;
  status: string;
  start_date: string;
  end_date: string;
  timezone: string;
};
function mayUseOfflineCache(error: unknown) {
  const candidate = error as { status?: number; code?: string } | null;
  return (
    candidate?.status !== 401 &&
    candidate?.status !== 403 &&
    candidate?.code !== "42501" &&
    candidate?.code !== "PGRST301" &&
    (!navigator.onLine || !candidate?.status || candidate.status >= 500)
  );
}
export function App() {
  const [uid, setUid] = useState<string>();
  const [user, setUser] = useState<User | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [qr, setQr] = useState("");
  const qrPanel = useRef<HTMLElement>(null);
  const [route, setRoute] = useState(location.hash);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [accountOpen, setAccountOpen] = useState(false);
  const [signOutWarning, setSignOutWarning] = useState(false);
  const [pendingCount, setPendingCount] = useState(0);
  useEffect(() => {
    if (qr) revealEditor(qrPanel.current);
  }, [qr]);
  useEffect(() => {
    setSelectedId(
      uid ? localStorage.getItem(`paikan-selected-trip:${uid}`) : null,
    );
  }, [uid]);
  function selectTrip(id: string | null) {
    setSelectedId(id);
    setQr("");
    if (uid) {
      if (id) localStorage.setItem(`paikan-selected-trip:${uid}`, id);
      else localStorage.removeItem(`paikan-selected-trip:${uid}`);
    }
  }
  async function prepareSignOut() {
    setPendingCount(
      uid ? await localDb.outbox.where("ownerId").equals(uid).count() : 0,
    );
    setSignOutWarning(true);
  }
  async function signOut() {
    await run(async () => {
      localStorage.setItem("paikan-cache-disabled", "true");
      try {
        const result = await db.auth.signOut({ scope: "local" });
        if (result.error) throw result.error;
      } catch (cause) {
        const current = await db.auth.getSession();
        const activeId = current.data.session?.user.id;
        if (activeId) localStorage.setItem("travelmate-local-user", activeId);
        localStorage.setItem(
          "paikan-cache-disabled",
          activeId ? "false" : "true",
        );
        throw cause;
      }
      await clearAllLocalData();
      qc.clear();
      setUser(null);
      setUid(undefined);
      setSelectedId(null);
      setSignOutWarning(false);
      setAccountOpen(false);
      localStorage.removeItem("travelmate-local-user");
      if (uid) localStorage.removeItem(`paikan-selected-trip:${uid}`);
    });
  }

  useEffect(() => {
    const routeChange = () => setRoute(location.hash);
    window.addEventListener("hashchange", routeChange);
    const { data } = db.auth.onAuthStateChange((_e, s) => {
      setUid(s?.user.id);
      setUser(s?.user ?? null);
      setQr("");
      qc.clear();
      const previous = localStorage.getItem("travelmate-local-user");
      if (previous && previous !== s?.user.id) void clearAllLocalData();
      if (s?.user.id) localStorage.setItem("travelmate-local-user", s.user.id);
      localStorage.setItem(
        "paikan-cache-disabled",
        s?.user.id ? "false" : "true",
      );
    });
    void db.auth.getSession().then(({ data }) => {
      const next = data.session?.user.id;
      const previous = localStorage.getItem("travelmate-local-user");
      if (previous && previous !== next) void clearAllLocalData();
      if (next) localStorage.setItem("travelmate-local-user", next);
      localStorage.setItem("paikan-cache-disabled", next ? "false" : "true");
      setUid(next);
      setUser(data.session?.user ?? null);
    });
    const resume = () => void qc.invalidateQueries();
    window.addEventListener("focus", resume);
    window.addEventListener("online", resume);
    return () => {
      data.subscription.unsubscribe();
      window.removeEventListener("hashchange", routeChange);
      window.removeEventListener("focus", resume);
      window.removeEventListener("online", resume);
    };
  }, []);
  const trips = useQuery({
    queryKey: ["trips", uid],
    enabled: !!uid,
    queryFn: async () => {
      try {
        const rows = await pages((from, to) =>
          db.from("trips").select("*").order("id").range(from, to),
        );
        if (uid) await cacheTripData(uid, "__dashboard__", "trips", rows);
        return rows;
      } catch (error) {
        const cached =
          uid && mayUseOfflineCache(error)
            ? await readCachedTripData<TripRow[]>(uid, "__dashboard__", "trips")
            : undefined;
        if (cached) return cached;
        throw error;
      }
    },
  });
  const members = useMembers(uid);
  const requests = useQuery({
    queryKey: ["requests", uid],
    enabled: !!uid,
    queryFn: () =>
      pages((from, to) =>
        db.from("trip_join_requests").select("*").order("id").range(from, to),
      ),
  });
  const invites = useQuery({
    queryKey: ["invites", uid],
    enabled: !!uid,
    queryFn: () =>
      pages((from, to) =>
        db
          .from("trip_invites")
          .select(
            "id,trip_id,expires_at,uses_count,max_uses,revoked_at,deleted_at",
          )
          .is("deleted_at", null)
          .order("id")
          .range(from, to),
      ),
  });
  useEffect(() => {
    if (!trips.isSuccess || !trips.data) return;
    const ids = new Set(trips.data.map((trip) => trip.id));
    if (selectedId && !ids.has(selectedId)) selectTrip(null);
    void (async () => {
      const cached = await localDb.cached.toArray();
      const queued = await localDb.outbox.toArray();
      for (const tripId of new Set(
        [...cached, ...queued]
          .filter((row) => row.ownerId === uid)
          .map((row) => row.tripId),
      ))
        if (tripId !== "__dashboard__" && !ids.has(tripId))
          await clearTripData(tripId, uid);
    })();
  }, [trips.isSuccess, trips.data, uid, selectedId]);
  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await fn();
      await qc.invalidateQueries();
    } catch (cause) {
      setError(actionError(cause, thai.value));
    } finally {
      setBusy(false);
    }
  }
  async function rpc(name: string, args: Record<string, unknown>) {
    const r = await db.rpc(name, args);
    if (r.error) throw r.error;
    return r.data;
  }
  return (
    <>
      <header>
        <a href="#/trips" onClick={() => selectTrip(null)}>
          Roam
        </a>
        <Button
          type="button"
          onClick={() => {
            thai.value = !thai.value;
            document.documentElement.lang = thai.value ? "th" : "en";
          }}
        >
          ไทย / English
        </Button>
        <ThemeToggle thai={thai.value} />
      </header>
      <PwaUpdate thai={thai.value} />
      <main>
        {uid && (
          <section class="account-menu" aria-label={t("Account", "บัญชี")}>
            <Button
              type="button"
              aria-expanded={accountOpen}
              onClick={() => setAccountOpen(!accountOpen)}
            >
              {user?.is_anonymous
                ? t("Guest account", "บัญชีผู้เยี่ยมชม")
                : (user?.email ?? t("Account", "บัญชี"))}
            </Button>
            {accountOpen && (
              <div>
                <ThemeChoice thai={thai.value} />
                <p>
                  {user?.is_anonymous
                    ? t(
                        "This guest account lives on this device. Verify an email to keep access across devices.",
                        "บัญชีผู้เยี่ยมชมอยู่ในอุปกรณ์นี้ ยืนยันอีเมลเพื่อเข้าถึงจากอุปกรณ์อื่น",
                      )
                    : user?.email}
                </p>
                {user?.is_anonymous && (
                  <Button
                    type="button"
                    onClick={() => {
                      selectTrip(null);
                      setAccountOpen(false);
                    }}
                  >
                    {t(
                      "Create my own trips / Verify email",
                      "สร้างทริปของฉัน / ยืนยันอีเมล",
                    )}
                  </Button>
                )}
                <Button type="button" onClick={() => void prepareSignOut()}>
                  {t("Sign out of this device", "ออกจากระบบในอุปกรณ์นี้")}
                </Button>
              </div>
            )}
            {signOutWarning && (
              <section
                role="alert"
                aria-label={t("Confirm sign out", "ยืนยันออกจากระบบ")}
              >
                <p>
                  {user?.is_anonymous
                    ? t(
                        "Signing out of a guest account can lose access to your trips. Ask your organizer about supervised recovery before continuing.",
                        "การออกจากบัญชีผู้เยี่ยมชมอาจทำให้เข้าถึงทริปไม่ได้ กรุณาติดต่อผู้จัดเรื่องกู้คืนบัญชีก่อน",
                      )
                    : t(
                        "You can sign in again with your email. Saved trip data will be removed from this device.",
                        "คุณลงชื่อเข้าใหม่ด้วยอีเมลได้ ข้อมูลทริปที่บันทึกจะถูกลบจากอุปกรณ์นี้",
                      )}
                </p>
                {pendingCount > 0 && (
                  <p>
                    {t(
                      `${pendingCount} saved action(s) will be removed from this device. Some may already have reached the server. Reconnect and check the trip before signing out.`,
                      `มี ${pendingCount} รายการที่บันทึกไว้และจะถูกลบ บางรายการอาจถึงเซิร์ฟเวอร์แล้ว กรุณาเชื่อมต่อและตรวจสอบทริปก่อนออกจากระบบ`,
                    )}
                  </p>
                )}
                <Button disabled={busy} onClick={() => void signOut()}>
                  {t("Confirm sign out", "ยืนยันออกจากระบบ")}
                </Button>
                <Button onClick={() => setSignOutWarning(false)}>
                  {t("Keep signed in", "อยู่ในระบบต่อ")}
                </Button>
              </section>
            )}
          </section>
        )}

        <h1>{t("Your trips, together.", "เดินทางไปด้วยกัน")}</h1>
        {error && <p role="alert">{error}</p>}
        {(trips.error || members.error || requests.error || invites.error) && (
          <p role="alert">
            {t(
              "Unable to refresh. Check your connection.",
              "ไม่สามารถโหลดข้อมูล กรุณาตรวจสอบอินเทอร์เน็ต",
            )}
          </p>
        )}
        {route.startsWith("#/join/") ? (
          <section>
            <h2>{t("Join a trip", "เข้าร่วมทริป")}</h2>
            <p>
              {t(
                "Install Roam first if you want to use it from your Home Screen. Open this invitation inside the installed app. Browser and installed app sessions may differ.",
                "ติดตั้งแอปก่อน แล้วเปิดคำเชิญในแอปที่ติดตั้ง บัญชีในเบราว์เซอร์อาจต่างจากแอป",
              )}
            </p>
            <details
              class="create-trip"
              onToggle={(event) => {
                if (event.currentTarget.open)
                  revealEditor(event.currentTarget.querySelector("form"));
              }}
            >
              <summary>
                {t("Join as a guest", "เข้าร่วมแบบผู้เยี่ยมชม")}
              </summary>
              <form
                class="editor-panel"
                tabIndex={-1}
                onSubmit={(e) => {
                  e.preventDefault();
                  const f = new FormData(e.currentTarget);
                  void run(async () => {
                    await redeem(route.slice(7), f.get("name"));
                    history.replaceState(null, "", location.pathname + "#");
                    setRoute("#");
                  });
                }}
              >
                <label>
                  {t("Your name", "ชื่อของคุณ")}
                  <input name="name" required maxLength={80} />
                </label>
                <label>
                  <input type="checkbox" required />
                  {t(
                    "I am using the browser or installed app I will keep using.",
                    "ฉันกำลังใช้แอปหรือเบราว์เซอร์ที่จะใช้ต่อไป",
                  )}
                </label>
                <Button disabled={busy}>
                  {t("Request to join", "ขอเข้าร่วม")}
                </Button>
              </form>
            </details>
          </section>
        ) : null}
        {!uid && !route.startsWith("#/join/") && (
          <section>
            <h2>{t("Reconnect to your trip", "เชื่อมต่อกับทริปของคุณ")}</h2>
            <p>
              {t(
                "Ask your organizer for an invitation QR. If you lost your session, ask them to verify your identity before rejoining.",
                "ขอ QR คำเชิญจากผู้จัดทริป หากข้อมูลบัญชีสูญหาย ให้ผู้จัดยืนยันตัวตนก่อนเข้าร่วมใหม่",
              )}
            </p>
            <label>
              {t("Paste invitation link", "วางลิงก์คำเชิญ")}
              <input
                type="url"
                onChange={(e) => {
                  try {
                    const u = new URL(e.currentTarget.value);
                    if (
                      u.origin === location.origin &&
                      /^#\/join\/[a-f0-9]{64}$/.test(u.hash)
                    )
                      location.hash = u.hash;
                  } catch {
                    /* Keep input for correction. */
                  }
                }}
              />
            </label>
          </section>
        )}
        {!selectedId &&
          !canCreateTrip(user) &&
          !route.startsWith("#/join/") && (
            <EmailAccess
              key={uid ?? "signed-out"}
              guest={!!user?.is_anonymous}
              thai={thai.value}
              onVerified={() => {
                void db.auth.getSession().then(({ data }) => {
                  setUser(data.session?.user ?? null);
                  setUid(data.session?.user.id);
                });
              }}
            />
          )}
        {!selectedId && canCreateTrip(user) && (
          <details
            class="create-trip"
            onToggle={(event) => {
              if (event.currentTarget.open)
                revealEditor(event.currentTarget.querySelector("form"));
            }}
          >
            <summary>{t("Create a trip", "สร้างทริป")}</summary>
            <form
              class="editor-panel"
              tabIndex={-1}
              onSubmit={(e) => {
                e.preventDefault();
                const f = new FormData(e.currentTarget);
                void run(async () => {
                  if (!canCreateTrip(user))
                    throw new Error("Email verification required");
                  const createdTrip = await rpc("create_trip", {
                    p_title: f.get("title"),
                    p_name: f.get("name"),
                    p_timezone: f.get("timezone"),
                    p_currency: f.get("currency"),
                    p_start: f.get("start"),
                    p_end: f.get("end"),
                  });
                  selectTrip(createdTrip);
                });
              }}
            >
              <h2>{t("Create a trip", "สร้างทริป")}</h2>
              {[
                ["title", t("Trip name", "ชื่อทริป"), "text"],
                ["name", t("Your name", "ชื่อของคุณ"), "text"],
                ["start", t("Start date", "วันเริ่ม"), "date"],
                ["end", t("End date", "วันสิ้นสุด"), "date"],
                [
                  "timezone",
                  t("Destination timezone (IANA)", "เขตเวลาปลายทาง (IANA)"),
                  "text",
                ],
                [
                  "currency",
                  t("Currency (e.g. THB)", "สกุลเงิน เช่น THB"),
                  "text",
                ],
              ].map(([name, label, type]) => (
                <label key={name}>
                  {label}
                  <input
                    name={name}
                    type={type === "date" ? "date" : "text"}
                    required
                    maxLength={name === "currency" ? 3 : 80}
                    defaultValue={
                      name === "currency"
                        ? "THB"
                        : name === "timezone"
                          ? "Asia/Bangkok"
                          : undefined
                    }
                    placeholder={name === "timezone" ? "Asia/Tokyo" : undefined}
                  />
                </label>
              ))}
              <Button disabled={busy}>{t("Create trip", "สร้างทริป")}</Button>
            </form>
          </details>
        )}
        {uid && (
          <Button onClick={() => void qc.invalidateQueries()}>
            {t("Refresh status", "รีเฟรชสถานะ")}
          </Button>
        )}
        {requests.data
          ?.filter((r) => r.auth_user_id === uid)
          .map((r) => (
            <p role="status" key={r.id}>
              {t("Join request", "คำขอเข้าร่วม")}:{" "}
              {r.status === "pending"
                ? t("Waiting for organizer approval", "รอผู้จัดอนุมัติ")
                : r.status === "approved"
                  ? t("Approved", "อนุมัติแล้ว")
                  : t(
                      "Declined — contact organizer",
                      "ปฏิเสธ กรุณาติดต่อผู้จัด",
                    )}
            </p>
          ))}
        {uid && trips.data && (
          <section
            class="trip-dashboard"
            aria-label={t("Choose a trip", "เลือกทริป")}
          >
            <h2>{t("Your trips", "ทริปของคุณ")}</h2>
            {trips.data.length === 0 && (
              <p>
                {t(
                  "No approved trips yet. Create a trip or join with an invitation.",
                  "ยังไม่มีทริปที่อนุมัติ สร้างทริปหรือเข้าร่วมด้วยคำเชิญ",
                )}
              </p>
            )}
            <div class="trip-cards">
              {trips.data.map((trip) => (
                <Button
                  type="button"
                  key={trip.id}
                  aria-pressed={selectedId === trip.id}
                  onClick={() => selectTrip(trip.id)}
                >
                  <strong>{trip.title}</strong>
                  <span>
                    {trip.start_date} — {trip.end_date}
                  </span>
                  <small>
                    {trip.status === "archived"
                      ? t("Archived", "เก็บถาวร")
                      : t("Active", "ใช้งาน")}
                  </small>
                </Button>
              ))}
            </div>
          </section>
        )}
        {trips.data
          ?.filter((trip) => trip.id === selectedId)
          .map((trip) => {
            const org = members.data?.some(
              (m) =>
                m.trip_id === trip.id &&
                m.user_id === uid &&
                m.role === "organizer" &&
                m.status === "approved",
            );
            return (
              <section class="trip-workspace" key={trip.id}>
                <h2>{trip.title}</h2>
                <p>
                  {trip.start_date} — {trip.end_date} · {trip.base_currency} ·{" "}
                  {trip.status}
                </p>
                {uid && members.data && (
                  <TripActivity
                    key={trip.id}
                    trip={trip}
                    members={members.data}
                    uid={uid}
                    thai={thai.value}
                    tripSettings={
                      <>
                        <h3>{t("Travelers", "ผู้เดินทาง")}</h3>
                        {members.data
                          ?.filter(
                            (m) =>
                              m.trip_id === trip.id && m.status === "approved",
                          )
                          .map((m) => (
                            <div class="trip-member-row" key={m.id}>
                              <span>
                                {m.display_name}
                                {m.role !== "organizer" && (
                                  <small class="member-permission">
                                    {" "}
                                    ·{" "}
                                    {m.can_edit_plan
                                      ? t("Can edit itinerary", "แก้ไขแผนได้")
                                      : t("Read only", "ดูได้อย่างเดียว")}
                                  </small>
                                )}
                              </span>
                              {org &&
                                m.role !== "organizer" &&
                                m.user_id &&
                                !m.managed_by_user_id && (
                                  <Button
                                    type="button"
                                    appearance="secondary"
                                    disabled={busy}
                                    onClick={() =>
                                      void run(async () => {
                                        await rpc(
                                          "set_member_plan_permission",
                                          {
                                            p_member_id: m.id,
                                            p_can_edit: !m.can_edit_plan,
                                          },
                                        );
                                      })
                                    }
                                  >
                                    {m.can_edit_plan
                                      ? t("Remove editing", "ยกเลิกสิทธิ์แก้ไข")
                                      : t("Grant editing", "ให้สิทธิ์แก้ไข")}
                                  </Button>
                                )}
                              {org && m.role !== "organizer" && (
                                <Button
                                  disabled={busy}
                                  onClick={() =>
                                    void run(async () => {
                                      await rpc("remove_member", {
                                        p_member_id: m.id,
                                      });
                                    })
                                  }
                                >
                                  {t("Remove", "นำออก")}
                                </Button>
                              )}
                            </div>
                          ))}
                        {org && (
                          <>
                            <details class="trip-settings">
                              <summary>
                                {t(
                                  "Trip settings and access",
                                  "ตั้งค่าทริปและการเข้าถึง",
                                )}
                              </summary>
                              <details class="trip-timezone-settings">
                                <summary>
                                  {t(
                                    "Advanced: destination time",
                                    "ขั้นสูง: เวลาปลายทาง",
                                  )}
                                </summary>
                                <form
                                  key={trip.timezone}
                                  onSubmit={(e) => {
                                    e.preventDefault();
                                    const f = new FormData(e.currentTarget);
                                    void run(async () => {
                                      await rpc("set_trip_timezone", {
                                        p_trip_id: trip.id,
                                        p_timezone: f.get("timezone"),
                                      });
                                    });
                                  }}
                                >
                                  <p>
                                    {t(
                                      "Changing the destination timezone leaves saved timestamps unchanged. They will display in the new destination timezone, and activity days are grouped by that local date.",
                                      "การเปลี่ยนเขตเวลาปลายทางจะไม่เปลี่ยนเวลาที่บันทึกไว้ แต่จะแสดงตามเขตเวลาใหม่ และจัดกลุ่มกิจกรรมตามวันที่ท้องถิ่น",
                                    )}
                                  </p>
                                  <label>
                                    {t(
                                      "Destination timezone (IANA)",
                                      "เขตเวลาปลายทาง (IANA)",
                                    )}
                                    <input
                                      name="timezone"
                                      required
                                      maxLength={80}
                                      defaultValue={trip.timezone}
                                      placeholder="Asia/Tokyo"
                                    />
                                  </label>
                                  <Button
                                    disabled={busy || trip.status !== "active"}
                                  >
                                    {t("Save timezone", "บันทึกเขตเวลา")}
                                  </Button>
                                </form>
                              </details>
                              <Button
                                disabled={busy || trip.status !== "active"}
                                onClick={() =>
                                  void run(async () => {
                                    const r = await rpc("create_invite", {
                                      p_trip_id: trip.id,
                                    });
                                    setQr(
                                      await QRCode.toDataURL(
                                        location.origin +
                                          location.pathname +
                                          "#/join/" +
                                          r[0].token,
                                      ),
                                    );
                                  })
                                }
                              >
                                {t(
                                  "Create invitation QR (24 hours, 8 uses)",
                                  "สร้าง QR คำเชิญ (24 ชั่วโมง 8 คน)",
                                )}
                              </Button>
                              <form
                                onSubmit={(e) => {
                                  e.preventDefault();
                                  const name = new FormData(
                                    e.currentTarget,
                                  ).get("name");
                                  void run(async () => {
                                    await rpc("add_managed_member", {
                                      p_trip_id: trip.id,
                                      p_name: name,
                                    });
                                  });
                                }}
                              >
                                <label>
                                  {t(
                                    "Traveler without a device",
                                    "ผู้เดินทางที่ไม่มีอุปกรณ์",
                                  )}
                                  <input name="name" required maxLength={80} />
                                </label>
                                <Button disabled={busy}>
                                  {t("Add traveler", "เพิ่มผู้เดินทาง")}
                                </Button>
                              </form>
                              {uid && (
                                <Button
                                  onClick={() => void qc.invalidateQueries()}
                                >
                                  {t("Refresh status", "รีเฟรชสถานะ")}
                                </Button>
                              )}
                              {requests.data
                                ?.filter(
                                  (r) =>
                                    r.trip_id === trip.id &&
                                    r.status === "pending",
                                )
                                .map((r) => (
                                  <div key={r.id}>
                                    <p>{r.requested_display_name}</p>
                                    {[true, false].map((approve) => (
                                      <Button
                                        disabled={busy}
                                        onClick={() =>
                                          void run(async () => {
                                            await rpc("decide_join", {
                                              p_request_id: r.id,
                                              p_approve: approve,
                                            });
                                          })
                                        }
                                      >
                                        {approve
                                          ? t("Approve", "อนุมัติ")
                                          : t("Decline", "ปฏิเสธ")}
                                      </Button>
                                    ))}
                                  </div>
                                ))}
                              {invites.data
                                ?.filter((i) => i.trip_id === trip.id)
                                .map((i) => (
                                  <p key={i.id}>
                                    {i.uses_count}/{i.max_uses} · {i.expires_at}
                                    {i.revoked_at ? (
                                      <Button
                                        disabled={busy}
                                        onClick={() => {
                                          if (
                                            !window.confirm(
                                              t(
                                                "Delete this revoked invitation? Its history will be retained.",
                                                "ต้องการลบคำเชิญที่ยกเลิกแล้วหรือไม่ ประวัติจะยังคงอยู่",
                                              ),
                                            )
                                          )
                                            return;
                                          void run(async () => {
                                            await rpc("delete_revoked_invite", {
                                              p_invite_id: i.id,
                                            });
                                          });
                                        }}
                                      >
                                        {t(
                                          "Delete revoked invitation",
                                          "ลบคำเชิญที่ยกเลิกแล้ว",
                                        )}
                                      </Button>
                                    ) : (
                                      <Button
                                        disabled={busy}
                                        onClick={() =>
                                          void run(async () => {
                                            await rpc("revoke_invite", {
                                              p_invite_id: i.id,
                                            });
                                            setQr("");
                                          })
                                        }
                                      >
                                        {t("Revoke", "ยกเลิก")}
                                      </Button>
                                    )}
                                  </p>
                                ))}
                              <Button
                                disabled={busy || trip.status === "archived"}
                                onClick={() =>
                                  void run(async () => {
                                    await rpc("archive_trip", {
                                      p_trip_id: trip.id,
                                    });
                                    setQr("");
                                  })
                                }
                              >
                                {t("Archive trip", "เก็บทริป")}
                              </Button>
                              {trip.status === "archived" && (
                                <Button
                                  disabled={busy}
                                  onClick={() =>
                                    void run(async () => {
                                      await rpc("restore_trip", {
                                        p_trip_id: trip.id,
                                      });
                                    })
                                  }
                                >
                                  {t("Restore trip", "กู้คืนทริป")}
                                </Button>
                              )}
                            </details>
                            <GuestRecovery
                              tripId={trip.id}
                              requests={requests.data ?? []}
                              members={members.data ?? []}
                              invites={invites.data ?? []}
                              busy={busy}
                              thai={thai.value}
                              onAction={(name, args) =>
                                void run(async () => {
                                  await rpc(name, args);
                                })
                              }
                            />
                            <details class="danger-zone">
                              <summary>{t("Delete trip", "ลบทริป")}</summary>
                              <p>
                                {t(
                                  "This permanently removes the trip, its itinerary, expenses, members, and stay details. Type the trip title to confirm.",
                                  "การดำเนินการนี้จะลบทริป กำหนดการ ค่าใช้จ่าย สมาชิก และข้อมูลที่พักถาวร กรุณาพิมพ์ชื่อทริปเพื่อยืนยัน",
                                )}
                              </p>
                              <form
                                onSubmit={(e) => {
                                  e.preventDefault();
                                  const f = new FormData(e.currentTarget);
                                  if (f.get("confirmTitle") !== trip.title) {
                                    setError(
                                      t(
                                        "The title does not match.",
                                        "ชื่อทริปไม่ตรงกัน",
                                      ),
                                    );
                                    return;
                                  }
                                  void run(async () => {
                                    await rpc("delete_trip", {
                                      p_trip_id: trip.id,
                                      p_confirmation_title:
                                        f.get("confirmTitle"),
                                    });
                                    if (uid) await clearTripData(trip.id, uid);
                                    selectTrip(null);
                                  });
                                }}
                              >
                                <label>
                                  {t("Trip title", "ชื่อทริป")}
                                  <input
                                    name="confirmTitle"
                                    required
                                    autoComplete="off"
                                  />
                                </label>
                                <Button class="danger-button" disabled={busy}>
                                  {t("Delete permanently", "ลบถาวร")}
                                </Button>
                              </form>
                            </details>
                          </>
                        )}
                      </>
                    }
                  />
                )}
              </section>
            );
          })}
        {qr && (
          <section
            ref={qrPanel}
            class="editor-panel"
            aria-label={t("Trip invitation", "คำเชิญเข้าร่วมทริป")}
          >
            <h2>{t("Scan to request access", "สแกนเพื่อขอเข้าร่วม")}</h2>
            <img
              src={qr}
              width="280"
              height="280"
              alt={t("Trip invitation QR code", "QR คำเชิญเข้าร่วมทริป")}
            />
            <Button onClick={() => setQr("")}>{t("Close", "ปิด")}</Button>
          </section>
        )}
      </main>
    </>
  );
}
