# Roam — M1 through M4 and Phase 1

Roam is a Preact/TypeScript PWA for small group trips. Travelers join through an expiring QR invitation, receive a persistent Supabase anonymous session, and wait for organizer approval. Approved travelers share an itinerary and expenses with deterministic whole-unit splits and suggested settlements. The dashboard keeps one trip workspace open at a time. Itinerary and expense data can be cached on the device, and expenses created offline are queued for inspection and retry when connectivity returns. English/Thai labels, 18px text and 56px buttons are included. No identity is created on launch.

Phase 1 adds nightly city/date ranges and accommodation, daily activities with transport, expense date/time and correction, and trip archive/restore. The trip workspace presents Today, Itinerary, Expenses, and Trip sections for mobile use. Existing trip data remains readable after archiving; restoring a trip does not restore invitations that were revoked during archive.

## Run locally

Use Node 22.12+ (tested with Node 24) and Docker with the Supabase CLI installed.

```sh
npm ci
supabase start
supabase db reset
cp .env.example .env.local
# Put the URL and public anon/publishable key from `supabase status` in .env.local.
npm run dev
```

Enable anonymous sign-ins in hosted Supabase Auth. Never put a service role key in a VITE variable. Configure Auth Site URL and redirect allowlist to the app origin.

Serve the invite gateway with a local untracked secrets file containing `APP_ORIGIN=http://localhost:5173` and `INVITE_RATE_LIMIT_SECRET` (at least 32 random bytes, e.g. `openssl rand -hex 32`). Supabase supplies its own URL and service role key inside the function.

```sh
supabase functions serve invite-gateway --env-file .env.functions
```

For a new hosted project, link the local Supabase directory to the project and apply migrations with `supabase db push`; then configure the Edge Function secrets and deploy `invite-gateway`:

```sh
supabase login
supabase link --project-ref YOUR_PROJECT_REF
supabase db push
supabase secrets set APP_ORIGIN=https://YOUR_APP_ORIGIN INVITE_RATE_LIMIT_SECRET="$(openssl rand -hex 32)"
supabase functions deploy invite-gateway
```

For an existing hosted project initialized by manually running migrations `001` and `002`, back up the database, review [migration `003`](supabase/migrations/202610280003_daily_planning.sql), and run that SQL script once in the SQL Editor for the intended hosted project. Do not rerun `001` or `002`, and do not use `supabase db push` unless this project already has matching entries in Supabase migration history; otherwise the CLI may treat the earlier scripts as pending. After `003` finishes, refresh the Supabase API schema cache (run `NOTIFY pgrst, 'reload schema';` in the SQL Editor) so the new tables and RPCs are available to the app. For projects managed by the Supabase CLI with migration history in sync, use `supabase migration list` to confirm the remote history, back up and review pending SQL, then run `supabase db push`; it applies migrations not recorded as applied remotely. If `003` was already applied manually, compare the live schema and migration history and reconcile the history before using the CLI; do not rerun the SQL or mark a migration applied just to bypass a schema mismatch. After deployment, verify Auth anonymous sign-in, the `invite-gateway` secrets, and the app URL/redirect allowlist. Build with `npm run build` and serve `dist` over HTTPS at the origin root. The service worker caches public assets only; it never caches API responses or private trip data. Static hosting should set a CSP restricting scripts to self and connections to your Supabase endpoint, `Referrer-Policy: no-referrer`, and `X-Content-Type-Options: nosniff`.

For a hosted project that already ran migrations `001` through `003` manually, back up the database, review [migration `004`](supabase/migrations/202610310004_email_trip_creators.sql), then run that SQL script once in the SQL Editor. Do not run it again. If the project tracks migrations with the Supabase CLI, check remote history and use `supabase db push` to apply pending migrations instead. Migration `004` only changes the trip-creation RPC; it does not rewrite existing Auth users, memberships, or guest access.

For destination-local activity times, create new trips with an explicit IANA destination timezone (new trips default to `Asia/Bangkok`). Apply [migration `007`](supabase/migrations/202611130007_trip_timezone_setting.sql) after migrations `001`–`006`, then redeploy the frontend. Organizers can correct a trip's destination timezone in Trip settings. A correction preserves every saved timestamp; the app displays those instants in the new timezone and groups activities by their destination-local date. The timezone RPC requires an active trip organizer and validates against PostgreSQL's IANA timezone database.


