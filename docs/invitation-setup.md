# Invitation gateway deployment

## Confirmed hosted blocker

On 2026-11-14 the configured project returned HTTP 404 with `code: NOT_FOUND` and `message: Requested function was not found` for an OPTIONS request to `https://bsuzmybuskeadtofvjbz.supabase.co/functions/v1/invite-gateway` from origin `https://roam.greatng.me`.

QR generation calls the database `create_invite` RPC. Joining on a new device additionally calls the `invite-gateway` Edge Function before creating an anonymous session. A working QR image therefore does not establish that joining is deployed.

## Supabase Dashboard setup (no Docker required)

1. In the intended Supabase project, enable anonymous sign-in under Authentication settings.
2. Under Edge Functions → Secrets, configure `APP_ORIGIN` as exactly `https://roam.greatng.me` (no trailing slash). Set `INVITE_RATE_LIMIT_SECRET` to a cryptographically random value of at least 32 characters. Generate it privately, for example with `openssl rand -hex 32`; do not share it in chat or put it in a `VITE_` variable.
3. Create/deploy an Edge Function named exactly `invite-gateway`, using the full source of [index.ts](../supabase/functions/invite-gateway/index.ts). The runtime supplies its standard Supabase URL and service-role variables; never put a service-role credential in the frontend.
4. Disable the platform's **Enforce JWT verification** option for this function, matching `verify_jwt = false` in [config.toml](../supabase/config.toml). Public invitation validation must work before a guest identity exists. The function itself requires and verifies the user's bearer token with `auth.getUser()` for redemption; do not remove that check or expose the service-role RPC to clients.
5. Ensure the existing database migrations providing `invite_gateway` are applied. Do not rerun historical migrations blindly. Foundation migration 001 creates this RPC; ask the database owner to reconcile migration history if it is missing.

## CLI alternative

From a checked-out repository with Node installed, authenticate using `npx supabase login`. Configure the two secrets privately in the Dashboard as above, then run:

```sh
npx supabase functions deploy invite-gateway --project-ref bsuzmybuskeadtofvjbz --no-verify-jwt
```

No local Docker instance or database password is required for Edge Function deployment. Account access to this Supabase project is required.

## Verification

```sh
curl -i -X OPTIONS \
  'https://bsuzmybuskeadtofvjbz.supabase.co/functions/v1/invite-gateway' \
  -H 'Origin: https://roam.greatng.me' \
  -H 'Access-Control-Request-Method: POST' \
  -H 'Access-Control-Request-Headers: authorization,apikey,content-type,x-client-info'
```

Expected: successful preflight and `Access-Control-Allow-Origin: https://roam.greatng.me`. A 404 means the function is still missing; a startup failure requires checking secrets and function logs. An origin mismatch means the configured origin differs from the real app URL.

Then create a fresh invitation QR, scan it from another device/browser, enter a name and submit. The guest should see a pending request; the organizer must approve it before trip access is granted. Test expiry and use limits without weakening them. Do not publish invitation tokens, service keys or guest session credentials in logs or issues.

## Hosted verification on 2026-11-14

The user approved production deployment with public validation and in-function redemption authentication. Version 5 is deployed with platform JWT verification disabled. After the owner saved the required secrets, live OPTIONS returned HTTP 200 with the exact allowed origin, and a synthetic invalid token returned HTTP 400 `invalid_invite`. A direct anonymous Auth signup also returned HTTP 200 with an anonymous user, confirming guest sign-in works. This created one diagnostic Auth user without trip membership; no actual invitation was redeemed or traveler data changed. The public Auth settings response had reported anonymous sign-in disabled, so that response alone was not a reliable readiness check.

Eight focused desktop/mobile browser cases pass using synthetic fixtures, including fresh guest joining, retry identity preservation, missing-gateway guidance and repeated QR focus/scroll. A real invitation on the owner’s other phone still needs confirmation; these checks do not claim physical-device acceptance.


## Remove revoked invitations

In Trip → Trip settings and access, organizers can choose **Delete revoked invitation** and confirm removal. Active invitations must first be revoked. Deletion hides the invitation while retaining history and existing memberships. The `20261114140713_delete_revoked_trip_invites.sql` migration adds the required column, read policy and organizer-only RPC; apply it before deploying the updated frontend on another project. It has already been applied to bsuzmybuskeadtofvjbz. No Docker is needed: use the Dashboard SQL Editor or your normal migration deployment.
