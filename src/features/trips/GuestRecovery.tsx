import { Button } from "../../shared/ui/Button";
type Request = {
  id: string;
  trip_id: string;
  status: string;
  requested_display_name: string;
};
type Member = {
  id: string;
  trip_id: string;
  status: string;
  display_name: string;
  role: string;
};
type Invite = {
  id: string;
  trip_id: string;
  revoked_at: string | null;
  expires_at: string;
  uses_count: number;
  max_uses: number;
};
export function GuestRecovery({
  tripId,
  requests,
  members,
  invites,
  busy,
  thai,
  onAction,
}: {
  tripId: string;
  requests: Request[];
  members: Member[];
  invites: Invite[];
  busy: boolean;
  thai: boolean;
  onAction: (name: string, args: Record<string, unknown>) => void;
}) {
  const t = (en: string, th: string) => (thai ? th : en);
  const denied = requests.filter(
    (r) => r.trip_id === tripId && r.status === "denied",
  );
  const pending = requests.filter(
    (r) => r.trip_id === tripId && r.status === "pending",
  );
  const removed = members.filter(
    (m) =>
      m.trip_id === tripId && m.status === "removed" && m.role !== "organizer",
  );
  const validInvites = invites.filter(
    (i) =>
      i.trip_id === tripId &&
      !i.revoked_at &&
      new Date(i.expires_at).getTime() > Date.now() &&
      i.uses_count < i.max_uses,
  );
  return (
    <section class="guest-recovery">
      <h3>{t("Supervised guest recovery", "กู้คืนผู้เยี่ยมชมโดยผู้จัด")}</h3>
      <p>
        {t(
          "Verify the person in person or through a trusted channel first. A matching name or QR invitation is not proof of identity.",
          "ยืนยันบุคคลต่อหน้าหรือผ่านช่องทางที่เชื่อถือก่อน ชื่อตรงกันหรือคำเชิญ QR ไม่ใช่หลักฐานยืนยันตัวตน",
        )}
      </p>
      {denied.map((r) => (
        <details key={r.id}>
          <summary>
            {t("Reopen request for", "เปิดคำขออีกครั้งสำหรับ")}{" "}
            {r.requested_display_name}
          </summary>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              onAction("reopen_join_request", {
                p_request_id: r.id,
                p_identity_verified: f.get("verified") === "on",
                p_invite_id: f.get("invite") || null,
              });
            }}
          >
            <label>
              {t("Invitation for this request", "คำเชิญสำหรับคำขอนี้")}
              <select name="invite">
                <option value="">
                  {t(
                    "Use original invitation (must still be valid)",
                    "ใช้คำเชิญเดิม (ต้องยังไม่หมดอายุ)",
                  )}
                </option>
                {validInvites.map((i) => (
                  <option key={i.id} value={i.id}>
                    {t("New invitation expiring", "คำเชิญใหม่หมดอายุ")}{" "}
                    {new Date(i.expires_at).toLocaleString(
                      thai ? "th-TH" : "en",
                    )}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <input type="checkbox" name="verified" required />
              {t(
                "I verified this person through a trusted channel.",
                "ฉันยืนยันบุคคลนี้ผ่านช่องทางที่เชื่อถือแล้ว",
              )}
            </label>
            <Button disabled={busy}>
              {t("Reopen for approval", "เปิดคำขอเพื่อพิจารณาอีกครั้ง")}
            </Button>
          </form>
        </details>
      ))}
      {pending.length > 0 && removed.length > 0 && (
        <details>
          <summary>
            {t(
              "Reconnect a verified traveler to an existing member",
              "เชื่อมผู้เดินทางที่ยืนยันแล้วกับสมาชิกเดิม",
            )}
          </summary>
          <p>
            {t(
              "The selected old member keeps their expenses and history. Access moves to the requesting device; the old device loses this trip.",
              "สมาชิกเดิมยังคงประวัติค่าใช้จ่ายและเช็กอิน สิทธิ์จะย้ายไปอุปกรณ์ที่ขอ และอุปกรณ์เดิมจะหมดสิทธิ์ในทริปนี้",
            )}
          </p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              onAction("recover_member", {
                p_request_id: f.get("request"),
                p_member_id: f.get("member"),
                p_identity_verified: f.get("verified") === "on",
              });
            }}
          >
            <label>
              {t("Requesting device", "อุปกรณ์ที่ขอเข้าร่วม")}
              <select name="request" required>
                <option value="">{t("Choose request", "เลือกคำขอ")}</option>
                {pending.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.requested_display_name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              {t("Existing removed member", "สมาชิกเดิมที่ถูกนำออก")}
              <select name="member" required>
                <option value="">{t("Choose member", "เลือกสมาชิก")}</option>
                {removed.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.display_name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <input type="checkbox" name="verified" required />
              {t(
                "I verified these are the same person and authorize moving access.",
                "ฉันยืนยันว่าเป็นบุคคลเดียวกันและอนุญาตให้ย้ายสิทธิ์",
              )}
            </label>
            <Button disabled={busy}>
              {t("Recover existing member", "กู้คืนสมาชิกเดิม")}
            </Button>
          </form>
        </details>
      )}
      {!denied.length && (!pending.length || !removed.length) && (
        <p>
          {t(
            "No recovery actions are waiting. If a traveler lost their session, first verify them, remove their old device membership, and ask the new device to request access with a valid invitation. Recover the existing member before approving a new member.",
            "ไม่มีรายการกู้คืนที่รออยู่ หากผู้เดินทางสูญเสียบัญชี ให้ยืนยันตัวตน นำสิทธิ์อุปกรณ์เดิมออก และให้อุปกรณ์ใหม่ขอเข้าร่วมด้วยคำเชิญที่ใช้ได้ แล้วกู้คืนสมาชิกเดิมก่อนอนุมัติเป็นสมาชิกใหม่",
          )}
        </p>
      )}
    </section>
  );
}
