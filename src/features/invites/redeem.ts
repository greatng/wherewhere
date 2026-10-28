import { supabase as db } from "../../shared/supabase/client";
export async function redeem(token: string, name: FormDataEntryValue | null) {
  let s = (await db.auth.getSession()).data.session;
  if (!s) {
    const pre = await db.functions.invoke("invite-gateway", {
      body: { action: "validate", token },
    });
    if (pre.error || pre.data.error) throw Error();
    const a = await db.auth.signInAnonymously();
    if (a.error) throw a.error;
    s = a.data.session;
  }
  const r = await db.functions.invoke("invite-gateway", {
    body: { action: "redeem", token, name },
    headers: { Authorization: `Bearer ${s?.access_token}` },
  });
  if (r.error || r.data.error) throw Error();
}
