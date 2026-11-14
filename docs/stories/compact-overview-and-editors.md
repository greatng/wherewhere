# US32 — compact mobile Overview

Issue: https://github.com/greatng/wherewhere/issues/32

As a traveler using a phone, I want a compact daily overview and itinerary so I can scan my hotel and activities without oversized controls or repeated dates.

1. Rename the visible Today tab to Overview (ภาพรวม), retaining internal tab/storage identifiers and destination-local day browsing. Show the formatted selected day once above the hotel card.
2. Reduce default text, mobile header/control padding, card spacing and outer nesting while preserving readable text, light/dark themes, 44px interaction targets and the larger Senior view.
3. Keep hotel names/directions visible and place lengthy address/contact details behind an explicit disclosure. Do not invent booking details or images.
4. Preserve date browsing, directions, editing, expense and member behavior; verify phone/desktop layouts and capture 390px mobile previews.

The root cause of the oversized presentation was a large base font combined with generous control spacing and nested section padding. The Overview date was rendered in its heading and twice inside the accommodation card. The compact layout removes the duplicate Trip details/title heading, shortens displayed stay date ranges and keeps the same data/editor behavior.

# US33 — guest plan editing permission

Issue: https://github.com/greatng/wherewhere/issues/33

As an organizer, I want to grant or revoke a guest's itinerary editing permission so trusted participants can help plan without receiving administrative powers.

1. Approved guests with a device identity can receive editing permission; default is read-only. Managed/no-device members cannot receive permission. Trip member management shows the status and Grant editing / Remove editing actions.
2. Editors use the same version-checked city/night, activity and accommodation editors as organizers. Overview hotel editing opens the shared accommodation editor.
3. Every planning write checks current approved membership and permission. Revoked/removed/pending membership, outsiders and unauthenticated API callers cannot edit. Only organizers can change editing permission.
4. Editors do not receive trip deletion/archive, invitation, member management, timezone, family-contact or financial administration rights. Existing expense rights remain unchanged.
5. Persist permission through a migration and cover grant/revoke, anonymous no-email editors, unauthorized operations and browser behavior.

Implementation adds `trip_members.can_edit_plan` (false by default), organizer-only `set_member_plan_permission(p_member_id,p_can_edit)`, and a private plan authorization helper used only by planning RPCs. Approved anonymous Auth users can be editors; email is not required. The frontend uses current membership data to show controls, while server checks remain authoritative when another device changes permissions.

The migration is `20261114142133_guest_plan_edit_permissions.sql`. Other installations must apply it with their normal migration deployment or Supabase Dashboard SQL Editor before publishing this frontend. No local Docker is required for the Dashboard route. Existing members remain read-only unless organizers explicitly grant permission; existing organizers retain their rights.

## Hosted setup and review

The permission migration was applied to project `bsuzmybuskeadtofvjbz`. Read-only checks confirm a non-null false default, unauthenticated EXECUTE denial for permission grants, and no direct authenticated access to the private helper. The planning functions use the new membership check. No real trip membership permission was changed during verification. The security advisor reports the new authenticated SECURITY DEFINER RPC, consistent with the existing guarded write API; its body checks organizer identity, approved device-linked membership and active trip status. Existing advisor notices remain outside this change.

Separate standards and requirement reviews found no outstanding issues. Database coverage proves that an approved anonymous user with no email can edit after a grant, loses write permission after revocation, cannot grant permission, and cannot invoke organizer-only administrative actions. Removed users remain denied even if their stored editing flag is true.
