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
- **Long-term direction** (versioning policy, upcoming libraries, harness
  apps): `docs/superpowers/specs/2026-07-08-alloy-independence-direction.md`.

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
  (`AlloyTime`, `AlloyUI`, `AlloyAudio`). Non-UI sources depend on
  Foundation + Observation only; `AlloyUI` additionally uses SwiftUI, and
  `AlloyAudio`'s platform edge uses AVFoundation.
- `web/` — npm workspace, one package per library. `@allyworld/alloy-time`
  and `@allyworld/alloy-audio` are pure TypeScript: zero runtime deps, no
  Angular (alloy-audio reaches WebAudio only through its MinimalAudioContext
  seam). `@allyworld/alloy-ui` is an Angular component library (see peer
  coupling below).
- `examples/` — private preview harnesses (web Angular app + macOS SwiftUI
  package); never packed, tagged, or released.
- `docs/mirroring.md` — the twin-API contract. Binding for every change.
- `tokens.json` + `tools/generate-tokens.mjs` — single source for shared design tokens (colors, durations) emitted to SCSS, TypeScript, and Swift.
- `web/packages/alloy-ui/src/styles/_knobs.scss` — canonical knobs design language (section cards, labels, toggles, segments, sliders, responsive grid) consumed globally by apps' styles.

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

Alloy's official dev-serve port is **4205** (the `examples/web-harness`
preview app; `ng serve` defaults to it via its `angular.json`). Each Ally
project owns a fixed port so several can run side by side: AllyClock 4200,
AllyPiano 4201, AllyScore 4202, Alloy 4205. The official port belongs to
the human dev: if it is already serving, never kill or reuse that server —
agents doing their own debugging or checking start their own instance on a
free port with `--port`.

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
- **Release procedure — always via the script, never by hand:**
  bump `package.json` for each package being released to the new version,
  commit and push, then run:
  ```
  node tools/release.mjs <version> [--dry-run] [--notes "..."]
  ```
  Packages whose `package.json` version equals `<version>` ride the release;
  unchanged packages keep their old version and get no new tarball. The
  script guards everything easy to get wrong by hand: clean/pushed tree,
  both test suites green, generated outputs fresh, and the packing rules —
  `alloy-time` packs from its package directory (tsc `prepack`), while
  `alloy-ui` MUST pack from the ng-packagr output at `web/dist/alloy-ui`
  (packing from src ships a broken tarball with no compiled bundles). It
  then tags via `gh release create` and cleans up the tarballs.
- Local development against an app: Xcode local-package path override /
  npm `file:` link. Never publish to a registry.

## Branching and pull-request workflow

`main` is canonical and, by convention, advances only through pull requests
merged on GitHub by the human. No direct pushes to `main`, and there is no
long-lived `develop` branch — just `main` plus short-lived feature branches.
Every feature follows this lifecycle:

1. **Issue first.** File a GitHub issue describing the work before touching
   code — it anchors the branch, the PR, and the Alloy project board. Use
   `/create-issue` to turn a settled brainstorm/design into a precise issue.
2. **`/implement <issue-number>`.** Reads the issue, creates and links a
   feature branch via `gh issue develop <n> --base main --checkout` (named
   `<n>-<slug>`), adds the issue to the **Alloy** project, and does the work
   on that branch. If the issue references a plan under
   `docs/superpowers/plans/`, it runs `superpowers:subagent-driven-development`;
   otherwise it plans/implements as the work warrants. All commits stay on the
   branch. The board step requires the `gh` `project` scope — grant it with
   `gh auth refresh -s project` if missing (the skill hard-fails without it).
3. **`/create-pr`.** Verifies the suites, pushes the feature branch, and opens
   a PR into `main` whose body ends with `Closes #<n>`. The human reviews and
   merges on GitHub; agents never self-merge.
4. **Release from `main` after merge.** Once merged, cut releases with
   `tools/release.mjs` from up-to-date `main` (see Versioning above).

The `/create-issue`, `/implement`, and `/create-pr` skills live in
`.claude/skills/`.

## Agent harness conventions (shared with the app repos)

- `CLAUDE.md` is canonical; `AGENTS.md` is a symlink to it. When adding a
  `CLAUDE.md` in a subdirectory, mirror it:
  `ln -s CLAUDE.md <dir>/AGENTS.md`.
- Repo-local skills live at `.claude/skills/<name>/SKILL.md` (canonical) with
  a **real copy** at `.agents/skills/<name>/SKILL.md` (not a symlink — some
  agent clients don't follow symlinked skill files) and
  `.agents/skills/<name>/agents/openai.yaml` as Codex-only metadata. When you
  edit a skill, update both copies in the same commit so the two harnesses
  stay in sync. (`AGENTS.md` remains a symlink to `CLAUDE.md`; only the
  per-skill `SKILL.md` files are copied.)
- Commit style: conventional commits (`feat:`, `fix:`, `docs:`, `test:`,
  `chore:`), imperative subject ≤ 72 chars.

## Cross-repo awareness

Phase-1 code is EXTRACTED from allyclock (`packages/AllyClockCore`,
`apps/web/src/app/core/clock.service.ts`, `location.service.ts`). When
migrating code here, keep allyclock's snapshot/unit suites green over there —
they are the regression net for the extraction. Do not edit sibling app repos
unless the task explicitly spans them.
