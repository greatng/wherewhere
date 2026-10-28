import { createClient } from "@supabase/supabase-js";
const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, ORGANIZER_EMAIL, APP_ORIGIN } =
  process.env;
if (
  !SUPABASE_URL ||
  !SUPABASE_SERVICE_ROLE_KEY ||
  !ORGANIZER_EMAIL ||
  !APP_ORIGIN
)
  throw Error(
    "Set SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, ORGANIZER_EMAIL, APP_ORIGIN",
  );
const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});
const { data, error } = await admin.auth.admin.generateLink({
  type: "magiclink",
  email: ORGANIZER_EMAIL,
  options: { redirectTo: APP_ORIGIN },
});
if (error)
  throw Error("Could not generate organizer setup link. Check configuration.");
console.log(
  "Open this private, short-lived link on the organizer device. Do not commit or share it:",
);
console.log(data.properties.action_link);
