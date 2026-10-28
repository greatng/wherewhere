import { createClient } from "npm:@supabase/supabase-js@2";
const origin = Deno.env.get("APP_ORIGIN")!;
const rateSecret = Deno.env.get("INVITE_RATE_LIMIT_SECRET");
if (
  !rateSecret ||
  rateSecret.length < 32 ||
  !origin ||
  new URL(origin).origin !== origin
)
  throw Error("Invalid gateway configuration");
const admin = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false } },
);
const hex = (bytes: ArrayBuffer) =>
  Array.from(new Uint8Array(bytes), (x) =>
    x.toString(16).padStart(2, "0"),
  ).join("");
Deno.serve(async (req) => {
  const headers = {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Headers":
      "authorization, apikey, content-type, x-client-info",
    "Cache-Control": "no-store",
    "Content-Type": "application/json",
  };
  const reply = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers });
  if (req.method === "OPTIONS") return new Response(null, { headers });
  if (req.method !== "POST" || req.headers.get("origin") !== origin)
    return reply({ error: "forbidden" }, 403);
  try {
    const body = await req.text();
    if (body.length > 2048) return reply({ error: "invalid_request" }, 400);
    const { token, action, name } = JSON.parse(body);
    if (
      typeof token !== "string" ||
      !/^[a-f0-9]{64}$/.test(token) ||
      !["validate", "redeem"].includes(action)
    )
      return reply({ error: "invalid_invite" }, 400);
    let user = null;
    if (action === "redeem") {
      const jwt = req.headers.get("authorization")?.replace(/^Bearer /, "");
      if (!jwt) return reply({ error: "unauthorized" }, 401);
      const r = await admin.auth.getUser(jwt);
      if (r.error || !r.data.user) return reply({ error: "unauthorized" }, 401);
      user = r.data.user.id;
    }
    const ip =
      req.headers.get("x-forwarded-for")?.split(",").at(-1)?.trim() ||
      "unknown";
    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(rateSecret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
    const rate = hex(
      await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(ip)),
    );
    const hash = hex(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token)),
    );
    const { data, error } = await admin.rpc("invite_gateway", {
      p_hash: hash,
      p_rate_key: rate,
      p_user_id: user,
      p_name: action === "redeem" ? name : null,
    });
    if (error) return reply({ error: "unavailable" }, 503);
    return reply(
      data,
      data.error ? (data.error === "rate_limited" ? 429 : 400) : 200,
    );
  } catch {
    return reply({ error: "invalid_request" }, 400);
  }
});
