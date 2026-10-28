# TravelMate — M1 and M2

Preact/TypeScript PWA for small group trips. Travelers join through an expiring QR invitation, receive a persistent Supabase anonymous session, and wait for organizer approval. English/Thai labels, 18px text and 56px buttons are included. No identity is created on launch.

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

For hosting, apply migrations with `supabase db push`, configure the two function secrets, then `supabase functions deploy invite-gateway`. Build with `npm run build` and serve `dist` over HTTPS at the origin root. The service worker caches public assets only; it never caches API responses or private trip data. Static hosting should set a CSP restricting scripts to self and connections to your Supabase endpoint, `Referrer-Policy: no-referrer`, and `X-Content-Type-Options: nosniff`.

## First organizer

An administrator runs `node scripts/bootstrap-organizer.mjs` with server-side environment variables `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `ORGANIZER_EMAIL`, and `APP_ORIGIN`. Open the printed private magic link on the organizer device. It provisions/signs in a nonanonymous organizer account without a traveler login screen. The link must remain private. The app restores this session on subsequent visits. Authenticated devices may create additional trips; organizer rights are assigned transactionally only for trips they create.

Create a trip, generate a QR, and have travelers scan it with their device camera. A traveler can also paste the same-origin invitation URL into the app. Install before enrollment when using a Home Screen PWA. Approval is always required. Use Refresh status after an organizer decision; focus/online events also refresh queries. Managed travelers have no auth account. Removal immediately revokes backend trip access. Archive revokes outstanding invites. Invitation history displays uses and expiration; raw tokens are shown only in the generated QR and cannot be recovered.

## Security and scope

- RLS filters trips and member lists by approved membership; requesters may see only their own pending requests. Invite history is organizer-only and token hashes are not selectable.
- Writes use fixed-search-path security-definer RPCs. The public client has no table write privileges and cannot grant itself organizer rights.
- Tokens contain 244 random bits from two UUIDs and only SHA-256 hashes are stored. URL fragments keep tokens out of HTTP request URLs. Gateway validation happens before anonymous sign-in and again atomically at redemption.
- Gateway validates bearer tokens using Supabase Auth and is the only caller permitted to redeem. HMAC IP buckets permit 20 attempts per ten minutes; failed valid-format attempts commit the counter. Verify your deployment's trusted proxy appends/overwrites `x-forwarded-for`; do not expose the function behind a proxy that lets callers control its last address. Also enable Supabase Auth CAPTCHA/rate limits for production anonymous signups.
- Pending requests reserve one invitation use. Duplicate requests do not consume another use, including across invitations for the same trip. Denials do not restore uses. Names never claim existing identities.
- M1/M2 tables cover trips, members, invitations and requests. Itinerary, expenses, check-in, offline private data/outbox and verified identity relinking are M3/M4 or later work. No GPS collection exists.
- Browser storage loss requires organizer-assisted rejoin. This release deliberately does not relink financial/member history automatically. Do not remove or replace an existing traveler solely because a new device presents the same name.

## Verify

```sh
npm test
npm run lint
npm run build
```

The database test executes the actual migration in PGlite (PostgreSQL WASM), with Auth roles and `auth.uid()` emulated. It checks isolation before approval, unauthorized organizer operations, duplicate joining/use counts, and expired/revoked invites. This is not a substitute for testing deployed Supabase Auth and Edge networking.

Manual acceptance: use separate organizer and traveler browser profiles; request approval; confirm traveler cannot see a trip until approved; revoke an invite; reload both sessions; remove traveler and refresh; install the production build on iOS and Android and repeat enrollment/relaunch. Real-device storage separation and the full hosted Auth/Edge flow have not been verified in this environment. Sessions remain recoverable only while local auth storage survives. Private offline data is intentionally not available in M1/M2.
