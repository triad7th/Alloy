# Alloy — Shared Library Family for the Ally App Series

**Date:** 2026-07-07
**Status:** Approved
**Scope:** Founding design for the Alloy repo; detailed scope for phase 1 (AlloyTime)

## Purpose

The Ally apps (AllyClock, AllyPiano, AllyMetronome, AllyScore, AllyFast,
AllyStation) duplicate foundational code: time/timezone models, liquid-glass
UI chrome, and audio/synth engines, each written twice (Angular web + SwiftUI
iOS). Alloy is the shared-library family that removes that duplication so each
app repo shrinks, stays clean, and the series keeps one consistent look and
feel.

**Naming rule:** `Ally<Noun>` names are reserved for apps. `Alloy*` names are
libraries. An alloy is a stronger material made by blending — the metaphor is
the point.

## Distribution model

One shared-library repo (`Alloy`) hosting both ecosystems. Apps stay in their
own repos and consume Alloy as a versioned dependency.

```
Alloy/
  swift/
    Package.swift             package "Alloy"; products: AlloyTime (phase 1),
    Sources/AlloyTime/        later AlloyUI, AlloyAudio
    Tests/AlloyTimeTests/
  web/
    packages/alloy-time/      @allyworld/alloy-time (pure TypeScript)
  docs/mirroring.md           the twin-API convention (see below)
  CLAUDE.md                   agent guidance encoding these conventions
```

- **Swift:** one package, one product per domain. Apps depend on the package
  by git URL + semver tag and `import AlloyTime`; SPM links only the products
  used. Local development uses an Xcode local-package path override.
- **Web:** npm workspace, one package per domain, consumed as a git
  dependency (no registry needed). Local development uses `file:` links.
- Tags are cut deliberately; apps pin and upgrade on their own schedule.

## Platform strategy: mirrored twins

Each library ships as a TypeScript package and a Swift package with
deliberately mirrored APIs — same names, same shapes.

- The web API is canonical (the Ally porting rule: web is the reference
  implementation; Apple ports are mechanical translations).
- Both sides are hand-written and idiomatic; `docs/mirroring.md` records the
  naming convention that keeps them aligned.
- **Pure data is generated, not twinned:** tables such as zone→country and
  region lists live once (TS source of truth) and a small script emits the
  Swift literal, following the pattern of allyclock's
  `assets/flags/render_ios_flags.py`.
- Web packages contain no Angular imports. Apps keep thin Angular
  signal-wrapper services (e.g. allyclock's `ClockService` shrinks to a
  signals adapter over `@allyworld/alloy-time`). This keeps apps free to
  upgrade Angular independently and the packages testable with plain Vitest.
- Swift sources depend on Foundation + Observation only (the AllyClockCore
  precedent), so future watchOS/tvOS targets come free.

## Roadmap (each phase gets its own spec and plan)

1. **AlloyTime** — this project. Time/TimeZone/TimeMachine models only, no
   views. Proves the packaging + consumption pipeline end to end with
   AllyClock as first consumer on both platforms.
2. **AlloyUI** — liquid-glass panels (GlassSheet), glass icon buttons, corner
   overlay slots (auto-hiding top-left/top-right chrome), knob/adjust
   controls, the SF-Symbol-named icon layer. Extracted from allyclock and
   AllyPiano once both consume Alloy.
3. **AlloyAudio** — unified engine from AllyMetronome's AVAudioEngine side and
   AllyPiano's web synth, behind one mirrored API.
4. **Adoption sweep** — AllyMetronome, AllyFast, AllyStation migrate
   opportunistically when next touched. No big-bang rewrites.

## Phase 1: AlloyTime

### Contents

Extracted from allyclock (`packages/AllyClockCore` on iOS; `ClockService`,
`LocationService`, zone catalog/formatting on web):

- **TimeMachine** — the mock-clock state machine (`now()`, `setMock()`,
  `clearMock()`) that lets any app preview itself at an arbitrary instant.
- **Zone catalog** — IANA zone resolution including fixed-offset ids
  (`"+05:30"`) that platform APIs reject; unknown ids fall back to the device
  zone.
- **Zone metadata** — zone→country code, zone→city display name, GMT-offset
  formatting (generated data tables).

Face-specific config stores (`FullscreenConfigStore`, dimension bands) stay in
allyclock — they are app concerns, not shared time models.

### Success criteria

- AllyClock (web + iOS) consumes AlloyTime; duplicated time code is deleted
  from the app repo. AllyClockCore disappears or shrinks to face-config
  stores only.
- Existing unit tests move with the code; AllyClock's snapshot suite stays
  green as the regression net for the migration.
- The data-generation script produces the Swift tables from the TS source,
  and a test on each platform asserts the tables agree (count + spot checks).
- Alloy has its own CI-less quality bar for now: `swift test` and
  `npm test` runnable from the repo root; CI comes later.

### Testing

- Twin unit tests: the same fixture instants and zone ids asserted on both
  platforms (fixed `Date` values, deterministic zones — the allyclock
  convention).
- AllyClock integration: build + existing test suites on both platforms after
  the swap.

## Risks

- **Twin drift** — mitigated by the mirroring doc, generated data, and twin
  test fixtures; accepted as a cost of idiomatic hand-written APIs.
- **Version friction for a solo developer** — mitigated by path/`file:`
  overrides during development and tagging only at meaningful checkpoints.
- **Over-extraction** — the phase-1 scope deliberately excludes anything only
  AllyClock uses (face config, dimension bands). Each later phase re-applies
  that test: two apps must want it before it enters Alloy.
