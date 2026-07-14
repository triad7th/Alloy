---
name: create-issue
description: Create a well-formed GitHub issue capturing a feature's design, drawn from the current conversation. Use for "/create-issue" — most often mid-brainstorm once a design is settled — to file the tracking issue that anchors the branch, the PR, and the Alloy project board. Draft, confirm, then create; ask clarifying questions if the design isn't precise enough.
---

# Create Issue

Turn the design worked out in this conversation into a precise GitHub issue on
`triad7th/Alloy`. In Alloy's branch-and-PR workflow the issue is the anchor
for everything downstream: `/implement <n>` links a branch to it and adds it
to the Alloy project, and `/create-pr` closes it on merge. This skill only
files the issue — it does not create branches, touch the project board, or
write code.

Typically called **in the middle of a `superpowers:brainstorming` session**,
right after the design is agreed (and, if one was written, after the spec doc
lands). It captures what was decided; it does not invent scope.

## When the design isn't ready

If the conversation has not settled the feature enough to describe it
precisely — the approach is still open, scope is fuzzy, or a key decision is
unmade — ask 1–3 targeted clarifying questions first (prefer
`AskUserQuestion`). Do not file a vague issue; a vague issue produces vague
implementation. It is fine to say the design needs more brainstorming before
an issue makes sense.

## Draft the issue

Compose from the actual conversation and any spec/plan already written — never
from assumptions. Keep it precise and specific.

- **Title:** concise and specific, naming the feature and the affected library
  (e.g. `alloy-ui form kit: consistent input + form-dialog components`). Not a
  vague verb phrase; not a conventional-commit prefix (issues aren't commits).
- **Body**, in this shape:
  - **Summary / driver** — the problem and why it matters (1–3 sentences).
  - **Design** — the settled approach and the key decisions made in the
    brainstorm, stated as decisions, not options.
  - **Scope** — what this issue delivers.
  - **Out of scope** — what it deliberately excludes (deferred ideas belong
    here so they aren't silently pulled in).
  - **Links** — the spec (`docs/superpowers/specs/*.md`) and plan
    (`docs/superpowers/plans/*.md`) if they exist, plus related issues. If a
    plan exists, say so — `/implement` will drive it via
    subagent-driven-development.
- Respect the mirrored-twins scope: if the feature is web-only or a documented
  asymmetry, say that in the body so the implementer doesn't build a Swift
  twin by reflex.

## Confirm, then create

1. Show the drafted title and body to the user and get a clear go-ahead before
   filing — creating the issue posts public content, and the draft is
   synthesized from context that is easy to get subtly wrong.
2. Create it:
   `gh issue create --repo triad7th/Alloy --title "<title>" --body "<body>"`.
   Add `--label <label>` only if an obviously-matching label already exists;
   do not invent labels or milestones.
3. Do NOT create the branch or add to the project here — that is `/implement`.

## Final Response

Report:

- The new issue number and URL.
- A one-line recap of what it captures.
- Next step: `/implement <n>` to link a branch, add it to the Alloy project,
  and start the work.
