# TravelMate — M1 through M4 and Phase 1

Preact/TypeScript PWA for small group trips. Travelers join through an expiring QR invitation, receive a persistent Supabase anonymous session, and wait for organizer approval. Approved travelers share an itinerary, arrival check-ins, and expenses with deterministic whole-unit splits and suggested settlements. Itinerary and expense data can be cached on the device, and check-ins/expenses created offline are queued for retry when connectivity returns. English/Thai labels, 18px text and 56px buttons are included. No identity is created on launch.

Phase 1 adds nightly city/date ranges and accommodation, daily activities with transport, expense date/time and correction, and trip archive/restore. The trip workspace presents Today, Plan, Expenses, and Trip sections for mobile use. Existing trip data remains readable after archiving; restoring a trip does not restore invitations that were revoked during archive.

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
- Offline cache and outbox records are scoped by the current auth user and trip. The app queues check-ins and expenses while offline and retries them on reconnection. This provides best-effort offline entry; it is not a promise of conflict-free editing or guaranteed delivery if browser storage is cleared.
- No GPS collection exists. Location coordinates are optional itinerary data entered by the organizer and are used only to form a map link. Browser storage loss requires organizer-assisted rejoin; verified identity relinking across lost devices is not implemented, so do not remove or replace an existing traveler solely because a new device presents the same name.

## Verify

```sh
npm test
npm run lint
npm run build
npx playwright install chromium
npm run test:e2e
```

The database tests execute the actual migrations in PGlite (PostgreSQL WASM), with Auth roles and `auth.uid()` emulated. They check membership isolation, unauthorized operations, invite handling, itinerary/check-in access, and expense integrity. Playwright exercises trip creation, a three-night plan range and middle-night edit, lodging, activities and transport, expense date/time and correction, trip archive/restore, delete confirmation, and offline check-in in desktop and mobile Chromium against deterministic mocked Supabase responses. It checks form labels and captures Today, Plan, Expenses, and Trip previews in both viewports under a fixed trip date in `artifacts/`; those images are previews, not evidence of a live Supabase session or production data. These checks do not replace testing deployed Supabase Auth and Edge networking.

Manual acceptance before release: use separate organizer and traveler browser profiles; request approval; confirm traveler cannot see a trip until approved; revoke an invite; reload both sessions; remove a traveler and refresh; test offline entry and recovery after going online; install the production build on iOS and Android and repeat enrollment/relaunch. Real-device storage separation, push/install behavior, and the hosted Auth/Edge flow have not been verified by the browser fixture. Sessions remain recoverable only while local auth storage survives.
