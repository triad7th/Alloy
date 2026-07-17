# AGENTS.md

Guidance for coding agents working in Alloy. This is the only `AGENTS.md` in
the repository. `CLAUDE.md` at the repo root is a byte-identical copy of this
file (a real copy, never a symlink — some agent clients do not follow
symlinks): edit `AGENTS.md`, then refresh the copy in the same commit
(`cp AGENTS.md CLAUDE.md`).

## Product

Alloy is the shared library family for the Ally app series. Apps live in
their own repos (allyclock, AllyPiano, AllyMetronome, AllyScore, allyfast,
AllyStation — siblings under the same parent directory) and consume Alloy as
a versioned dependency.

- **Naming rule:** `Ally<Noun>` = app (reserved). `Alloy*` = library.
- Four libraries ship today: **AlloyTime** (time/zone models),
  **AlloyUI** (liquid-glass component kit), **AlloyStorage** (storage
  abstraction with pluggable auth), **AlloyAudio** (synth/rompler engine).

Current source-of-truth order:

1. Code, package manifests, and tests.
2. This file.
3. `README.md` for setup and the preview harnesses.
4. `docs/mirroring.md` (binding for every API change) and approved
   specs/plans in `docs/superpowers/`.

Older specs describe intent and may lag the implementation. Confirm facts in
the current code before relying on them. The founding spec is
`docs/superpowers/specs/2026-07-07-alloy-shared-library-design.md`; long-term
direction (versioning policy, upcoming libraries, harness apps) is
`docs/superpowers/specs/2026-07-08-alloy-independence-direction.md`.

## Platform scope (decided 2026-07-08)

Alloy targets exactly two platforms:

- **Web**, consumed by the Angular apps. Non-UI libraries (`alloy-time`,
  `alloy-audio`, `alloy-storage`) stay framework-agnostic pure TypeScript —
  no Angular-isms (RxJS, signals, DI tokens). `alloy-ui` is the sanctioned
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

## The one rule that governs all changes

Every library is **mirrored twins**: TypeScript and Swift with identical API
shapes. Web is canonical. Change protocol (from `docs/mirroring.md`):

1. Design/update the API on the web side first.
2. Port to Swift in the same change set — never ship half-updated twins.
3. Regenerate generated data tables if their TS source changed
   (`node tools/generate-tokens.mjs`, `node tools/generate-zone-country.mjs`).
4. Run both test suites before the PR.

Pure data tables are generated, never hand-duplicated. Deliberate
platform asymmetries (web-only surfaces, Apple-only surfaces) exist but must
be documented in `docs/mirroring.md`; a ticket states its twin scope
explicitly.

## Repository layout

```text
Package.swift             Swift package "Alloy" at the REPO ROOT — one
                          product per library (AlloyTime, AlloyUI,
                          AlloyAudio, AlloyStorage); build/test from root
swift/                    Swift sources and tests (paths pinned in the
                          manifest); Foundation + Observation only, except
                          AlloyUI (SwiftUI) and AlloyAudio's AVFoundation edge
web/                      npm workspace — one package per library
  packages/alloy-time/    @allyworld/alloy-time (pure TS, zero runtime deps)
  packages/alloy-audio/   @allyworld/alloy-audio (pure TS; WebAudio only via
                          the MinimalAudioContext seam)
  packages/alloy-storage/ @allyworld/alloy-storage (pure TS)
  packages/alloy-ui/      @allyworld/alloy-ui (Angular component library)
examples/
  web-harness/            Angular preview app (consumes packages from source)
  apple-harness/          SwiftUI preview app (macOS via SwiftPM, iOS via
                          xcodegen) — see README for run/screenshot recipes
services/google-oauth/    OAuth token-exchange service for the storage demos
docs/mirroring.md         the twin-API contract — binding for every change
docs/superpowers/         approved specs and implementation plans
tokens.json + tools/generate-tokens.mjs
                          single source for shared design tokens (colors,
                          durations) emitted to SCSS, TypeScript, and Swift
web/packages/alloy-ui/src/styles/_knobs.scss
                          canonical knobs design language consumed globally
                          by apps' styles
.claude/skills/           ticket-flow skills (canonical)
.agents/skills/           byte-identical copies of .claude/skills
```

`examples/` harnesses are private previews — never packed, tagged, or
released.

### AlloyUI peer coupling

`@allyworld/alloy-ui` is an Angular component library: its components and
directives are built on `@angular/core`, and it declares `@angular/core` +
`@angular/common` `^21.0.0` as hard `peerDependencies`, required at both
compile time and runtime. Consuming apps must stay within a compatible
Angular major, so Angular upgrades are coordinated bumps across the Ally
apps.

## Workflow

Ticket-driven development runs on GitHub Issues, the Alloy Kanban board
(project 4, owner `triad7th`), and pull requests, via the repo skills in
`.claude/skills/` (byte-identical copies in `.agents/skills/`; `.claude` is
canonical — sync the copy in the same commit, never symlink):

1. Brainstorm → `create-issue` files the issue (Status: Ready). Small tickets
   carry acceptance criteria in the body; large ones link spec/plan docs in
   `docs/superpowers/`. Every ticket states its twin scope (both twins,
   web-only, or a documented asymmetry).
2. `/implement <N>` → branch `<type>/<N>-slug` off fresh `main`, Status: In
   progress, TDD plus the verification matrix, commits formatted
   `[#N] <subject>` (support work `[#N] chore: ...`, likewise
   `fix:`/`test:`/`docs:`). Subjects are all lowercase except proper nouns
   (GitHub, PR, AlloyUI, Swift). Multiple commits per ticket. Never pushes.
