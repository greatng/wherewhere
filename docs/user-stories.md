# Roam — product improvement stories

Scope: implementation following the product review of commit 9d8eb55. The app is now named Roam. Keep Thai/English, quiet ivory/moss styling and accessible controls. Preserve existing login storage, IndexedDB and trip history through the rename. No live hosted data is modified as part of development.

## US1 — recognizable identity

GitHub issue: https://github.com/greatng/wherewhere/issues/1

As a traveler, I see Roam in the app, browser title, install manifest and icon, so I recognize the same service on return. Existing sessions and local pending operations survive the name change; internal legacy storage keys are retained deliberately.

## US2 — one trip at a time

GitHub issue: https://github.com/greatng/wherewhere/issues/2

As a traveler belonging to several trips, I choose a trip from a compact dashboard and see one workspace. I can switch trips or return to the dashboard. Remember the selected trip per device identity, but clear it if access is lost or the trip is deleted. Dashboard shows active and archived status. Do not expose another user's remembered trip or private data.

## US3 — discoverable trip management

GitHub issue: https://github.com/greatng/wherewhere/issues/3

As an organizer, I find travelers, approvals, invitations, archive/restore and Delete trip in the Trip tab. Ordinary members cannot invoke organizer actions. Deletion clearly explains that it affects everyone and requires the exact trip title. A mismatched title never calls deletion; a successful deletion returns to available trips. No actual live trip is deleted by verification tests.

## US4 — useful Today

GitHub issue: https://github.com/greatng/wherewhere/issues/4

As a traveler, I see current/next destinations belonging to the trip-local day. Completed days never show a past stop as the next destination. Untimed stops remain visible with a clear time-not-set label. If there are no stops or the day/trip is finished, say so. Optional device-local current-stop choice must be explicitly labeled and never implied to be synchronized to the group. Attendance includes last server-acknowledged time and clearly labels cached/offline data.

## US5 — simpler senior view

GitHub issue: https://github.com/greatng/wherewhere/issues/5

As an older traveler, I can persist Senior view on this device and see only destination/directions, check-in, tonight's stay and family contact, with large labels and controls. I can leave Senior view easily. Organizer editors and unnecessary tabs are hidden in this mode. No location permission is assumed.

## US6 — account clarity and safe sign-out

GitHub issue: https://github.com/greatng/wherewhere/issues/6

As a user, I can see whether I am Guest or signed in with email and explicitly sign out. Before signing out as a guest, explain that their anonymous session cannot be recovered by name alone. Warn about pending device operations and require confirmation; clearing local data must not falsely claim they were sent. Sign-out affects this device and clears private in-memory and local caches and remembered trip selections.

## US7 — organizer-assisted recovery

GitHub issue: https://github.com/greatng/wherewhere/issues/7

As an organizer who has verified a traveler's identity in person or through a trusted channel, I can reopen a denied join request or explicitly approve and link a pending recovery request to an existing member. A QR or matching display name never grants identity ownership. Relinking preserves member IDs and expense history, revokes the old device's trip membership, is trip-scoped and records an audit entry. No guest can self-approve, reopen, or relink. Archived trips reject recovery writes. Removed users cannot regain access without this explicit trusted action.

## US8 — actionable offline operations

GitHub issue: https://github.com/greatng/wherewhere/issues/8

As a traveler, I can inspect pending/failed/blocked check-ins and expenses, understand errors, and retry using the same operation ID. Retrying cannot duplicate a server write. A locally saved action is not delivered until acknowledged. Discard requires explicit confirmation and is unavailable while sending; disclose that an uncertain network outcome may already have reached the server and should be checked. Retrying an unrecoverable permission failure must not pretend success. Persist operations across app restart and isolate by identity and trip.

## US9 — understandable errors

GitHub issue: https://github.com/greatng/wherewhere/issues/9

As a user, I receive actionable messages for lost access, missing backend setup, invalid input, conflicts and network failures. Organizers may inspect technical details without exposing secrets. Retain entered input where safe and never substitute cached data for an authorization denial.

