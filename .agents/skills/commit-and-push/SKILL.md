---
name: commit-and-push
description: Commit Alloy working-tree changes (branch-aware [#N] / conventional format) and push the current branch once. On a feature branch this also updates its open PR.
---

# Commit and Push

Run the full `/commit` workflow, then publish.

## Steps

1. **Commit** exactly per the `commit` skill (read
   `.claude/skills/commit/SKILL.md` and follow it): inspect, group 1–4
   logical commits, branch-aware `[#N]` / conventional messages, session
   trailers, twins never split, no `git add -A`, no `--no-verify`, new
   commit on a failed check.
   If the working tree is already clean, skip to pushing any unpushed
   commits; if there is nothing to commit AND nothing to push, say so and
   stop.
2. **Push once, after all commits:** `git push origin <current-branch>`
   (add `-u` on first push of a new branch). Never `--force` — on `main`,
   never force under any circumstances; a rejected push means pull/rebase
   and re-verify, not override.
3. **Context notes:**
   - On `main`: this is the direct path for non-ticket work (docs, config,
     meta). Ticket work should be on a `feat/N-*` branch via `/implement`.
   - On a feature branch with an open PR: the push updates the PR — this is
     the standard way to publish review fixes.
   - Never create or push semver tags here — releases are deliberate and go
     through `node tools/release.mjs` (see AGENTS.md).
4. **Report** each commit hash + subject and the push result (branch and
   remote range).
