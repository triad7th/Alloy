---
name: lint-and-format
description: Format and lint both Alloy twins - SwiftFormat + SwiftLint for the Swift package, Prettier/ESLint for the web workspace where configured - and report what changed and what remains.
---

# Lint and Format

Both twins, Swift first, then web. Formatting runs before linting on each
side so auto-fixes land before the style check. Never commits — that is
`/commit` or `/commit-and-push`.

## Steps

1. **Swift format** (from the repo root):

   ```bash
   swiftformat swift Package.swift
   ```

   If SwiftFormat is not installed (`which swiftformat`), report the missing
   binary (`brew install swiftformat`) and skip — do not invent a
   replacement.

2. **Swift lint:**

   ```bash
   swiftlint lint swift
   ```

   Same rule for a missing binary (`brew install swiftlint`). Do not add or
   change SwiftLint/SwiftFormat rules unless the user asks for config
   changes.

3. **Swift still compiles:** if step 1 changed files, run `swift build`
   from the repo root to confirm formatting did not break compilation.

4. **Web format + lint** (in `web/`): run `npm run format` then
   `npm run lint` **only if those scripts exist** in `web/package.json`.
   If they are not configured (currently the case), report that and skip —
   never improvise `npx prettier --write .` or ad-hoc ESLint runs with
   default configs; that reformats the whole tree against no agreed style.

5. **Report:** commands run, files changed by formatting
   (`git status --short`), remaining lint errors/warnings with file:line,
   and any missing tools or scripts. Do NOT commit.
