# Alloy

Shared library family for the **Ally** app series (AllyClock, AllyPiano,
AllyMetronome, AllyScore, AllyFast, AllyStation).

An alloy is a stronger material made by blending — Alloy is the foundation the
Ally apps blend into themselves: one implementation of time models, UI chrome,
and audio engines instead of one copy per app.

**Naming rule:** `Ally<Noun>` names are reserved for apps. `Alloy*` names are
libraries.

## Libraries

| Library | Status | Contents |
|---------|--------|----------|
| **AlloyTime** | 0.1.x — zone catalog, zone metadata, zone formatting, TimeMachine | Time/TimeZone/TimeMachine models (no views): mock-clock state machine, IANA + fixed-offset zone resolution, zone→country/city/GMT metadata |
| **AlloyUI** | 0.3.x — tokens, icon layer, icon button, sheet, nav-header, auto-hide, knobs | Liquid-glass panels, glass icon buttons, SF-Symbol-named icon layer, dismissible sheets, auto-hiding chrome, canonical knobs design language |
| **AlloyStorage** | 0.1.0 (unreleased) — backends, auth, Drive client | Storage abstraction (browser, file system, Google Drive) with pluggable auth; sync engine arrives in a later release |
| **AlloyAudio** | planned | Unified audio/synth engine (AVAudioEngine on iOS, AudioWorklet on web) |

## Structure

```text
swift/                    Swift package "Alloy" — one product per library
  Sources/AlloyTime/
  Tests/AlloyTimeTests/
web/                      npm workspace — one package per library
  packages/alloy-time/    @allyworld/alloy-time (pure TypeScript, no Angular)
  packages/alloy-ui/      @allyworld/alloy-ui (Angular component library)
docs/
  mirroring.md            the twin-API convention both ecosystems follow
  superpowers/specs/      design specs (start with the founding spec)
examples/
  web-harness/            Angular preview app (consumes packages from source)
  apple-harness/          SwiftUI preview app (macOS via SwiftPM, iOS via xcodegen)
```

## Running the preview harnesses

Private demo apps for every library surface — never packed, tagged, or
released. Both consume the libraries **from source**, so edits show up on
the next build.

**Web** (<http://localhost:4200>):

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

**iOS simulator** (generated project; `brew install xcodegen` first time):

```sh
cd examples/apple-harness
xcodegen generate
xcodebuild -project AlloyHarnessIOS.xcodeproj -scheme AlloyHarnessIOS \
  -destination 'platform=iOS Simulator,name=iPhone 17 Pro' build
```

then run the scheme from Xcode, or install/launch by hand:

```sh
APP=$(find ~/Library/Developer/Xcode/DerivedData -path "*Debug-iphonesimulator/AlloyHarnessIOS.app" | head -1)
xcrun simctl boot "iPhone 17 Pro"; open -a Simulator
xcrun simctl install "iPhone 17 Pro" "$APP"
xcrun simctl launch "iPhone 17 Pro" world.ally.AlloyHarnessIOS
```

The storage demos' Google Drive halves need one-time OAuth setup — the
constants at the top of `storage-section.component.ts` (web: client id +
token-service URL) and `StorageDemoView.swift` (Apple: iOS-type client id +
redirect scheme) explain what to create in the Google Cloud console.

## How apps consume Alloy

- **iOS:** SPM dependency by git URL + semver tag; `import AlloyTime`.
  Local development: Xcode local-package path override.
- **Web:** npm git dependency on `@allyworld/alloy-time`.
  Local development: `file:` link.

Every library ships as **mirrored twins**: a TypeScript package and a Swift
package with deliberately identical API shapes. The web API is canonical;
Swift mirrors it. Pure data tables are generated from the TS source into
Swift, never hand-duplicated. See [docs/mirroring.md](docs/mirroring.md).

## Start here

1. [Founding design spec](docs/superpowers/specs/2026-07-07-alloy-shared-library-design.md)
   — why Alloy exists, distribution model, roadmap, phase-1 scope.
2. [docs/mirroring.md](docs/mirroring.md) — the rules that keep the Swift and
   TypeScript twins aligned.
3. `CLAUDE.md` — working conventions for coding agents.
