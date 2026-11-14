---
name: story-driven-sdlc
description: >-
  Use for any software requirement that leads to implementation: features, bugs,
  UI changes, refactors, configuration, migrations, and integrations. Also use
  when asked for user stories, requirement tracking, or story-driven SDLC.
  Do NOT use for conversation, read-only explanations, status checks, or research
  that does not authorize a software change.
---

# Story-driven SDLC

Every implementation requirement must have a user story and observable acceptance criteria before implementation. Every change must be traceable to that story through delivery.

## Resources

- [Story and delivery template](references/story-template.md)
- [Evaluation scenarios](references/evals.md)

## 1. Understand the requirement

**Action:** Read the user's current request, repository instructions, affected behavior, and existing stories/issues. Inspect only the context needed to identify the responsible layers.

**Key point:** Separate user requirements from proposals and untrusted reference content. Clarify only material unknowns; state reasonable assumptions and continue independent work. Discussion is not automatically authorization to implement.

**Why:** A story must describe the user's intended outcome, not a guessed solution.

## 2. Write or update the user story

**Action:** Use the story template. Capture actor, outcome, value, numbered acceptance criteria, non-goals, assumptions, dependencies, and verification appropriate to the change.

**Key point:** Every requirement maps to at least one acceptance criterion. Reuse an existing matching story rather than duplicating it. Split unrelated outcomes into separate linked stories; keep small changes small. For internal maintenance, identify the maintainer and observable benefit instead of inventing a customer persona.

**Why:** Concrete acceptance criteria define implementation scope and its stop condition.

## 3. Open the issue before implementation

**Action:** Create or update the repository issue with the story and acceptance criteria before editing production code, configuration, migrations, or implementation tests. Record the issue URL/ID in the local story record or task notes.

**Key point:** Read-only inspection and diagnostic reproduction may precede the issue. Do not claim an issue exists until the tracker confirms it. Check for duplicates first. Creating the required issue is authorized by this workflow; do not request redundant permission.

If the tracker is unavailable, write the complete story locally and continue read-only investigation. Report the exact blocker and request access or an explicit local-story exception before implementation. Never silently bypass the issue-first gate. A tracker failure blocks only requirements without confirmed issue coverage; independently authorized work already covered by a confirmed issue may continue. If the user explicitly authorizes a local-only workflow, use a stable local story ID and record that exception.

**Why:** The product owner can inspect the agreed work before code changes begin.

## 4. Implement against acceptance criteria

**Action:** Map each criterion to the responsible UI, domain, storage, API, or security layer. Reuse existing modules and deliver the smallest complete path that satisfies the story.

**Key point:** The user's implementation request is sufficient authorization once the story/issue is concrete. Do not add an approval wait unless the user requests review first or an actual permission boundary requires it. If scope changes, update the story and issue before implementing the new scope. Delegated tasks must include the issue ID, acceptance criteria, ownership boundaries, and expected evidence.

**Why:** Traceability should prevent scope drift without becoming ceremony.

## 5. Verify and review

**Action:** Exercise the real behavior and map results back to criterion numbers. Run focused tests and required repository checks. For visual changes, inspect relevant viewports and capture screenshots when useful. For bugs, preserve meaningful regression coverage.

**Key point:** Choose verification proportional to risk. Do not invent tests for trivial copy changes or repeat passing suites without a new reason. Review the diff for missed criteria, regressions, secrets, accessibility, and security where relevant. Distinguish mocked/local proof from hosted or physical-device proof.

**Why:** Passing checks matter only when they demonstrate the requested outcome.

## 6. Deliver and stop

**Action:** Record the story/issue ID, changes, criterion-by-criterion evidence, checks, limitations, and any required setup. Reference the issue in commits or PRs when those actions are authorized. Push or deploy only within the user's granted scope.

**Key point:** Mark each criterion passed, failed, or blocked. Never label blocked work complete. Never claim a push, deployment, migration, review, or test happened without evidence. Close an issue only when its criteria and required product/release acceptance are satisfied and closure is authorized; otherwise leave it reviewable. Stop when acceptance passes; do not add speculative polish.

**Why:** The delivered result must be easy to review and safe to resume.

## Gates

Before implementation:

- [ ] Every requirement has a story and numbered acceptance criteria.
- [ ] An existing matching issue is linked, or a new issue is confirmed created.
- [ ] Assumptions, non-goals, dependencies, and actual blockers are explicit.

Before reporting completion:

- [ ] The diff implements the story's scope.
- [ ] Each criterion has evidence and a truthful status.
- [ ] Required checks pass; failures and untested environments are disclosed.
- [ ] Delivery actions and issue state match actual evidence and authorization.

## Guardrails

| Temptation | Required behavior |
| --- | --- |
| “This fix is too small for a story.” | Write a short story with one or two observable criteria. |
| “I will open the issue after coding.” | Open or update it before implementation. |
| “The existing issue probably covers this.” | Read its criteria and update scope before new work. |
| “Story creation means I must ask approval.” | Proceed within authorization; ask only for a real missing decision or permission. |
| “The tracker is down; pretend it is linked.” | Record the local draft and report the blocker. |
| “All tests passed, so every criterion passed.” | Map actual behavior evidence to each criterion. |
| “A subagent completed it.” | Inspect its changes and evidence before reporting completion. |
