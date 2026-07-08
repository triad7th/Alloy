# Alloy

Guidance for coding agents working in this repository. The same content is
served to both Claude Code (via `CLAUDE.md`) and Codex (via `AGENTS.md`, a
symlink to `CLAUDE.md`). Edit `CLAUDE.md` and the agent harness stays
consistent for both.

## What this repo is

Alloy is the shared library family for the Ally app series. Apps live in their
own repos (allyclock, AllyPiano, AllyMetronome, AllyScore, allyfast,
AllyStation, all siblings under the same parent directory) and consume Alloy
as a versioned dependency.

- **Naming rule:** `Ally<Noun>` = app (reserved). `Alloy*` = library.
- **Read first:** `README.md`, then the founding spec at
  `docs/superpowers/specs/2026-07-07-alloy-shared-library-design.md`, then
  `docs/mirroring.md`. Those three explain everything below in depth.

## Layout

- `swift/` — ONE Swift package named `Alloy`, one product per library
  (`AlloyTime`, later `AlloyUI`, `AlloyAudio`). Sources depend on
  Foundation + Observation only.
- `web/` — npm workspace, one package per library
  (`@allyworld/alloy-time`). Pure TypeScript: zero runtime deps, no Angular.
- `docs/mirroring.md` — the twin-API contract. Binding for every change.
- `tools/` — data-generation scripts (TS tables → Swift literals).

## The one rule that governs all changes

Every library is **mirrored twins**: TypeScript and Swift with identical API
shapes. Web is canonical. Change protocol (from `docs/mirroring.md`):

1. Design/update the API on the web side first.
2. Port to Swift in the same change set — never ship half-updated twins.
3. Regenerate generated data tables if their TS source changed.
4. Run both test suites before tagging.

Pure data tables are generated, never hand-duplicated.

## Commands

- Swift: `cd swift && swift build && swift test`
- Web: `cd web && npm ci && npm test` (Vitest)

(Scaffolding pending — until `swift/Package.swift` and `web/package.json`
exist, these commands are aspirational; the phase-1 implementation plan
creates them.)

## Testing guidance

- Twin tests: same fixed instants, zone ids, and expected outputs on both
  platforms. Use `Date(timeIntervalSince1970:)` / `new Date(ms)` fixtures so
  assertions are deterministic in any timezone.
- A table-agreement test on each platform asserts generated Swift data
  matches the TS source (entry count + spot checks).

## Versioning and consumption

- Apps consume by git URL: SPM dependency + semver tag (iOS), npm git
  dependency (web). Tag deliberately at meaningful checkpoints, not per
  commit.
- Local development against an app: Xcode local-package path override /
  npm `file:` link. Never publish to a registry.

## Agent harness conventions (shared with the app repos)

- `CLAUDE.md` is canonical; `AGENTS.md` is a symlink to it. When adding a
  `CLAUDE.md` in a subdirectory, mirror it:
  `ln -s CLAUDE.md <dir>/AGENTS.md`.
- Repo-local skills, if added later, live at `.claude/skills/<name>/SKILL.md`
  (canonical) with `.agents/skills/<name>/SKILL.md` symlinked to it and
  `.agents/skills/<name>/agents/openai.yaml` as Codex-only metadata — the
  same pattern as the allyclock repo.
- Commit style: conventional commits (`feat:`, `fix:`, `docs:`, `test:`,
  `chore:`), imperative subject ≤ 72 chars.

## Cross-repo awareness

Phase-1 code is EXTRACTED from allyclock (`packages/AllyClockCore`,
`apps/web/src/app/core/clock.service.ts`, `location.service.ts`). When
migrating code here, keep allyclock's snapshot/unit suites green over there —
they are the regression net for the extraction. Do not edit sibling app repos
unless the task explicitly spans them.
