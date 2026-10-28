# Browser preview and verification notes

Install the browser once with `npx playwright install chromium`, then run `npm run test:e2e`. Playwright launches local Vite and runs the same mocked trip flows in desktop and mobile Chromium. The fixture provides a seeded organizer session and sample Bangkok trip through intercepted Supabase REST/RPC calls. It verifies adding an itinerary stop, whole-unit expense splits, keyboard focus and labeled form controls, plus an offline check-in that remains queued until reconnection and is acknowledged by the fixture.

These screenshots are fixture-backed previews. They show the UI at desktop and mobile viewports; they do not represent a hosted Supabase session, live trip, or real user data.

## Itinerary

![Desktop itinerary fixture preview](../artifacts/desktop-chromium-itinerary-fixture-preview.png)

![Mobile itinerary fixture preview](../artifacts/mobile-chromium-itinerary-fixture-preview.png)

## Expenses

![Desktop expenses fixture preview](../artifacts/desktop-chromium-expenses-fixture-preview.png)

![Mobile expenses fixture preview](../artifacts/mobile-chromium-expenses-fixture-preview.png)

## Remaining release verification

The browser fixture does not exercise deployed Supabase Auth or Edge Function networking, rate limiting through the production proxy, multiple real browser profiles, browser storage loss, or installed PWA behavior. Before release, repeat the README manual acceptance steps against a configured Supabase project and test installation, offline recovery, and persisted sessions on physical iOS and Android devices.
