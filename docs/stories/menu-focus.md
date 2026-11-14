# US30 — reliable itinerary menu keyboard focus

Issue: https://github.com/greatng/wherewhere/issues/30

As a keyboard user, I want Escape to close an itinerary menu and return focus to its trigger so I can continue navigating.

1. Escape closes the menu and restores focus even before passive opening effects run.
2. Preserve outside dismissal, arrow navigation and existing editor behavior on desktop/mobile.
3. Keep a deterministic regression and pass the full E2E suite without retries or weaker assertions.

Root cause: a queued passive opening effect ran during the closing render, focused the menu item after Escape restored the trigger, and left focus on the document body when that menu item was removed. Moving focus and the outside listener into a layout effect ensures opening work finishes before the user can dismiss it.

The regression holds passive effects until the next render and sends Escape immediately after opening. It fails on the original implementation and passes with the fix. CI originally reported 45/46 passing, with this focus assertion failing on desktop.
