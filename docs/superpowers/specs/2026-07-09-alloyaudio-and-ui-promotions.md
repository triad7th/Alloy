# AlloyAudio + UI Promotions (flag, zone-picker) + Preview Harnesses

**Date:** 2026-07-09
**Status:** Approved
**Scope:** Phase 4 of Alloy: (a) promote allyclock's flag + zone-picker into
AlloyUI, (b) extract AllyPiano's synth engine into a new AlloyAudio library,
(c) add `examples/` preview harnesses. Consumer repos are NOT updated in this
phase — they migrate on their own schedule after the release.

## a. AlloyUI promotions: flag + zone-picker

Both exist twice in allyclock (web + iOS), already built on Alloy APIs.
Library versions decouple from alloy-time:

- **FlagComponent / FlagView** — keyed by ISO 3166-1 alpha-2 `countryCode`
  (not zone id: the app resolves zone→country via alloy-time). Apps own the
  artwork: web serves square SVGs under an injectable base path
  (`provideAlloyFlags`, default `flags/1x1`); Apple looks up asset-catalog
  names `<assetPrefix><code>` (default `Flags/`) in an injectable bundle.
  Missing/blank code or missing artwork → globe icon fallback.
- **ZonePickerComponent / ZonePickerView** — search box over a filtered,
  live-apply list. New local shape `ZonePickerOption { id, label }`
  (structurally compatible with alloy-time's `TimeZoneOption`) plus a
  `countryFor: (id) => countryCode | null` input keep alloy-ui free of any
  alloy-time dependency. Filter contract (twin-tested): case-insensitive
  substring over the full label; blank query returns all.

## b. AlloyAudio: the synth engine, extracted

Source: AllyPiano, where the pure/platform split already exists on both
sides. Regime assignment per the independence direction doc: strict-mirrored
core, semantic platform edges.

**Renames (instrument-agnostic — this engine also backs AllyScore playback
later):** `PianoAudioEngine` → `SynthEngine`, `PianoEngineCore` →
`SynthEngineCore`, `WebAudioEngine` → `WebSynthEngine`,
`AVPianoAudioEngine` → `AVSynthEngine`. Everything else keeps its name.

**Strict-regime core (twin-tested, identical fixtures):**
- `SynthEngine` interface: `noteOn(midi, velocity?)`, `noteOff`,
  `setSustain`, `setInstrument(id)`, `allNotesOff`.
- `SynthEngineCore` — the polyphony + sustain-pedal state machine,
  dependency-injected with `playerFor(instrumentId)` and `now()` (the
  Swift `PianoEngineCore` shape, back-ported to web as the canonical form).
- `VoicePlayer` / `ActiveVoice` (Swift: `ActiveVoiceHandle`) contracts,
  `VOICE_PEAK = 0.3`, `FAST_STOP_S = 0.03`.
- Pitch math (`midiToFrequency`, note names, `isBlackKey`).
- Voice spec types: `SynthVoiceConfig` (ADSR + waveform),
  `SupersawVoiceSpec`, `SampledVoiceSpec`, `VoiceSpec` union, plus
  `InstrumentDescriptor { id, voice, sends }` and `VoiceSends`.
  **The instrument catalog itself stays app-side** — AlloyAudio is
  instrument-agnostic; ids are opaque strings; apps (and the harnesses)
  supply their own descriptors.
- Nearest-loaded-zone lookup (`sampleFileName`, zone store shape with the
  lower-zone tie-break).

**Semantic-regime platform edges:**
- Web: `audio-graph.ts` (`MinimalAudioContext` + node/param interfaces —
  the deliberate WebAudio seam), node-based voice players (synth, supersaw,
  sampled), `MasterChain` (limiter + generated-IR reverb + feedback delay),
  `SampleLoader` (fetch + decodeAudioData, injectable fetcher),
  `WebSynthEngine` factory wiring it all to `SynthEngineCore`.
- Swift: hand-rolled DSP (`Oscillator` polyBLEP, `BiquadLowpass`,
  `ParamRamp` mirroring the three AudioParam scheduling primitives,
  `SynthVoice`/`SupersawVoice`/`SampledVoice`, `VoiceMixer`),
  `AVSynthEngine` (static AVAudioEngine graph: per-instrument source node →
  dry/reverb/delay sends → limiter), `ChannelCommandQueue` (UI→render-thread
  handoff), `SampleSource` protocol + bundle-based loader with injectable
  bundle/subdirectory.
- **Documented asymmetry:** the web synthesizes via native WebAudio nodes;
  Swift synthesizes per-sample by hand. The alignment contract is the
  `MinimalAudioParam`/`ParamRamp` primitive pairing plus twin tests pinning
  shared numeric behavior (pitch math, envelope targets, zone selection).
- **Samples stay app-side** (~2 MB Salamander set is not bundled in Alloy).
  The convention is the contract: zero-padded-MIDI mp3 names + arithmetic
  zone lists.

**Non-goals this phase:** no lookahead scheduler (the engine is
play-as-you-press; every API already threads absolute `when` timestamps, so
a sequencer/metronome scheduler layers on top in a later phase), no velocity
curves (velocity is plumbed and clamped but apps currently send 1.0), no
WASM-shared DSP.

## c. Preview harnesses (`examples/`)

Per the independence direction doc; private, never packed or released.

- `examples/web-harness` — minimal Angular app in the npm workspace
  (`"private": true`), one page per feature: flag + zone-picker, knobs,
  sheet/icons, and a clickable synth keyboard driving AlloyAudio.
- `examples/apple-harness` — a local SwiftPM package (no Xcode project;
  xcodegen unavailable) with a macOS SwiftUI executable depending on the
  root Alloy package by relative path: `swift run AlloyHarness`. macOS is in
  platform scope and exercises the same Liquid Glass AlloyUI + AVAudioEngine
  AlloyAudio code paths as iOS; the root view is structured to drop into an
  iOS app target unchanged if a device-preview Xcode project is added later.

## Release

One train: alloy-ui 0.4.0 (flag + zone-picker) and alloy-audio 0.4.0 (new)
ride tag 0.4.0 via `tools/release.mjs`. alloy-time is unchanged and stays at
its current version.
