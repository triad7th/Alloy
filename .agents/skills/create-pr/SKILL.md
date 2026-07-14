---
name: create-pr
description: Open a pull request for the current Alloy feature branch. Use for "/create-pr" — verifies tests, pushes the feature branch, and opens a PR into main that closes its linked issue. The human reviews and merges on GitHub; this never self-merges.
---

# Create PR

Open a pull request from the current feature branch into `main`. Alloy is
branch-and-PR based: `main` only advances through PRs merged on GitHub by the
human. This skill pushes the branch and opens the PR. It never merges and
never pushes to `main` directly.

## Preflight — stop early if any check fails

1. Confirm you are on a feature branch, not `main`:
   - `git status --short --branch`.
   - If on `main`, STOP — there is nothing to PR; work starts from an issue
     with `/implement <issue>`.
2. Determine the linked issue number:
   - Feature branches are named `<n>-<slug>` — take the leading number
     (`git branch --show-current`).
   - If the branch has no leading issue number, ask the user for it; it is
     needed for the `Closes #<n>` link.
3. Confirm there are commits to propose:
   - `git fetch origin`, then `git log --oneline origin/main..HEAD`.
   - If empty, STOP and report the branch has no changes over `main`.
4. Confirm the tree is committed:
   - `git status --short`. Uncommitted source changes: stop and ask — they
     won't be in the PR. Never `git add -A` / `git add .` / `git stash`.

## Verify tests (a PR must be green)

5. Run the suites for the changed areas:
   - Swift changes (`swift/**`, `Package.swift`): `swift build && swift test`
     from the repo root.
   - Web changes (`web/**`): `cd web && npm test`.
   - Docs/tooling-only diffs may skip. Reuse a green result already produced
     this session after the last commit.
   - If anything fails, STOP — fix it or report; do not open a red PR.

## Push and open the PR

6. Push the feature branch: `git push -u origin <branch>` (never force unless
   the user explicitly asks).
7. Open the PR into `main`:
   - `gh pr create --base main --head <branch> --title "<type: summary>" --body "<what & why>"`.
   - The body MUST end with `Closes #<n>` so merging auto-closes the linked
     issue, followed by the harness PR footer
     (`🤖 Generated with [Claude Code](https://claude.com/claude-code)` and
     the session link if the harness requires one).
   - Do NOT merge. The human reviews and merges on GitHub.

## Final Response

Report:

- PR URL, `base ← head` branches, and the linked issue (`Closes #<n>`).
- Test suites run and their result.
- Reminder that merging is the human's step on GitHub.
