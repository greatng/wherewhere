# TravelMate — Codex implementation brief

## Product purpose
Build a lightweight, installable, mobile-first Progressive Web App (PWA) to coordinate small group trips, especially a family journey with 3 elders and 5 adults. It must also support unlimited additional trips with entirely different member sets. Optimize for low cognitive load, low battery/data usage, offline resilience, and a login-free *user experience*. The backend still authenticates every device securely.

## Core decisions
- Frontend: Preact + TypeScript + Vite, Preact Signals for ephemeral UI, TanStack Preact Query for server state; Tailwind CSS and small accessible primitives. Avoid React-heavy component libraries unless compatibility is verified.
- Backend: Supabase (Postgres, Auth, Realtime, optional Edge Functions). Use rigorous row-level security (RLS). No dedicated server or microservices in MVP.
- Local/offline: IndexedDB via Dexie; PWA with vite-plugin-pwa; cache shell, essential itinerary, hotel/emergency cards; queue mutations and reconcile on reconnect/app resume.
- Navigation: generate Google Maps deep links; no map SDK or continuous GPS needed for MVP.
- Authentication UX: no email/password/OTP or visible login screen for elderly travelers. Under the hood use Supabase anonymous auth and persist session/auto-refresh. **Create anonymous identities only when redeeming a valid invitation; never on every launch.**
- QR invite: an organizer creates a trip and displays QR containing an invitation URL with a high-entropy random token. Store a hash, enforce expiry/revocation/use policies, validate on server, and require organizer approval (at least by default). Invitation token must not become long-lived device credential.
- PWA install: especially on iOS, browser tab storage and installed PWA storage may differ. Finish anonymous enrollment inside the installed PWA or use a short-lived secure enrollment handoff. Verify actual iOS/Android behavior.
- Recovery: if browser storage is lost, organize supervised rejoin and relink to an existing *trip member* only after the organizer verifies identity. Never let a name selection or invite QR alone claim someone's identity.
- Accessibility: senior view has large readable text (prefer >=18px), generous touch targets (at least 48x48px, preferably 56+), WCAG-aware contrast, clear feedback and Thai/English localization. Never assume GPS permission.
- Privacy: consent-based temporary location share, off by default, expiry, visible last-updated timestamp, limited retention. No continuous background PWA location guarantee.

## MVP features
1. Trip dashboard: list upcoming/past trips the device identity belongs to; create trip and archive trip.
2. Membership: trip-specific roles (organizer/member), registered anonymous identities and optional organizer-managed travelers (members without their own device/account). Same account/anonymous identity may belong to multiple trips.
3. QR invitations: generation, joining, pending approval, revocation and invitation history.
4. Today/itinerary: stops, start times, meeting points, external navigation links, transport mode, notes, accessible rest breaks; clear next destination.
5. Senior mode: one obvious 'Where do I go?' button, one-tap 'I'm Here' check-in, prominent contact-family entry, hotel/offline emergency card. Implement user-friendly successful/pending/error states.
6. Check-in: authenticated check-in tied to a trip member and itinerary stop; GPS optional; offline mutation queued with explicit 'Waiting to send' label, never falsely claim delivery. Organizer sees members checked in, missing and last update.
7. Shared expenses: payer, selected participants, integer minor currency units, currency, shares, expense history and settlement. Display exactly who owes whom. Use deterministic rounding and idempotent creates.
8. Offline itinerary and pending expense/check-in operations; appropriately handle duplicates, stale versions and conflicts.

## Deferred features
- Continuous live location tracking, in-app full mapping, receipt OCR, AI planning, automatic route optimization, native push notifications, permanent reusable groups, robust multi-currency FX automation.

## Relational model (starting point)
- `profiles` or Auth user identity (anonymous first); no need to create one for a managed elder.
- `trips`: id, owner_user_id, title, timezone (IANA), base_currency, start/end dates, status.
- `trip_members`: id, trip_id, nullable user_id, display_name, role, status, optionally managed_by_user_id; enforce appropriate uniqueness and trip scope.
- `trip_invites`: id, trip_id, token_hash, expires_at, max_uses, uses_count, revoked_at.
- `trip_join_requests`: id, trip_id, auth_user_id, requested_display_name, status, timestamps.
- `itinerary_items`: id, trip_id, time UTC, destination coordinates/address, meeting info, notes, order, version.
- `check_ins`: id, trip_id, trip_member_id, itinerary_item_id, checked_in_at, optional location, client_operation_id.
- `expenses`: id, trip_id, paid_by_member_id, amount_minor bigint, currency, description, version, client_operation_id.
- `expense_shares`: expense_id, trip_member_id, owed_minor bigint.
- `settlements`: trip_id, from_member_id, to_member_id, amount_minor, status, client_operation_id.
- `pendingMutations` in local IndexedDB, not necessarily a server table.

