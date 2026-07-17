---
name: create-pr
description: Push the current Alloy feature branch and open its pull request (Status In review). Run after locally reviewing /implement's work.
---

# Create PR

Publish the reviewed feature branch as a pull request tied to its issue.

## Constants

- Repo: `triad7th/Alloy` — Project: `4` (owner `triad7th`)
- Project ID: `PVT_kwHOALPoSc4Bda4_`
- Status field `PVTSSF_lAHOALPoSc4Bda4_zhX8jxY`: In review `df73e18b`
- Board item lookup: `gh project item-list 4 --owner triad7th --format json --limit 200`,
  match `content.number` to the issue number.

## Steps

1. **Preflight.** Current branch must match `<type>/<N>-*` (extract `N`);
   worktree clean (uncommitted work → run `/commit` first or stop and ask).
   Confirm the verification gate from `/implement` is still valid; if
   commits were added since, re-run the focused tests for what changed.
2. **Push.** `git push -u origin <branch>`.
3. **Open the PR:**

   ```bash
   gh pr create -R triad7th/Alloy \
     --title "[#N] <issue title>" \
     --body "$(cat <<'EOF'
   ## What
   <what changed, 2-5 bullets>

   ## Why
   <one or two sentences — the issue's goal>

   ## Test evidence
   <suites run + counts, e.g. swift test all passing, web Vitest + ng test clean>

   Closes #N

   🤖 Generated with [Claude Code](https://claude.com/claude-code)
   EOF
   )"
   ```

   Also append the session URL line after the generated-with line, matching
   the session's standard PR footer.

4. **Board: In review.** Look up the item id, then `gh project item-edit`
   with option id `df73e18b`.
5. **Report** the PR URL. The user reviews the PR; review fixes are more
   `[#N]` commits on this branch pushed with `/commit-and-push` (the PR
   updates automatically). `/approve-pr <N>` finishes the ticket.
