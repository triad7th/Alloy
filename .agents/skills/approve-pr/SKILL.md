---
name: approve-pr
description: Merge an approved Alloy pull request - rebase-merge into main, delete the branch, close out the board (Status Done). Usage - /approve-pr <pr-number> | /approve-pr issue <issue-number> | /approve-pr (resolve from context).
---

# Approve PR

The user has reviewed the PR and this command is their approval: merge it,
clean up, and close the ticket.

## Constants

- Repo: `triad7th/Alloy` — Project: `4` (owner `triad7th`)
- Project ID: `PVT_kwHOALPoSc4Bda4_`
- Status field `PVTSSF_lAHOALPoSc4Bda4_zhX8jxY`: Done `98236657`
- Board item lookup: `gh project item-list 4 --owner triad7th --format json --limit 200`,
  match `content.number` to the issue number.

## Steps

1. **Resolve the PR from the argument.** (Issues and PRs share GitHub's
   number sequence, so the two numbers usually differ.)
   - `/approve-pr <N>` — `N` is the PR NUMBER (the default). `gh pr view <N>`
     must be an OPEN PR; derive the issue number `M` from its head branch
     `<type>/<M>-*`.
   - `/approve-pr issue <N>` (or `issue #N`) — `N` is the ISSUE number. Find
     the open PR whose head branch matches `<type>/<N>-*`.
   - `/approve-pr` (no argument) — resolve from context: if the current
     branch is a ticket branch with an open PR, use it; else if exactly ONE
     open PR exists, use it.
   - **Ambiguity → ask, never guess.** If a bare number is not an open PR
     but does match a ticket branch (or vice versa), if no-arg resolution
     finds zero or multiple candidates, or if the head branch yields no
     issue number — ask the user a follow-up question naming the candidates
     (PR number, branch, title) and wait.
     Always state which PR and which issue you resolved before merging.
2. **Skill-drift guard.** For every skill present in both trees, the copies
   must be identical:

   ```bash
   for d in .claude/skills/*/; do n=$(basename "$d"); \
     [ -f ".agents/skills/$n/SKILL.md" ] && \
     diff -q "$d/SKILL.md" ".agents/skills/$n/SKILL.md"; done
   ```

   Any diff → warn the user and offer to sync (`.claude/skills` is
   canonical) before merging. `AGENTS.md` and `CLAUDE.md` must be identical
   too (`diff -q AGENTS.md CLAUDE.md`).

3. **Mergeability.** `gh pr view <PR#> --json mergeable,mergeStateStatus`.
   If conflicting, ask the user whether to rebase the branch on `main`
   (then rebase, re-run the touched-twin tests, force-push the FEATURE
   branch only — never main — with `git push --force-with-lease`).
4. **Merge (rebase & merge) + cleanup:**

   ```bash
   gh pr merge <PR#> -R triad7th/Alloy --rebase --delete-branch
   git checkout main 2>/dev/null; git pull origin main
   git branch -d <branch> 2>/dev/null || true   # if gh didn't already remove it
   ```

   `Closes #N` in the PR body closes the issue on merge.

5. **Board: Done.** Look up the item id, then `gh project item-edit` with
   option id `98236657`. (GitHub's built-in workflow may have done this on
   close — setting it again is harmless.)
6. **Report** the merged commit range on `main` (`git log --oneline` since
   the previous main tip) and confirm issue closed + branch deleted. If the
   ticket shipped library API changes, remind the user that releases are a
   separate deliberate step (`node tools/release.mjs <version>` from
   up-to-date `main`).
