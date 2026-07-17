---
name: create-issue
description: Create a GitHub issue for a new Alloy feature, fix, or chore and add it to the Alloy Kanban board (Status Ready). Run at the end of a brainstorm, or directly for ad-hoc bugs and tasks.
---

# Create Issue

Create the GitHub issue that becomes the unit of work for the ticket flow
(`/implement` → `/create-pr` → `/approve-pr`).

## Constants

- Repo: `triad7th/Alloy` — Project: `4` (owner `triad7th`)
- Project ID: `PVT_kwHOALPoSc4Bda4_`
- Status field `PVTSSF_lAHOALPoSc4Bda4_zhX8jxY`: Backlog `f75ad846`, Ready
  `61e4505c`, In progress `47fc9ee4`, In review `df73e18b`, Done `98236657`
- Priority field `PVTSSF_lAHOALPoSc4Bda4_zhX8j4s`: P0 `79628723`, P1
  `0a877460`, P2 `da944a9c`
- Size field `PVTSSF_lAHOALPoSc4Bda4_zhX8j4w`: XS `6c6483d2`, S `f784b110`,
  M `7515a9f1`, L `817d0097`, XL `db339eb2`

If an `item-edit` call fails, the IDs may have changed — re-derive them with
`gh project field-list 4 --owner triad7th --format json` and continue.

## Steps

1. **Compose the issue.** Title: short, imperative. Body scales with size:
   - Small feature/fix: the body IS the spec — a Goal line plus concrete
     acceptance criteria (checkboxes).
   - Large feature: link the approved design/plan docs in
     `docs/superpowers/specs/` and `docs/superpowers/plans/`; the body holds
     the one-paragraph summary and the doc links.
   - State the twin scope explicitly: both twins (the default), web-only, or
     a documented asymmetry — so the implementer neither forgets the Swift
     port nor builds one by reflex. See `docs/mirroring.md`.
2. **Confirm with the user** (title + body + label + proposed Priority/Size)
   before creating. Label: `enhancement`, `bug`, or `documentation`.
3. **Create and board it:**

   ```bash
   gh issue create -R triad7th/Alloy --title "<title>" --label "<label>" --assignee triad7th --body "<body>"
   gh project item-add 4 --owner triad7th --url <issue-url> --format json   # note the item id
   gh project item-edit --id <ITEM_ID> --project-id PVT_kwHOALPoSc4Bda4_ \
     --field-id PVTSSF_lAHOALPoSc4Bda4_zhX8jxY --single-select-option-id 61e4505c   # Status: Ready
   ```

   Set Priority and Size the same way with their field/option IDs.

4. **Report** the issue number and URL. The number is the handle for
   `/implement <N>` and every `[#N]` commit after it.
