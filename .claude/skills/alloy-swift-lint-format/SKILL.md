---
name: alloy-swift-lint-format
description: Run SwiftLint and SwiftFormat for the Alloy Swift package. Use when the user asks to lint, format, clean up, check style, run SwiftLint, run SwiftFormat, or validate formatting for Swift files under swift/ or Package.swift.
---

# Alloy Swift Lint Format

Lint and format the Swift twin under `swift/` (package manifest at the repo root).

## Workflow

1. Inspect state:
   - `git status --short`
   - `find swift -type f -name '*.swift' -print | head -20`
2. Confirm the Swift sources exist:
   - If `swift/Sources` does not exist, stop and report that the Swift package has not been scaffolded yet.
   - If `.swiftlint.yml` or `.swiftformat` is missing at the repo root, run only the available tool and report the missing config.
3. Format Swift code:
   - Preferred command (from repo root): `swiftformat swift Package.swift`
   - If SwiftFormat is not installed, report the missing binary and do not invent a replacement.
4. Lint Swift code:
   - Preferred command (from repo root): `swiftlint lint swift`
   - If SwiftLint is not installed, report the missing binary and do not invent a replacement.
5. Verify:
   - Run `swift build` from the repo root to confirm formatting did not break compilation.
   - Run `git diff --check`.
   - Run `git status --short` and report changed files.

## Rules

- Do not format web files or root docs unless the user explicitly asks.
- Do not add or change SwiftLint/SwiftFormat rules unless the user asks for config changes.
- Do not stage or commit changes unless the user explicitly asks.
- If formatting changes files, summarize the changed paths.

## Final Response

Report:

- Commands run.
- Whether formatting changed files.
- SwiftLint result.
- Any missing tools or missing scaffold/config files.
