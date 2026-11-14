import { Button } from "../../shared/ui/Button";
import { useEffect, useState } from "preact/hooks";
import {
  confirmEmailCode,
  requestEmailCode,
  type EmailEnrollment,
} from "./email";

export function EmailAccess({
  guest,
  thai,
  onVerified,
}: {
  guest: boolean;
  thai: boolean;
  onVerified: () => void;
}) {
  const t = (en: string, th: string) => (thai ? th : en);
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [enrollment, setEnrollment] = useState<EmailEnrollment>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [cooldown, setCooldown] = useState(0);
  useEffect(() => {
    if (!cooldown) return;
    const timer = window.setTimeout(() => setCooldown(cooldown - 1), 1000);
    return () => window.clearTimeout(timer);
  }, [cooldown]);
  async function send() {
    if (busy || cooldown) return;
    setBusy(true);
    setError("");
    try {
      setEnrollment(await requestEmailCode(email));
      setCode("");
      setCooldown(60);
    } catch {
      setError(
        t(
          guest
            ? "Could not send the code. Check your email address and connection. If this email already has an account, contact your organizer before changing accounts so you keep access to your guest trips."
            : "Could not send the code. Check your email address and connection, then try again later.",
          guest
            ? "ส่งรหัสไม่ได้ กรุณาตรวจสอบอีเมลและอินเทอร์เน็ต หากอีเมลนี้มีบัญชีแล้ว ให้ติดต่อผู้จัดก่อนเปลี่ยนบัญชีเพื่อรักษาสิทธิ์ในทริปของผู้เยี่ยมชม"
            : "ส่งรหัสไม่ได้ กรุณาตรวจสอบอีเมลและอินเทอร์เน็ต แล้วลองใหม่ภายหลัง",
        ),
      );
    } finally {
      setBusy(false);
    }
  }
  async function verify() {
    if (!enrollment || busy) return;
    setBusy(true);
    setError("");
    try {
      await confirmEmailCode(enrollment, code);
      onVerified();
    } catch {
      setError(
        t(
          "The code could not be verified. Check the six digits, or request a new code when available. Keep using the same browser or installed app.",
          "ยืนยันรหัสไม่ได้ กรุณาตรวจสอบรหัส 6 หลัก หรือขอรหัสใหม่เมื่อพร้อม โดยใช้เบราว์เซอร์หรือแอปเดิม",
        ),
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <section aria-labelledby="email-access-title">
      <h2 id="email-access-title">
        {t("Create trips with your email", "ใช้อีเมลเพื่อสร้างทริป")}
      </h2>
      <p>
        {t(
          guest
            ? "You can keep joining trips as a guest. Verify an email to create your own trips while keeping this guest identity."
            : "Sign in with a six-digit email code to create and manage your trips. Travelers can join by QR as guests.",
          guest
            ? "คุณยังเข้าร่วมทริปแบบผู้เยี่ยมชมได้ ยืนยันอีเมลเพื่อสร้างทริปของคุณโดยคงบัญชีผู้เยี่ยมชมนี้ไว้"
            : "ลงชื่อเข้าใช้ด้วยรหัสอีเมล 6 หลักเพื่อสร้างและจัดการทริป ผู้เดินทางเข้าร่วมแบบผู้เยี่ยมชมผ่าน QR ได้",
        )}
      </p>
      {error && <p role="alert">{error}</p>}
      {enrollment ? (
        <>
          <p role="status">
            {t("Enter the code sent to", "กรอกรหัสที่ส่งไปยัง")}{" "}
            {enrollment.email}
          </p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void verify();
            }}
          >
            <label>
              {t("Six-digit code", "รหัส 6 หลัก")}
              <input
                name="emailCode"
                value={code}
                onInput={(e) => setCode(e.currentTarget.value)}
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="[0-9]{6}"
                minLength={6}
                maxLength={6}
                required
              />
            </label>
            <Button disabled={busy}>
              {busy
                ? t("Please wait…", "กรุณารอสักครู่…")
                : t("Verify email", "ยืนยันอีเมล")}
            </Button>
          </form>
          <Button disabled={busy || cooldown > 0} onClick={() => void send()}>
            {cooldown
              ? t(`Resend in ${cooldown}s`, `ส่งใหม่ได้ใน ${cooldown} วินาที`)
              : t("Resend code", "ส่งรหัสใหม่")}
          </Button>
          <Button
            disabled={busy}
            onClick={() => {
              setEnrollment(undefined);
              setCode("");
              setError("");
            }}
          >
            {t("Change email", "เปลี่ยนอีเมล")}
          </Button>
        </>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void send();
          }}
        >
          <label>
            {t("Email address", "ที่อยู่อีเมล")}
            <input
              name="organizerEmail"
              type="email"
              autoComplete="email"
              value={email}
              onInput={(e) => setEmail(e.currentTarget.value)}
              required
            />
          </label>
          <Button disabled={busy || cooldown > 0}>
            {busy
              ? t("Sending…", "กำลังส่ง…")
              : cooldown
                ? t(`Try again in ${cooldown}s`, `ลองใหม่ใน ${cooldown} วินาที`)
                : t("Send sign-in code", "ส่งรหัสลงชื่อเข้าใช้")}
          </Button>
        </form>
      )}
    </section>
  );
}
