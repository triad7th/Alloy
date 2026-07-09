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

## Platform scope (decided 2026-07-08)

Alloy targets exactly two platforms:

- **Web**, consumed by the Angular apps. Non-UI libraries (`alloy-time`,
  later `alloy-audio`) stay framework-agnostic pure TypeScript — no
  Angular-isms (RxJS, signals, DI tokens). `alloy-ui` is the sanctioned
  exception: an Angular component library by design (see peer coupling
  below).
- **Apple (iOS + macOS)** via the one Swift package; tvOS/watchOS ride along
  in `Package.swift` at no extra cost. Non-UI products depend on
  Foundation + Observation only. `AlloyUI` is the sanctioned exception:
  SwiftUI views by design. App-specific screens still live in the app repos;
  only shared, reusable components belong in `AlloyUI`.

Out of scope: React bindings, Linux, Windows, and any third native twin.
Do not add targets, CI matrices, or contract changes for them without an
explicit user decision.

## Layout

- `swift/` — ONE Swift package named `Alloy`, one product per library
  (`AlloyTime`, `AlloyUI`, later `AlloyAudio`). Non-UI sources depend on
  Foundation + Observation only; `AlloyUI` additionally uses SwiftUI.
- `web/` — npm workspace, one package per library. `@allyworld/alloy-time`
  is pure TypeScript: zero runtime deps, no Angular. `@allyworld/alloy-ui`
  is an Angular component library (see peer coupling below).
- `docs/mirroring.md` — the twin-API contract. Binding for every change.
- `tokens.json` + `tools/generate-tokens.mjs` — single source for shared design tokens (colors, durations) emitted to SCSS, TypeScript, and Swift.

### AlloyUI peer coupling

`@allyworld/alloy-ui` is an Angular component library: its components and
directives are built on `@angular/core`, and it declares `@angular/core` +
`@angular/common` `^21.0.0` as hard `peerDependencies`, required at both
compile time and runtime. Consuming apps must stay within a compatible
Angular major, so Angular upgrades are coordinated bumps across the Ally
apps.

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

## Testing guidance

- Twin tests: same fixed instants, zone ids, and expected outputs on both
  platforms. Use `Date(timeIntervalSince1970:)` / `new Date(ms)` fixtures so
  assertions are deterministic in any timezone.
- A table-agreement test on each platform asserts generated Swift data
  matches the TS source (entry count + spot checks).

## Versioning and consumption

- iOS: SPM dependency by git URL + semver tag. Tag deliberately at
  meaningful checkpoints, not per commit.
- Web: npm cannot install a git subdirectory, so each release instead
  attaches `npm pack` tarballs to the GitHub Release. Apps depend on the
  release asset URL directly, e.g.
  `https://github.com/triad7th/Alloy/releases/download/<version>/allyworld-alloy-time-<version>.tgz`.
  The two web packages pack from different places — get this wrong and the
  tarball is broken:
  - `alloy-time` is plain TypeScript compiled by its own `prepack` (tsc), so
    it packs straight from its package directory. Bump the version in
    `web/packages/alloy-time/package.json`, then:
    ```
    cd web/packages/alloy-time && npm pack
    ```
  - `alloy-ui` is an Angular library built by ng-packagr. It MUST be packed
    from the ng-packagr output at `web/dist/alloy-ui`, never from
    `web/packages/alloy-ui` — packing from src ships a tarball with no
    compiled JS/FESM bundles and no generated `package.json`. Bump the
    version in `web/packages/alloy-ui/package.json`, then:
    ```
    cd web && ng build alloy-ui && cd dist/alloy-ui && npm pack
    ```
  Then, per tarball: `gh release create <version> <tarball...> --title ...
  --notes ...` → delete the local tarball(s).
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
