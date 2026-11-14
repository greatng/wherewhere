# Supabase email code setup

Roam signs users in with a six-digit email code. The app calls Supabase `signInWithOtp` and `verifyOtp`; guest email upgrades use `updateUser({ email })` and verify the email change on the same guest identity. The Supabase email messages must expose the token itself so users can enter it in the app.

## Auth URL configuration

In Supabase Dashboard, open **Authentication → URL Configuration**:

1. Set **Site URL** to the deployed Roam origin, including its scheme and host (for example, `https://your-deployed-host`). Use the actual deployment origin; do not leave `http://localhost:5173` as the production Site URL.
2. Add the same deployed origin to **Redirect URLs**. Add any separately used preview or local origins explicitly when needed. Do not use a broad wildcard for production.

The current code verification flow does not depend on an email redirect link. These URL settings still establish the correct project default and support other Supabase auth redirects.

## Email templates

Open **Authentication → Email Templates** and set the body of each template below. The app needs numeric codes for these three flows:

- **Confirm signup** — new email sign-in / signup
- **Magic Link** — sign-in when Supabase sends this template
- **Change Email Address** — upgrading a guest identity with an email address

Paste the corresponding body from [`supabase/templates`](../supabase/templates). Each message contains `{{ .Token }}` and no confirmation URL. Keep the token placeholder intact. A link template using `{{ .ConfirmationURL }}` will not match Roam's code-entry screen.

## OTP and SMTP settings

In **Authentication → Providers → Email**, set the **OTP length** to `6` to match the app's six-digit input, and choose an OTP expiry appropriate for your sign-in policy. Supabase's default is commonly one hour; a shorter expiry such as 10 minutes reduces the time an unused code remains valid. Ensure the setting remains within the Supabase supported range.

Configure a production SMTP provider in **Project Settings → Authentication → SMTP Settings** (menu names may vary). Verify the sender domain with that provider and use its SMTP host, port, username, and password. Supabase's built-in mail service has restrictive delivery limits and is intended for evaluation; production delivery and higher-volume limits depend on the configured provider and Supabase plan. Also review **Authentication → Rate Limits**: resend cooldowns and per-recipient/IP limits can prevent rapid repeated sends. The app applies a 60-second resend cooldown as well.

After setup, test one new address, one existing address, and a guest email upgrade. Codes should arrive as six digits. For a guest upgrade, keep the same browser or installed app open until the code is verified so the original anonymous identity and memberships are preserved.