### Schema and security invariants
- Every private row must be scoped by trip and protected by enabled RLS based on approved membership. Review access for member lists, check-ins, locations and expense records independently.
- Ensure payer/share/check-in referenced member IDs belong to the SAME trip via composite keys or server-side validation; do not rely on client filtering.
- Organizer privileges must be assigned only by trusted server code.
- QR token: at least 128 bits of entropy using cryptographically secure generation; store hash, not raw token. Rate-limit redeem attempts; never log raw invitation token.
- Anonymous users can be recognized by Supabase Auth; an RLS check must not treat anonymous users as globally trusted. Revoke when removed.
- Expenses must reconcile: sum(shares) == expense amount in the same normalized currency, subject to explicit rounding rules; all mutations idempotent with unique operation IDs.
- Location should not be retained by default unless user explicitly shares; disable by default, support stopping/expiry.
- Don't store sensitive private details in service-worker caches that can be accessed across unintended accounts; clear trip-specific caches on access removal when possible.

## UX and critical flows
### New trip
Organizer creates trip -> gets join QR -> participants scan -> install PWA if desired -> open installed PWA -> redeem invitation -> select or enter name -> organizer approves -> trip dashboard.

### Return visit
Open Home Screen icon -> restore stored session -> determine approved trip memberships -> show last active trip and today screen; if offline show cached trip data with an offline label. No login form for elders.

### Session lost
Show 'Reconnect to your trip' -> organizer-assisted rejoin; create new anonymous device identity, send a recovery request, verify in person or via trusted channel, then safely associate with existing trip member without duplicating old expenses. Do not automatically approve identity takeover.

### Check in
Show destination, meeting time, large 'I'm Here', optional separate GPS consent. Tap creates client_operation_id -> if online, securely persist; if offline, enqueue locally with clearly pending status. Success means server acknowledgment, not just local storage. Organizer sees checked-in count, timestamp, optional last shared location.

### Expense example
Adult A paid THB 2,000, Adult B paid THB 1,000, four participants each owe THB 750. Store currency integer minor units. Balance_i = paid_i - owed_i. Match positive/negative nets into repayment suggestions, ensure total net is zero. Write extensive tests for splitting/rounding/multi-payer cases.

## Architecture boundaries
- `src/features/trips`, `members`, `invites`, `itinerary`, `check-in`, `expenses`, `senior-mode`.
- `src/shared/ui`, `db` (Dexie), `supabase`, `utils`.
- Treat server/DB as source of truth. TanStack Query for fetched data; Signals for ephemeral UI; Dexie for offline cache/outbox. Avoid a third independent synchronized copy of expenses.
- Prefer explicit server RPC/Edge Function for transaction-sensitive operations: invitation redemption/approval, settlement writes and recovery.
- Use Supabase Realtime sparingly to invalidate queries on relevant updates. Refetch on app resume. No constantly open websocket if unneeded.
- For mutation outbox: persistent client operation IDs, transactionally store local operation with optimistic state; retry on re-entry/online; dedupe server-side, version-check edits and handle conflicts. Background Sync optional, not guaranteed.

## Implementation milestones (build in increments)
**M1 foundation:** Preact/Vite/TS/Tailwind, PWA manifest/service worker, routing, localization scaffolding, accessible layout, Supabase initialization, migrations + RLS tests; README with setup and env vars.
**M2 onboarding:** create/list trips, QR invite generation and redemption, anonymous identity persistence, organizer approval, basic member management. Add tests for cross-trip isolation and expired/revoked QR.
**M3 itinerary/check-in:** Today + senior UX, next destination, directions external deep link, check-in states, organizer attendance dashboard, offline cache.
**M4 expenses:** expense creation and share selection, owed calculations and settlement suggestions; integer-money domain unit tests, idempotency and offline outbox.
**M5 hardening:** iOS standalone installation and session persistence tests, Android tests, offline/reconnect recovery, a11y checks, location privacy, security review, production readiness.

## Constraints & acceptance tests
- A senior can join with help and open the installed app for subsequent days without login UI as long as local auth storage survives.
- A member of Trip A cannot read Trip B unless separately invited and approved; write security/RLS integration tests.
- Joining via expired, revoked, or tampered invite fails safely.
- A check-in made offline shows pending, then becomes confirmed when acknowledged by backend; retries cannot create duplicates.
- Expense totals and shares reconcile exactly in integer minor units; repeated writes don't double-charge.
- All primary mobile actions keyboard/assistive-tech accessible, Thai/English labels, high contrast, target sizes suitable for elders.
- No hidden background GPS watcher; explicit opt-in and stop for any active sharing.
- Production documents should explain limitations of anonymous storage and PWA background capabilities.

## First Codex instruction
Start with M1 and M2 only. Inspect the repository first; if empty, scaffold Preact + Vite + TypeScript. Create the database schema, migrations, RLS policies, setup docs, QR onboarding and guest session persistence. Write tests for membership isolation, invitation expiry/revocation and duplicate joining. Don't implement continuous GPS or add unnecessary infrastructure. If decisions are ambiguous, state assumptions in README and choose smallest secure design. Show changed files, verification commands, and remaining risks.
