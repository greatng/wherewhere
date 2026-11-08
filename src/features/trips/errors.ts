export function actionError(error: unknown, thai = false): string {
  const value = error as {
    code?: string;
    message?: string;
    status?: number;
  } | null;
  const code = value?.code ?? "";
  const message = value?.message?.toLowerCase() ?? "";
  const choose = (en: string, th: string) => (thai ? th : en);
  if (code === "PGRST202" || code === "PGRST205" || value?.status === 404)
    return choose(
      "This feature is not set up on the server yet. Ask the organizer to apply the latest database migrations and refresh the API schema.",
      "เซิร์ฟเวอร์ยังไม่ได้ตั้งค่าฟีเจอร์นี้ ให้ผู้จัดอัปเดตฐานข้อมูลและรีเฟรช API",
    );
  if (code === "40001")
    return choose(
      "This information changed on another device. Refresh, review the latest version, and try again.",
      "ข้อมูลถูกแก้ไขจากอุปกรณ์อื่น กรุณารีเฟรชและตรวจสอบก่อนลองใหม่",
    );
  if (message.includes("email") && message.includes("verif"))
    return choose(
      "Verify your email before creating a trip.",
      "กรุณายืนยันอีเมลก่อนสร้างทริป",
    );
  if (["22023", "23514", "22P02", "22007", "23505"].includes(code))
    return choose(
      "Some details are invalid or conflict with existing information. Review the dates, amounts, and selected travelers, then try again.",
      "ข้อมูลบางรายการไม่ถูกต้องหรือขัดแย้งกับข้อมูลเดิม กรุณาตรวจสอบวันที่ จำนวนเงิน และผู้เดินทางก่อนลองใหม่",
    );
  if (message.includes("not found") || message.includes("missing trip"))
    return choose(
      "This trip or item is no longer available. Refresh your trip list before continuing.",
      "ทริปหรือรายการนี้ไม่พร้อมใช้งานแล้ว กรุณารีเฟรชรายการทริปก่อนทำต่อ",
    );
  if (
    message.includes("invite") &&
    (message.includes("expired") ||
      message.includes("revoked") ||
      message.includes("valid"))
  )
    return choose(
      "This invitation is no longer valid. Ask the organizer to select or create a current invitation, then try again.",
      "คำเชิญนี้ใช้ไม่ได้แล้ว ให้ผู้จัดเลือกหรือสร้างคำเชิญปัจจุบันก่อนลองใหม่",
    );
  if (code === "42501" || value?.status === 403)
    return choose(
      "You no longer have permission for this action. Refresh your trip access or ask its organizer.",
      "คุณไม่มีสิทธิ์ทำรายการนี้ กรุณารีเฟรชสิทธิ์หรือติดต่อผู้จัดทริป",
    );
  if (code === "PGRST301" || value?.status === 401)
    return choose(
      "Your session could not be verified. Reconnect and refresh; email users can sign in again. Guests should contact their organizer before signing out.",
      "ไม่สามารถยืนยันบัญชี กรุณาเชื่อมต่อและรีเฟรช ผู้ใช้อีเมลลงชื่อเข้าใหม่ได้ ผู้เยี่ยมชมควรติดต่อผู้จัดก่อนออกจากระบบ",
    );
  if (message.includes("archived"))
    return choose(
      "This trip is archived. Its organizer can restore it before making changes.",
      "ทริปนี้เก็บถาวรแล้ว ให้ผู้จัดกู้คืนก่อนแก้ไข",
    );
  if (message.includes("exact trip name") || message.includes("confirmation"))
    return choose(
      "Type the trip name exactly to confirm deletion.",
      "พิมพ์ชื่อทริปให้ตรงเพื่อยืนยันการลบ",
    );
  if (
    message.includes("network") ||
    message.includes("fetch") ||
    (value?.status && value.status >= 500) ||
    !navigator.onLine
  )
    return choose(
      "The server could not be reached. Check your connection and try again. Your saved trip details remain on this device.",
      "ไม่สามารถเชื่อมต่อเซิร์ฟเวอร์ กรุณาตรวจสอบอินเทอร์เน็ตแล้วลองใหม่ ข้อมูลที่บันทึกยังอยู่ในอุปกรณ์",
    );
  return choose(
    "This action could not be completed. Refresh the trip and try again; ask the organizer if the problem continues.",
    "ทำรายการไม่สำเร็จ กรุณารีเฟรชทริปแล้วลองใหม่ หากยังมีปัญหาให้ติดต่อผู้จัด",
  );
}
