---
name: implement
description: Implement a GitHub issue by number on a fresh feature branch with [#N] commits — the working step of the Alloy ticket flow. Usage - /implement <issue-number>.
---

# Implement Issue

Take an issue from Ready to implemented-and-verified on a feature branch.
Ends at local review — never pushes; `/create-pr` is the next step.

## Constants

- Repo: `triad7th/Alloy` — Project: `4` (owner `triad7th`)
- Project ID: `PVT_kwHOALPoSc4Bda4_`
- Status field `PVTSSF_lAHOALPoSc4Bda4_zhX8jxY`: In progress `47fc9ee4`
- Board item lookup: `gh project item-list 4 --owner triad7th --format json --limit 200`,
  match `content.number` to the issue number.

## Steps

1. **Preflight.** `git status` must be clean and on `main`; then
   `git pull origin main`. If dirty or mid-branch, STOP and report — never
   mix a ticket with unrelated work.
2. **Read the ticket.** `gh issue view <N> -R triad7th/Alloy`. If the body
   links spec/plan docs, read them — they are the requirements. Re-read root
   `AGENTS.md`, especially the mirroring rule and the verification matrix
   for the twins you will touch.
3. **Branch (auto-linked to the ticket).** Create it with
   `gh issue develop <N> -R triad7th/Alloy --name <type>/<N>-<short-slug> --base main --checkout`
   — this creates the branch on origin linked to the issue's Development
   section, then checks it out locally. `<type>` is `feat`, `fix`, or
   `chore` matching the issue label. (Fallback if `gh issue develop` is
   unavailable: `git checkout -b <type>/<N>-<short-slug>` — the PR's
   `Closes #N` still links the ticket at review time.)
4. **Board: In progress + assignee.** Ensure the ticket is assigned
   (`gh issue edit <N> -R triad7th/Alloy --add-assignee triad7th`),
   look up the board item id, then:

   ```bash
   gh project item-edit --id <ITEM_ID> --project-id PVT_kwHOALPoSc4Bda4_ \
     --field-id PVTSSF_lAHOALPoSc4Bda4_zhX8jxY --single-select-option-id 47fc9ee4
   ```

5. **Implement with TDD**, scaled to the ticket:
   - Small (XS/S): failing test → smallest change → focused tests, directly
     in this session.
   - Large (M+ with a linked plan): follow the plan task-by-task
     (superpowers:subagent-driven-development when the plan calls for it).
   - **Mirrored twins:** design/change the web API first, port to Swift in
     the same ticket — never leave one twin half-updated. If a generated
     data table's TS source changed, regenerate (`node tools/generate-tokens.mjs`,
     `node tools/generate-zone-country.mjs`) in the same commit.
6. **Verify** with the AGENTS.md matrix for the touched twins (focused
   tests, then `swift build && swift test` from the repo root and/or
   `cd web && npm test` / `npm run build` as applicable; harness builds when
   `examples/` changed). Never claim green on a failed or incomplete run.
7. **Commit** as work naturally splits — multiple commits per ticket is
   normal. Message format:
   - Feature work: `[#N] <imperative subject>`
   - Support work: `[#N] chore: <subject>` (likewise `fix:`, `test:`,
     `docs:`)
   - Subjects all lowercase except proper nouns (GitHub, PR, AlloyUI, Swift)
   - Always append the session's standard commit trailers (Co-Authored-By +
     Claude-Session). Stage files explicitly — never `git add -A`, never
     `--no-verify`. If a commit fails a check: fix, re-stage, NEW commit
     (never `--amend`).
8. **Stop for review.** Report what changed, the verification evidence, and
   the commit list. Do NOT push. The user reviews locally, requests fixes
   (more `[#N]` commits), then runs `/create-pr`.