## Verification and release boundary

Run lint, TypeScript/build, domain/database/component tests and browser flows for organizer and guest states. Capture desktop/mobile previews using disclosed sample data. Database tests run actual migrations in PGlite; browser fixtures are not proof of hosted Supabase email/Edge behavior. A real organizer-and-guest pilot, installed iOS/Android sessions, production SMTP and proxy/rate-limit checks remain manual release acceptance; do not claim these were completed locally.

## Implementation evidence

Stories US1–US9 are tracked in GitHub issues #1–#9 (linked above). Local changes had already begun when the issue-first workflow was requested; implementation was paused while those issues were opened, then resumed against them. The source changes retain the legacy storage names deliberately, so renaming the app does not replace existing guest sessions or the IndexedDB outbox.

The implementation includes a selected-trip dashboard, management inside the Trip tab, device-scoped account sign-out with pending-action warnings, trip-timezone Today selection and attendance timestamps, persisted reduced Senior view, atomic offline retry/discard/claim controls, actionable errors, and supervised recovery migration 005. Build and lint pass; 42 unit/component/database tests pass, including recovery history preservation, deletion after recovery, same-UUID retry, discard protections, late cache-write rejection after sign-out, and Today boundaries. All 18 desktop/mobile Chromium browser tests pass. Browser coverage and sample-data screenshots are described in [browser-validation.md](browser-validation.md).

Issues remain open for product review and the manual release checks above. New recovery RPCs require applying migration 005 once to an existing hosted database that has migrations 001–004; no hosted migration or real traveler data was changed by this development work.


## US10 — local activity times and reachable editors

GitHub issue: https://github.com/greatng/wherewhere/issues/10

As an organizer, Add/Edit takes me to the correct populated form, including when I select the same item again. Accommodation editing opens from the closed state and saves the existing stay with its version check. Focus moves to the form without opening a mobile keyboard; scrolling respects reduced-motion preferences and sticky navigation.

As a traveler, I enter an activity date and local time without a timezone selector. Everyone on the trip is expected to use the same local device timezone. The app converts that local value to a timestamp for storage, then displays and edits it locally; Today and Tonight use the local calendar day. Existing timestamps are retained. Migration 006 makes an explicitly supplied planned date authoritative while retaining organizer access, version and trip-date checks. Older clients that omit the date retain the legacy trip-timezone fallback.

Issue #10 was opened before implementation and updated when the product owner clarified local-time behavior. No hosted database was modified.


## US11 — email codes that keep travelers in Roam

GitHub issue: https://github.com/greatng/wherewhere/issues/11

As a traveler, I receive a six-digit email code and enter it in Roam without following a development-domain link. Supabase email templates must display the token and its Site URL must point to the deployed app. Preserve guest identity during email enrollment. See [email setup](email-setup.md); hosted configuration remains an operator step.

## US12 — compact mobile workspace

GitHub issue: https://github.com/greatng/wherewhere/issues/12

As a traveler on a phone, I see more useful information with less nested padding and excess whitespace, while keeping readable text, touch-sized buttons, and the larger Senior view. Verify editor scrolling and horizontal overflow on mobile and capture fixture previews.


Validation for US10–US12: 47 unit/component/database tests pass, including existing-time local-day grouping, accommodation updates, draft preservation, and migration 006 permissions/version guards. Email auth tests confirm the existing code-entry flow; production email delivery and dashboard settings are not verified locally.


## US13 — a flat daily Plan

GitHub issue: https://github.com/greatng/wherewhere/issues/13

As a traveler, I scan dates, cities and activities as one daily list, without boxes inside boxes. Days use dividers; activities are simple rows. Accommodation remains a separate list and forms retain a clear editing surface. Preserve readable text, touch targets, editor navigation and mobile width.


## US14 — full-width Plan with SVG actions

GitHub issue: https://github.com/greatng/wherewhere/issues/14

As a traveler I see activities directly in the workspace without parent card layers or nested indentation. As an organizer I use compact SVG pencil/trash controls for repeated editing actions, with accessible bilingual names, visible focus and touch-sized targets. Add actions retain text plus an SVG icon. Capture desktop/mobile previews and verify editor flows.


