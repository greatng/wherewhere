# Daily itinerary and accommodation stories

## US24 — One clear daily plan with shared accommodation editing

Issue: https://github.com/greatng/wherewhere/issues/24

As a trip participant, I want each day to show the overnight city, hotel and activities together, so I know where we sleep and what we visit without cross-referencing separate lists.

### Acceptance criteria

- AC1: Each date has a clear day boundary and shows its overnight city, applicable hotel, and destination-time activities in chronological order.
- AC2: A hotel applies from check-in inclusive to check-out exclusive. Missing city, hotel or activities have concise empty states; unset transport is hidden.
- AC3: Organizers can edit the same accommodation record from the daily overview and a separate Accommodation view. Both entry points use one editor and version-checked save; both views refresh after a change without creating duplicate stays.
- AC4: Editing a multi-night stay clearly shows the affected date range. Existing date, overlap and permission constraints remain enforced.
- AC5: Participants can view but cannot edit. Preserve flat compact layouts, SVG actions, light/dark appearance, destination-time semantics and cached reads.

Non-goals: booking integrations, automatic city inference, destructive migrations.

Verification: daily stay boundaries, two-way editor entry, same record/version payloads, participant permissions, and mobile light/dark previews.

## US25 — Browse the stay and complete itinerary for today or another day

Issue: https://github.com/greatng/wherewhere/issues/25

As a trip participant, I want Today to show where we stay and all activities for today or a selected trip date, so I can prepare for any day from one consistent overview.

### Acceptance criteria

- AC1: Default to the destination-local current date during the trip, the first day before departure, and the last day after completion.
- AC2: Provide previous/next day controls and an accessible date selector bounded by trip dates. Browsing never silently switches trips.
- AC3: Show the selected day's city, applicable hotel, address/directions and all activities in chronological order using destination local time. Reuse Plan's accommodation coverage rules.
- AC4: Empty days show a free-day state and accommodation, plus the next planned activity date when available.
- AC5: Current/next highlights apply only to the actual destination-local today. Keep Senior readability, directions and cached reads. Check-in and attendance remain removed.

Non-goals: automatic trip switching or a new navigation model. The Today tab keeps its name and gains date browsing.

Verification: destination-date defaults and bounds, aligned selected-day stays and activities, free-day behavior, participant/Senior access, and mobile light/dark previews.

## Implementation evidence

US24 AC1–AC2: daily Plan rows use the shared `stayForDate` rule (inclusive check-in, exclusive check-out) and group destination-time activities. AC3–AC4: daily and Accommodation entry points use the same stay editor, ID and expected version; multi-night edits disclose the affected range. AC5: edit controls remain organizer-only; participant view is covered in browser tests.

US25 AC1–AC2: destination-local defaults clamp to trip bounds, with previous/next controls and a bounded date input. AC3: each selected day derives its hotel and city from complete cached trip arrays, rather than a previously selected day's summary. AC4: free days retain stay information and can jump to the next activity date. AC5: current/next highlights apply only to actual destination-local today; Senior mode shows the daily itinerary without check-in controls.

Verification: twelve focused component/domain tests pass; ten new desktop/mobile daily-overview cases pass. A separate targeted read-only source review found no meaningful runtime issues in the date, coverage, refresh, authorization or Senior paths. Full browser regression results are recorded in `docs/browser-validation.md`. No schema migration or hosted data change is required. Local/mocked verification does not establish live hosted Supabase behavior.

Final checks: lint/build and twelve focused unit/component/domain tests pass. The full browser run passed 37/38; an editor scroll conflict was fixed, and all twelve affected editor/daily-overview browser cases passed afterward. All US24 and US25 acceptance criteria have local behavior evidence. Hosted and physical-device verification remain unperformed. Editor navigation is immediate to avoid competing mobile scroll animations.
