type InviteFailure = { code?: string; message?: string; status?: number };

async function failureDetails(error: unknown): Promise<InviteFailure> {
  if (typeof error === "string") return { code: error };
  const value = error as InviteFailure & { name?: string; context?: unknown };
  const details: InviteFailure = {
    code: value?.code,
    message: value?.message,
    status: value?.status,
  };
  const context = value?.context as Response | undefined;
  if (context && typeof context.status === "number") {
    details.status = context.status;
    try {
      const payload = await context.clone().json();
      if (payload && typeof payload === "object") {
        details.code =
          typeof payload.code === "string" ? payload.code : details.code;
        if (!details.code && typeof payload.error === "string")
          details.code = payload.error;
        details.message =
          typeof payload.message === "string" ? payload.message : undefined;
      }
    } catch {
      // A malformed gateway response still has a useful HTTP status.
    }
  }
  if (value?.name === "FunctionsFetchError")
    details.code = "GATEWAY_CONNECTION";
  return details;
}

export async function inviteError(
  error: unknown,
  thai = false,
): Promise<Error> {
  const { code = "", status } = await failureDetails(error);
  const choose = (en: string, th: string) => (thai ? th : en);
  let message: string;
  let safeCode: string;
  if (code === "gateway_not_configured") {
    safeCode = "INVITE_CONFIG";
    message = choose(
      "Ask the organizer to configure the invitation service's required server settings, then try again.",
      "กรุณาให้ผู้จัดตั้งค่าเซิร์ฟเวอร์ของบริการคำเชิญให้ครบ แล้วลองอีกครั้ง",
    );
  } else if (
    ["NOT_FOUND", "FUNCTION_NOT_FOUND"].includes(code) ||
    status === 404
  ) {
    safeCode = "INVITE_SETUP";
    message = choose(
      "Invitations are not set up on this server yet. Ask the organizer to deploy the invite-gateway function.",
      "เซิร์ฟเวอร์ยังไม่ได้ตั้งค่าคำเชิญ กรุณาให้ผู้จัดติดตั้งฟังก์ชัน invite-gateway",
    );
  } else if (
    [
      "invalid_invite",
      "expired_invite",
      "revoked_invite",
      "INVALID_INVITE",
      "EXPIRED_INVITE",
    ].includes(code)
  ) {
    safeCode = "INVITE_INVALID";
    message = choose(
      "This invitation is invalid or expired. Ask the organizer for a current invitation.",
      "คำเชิญนี้ไม่ถูกต้องหรือหมดอายุแล้ว กรุณาขอคำเชิญใหม่จากผู้จัด",
    );
  } else if (
    ["rate_limit", "rate_limited", "RATE_LIMIT", "too_many_requests"].includes(
      code,
    ) ||
    status === 429
  ) {
    safeCode = "INVITE_RATE_LIMIT";
    message = choose(
      "Too many attempts were made. Wait a little and try again.",
      "มีการลองมากเกินไป กรุณารอสักครู่แล้วลองอีกครั้ง",
    );
  } else if (code === "GATEWAY_CONNECTION") {
    safeCode = "INVITE_CONNECTION";
    message = choose(
      "Could not connect to the invitation service. Check your connection; if it continues, ask the organizer to check the invite-gateway deployment and CORS setup.",
      "เชื่อมต่อบริการคำเชิญไม่ได้ กรุณาตรวจสอบอินเทอร์เน็ต หากยังมีปัญหาให้ผู้จัดตรวจสอบการติดตั้ง invite-gateway และการตั้งค่า CORS",
    );
  } else if (status === 401) {
    safeCode = "INVITE_AUTH";
    message = choose(
      "Your guest session could not be verified. Refresh and try again; contact the organizer if this continues.",
      "ไม่สามารถยืนยันเซสชันผู้เยี่ยมชมได้ กรุณารีเฟรชแล้วลองอีกครั้ง หากยังมีปัญหาให้ติดต่อผู้จัด",
    );
  } else if (
    status === 403 ||
    ["FORBIDDEN", "origin_not_allowed", "ORIGIN_NOT_ALLOWED"].includes(code)
  ) {
    safeCode = "INVITE_FORBIDDEN";
    message = choose(
      "The invitation service denied this request. Ask the organizer to check its allowed origins and invitation settings.",
      "บริการคำเชิญปฏิเสธคำขอนี้ กรุณาให้ผู้จัดตรวจสอบโดเมนที่อนุญาตและการตั้งค่าคำเชิญ",
    );
  } else {
    const authMessage =
      (error as InviteFailure | null)?.message?.toLowerCase() ?? "";
    if (
      code === "anonymous_provider_disabled" ||
      authMessage.includes("anonymous sign-ins are disabled")
    ) {
      safeCode = "INVITE_ANONYMOUS_DISABLED";
      message = choose(
        "Guest invitations are not enabled on this server. Ask the organizer to enable anonymous sign-ins in the Supabase Auth settings.",
        "เซิร์ฟเวอร์ยังไม่เปิดใช้คำเชิญสำหรับผู้เยี่ยมชม กรุณาให้ผู้จัดเปิด anonymous sign-ins ในการตั้งค่า Supabase Auth",
      );
    } else {
      safeCode = "INVITE_UNKNOWN";
      message = choose(
        "Could not complete the invitation. Check your connection and try again; ask the organizer to check the invite-gateway setup if it continues.",
        "ดำเนินการคำเชิญไม่สำเร็จ กรุณาตรวจสอบอินเทอร์เน็ตแล้วลองอีกครั้ง หากยังมีปัญหาให้ผู้จัดตรวจสอบการตั้งค่า invite-gateway",
      );
    }
  }
  return Object.assign(new Error(message), { code: safeCode });
}

export async function throwInviteError(
  error: unknown,
  thai = false,
): Promise<never> {
  throw await inviteError(error, thai);
}