## US15 — destination time independent of viewer location

GitHub issue: https://github.com/greatng/wherewhere/issues/15

Correction to US10: local means destination local time. Activities entered as09:00 in Japan display and edit as09:00 Japan regardless of the device location. Use the configured trip destination timezone for Plan, Today and Tonight. Provide one organizer-controlled destination timezone setting for the trip, rather than per-activity selectors. Preserve existing saved timestamps and disclose this when correcting the setting. Verify in a browser using a different timezone.


US14–US15 verification: 48 unit/component/database tests pass, including destination-time activity editing and organizer-only timezone correction with timestamp preservation. UI uses the trip destination timezone, superseding the device-local interpretation recorded in US10. One timezone is configured per trip; activities do not prompt for individual timezone selections.


## US16 — quiet times and SVG-only Plan actions

GitHub issue: https://github.com/greatng/wherewhere/issues/16

Remove repeated timezone names from the daily workspace and activity rows. Keep destination conversion internally and its organizer setting. All Plan actions use compact SVG icons with bilingual accessible names, titles, visible keyboard focus and touch targets; navigation tab labels remain readable text.


## US17 — persistent light and dark appearance

GitHub issue: https://github.com/greatng/wherewhere/issues/17

As a traveler I can switch appearance using an accessible header control, retain my choice across reloads and follow system appearance before choosing. Dark surfaces preserve contrast, focus, Senior mode and QR readability. The official 21st skills are installed and design context initialized; catalog retrieval is blocked until 21st authentication is configured, so this change reuses Preact primitives and does not claim downloaded components.


## US18 — actual 21st.dev component integration

GitHub issue: https://github.com/greatng/wherewhere/issues/18

Retrieve real catalog source and integrate it into the running Preact app. Shared Button derives from @shugar/button-1 (3824); compact Light/Dark/System choices derive from @campsite/theme-toggle (554). Preserve native form behavior, SVG actions, destination time, focus, touch targets and explicit/system appearance persistence. Source snapshots and adaptation notes are retained in vendor/21st; credentials are not committed. This supersedes US17's authentication blocker.


## US19 — Roam branding

GitHub issue: https://github.com/greatng/wherewhere/issues/19

Rename public branding, install metadata, icons and email copy to Roam. Preserve legacy `paikan-*` and `travelmate*` storage keys so existing sessions and preferences survive. Backend identifiers and migration history are unchanged.


## US20 — clear daily boundaries

GitHub issue: https://github.com/greatng/wherewhere/issues/20

Separate daily Plan groups with generous vertical gaps and a destination-date header band. A numbered Day marker and stronger top rule distinguish each new day while activity rows remain flat and full width. Use matching light/dark colors and semantic date headings; no new nested cards.


## US21 — show only selected travel modes

GitHub issue: https://github.com/greatng/wherewhere/issues/21

Hide unset travel-mode placeholders on city nights and activities. Keep selected transport labels and optional editor fields.


## US22 — story-driven SDLC skill

GitHub issue: https://github.com/greatng/wherewhere/issues/22

As a product owner, every implementation requirement must have a user story and numbered acceptance criteria before implementation, so delivery stays traceable. The repository skill and AGENTS.md require confirmed issue linkage before edits, reuse existing stories, update scope before additional work, and record criterion-level verification. Read-only conversation does not create issues. Existing authorization avoids redundant approval pauses. Tracker failures require an honest local draft and an explicit exception or restored access before implementation.

Acceptance: AC1 installable skill and templates; AC2 issue-first and requirement-to-criterion gates; AC3 proportional verification and honest delivery evidence; AC4 structural and blind-scenario validation. Skill files are versioned under `.agents/skills/story-driven-sdlc` and copied to the local Codex skill directory.

US22 verification: AC1–AC3 pass by installed files, templates and workflow gates. AC4 passes structural checks and six simulated blind-agent scenarios; one ambiguity was corrected. No application runtime changes were made.