3. Local review → `/create-pr` pushes and opens the PR (`Closes #N`,
   Status: In review). Review fixes are more `[#N]` commits pushed with
   `/commit-and-push`.
4. `/approve-pr <N>` → rebase-merge into `main`, delete remote and local
   branch, issue closes, Status: Done.

General rules:

- Direct commits to `main` are for meta work only (docs, config, skills);
  library, harness, and tooling behavior goes through the ticket flow.
  Agents never self-merge a PR without the user's approval
  (`/approve-pr` IS that approval).
- Preserve unrelated user changes. The worktree may change while you work;
  re-check `git status` before editing and before handoff.
- Use TDD for behavior changes: write the focused test, observe the expected
  failure, implement the smallest change, then run broader verification.
- Keep specs and plans proportional. Record decisions and traps; do not
  produce line-by-line code transcripts larger than the feature.
- After a superpowers implementation plan is approved, proceed directly with
  `superpowers:subagent-driven-development` in the current session. Do not
  ask the user to choose an execution mode.
- Feature work happens on a real local branch checked out in place — not in
  a git worktree. Decline worktree offers from skills unless the user
  explicitly asks for one.
- Releases are a separate deliberate step, never part of a ticket merge
  (see Versioning and releases).

## Commands

Run from the repository root unless noted:

```bash
swift build && swift test            # Swift twins (manifest at repo root)
cd web && npm ci                     # web install (first time / lockfile change)
cd web && npm test                   # web twins: Vitest per package + ng test alloy-ui
cd web && npm run build              # tsc per package + ng build alloy-ui
node tools/generate-tokens.mjs       # regenerate design-token outputs
node tools/generate-zone-country.mjs # regenerate zone→country data tables
```

Focused runs: `swift test --filter <TestName>`; one web package with
`npm test -w packages/<name>` from `web/`, one spec with
`npx vitest run <path>` inside the package.

Preview harnesses (README has the full recipes, including iOS simulator):

```bash
cd examples/web-harness && npx ng serve    # → http://localhost:4205
cd examples/apple-harness && swift run AlloyHarness   # macOS window
```

## Verification

Match verification to the touched twins, then run the complete relevant
gate. Do not call the repository green when any required command failed,
timed out, or never completed.

| Change                        | Required evidence                                                             |
| ----------------------------- | ----------------------------------------------------------------------------- |
| Swift twin only               | focused tests, `swift build && swift test`                                    |
| Web twin only                 | focused Vitest, `cd web && npm test`, `cd web && npm run build`               |
| Twin API change (both sides)  | both suites above + regenerated tables fresh (`git diff --exit-code` on them) |
| Harness (`examples/`)         | the touched harness builds (web: `npm run build`; apple: `swift build --package-path examples/apple-harness`) |
| Docs/skills only              | copy-sync check (`diff -q AGENTS.md CLAUDE.md`; `.claude/skills` vs `.agents/skills`), diff review |

CI (`.github/workflows/ci.yml`) runs the Swift suite, the web suite, both
harness builds, and a generated-output freshness check on every PR and push
to `main` — but lint/format are NOT CI-enforced; run `/lint-and-format`
locally. Twin tests use the same fixed instants, zone ids, and expected
outputs on both platforms (`Date(timeIntervalSince1970:)` /
`new Date(ms)` fixtures), and a table-agreement test on each platform
asserts generated Swift data matches the TS source.

Ports follow the Ally-family scheme — each product owns a hundred block:
AllyScore 42xx, AllyClock 43xx, AllyPiano 44xx, **Alloy 45xx**, 46xx+
reserved. Alloy's web harness currently serves on **4205** (grandfathered
from the old scheme; moving it to 45xx requires re-registering the Google
OAuth origins for the storage demo). The official harness port belongs to
the human dev: never kill or reuse a server already on it — agents doing
their own checking start their own instance on a free 45xx port with
`--port`.

## Versioning and releases

- iOS: SPM dependency by git URL + semver tag. Tag deliberately at
  meaningful checkpoints, not per commit.
- Web: npm cannot install a git subdirectory, so each release attaches
  `npm pack` tarballs to the GitHub Release. Apps depend on the release
  asset URL directly, e.g.
  `https://github.com/triad7th/Alloy/releases/download/<version>/allyworld-alloy-time-<version>.tgz`.
- **Release procedure — always via the script, never by hand.** From
  up-to-date `main` after the feature PR merged (never from a feature
  branch): bump `package.json` for each package being released to the new
  version, commit and push, sanity-check with
  `node tools/release.mjs <version> --dry-run`, then run:

  ```bash
  node tools/release.mjs <version> [--notes "..."]
  ```

  Packages whose `package.json` version equals `<version>` ride the release;
  unchanged packages keep their old version and get no new tarball. The
  script guards everything easy to get wrong by hand: clean/pushed tree,
  both test suites green, generated outputs fresh, and the packing rules —
  `alloy-time` packs from its package directory (tsc `prepack`), while
  `alloy-ui` MUST pack from the ng-packagr output at `web/dist/alloy-ui`
  (packing from src ships a broken tarball with no compiled bundles). It
  then tags via `gh release create` and cleans up the tarballs. If a guard
  fails, fix the cause and re-run; never work around a guard by hand.
- Local development against an app: Xcode local-package path override /
  npm `file:` link. Never publish to a registry.

## Cross-repo awareness

Phase-1 code was EXTRACTED from allyclock (`packages/AllyClockCore`,
`apps/web/src/app/core/clock.service.ts`, `location.service.ts`). When
migrating code here, keep allyclock's snapshot/unit suites green over there —
they are the regression net for the extraction. Do not edit sibling app
repos unless the task explicitly spans them.
