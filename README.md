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

```
swift/                    Swift package "Alloy" — one product per library
  Sources/AlloyTime/
  Tests/AlloyTimeTests/
web/                      npm workspace — one package per library
  packages/alloy-time/    @allyworld/alloy-time (pure TypeScript, no Angular)
  packages/alloy-ui/      @allyworld/alloy-ui (Angular component library)
docs/
  mirroring.md            the twin-API convention both ecosystems follow
  superpowers/specs/      design specs (start with the founding spec)
```

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