For a hosted project that already ran migrations `001` through `004` manually, back up the database, review [migration `005`](supabase/migrations/202611060005_supervised_guest_recovery.sql), then run that SQL script once in the SQL Editor. Do not run it again. If the project tracks migrations with the Supabase CLI, check remote history and use `supabase db push` to apply pending migrations instead. Migration `005` adds organizer-supervised recovery for an existing trip member; it does not grant access based on a name or invitation QR. The organizer must verify the person through a trusted channel and link an eligible recovery request to that member.

In Supabase Auth, require email confirmation and set the email OTP length to 6 digits with an expiry appropriate for your sign-in flow. Configure all three email templates used by the app: **Confirm signup**, **Magic Link**, and **Change Email**. Each template must display the code with `{{ .Token }}` (for example, “Your Roam code is {{ .Token }}”) so users can enter the six-digit code. The Change Email template is used when a QR guest upgrades the same anonymous account with `updateUser({ email })`; completing that email-change confirmation keeps the guest's existing user ID and trip memberships. Configure a custom SMTP provider with a verified sender address and domain before production. Supabase's built-in mailer is rate-limited and restricted to project team recipients, and SMTP providers commonly reject unverified From addresses or domains.

## First organizer

An administrator runs `node scripts/bootstrap-organizer.mjs` with server-side environment variables `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `ORGANIZER_EMAIL`, and `APP_ORIGIN`. Open the printed private magic link on the organizer device. It provisions/signs in a nonanonymous organizer account without a traveler login screen. The link must remain private. The app restores this session on subsequent visits. Authenticated devices may create additional trips; organizer rights are assigned transactionally only for trips they create.

Create a trip, generate a QR, and have travelers scan it with their device camera. A traveler can also paste the same-origin invitation URL into the app. Install before enrollment when using a Home Screen PWA. Approval is always required. Use Refresh status after an organizer decision; focus/online events also refresh queries. Managed travelers have no auth account. Removal immediately revokes backend trip access. Archive revokes outstanding invites. Invitation history displays uses and expiration; raw tokens are shown only in the generated QR and cannot be recovered.

## Security and scope

- RLS filters trips and member lists by approved membership; requesters may see only their own pending requests. Invite history is organizer-only and token hashes are not selectable.
- Writes use fixed-search-path security-definer RPCs. The public client has no table write privileges and cannot grant itself organizer rights.
- Tokens contain 244 random bits from two UUIDs and only SHA-256 hashes are stored. URL fragments keep tokens out of HTTP request URLs. Gateway validation happens before anonymous sign-in and again atomically at redemption.
- Gateway validates bearer tokens using Supabase Auth and is the only caller permitted to redeem. HMAC IP buckets permit 20 attempts per ten minutes; failed valid-format attempts commit the counter. Verify your deployment's trusted proxy appends/overwrites `x-forwarded-for`; do not expose the function behind a proxy that lets callers control its last address. Also enable Supabase Auth CAPTCHA/rate limits for production anonymous signups.
- Pending requests reserve one invitation use. Duplicate requests do not consume another use, including across invitations for the same trip. Denials do not restore uses. Names never claim existing identities.
- Itinerary, check-in, expense and share writes are restricted to approved trip members through RLS and fixed-search-path security-definer RPCs. Expense amounts use integer minor units; each selected member receives an equal split and earlier selections receive any remainder.
- Offline cache and outbox records are scoped by the current auth user and trip. The app queues expenses while offline and retries them on reconnection. This provides best-effort offline entry; it is not a promise of conflict-free editing or guaranteed delivery if browser storage is cleared.
- No GPS collection exists. Location coordinates are optional itinerary data entered by the organizer and are used only to form a map link. Browser storage loss requires organizer-assisted rejoin; verified identity relinking across lost devices is not implemented, so do not remove or replace an existing traveler solely because a new device presents the same name.

## Verify

```sh
npm test
npm run lint
npm run build
npx playwright install chromium
npm run test:e2e
```

The database tests execute the actual migrations in PGlite (PostgreSQL WASM), with Auth roles and `auth.uid()` emulated. They check membership isolation, unauthorized operations, invite handling, itinerary/check-in access, expense integrity, and supervised guest recovery. Playwright exercises trip selection, trip creation, a three-night plan range and middle-night edit, lodging, activities and transport, expense date/time and correction, Trip-tab management, confirmed deletion, account sign-out safety, persisted Senior view, and offline queue recovery in desktop and mobile Chromium against deterministic mocked Supabase responses. It checks form labels and captures dashboard and Today, Itinerary, Expenses, Trip, and Senior view previews in both viewports under a fixed trip date in `artifacts/`; those images are previews, not evidence of a live Supabase session or production data. These checks do not replace testing deployed Supabase Auth and Edge networking.

Manual acceptance before release: use separate organizer and traveler browser profiles; request approval; confirm traveler cannot see a trip until approved; revoke an invite; reload both sessions; remove a traveler and refresh; test offline entry and recovery after going online; install the production build on iOS and Android and repeat enrollment/relaunch. Real-device storage separation, push/install behavior, and the hosted Auth/Edge flow have not been verified by the browser fixture. Sessions remain recoverable only while local auth storage survives.


For emails that currently link to a development domain, follow the [email code and production URL setup](docs/email-setup.md). The app already verifies six-digit codes; the hosted Supabase email templates determine whether an email contains a code or a link.


## Appearance and 21st design workflow

Use the sun/moon header control to switch light/dark appearance. Before an explicit choice, Roam follows system appearance; a choice is stored under `paikan-theme` on the device. QR codes retain a white background in both modes.

The official `21st-dev/skill` workflow retrieved and integrated two real catalog sources: @shugar/button-1 (3824) and @campsite/theme-toggle (554). Shared Preact buttons now serve the trip workspace, Plan, expenses, account, guest recovery and email access. Account → Appearance offers Light/Dark/System; the header quick toggle remains. Source snapshots, attribution and adaptation details live in [vendor/21st](vendor/21st/README.md). React/Next/Radix-specific dependencies were replaced with native Preact controls; this does not migrate the app to Next.js. No API key is stored in the repository.


Participant check-in and attendance controls have been retired. Historical server records remain intact. Previously queued check-in operations remain inspectable and can finish replaying with their original operation IDs; the current UI does not create new check-ins. Accommodation check-in/check-out dates are unrelated and remain available. No database migration is required for this removal.


## Daily plan and accommodation

Itinerary's Daily overview groups each date's overnight city, hotel and activities together. The separate Accommodation view lists stays. Organizers can open the same version-checked accommodation editor from either view; a multi-night edit affects the displayed stay range, not a duplicate booking. Check-out dates are exclusive.

Today includes previous/next controls and an itinerary-date field. It defaults to destination-local today during the trip, the first day before departure, and the last day afterward. The selected day shows its city, hotel, directions and complete itinerary; free days still show accommodation and the next planned activity date when available. Current/next highlights apply only to the actual destination-local today. English user stories: [US24 and US25](docs/stories/daily-overviews.md).


## Receiving app updates

When a newer PWA worker is waiting, Roam shows **Update app**. Save any open form before applying it; the app activates the waiting worker and reloads only after you choose to update. Identity storage and pending offline operations are retained. Focus/online events check for updates.

Older installed versions did not include this notice. If the web deployment is current but controls are missing, close every Roam browser tab and installed-app window, then reopen the app. Do not clear browser storage or site data: anonymous session identity can be lost. Reloading a page alone may leave the older worker waiting while another tab remains open.

Run `npm run test:pwa` to build and verify actual production service-worker installation, waiting update discovery on launch, explicit activation/reload, and retention of a storage marker and queued expense. It uses an isolated local browser profile and synthetic data. CI runs the same script against its generated build.


Itinerary uses day-by-day timeline cards. Organizers open each record's three-dot menu to edit/remove it, or use the floating **Edit itinerary** control to add activities, city nights or accommodation and open accommodation management. Participants see the same itinerary without editing controls. The design does not imply booking confirmation or room counts unless those data are actually available.


If a QR is generated but a different mobile cannot join, follow [invitation gateway deployment](docs/invitation-setup.md). The hosted `invite-gateway` must exist independently of database QR creation. The setup guide includes a no-Docker Dashboard path and a safe preflight check.
