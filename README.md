# Alloy

Shared library family for the **Ally** app series (AllyClock, AllyPiano,
AllyMetronome, AllyScore, AllyFast, AllyStation).

An alloy is a stronger material made by blending — Alloy is the foundation the
Ally apps blend into themselves: one implementation of time models, UI chrome,
storage, and audio engines instead of one copy per app.

**Naming rule:** `Ally<Noun>` names are reserved for apps. `Alloy*` names are
libraries.

## Libraries

| Library | Status | Contents |
|---------|--------|----------|
| **AlloyTime** | 0.5.x — zone catalog, zone metadata, zone formatting, TimeMachine | Time/TimeZone/TimeMachine models (no views): mock-clock state machine, IANA + fixed-offset zone resolution, zone→country/city/GMT metadata |
| **AlloyUI** | 0.6.x — tokens, icon layer, icon button, sheet, auto-hide + chrome modifier, knobs, flag view, zone picker | Liquid-glass panels, glass icon buttons, SF-Symbol-named icon layer, dismissible sheets, auto-hiding chrome, canonical knobs design language |
| **AlloyStorage** | 0.6.x — backends, auth, Drive client, public share links | Storage abstraction (browser, file system, Google Drive) with pluggable auth; sync engine arrives in a later release |
| **AlloyAudio** | 0.6.x — synth engine, voices, DSP primitives, sample pipeline | Unified audio/synth engine (AVAudioEngine on iOS, AudioWorklet on web); rompler generators in progress |

Every library ships as **mirrored twins**: a TypeScript package and a Swift
product with deliberately identical API shapes. The web API is canonical;
Swift mirrors it. Pure data tables are generated from the TS source into
Swift, never hand-duplicated. See [docs/mirroring.md](docs/mirroring.md) —
binding for every API change.

## Structure

```text
Package.swift             Swift package "Alloy" (repo root) — one product per
                          library; swift build / swift test from the root
swift/                    Swift sources and tests
web/                      npm workspace — one package per library
  packages/alloy-time/    @allyworld/alloy-time (pure TypeScript, no Angular)
  packages/alloy-audio/   @allyworld/alloy-audio (pure TypeScript)
  packages/alloy-storage/ @allyworld/alloy-storage (pure TypeScript)
  packages/alloy-ui/      @allyworld/alloy-ui (Angular component library)
examples/
  web-harness/            Angular preview app (consumes packages from source)
  apple-harness/          SwiftUI preview app (macOS via SwiftPM, iOS via xcodegen)
services/google-oauth/    OAuth token-exchange service for the storage demos
docs/
  mirroring.md            the twin-API convention both ecosystems follow
  superpowers/            design specs and implementation plans
tools/                    generators (tokens, zone data) + release.mjs
.claude/skills/           ticket-flow skills (.agents/skills/ holds exact copies)
```

## Building and testing

```sh
swift build && swift test        # Swift twins, from the repo root
cd web && npm ci && npm test     # web twins (Vitest + ng test alloy-ui)
```

## Running the preview harnesses

Private demo apps for every library surface — never packed, tagged, or
released. Both consume the libraries **from source**, so edits show up on
the next build.

**Web** (<http://localhost:4510>):

```sh
cd examples/web-harness
npm install   # first time only
npx ng serve
```

**macOS** (opens a window; no Xcode project needed):

```sh
cd examples/apple-harness
swift run AlloyHarness
```

**iOS simulator** (generated project; `brew install xcodegen` first time).
The pinned derived-data path makes the .app location deterministic:

```sh
cd examples/apple-harness
xcodegen generate
xcodebuild -project AlloyHarnessIOS.xcodeproj -scheme AlloyHarnessIOS \
  -destination 'platform=iOS Simulator,name=iPhone 17 Pro' \
  -derivedDataPath .build-ios build
```

then run the scheme from Xcode, or install/launch by hand (the `terminate`
matters when re-launching after a rebuild):

```sh
xcrun simctl boot "iPhone 17 Pro" 2>/dev/null; open -a Simulator
xcrun simctl install "iPhone 17 Pro" .build-ios/Build/Products/Debug-iphonesimulator/AlloyHarnessIOS.app
xcrun simctl terminate "iPhone 17 Pro" world.ally.AlloyHarnessIOS 2>/dev/null || true
xcrun simctl launch "iPhone 17 Pro" world.ally.AlloyHarnessIOS
```

The storage demos' Google Drive halves need one-time OAuth setup — the
constants at the top of `storage-section.component.ts` (web: client id +
token-service URL) and `StorageDemoView.swift` (Apple: iOS-type client id +
redirect scheme) explain what to create in the Google Cloud console.

## How apps consume Alloy

- **iOS:** SPM dependency by git URL + semver tag; `import AlloyTime`.
  Local development: Xcode local-package path override.
- **Web:** npm dependency on the tarball attached to each GitHub Release
  (npm cannot install a git subdirectory). Local development: `file:` link.

Releases are cut from up-to-date `main` with `node tools/release.mjs
<version>` — the script runs both suites, packs the tarballs correctly, and
tags the GitHub Release. Never tag or pack by hand.

## Development workflow

Work is ticket-driven on GitHub Issues + the Alloy Kanban board (project 4)
via repo skills: brainstorm → `create-issue` (Status: Ready) →
`/implement <N>` (feature branch, TDD, `[#N]`-prefixed commits) → local
review → `/create-pr` (Status: In review) → PR review → `/approve-pr <N>`
(rebase-merge to `main`, branch cleanup, Status: Done). Direct commits to
`main` are reserved for meta work (docs, config, skills).

## Start here

1. [Founding design spec](docs/superpowers/specs/2026-07-07-alloy-shared-library-design.md)
   — why Alloy exists, distribution model, roadmap, phase-1 scope.
2. [docs/mirroring.md](docs/mirroring.md) — the rules that keep the Swift and
   TypeScript twins aligned.
3. `AGENTS.md` — working conventions for coding agents (`CLAUDE.md` is a
   byte-identical copy).
