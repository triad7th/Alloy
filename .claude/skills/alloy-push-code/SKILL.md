---
name: alloy-push-code
description: Push committed Alloy repository changes to the correct Git remote and branch. Use when the user asks to push code, publish commits, push the current branch, upload work to GitHub, or push after committing Swift, web, docs, tools, dependency, or repo tooling changes.
---

# Alloy Push Code

Push committed Alloy changes deliberately, without hiding local state or pushing the wrong branch.

## Workflow

1. Inspect repository state:
   - `git status --short --branch`
   - `git remote -v`
   - `git log --oneline --decorate -5`
2. Confirm the branch and upstream:
   - Prefer the current branch.
   - Use `git rev-parse --abbrev-ref --symbolic-full-name @{u}` to check upstream.
   - If no upstream exists, use `git push -u origin <current-branch>` when `origin` exists.
   - If multiple remotes exist and intent is unclear, ask before pushing.
3. Check what will be pushed:
   - If upstream exists, run `git log --oneline @{u}..HEAD`.
   - If upstream exists, run `git diff --stat @{u}..HEAD`.
   - If there are no commits ahead, do not push; report that the branch is already up to date.
4. Protect local work:
   - Do not push when there are uncommitted source changes unless the user explicitly asked to push anyway.
   - Untracked docs or local notes may be allowed only when clearly unrelated to the commits being pushed.
   - Never use force push unless the user explicitly asks for it.
   - Never rewrite history, rebase, amend, or reset as part of pushing unless explicitly requested.
5. Run final validation when appropriate:
   - If commits since upstream include Swift changes, run `swift build && swift test` from the repo root.
   - If commits since upstream include web changes, run `cd web && npm test` once `web/` is scaffolded.
   - If commits are docs-only or repo workflow-only, validation may be skipped.
   - If validation was already run during the same session after the last commit, reuse that result.
   - If validation fails, stop before pushing unless the user explicitly asks to push failing work.
6. Push:
   - Existing upstream: `git push`
   - No upstream: `git push -u origin <current-branch>`
   - After pushing, run `git status --short --branch`.

## Branch and Tag Guidance

- Do not push directly to `main` if the user asked for a feature branch or PR workflow.
- If already on `main` and commits are present, pushing to `main` is acceptable only when that matches the repo's current workflow or the user's request.
- If the user asks for a PR, push the branch first, then use the repo's GitHub workflow or GitHub tooling to open the PR.
- Never create or push semver tags as part of a routine push. Apps consume Alloy by tag; tags are cut deliberately at meaningful checkpoints, only when the user explicitly asks.

## Final Response

Report:

- Remote and branch pushed.
- Commit hashes and subjects pushed.
- Validation command and result, or why validation was skipped.
- Final branch status.
