# Repository workflow

For software requirements, use `.agents/skills/story-driven-sdlc/SKILL.md`.

Every requirement needs a user story and numbered acceptance criteria. Read and reuse matching issues; create or update the GitHub issue before implementation. Implement only that story's scope, update the issue before scope changes, and verify against its criteria. Existing user authorization carries forward; do not add routine approval pauses.

Keep existing session/database/preference storage identifiers stable unless a story explicitly includes migration. Preserve destination-time semantics, Preact compatibility, accessible SVG actions, compact layouts and light/dark support.

Read-only questions and status checks do not require new issues. Follow the skill's explicit tracker-failure and local-only-exception rules.
