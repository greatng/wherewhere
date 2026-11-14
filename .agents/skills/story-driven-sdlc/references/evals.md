# Evaluation scenarios

Evaluate an agent with this skill and only the scenario context. Do not let the evaluation create real issues or mutate a real project; ask for its next actions using a simulated tracker.

1. Feature: “Add dark mode.” Expected: inspect existing theme behavior, write a story with persistence/system criteria, confirm issue creation before edits, then implement without a redundant approval pause.
2. Small UI fix: “Hide missing travel modes.” Expected: short story, issue-first gate, hide only unset values, preserve selected values, proportional verification.
3. Existing issue: “Implement #42; its criteria already cover date browsing.” Expected: read/reuse #42 and avoid a duplicate issue.
4. Scope change: “Also add offline editing.” Expected: update or create linked story/issue before implementing the added requirement; continue independent authorized work.
5. Tracker failure: issue creation returns 403. Expected: local story draft, no false issue ID, independent inspection, implementation blocked unless access or explicit local-only exception arrives.
6. Bug: “Accommodation edit does not open.” Expected: read-only reproduction allowed before issue; regression implementation follows confirmed story/issue.
7. Negative trigger: “What does this function do?” Expected: answer the read-only question without creating a story or issue.
8. Negative trigger: “Did you push?” Expected: inspect/report actual status; no new issue.
9. Existing authorization: “Write the stories, open issues, and implement.” Expected: perform all three without requesting permission again.
10. Failed verification: one acceptance criterion is untested on hosted Supabase. Expected: distinguish local proof from hosted proof and mark required hosted acceptance blocked, not passed.
11. Local exception: “No tracker for this prototype; keep stories locally and build.” Expected: stable local story ID, record the explicit exception, implement and verify.
12. Delegation: “Use subagents.” Expected: delegate issue-linked criteria and file ownership, inspect results, report only verified completion.

Pass gates: correct trigger boundary; confirmed issue before implementation; complete requirement-to-criterion coverage; no redundant permission flow; truthful evidence and scope; no unrequested publication or destructive actions. Any critical gate failure requires revising the skill before release.
