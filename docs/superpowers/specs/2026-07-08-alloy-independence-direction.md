# Alloy Independence — Versioning, Library Growth, and Harnesses

**Date:** 2026-07-08
**Status:** Approved (direction)
**Scope:** Phase-3+ direction: how Alloy evolves once all Ally apps depend on
it and the planned migrations land (Drive sync, audio synthesizer, MIDI,
studio-quality audio timing). Not an implementation plan — each library named
here gets its own spec + plan when its phase starts.

## Purpose

Alloy started as an extraction target: code moved out of allyclock, with
allyclock's suites as the regression net. This document defines the end
state after migration completes — Alloy as an independent product with its
own development loop, releasing on its own cadence, verified by its own
built-in harnesses, with every Ally app consuming it as a deliberately
pinned dependency.

Three concerns, three sections: (1) how releases avoid rippling across app
repos, (2) how the incoming libraries fit the mirroring contract, (3) how
built-in test projects make independent development safe.

## 1. Version impact: apps pull, Alloy never pushes

The load-bearing property is exact pinning — SPM semver tag, tarball URL
with the version baked in. A release changes nothing anywhere until an app
deliberately bumps. Protect that property; the rules below make the bump
cheap when an app chooses it.

- **Additive-first evolution.** New capability = new API. Changing or
  removing an existing signature is the expensive event: deprecate first
  (`@available(*, deprecated)` in Swift, `@deprecated` JSDoc in TS), remove
  only in a major release.
- **Batch breaking changes.** Accumulate them behind deprecations and cut a
  rare, well-documented major. Never dribble one breaking change per
  release across six consumer apps.
- **Declare 1.0 when migration completes.** Until then, 0.x semantics
  (minor = possibly breaking). At 1.0, real semver: the tag number alone
  tells an app whether a bump is free (patch/minor) or a project (major).
- **Pilot-then-fanout upgrades.** Bump the app that motivated the change
  first, let it soak, then fan out to the rest. App repos get an
  `alloy-bump` skill (update tag + tarball URL, run that app's suites) so
  fanout is mechanical.
- Release mechanics stay as built: release train via `tools/release.mjs`,
  one repo tag per release, packages whose `package.json` matches the tag
  ride it.

## 2. Library growth: assign each library a mirroring regime

`docs/mirroring.md` already defines two regimes — strict API mirroring
(AlloyTime) and semantic mirroring (AlloyUI). Every new library declares its
split explicitly in mirroring.md when it lands: pure core under the strict
regime, platform edge under the semantic regime.

| Library | Strict-regime core (twin-tested, identical fixtures) | Semantic-regime platform edge |
|---|---|---|
| **AlloySync** (Drive sync) | change queues, diffing, conflict resolution, backoff/retry policy | transport + OAuth as injected adapters (`fetch`/`URLSession` behind an interface — the `TimeMachine` storage-injection pattern scaled up) |
| **AlloyMidi** | MIDI data: parsing, event models, sequences | device I/O (WebMIDI vs CoreMIDI), thin adapters |
| **AlloyAudio** (synth + timing) | the scheduling model: tempo math, beat grids, event timelines — "what sounds at which timestamp", deterministic and fixture-testable | the engines: AudioContext lookahead scheduling vs AVAudioEngine sample-time. Do not mirror the engines; mirror the model that drives them |

Dependency discipline holds: cores stay Foundation+Observation / zero-dep
TS; anything platform-bound is an injected adapter or a documented
semantic-regime component.

## 3. Built-in harnesses: Alloy verifies itself

Today the de-facto integration test is "does allyclock still work." That
dependency ends when migration does. Alloy grows private example apps:

```
examples/
  web-harness/    Angular app in the npm workspace ("private": true),
                  consumes the packages as workspace deps — never packed
  ios-harness/    Xcode project referencing the root package by relative
                  path — invisible to SPM consumers
```

Harnesses are NOT apps — the `Ally<Noun>` naming rule does not apply to
them and they never ship.

Three jobs each:

1. **Integration proof** — consume Alloy exactly as an app does, so broken
   export maps, ng-packagr config, or missing products surface here first.
2. **Manual QA surface** — audio timing, synth output, and sync behavior
   need a screen, a play button, and ears on a real device. The harness is
   where "studio quality" gets verified, with measurement instrumentation.
3. **Living documentation** — the harness page per library is its usage
   example.

CI adds a second-tier job: build-only harness compilation (web `ng build`,
iOS `xcodebuild` on the macOS runner). Unit suites are not duplicated there.

**Regression-net handoff (explicit gate):** while extraction is ongoing,
allyclock's suites remain the net (per CLAUDE.md). Migration is declared
done only when representative twin tests are ported into Alloy and the
cross-repo dependency is formally retired — until that gate, "independent"
is aspirational.

## Risk to watch

**Harness-driven development drift** — features shaped by how the harness
uses them instead of how apps do. The pilot-app upgrade step in §1 is the
antidote; keep it even when the harnesses are good.
