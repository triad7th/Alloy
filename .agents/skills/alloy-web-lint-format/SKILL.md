---
name: alloy-web-lint-format
description: Run ESLint and Prettier for the Alloy web packages. Use when the user asks to lint, format, clean up, check style, run ESLint, run Prettier, or validate formatting for TypeScript files under web/.
---

# Alloy Web Lint Format

Lint and format the TypeScript twin packages under `web/` (npm workspace).

## Workflow

1. Inspect state:
   - `git status --short`
   - `find web -type f -name '*.ts' -not -path '*/node_modules/*' -print | head -20`
2. Confirm the web workspace exists:
   - If `web/package.json` does not exist, stop and report that the web workspace has not been scaffolded yet.
   - If ESLint or Prettier config is missing, run only the configured tool and report the missing config.
3. Format code with Prettier:
   - Preferred command (from repo root): `cd web && npm run format`
   - If no `format` script exists, fall back to `cd web && npx prettier --write .`
   - If Prettier is not installed, report the missing binary and do not invent a replacement.
4. Lint with ESLint:
   - Preferred command (from repo root): `cd web && npm run lint`
   - If ESLint reports errors, show them; do not auto-fix unless the user asks.
5. Verify:
   - Run `git diff --check`.
   - Run `git status --short` and report changed files.

## Rules

- Do not format Swift files or root docs unless the user explicitly asks.
- Do not add or change ESLint or Prettier rules unless the user asks for config changes.
- Do not stage or commit changes unless the user explicitly asks.
- If formatting changes files, summarize the changed paths.
- Run Prettier (format) before ESLint (lint) — formatted code lints cleanest.

## Final Response

Report:

- Commands run.
- Whether Prettier changed files.
- ESLint result (pass or list of errors/warnings).
- Any missing tools or missing web scaffold/config files.
