---
name: implement
description: Start implementing a GitHub issue on a linked feature branch. Use for "/implement <issue-number>" — reads the issue, creates and links a feature branch, adds the issue to the Alloy project board, and does the work on that branch (never on main). Open the PR afterwards with /create-pr.
---

# Implement (issue-driven feature branch)

Turn a GitHub issue into work on a linked feature branch. Alloy is
branch-and-PR based: `main` only advances through merged PRs, so every
feature starts from an issue and lands on its own branch. This skill sets up
that branch and drives the implementation. It never pushes to `main`, never
merges, and never opens the PR — that is `/create-pr`.

**Argument:** the issue number (e.g. `/implement 42`). If none was given, ask
for it before doing anything.

## Preflight — stop early if any check fails

1. Confirm the repo and issue exist:
   - `gh repo view --json nameWithOwner` (expect `triad7th/Alloy`).
   - `gh issue view <n> --json number,title,body,state,url,labels`.
     If the issue is closed, stop and confirm with the user before continuing.
2. Confirm `gh` has the `project` scope — the Alloy board step is mandatory
   and this skill hard-fails without it:
   - Check `gh auth status` scopes, or probe with
     `gh project list --owner triad7th`.
   - If the scope is missing (error mentions `read:project` / `project`),
     STOP. Tell the user to run `gh auth refresh -s project` themselves — it
     is an interactive login this skill cannot perform — then re-run
     `/implement`. Do not proceed: no feature may skip the board.
3. Confirm a clean starting point:
   - `git status --short`. If the tree holds uncommitted work that is not
     this issue's (for example a sibling session's in-flight files), stop and
     ask — never sweep unrelated changes onto the new branch.

## Set up the linked branch

4. Base off up-to-date `main`: `git fetch origin`.
5. Create and check out the issue's linked branch (GitHub's development link):
   - Check for an existing one first: `gh issue develop <n> --list`.
   - None yet: `gh issue develop <n> --base main --checkout`. This creates a
     branch named `<n>-<slug>`, links it to the issue on GitHub, and checks
     it out.
   - Already exists: check it out with `git checkout <branch>`; do not create
     a second branch.
   - Verify with `git status --short --branch` — you must be on the feature
     branch, not `main`.

## Add the issue to the Alloy project (mandatory)

6. Resolve the project and add the issue:
   - `gh project list --owner triad7th` — find the project named `Alloy` and
     note its number.
   - `gh project item-add <project-number> --owner triad7th --url <issue-url>`.
   - If no project named `Alloy` exists, STOP and ask the user — do not
     create a project or add the issue to a different one.
   - If this step fails for any reason, stop before implementing (see
     preflight 2).

## Implement

7. Choose the execution path from the issue body:
   - References a plan (`docs/superpowers/plans/*.md`) → drive it with
     `superpowers:subagent-driven-development` (fresh subagent per task,
     review between tasks).
   - References a design spec but no plan → use `superpowers:writing-plans`
     to produce the plan first, then execute it.
   - References neither and the change is small and clear → implement inline
     (TDD wherever a suite exists).
   - Only a rough idea → use `superpowers:brainstorming` first; do not guess
     a design.
8. Throughout the work:
   - Every commit lands on the feature branch, conventional-commit style
     (`feat:`/`fix:`/`docs:`/`test:`/`chore:`, imperative subject ≤ 72 chars).
   - Stage explicit pathspecs; never `git add -A` / `git add .` / `git stash`
     (the tree may hold a sibling session's in-flight work).
   - Respect the mirrored-twins rule: both twins of an API change land in the
     same commit.
   - Never push to `main`, never merge, never open the PR here.

## Final Response

Report:

- Issue number, title, and the linked branch name.
- Confirmation the issue was added to the Alloy project (or why it stopped).
- What was implemented and the commit hashes on the branch.
- Next step: run `/create-pr` when the feature is ready.
