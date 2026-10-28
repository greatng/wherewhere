import { useMembers } from "../members/queries";
import { pages } from "../../shared/supabase/pages";
import { redeem } from "../invites/redeem";

import { useEffect, useState } from "preact/hooks";
import { signal } from "@preact/signals";
import { QueryClient, useQuery } from "@tanstack/preact-query";
import QRCode from "qrcode";
import { supabase as db } from "../../shared/supabase/client";
import { TripActivity } from "./TripActivity";
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
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [qr, setQr] = useState("");
  const [route, setRoute] = useState(location.hash);
  useEffect(() => {
    const routeChange = () => setRoute(location.hash);
    window.addEventListener("hashchange", routeChange);
    const { data } = db.auth.onAuthStateChange((_e, s) => {
      setUid(s?.user.id);
      setQr("");
      qc.clear();
      const previous = localStorage.getItem("travelmate-local-user");
      if (previous && previous !== s?.user.id) void clearAllLocalData();
      if (s?.user.id) localStorage.setItem("travelmate-local-user", s.user.id);
    });
    void db.auth.getSession().then(({ data }) => {
      const next = data.session?.user.id;
      const previous = localStorage.getItem("travelmate-local-user");
      if (previous && previous !== next) void clearAllLocalData();
      if (next) localStorage.setItem("travelmate-local-user", next);
      setUid(next);
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
          .select("id,trip_id,expires_at,uses_count,max_uses,revoked_at")
          .order("id")
          .range(from, to),
      ),
  });
  useEffect(() => {
    if (!trips.isSuccess || !trips.data) return;
    const ids = new Set(trips.data.map((trip) => trip.id));
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
  }, [trips.isSuccess, trips.data, uid]);
  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await fn();
      await qc.invalidateQueries();
    } catch {
      setError(
        t(
          "Could not complete this action. Check your connection or ask your organizer.",
          "ไม่สามารถทำรายการได้ กรุณาตรวจสอบอินเทอร์เน็ตหรือติดต่อผู้จัดทริป",
        ),
      );
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
        <a href="#/trips">TravelMate</a>
        <button
          onClick={() => {
            thai.value = !thai.value;
            document.documentElement.lang = thai.value ? "th" : "en";
          }}
        >
          ไทย / English
        </button>
      </header>
      <main>
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
                "Install TravelMate first if you want to use it from your Home Screen. Open this invitation inside the installed app. Browser and installed app sessions may differ.",
                "ติดตั้งแอปก่อน แล้วเปิดคำเชิญในแอปที่ติดตั้ง บัญชีในเบราว์เซอร์อาจต่างจากแอป",
              )}
            </p>
            <form
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
              <button disabled={busy}>
                {t("Request to join", "ขอเข้าร่วม")}
              </button>
            </form>
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
        {uid && (
          <>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const f = new FormData(e.currentTarget);
                void run(async () => {
                  await rpc("create_trip", {
                    p_title: f.get("title"),
                    p_name: f.get("name"),
                    p_timezone:
                      Intl.DateTimeFormat().resolvedOptions().timeZone,
                    p_currency: f.get("currency"),
                    p_start: f.get("start"),
                    p_end: f.get("end"),
                  });
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
                    defaultValue={name === "currency" ? "THB" : undefined}
                  />
                </label>
              ))}
              <button disabled={busy}>{t("Create trip", "สร้างทริป")}</button>
            </form>
            <button onClick={() => void qc.invalidateQueries()}>
              {t("Refresh status", "รีเฟรชสถานะ")}
            </button>
          </>
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
        {trips.data?.map((trip) => {
          const org = members.data?.some(
            (m) =>
              m.trip_id === trip.id &&
              m.user_id === uid &&
              m.role === "organizer",
          );
          return (
            <section key={trip.id}>
              <h2>{trip.title}</h2>
              <p>
                {trip.start_date} — {trip.end_date} · {trip.base_currency} ·{" "}
                {trip.status}
              </p>
              {uid && members.data && (
                <TripActivity
                  trip={trip}
                  members={members.data}
                  uid={uid}
                  thai={thai.value}
                />
              )}
              <h3>{t("Travelers", "ผู้เดินทาง")}</h3>
              {members.data
                ?.filter(
                  (m) => m.trip_id === trip.id && m.status === "approved",
                )
                .map((m) => (
                  <p key={m.id}>
                    {m.display_name}
                    {org && m.role !== "organizer" && (
                      <button
                        disabled={busy}
                        onClick={() =>
                          void run(async () => {
                            await rpc("remove_member", { p_member_id: m.id });
                          })
                        }
                      >
                        {t("Remove", "นำออก")}
                      </button>
                    )}
                  </p>
                ))}
              {org && (
                <>
                  <button
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
                  </button>
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      const name = new FormData(e.currentTarget).get("name");
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
                    <button disabled={busy}>
                      {t("Add traveler", "เพิ่มผู้เดินทาง")}
                    </button>
                  </form>
                  {requests.data
                    ?.filter(
                      (r) => r.trip_id === trip.id && r.status === "pending",
                    )
                    .map((r) => (
                      <div key={r.id}>
                        <p>{r.requested_display_name}</p>
                        {[true, false].map((approve) => (
                          <button
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
                          </button>
                        ))}
                      </div>
                    ))}
                  {invites.data
                    ?.filter((i) => i.trip_id === trip.id)
                    .map((i) => (
                      <p key={i.id}>
                        {i.uses_count}/{i.max_uses} · {i.expires_at}
                        <button
                          disabled={busy || !!i.revoked_at}
                          onClick={() =>
                            void run(async () => {
                              await rpc("revoke_invite", { p_invite_id: i.id });
                              setQr("");
                            })
                          }
                        >
                          {t("Revoke", "ยกเลิก")}
                        </button>
                      </p>
                    ))}
                  <button
                    disabled={busy || trip.status === "archived"}
                    onClick={() =>
                      void run(async () => {
                        await rpc("archive_trip", { p_trip_id: trip.id });
                        setQr("");
                      })
                    }
                  >
                    {t("Archive trip", "เก็บทริป")}
                  </button>
                </>
              )}
            </section>
          );
        })}
        {qr && (
          <section>
            <h2>{t("Scan to request access", "สแกนเพื่อขอเข้าร่วม")}</h2>
            <img
              src={qr}
              width="280"
              height="280"
              alt={t("Trip invitation QR code", "QR คำเชิญเข้าร่วมทริป")}
            />
            <button onClick={() => setQr("")}>{t("Close", "ปิด")}</button>
          </section>
        )}
      </main>
    </>
  );
}
