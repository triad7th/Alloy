---
name: alloy-auto-commit
description: Automatically review, group, validate, stage, and commit Alloy repository changes using conventional commit messages. Use when the user asks to auto commit, commit current changes, create well-structured commits, split changes into multiple commits, or prepare commits for Swift, web, docs, tools, dependency, or repo tooling changes.
---

# Alloy Auto Commit

Commit current Alloy changes with deliberate grouping and the repo's conventional-commit style.

## Workflow

1. Inspect the worktree:
   - `git status --short`
   - `git diff --stat`
   - `git diff`
   - Include staged changes with `git diff --cached --stat` and `git diff --cached` when present.
2. Identify changed files and classify them by area:
   - `swift`: Swift twin sources and tests (`Package.swift`, `swift/**`)
   - `web`: TypeScript twin packages (`web/**`)
   - `tools`: data-generation scripts (`tools/**`)
   - `docs`: documentation-only changes (`README.md`, `docs/**`)
   - `deps`: dependency manifest/lockfile changes
   - `repo`: repository tooling, agent, config, or structure changes (`CLAUDE.md`, `.claude/**`, `.agents/**`, `.gitignore`)
3. Respect the mirrored-twins rule (`docs/mirroring.md`):
   - An API change to one twin must land with its port to the other twin in the same commit — never commit a half-updated twin.
   - Regenerated Swift data tables belong in the same commit as the TS source change that produced them.
4. Split commits by logical intent, not by file type:
   - Keep source changes and their matching tests in the same commit.
   - Keep both twins of one API change in the same commit.
   - Keep dependency manifest and lockfile updates in the same commit.
   - Separate mechanical formatting from behavior changes when both are present.
5. Avoid unsafe partial commits:
   - Stage explicit paths, not `git add .`, unless all changed files belong to the same intended commit.
   - Do not stage unrelated user changes.
   - If one file contains multiple unrelated changes, only split it when the hunks are clearly separable with non-interactive commands. Otherwise create one broader commit or ask the user before proceeding.
   - Never rewrite history or amend existing commits unless the user explicitly asks.
6. Validate before committing:
   - For Swift changes: `swift build && swift test` from the repo root.
   - For web changes: `cd web && npm test` (Vitest), once `web/` is scaffolded.
   - For changes touching both twins, run both suites.
   - For docs-only changes, validation may be skipped.
   - If a relevant validation command is unavailable (scaffolding pending), note that in the final response.
   - If validation fails, stop before committing unless the user explicitly asks to commit failing work.
7. Commit each group independently:
   - Stage only that group.
   - Run `git diff --cached --stat` and confirm it matches the intended group.
   - Commit with the message format below.
   - Continue with the next group until all intended changes are committed.

## Commit Message Style

Conventional commits, per `CLAUDE.md`:

```text
<type>: <imperative summary>
```

Rules:

- Use one type: `feat`, `fix`, `docs`, `test`, or `chore`.
- Summary is imperative, 72 characters or fewer, no trailing period.
- Add a short body only when the why is not obvious from the summary.
- Do not include generated marketing language.

Examples:

```text
feat: add AlloyTime zone-offset lookup to both twins
```

```text
chore: regenerate Swift timezone tables from TS source
```

## Final Response

Report:

- Commit hashes and subjects created.
- Validation commands run and their result.
- Any remaining uncommitted files, especially files intentionally left out.
