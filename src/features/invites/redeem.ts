import { supabase as db } from "../../shared/supabase/client";
import { throwInviteError } from "./errors";

export async function redeem(token: string, name: FormDataEntryValue | null) {
  let session;
  try {
    const current = await db.auth.getSession();
    if (current.error) return throwInviteError(current.error);
    session = current.data.session;
  } catch (error) {
    return throwInviteError(error);
  }

  if (!session) {
    const pre = await db.functions.invoke("invite-gateway", {
      body: { action: "validate", token },
    });
    if (pre.error) return throwInviteError(pre.error);
    if (!pre.data || pre.data.error || pre.data.valid === false)
      return throwInviteError(pre.data?.error ?? { code: "invalid_invite" });
    const a = await db.auth.signInAnonymously();
    if (a.error) return throwInviteError(a.error);
    session = a.data.session;
    if (!session) return throwInviteError({ status: 401 });
  }

  const result = await db.functions.invoke("invite-gateway", {
    body: { action: "redeem", token, name },
    headers: { Authorization: `Bearer ${session.access_token}` },
  });
  if (result.error) return throwInviteError(result.error);
  if (!result.data || result.data.error)
    return throwInviteError(result.data?.error ?? { code: "UNKNOWN" });
}
