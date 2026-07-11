# Alloy Rompler Engine — Design Spec

Date: 2026-07-10
Status: approved for planning

## Vision

Evolve `alloy-audio` from a minimal sample/synth player into a rompler engine
in the lineage of the Roland XV-1010 / Sound Canvas and Steinberg
Hypersonic 2 / HALion Sonic: **short, curated, polished samples plus a real
synthesis layer**, not sample-heavy realism. The target aesthetic is
"zero noise, polished, Japanese professional synth" — clean over realistic;
FM8-class electric pianos with no samples at all; studio-clean acoustic
sources with no room noise or player artifacts.

End state: a software GM-class module (Virtual Sound Canvas competitor, far
better quality) shipped in three tiers. **Tier budgets are for the entire
library at GM-level variety, not per instrument:**

| Tier | Whole-library budget | Strategy |
|---|---|---|
| Tiny | < 100 MB | Synthesis-first; sparse zones (every 4–5 semitones), 1–2 velocity layers, short loops, mono below C2 |
| Standard | ~500 MB | Denser zones, 3 velocity layers, stereo, longer pre-loop tails |
| HQ | 1–2 GB | Full zone coverage, 4+ velocity layers, long natural decays (loops as safety net), high bitrate |

The tiny tier must already sound fantastic (the XV-1010 DNA); upper tiers add
depth, never rescue quality. Roughly half of GM's 128 programs are
synthesis-first in this engine (organs, EPs, synth leads/pads/basses,
chromatic percussion via FM) and cost near-zero bytes; the sample budget
concentrates on piano, strings, brass, winds, guitars, choir, and drums.

## Decisions made

1. **Milestone order**: engine core first, acoustic piano as the proving
   patch. Every later instrument rides the same engine.
2. **Content sourcing**: curated CC0/CC-BY libraries (Salamander piano,
   VSCO-2 CE, University of Iowa, FreePats) polished in-house, plus our own
   synthesized source material. No resampling of hardware ROMs (Roland
   asserts copyright on ROM waveforms). No Kontakt-style noisy realism.
3. **DSP model**: custom per-sample DSP core with thin platform hosts
   (AudioWorklet on web, `AVAudioSourceNode` render callback on Apple).
   Graph-native nodes cannot express FM on AVFoundation and cap quality
   everywhere; a pure core makes the twins bit-comparable and testable.
4. **Voice architecture**: structured rompler voice ("XV-lite") — patches
   are pure data over a fixed set of generator/filter/envelope units.
   Rejected: bespoke voice classes per instrument family (every instrument
   becomes twin code, GM becomes 128 code projects); fully modular patching
   (Reaktor-lite scope, nothing in the first wave needs it).
5. **Effects**: full rompler FX in the first engine build — per-patch insert
   chain plus rebuilt algorithmic send reverb/delay, all in the DSP core.
6. **Packaging**: built inside `alloy-audio` (new `dsp/` core + patch data
   model), not a new package. Public `SynthEngine` surface is preserved.
7. **Factory content**: alloy-audio ships a curated, opinionated factory
   patch bank. This deliberately reverses the earlier "AlloyAudio ships no
   instruments" stance; apps can still ship their own patches.
8. **First wave** (after the piano proof): FM electric pianos (DX/FM8
   style), tine/Wurli EP, strings/warm pads, drawbar + electronic organs.

## Architecture

### DSP core

New `web/packages/alloy-audio/src/dsp/` — pure per-sample math over
`Float32Array` blocks, zero WebAudio imports. Swift twin in
`swift/Sources/AlloyAudio/DSP/` with the same names and numeric contract
(web designed first, ported in the same change set, per `docs/mirroring.md`).

Units:

- Oscillators: sine/saw/pulse with polyBLEP anti-aliasing.
- FM kernel: 4–6 operators, per-operator ratio/level/envelope, algorithm
  matrix, feedback.
- Additive generator: partial-level mixing (drawbar organs are a 9-partial
  preset).
- Virtual-analog generator: osc mix + unison/detune (absorbs the existing
  supersaw).
- Sample-zone playback: cubic interpolation, crossfaded loops,
  velocity-layer crossfading.
- State-variable filter (TVF): LP/HP/BP, cutoff, resonance.
- ADSR envelopes with exponential segments (TVA + filter env).
- LFOs: shape, rate, delay/fade-in.
- Seeded PRNG unit — the only randomness source (detune drift, noise
  generators) — so renders are deterministic.

Determinism is a hard constraint: same patch + note events + sample rate →
same output (within cross-compiler float epsilon).

### Platform hosts

- **Web**: an `AudioWorkletProcessor` running the core. alloy-audio ships
  the worklet module; the app registers it via `audioWorklet.addModule()`.
  Note events and patch changes cross the message port with sample-accurate
  timestamps. `MinimalAudioContext` gains a `createWorkletHost()` seam so
  tests run without a browser.
- **Apple**: one `AVAudioSourceNode` for the whole engine (all voices + FX
  mixed in-core), sidestepping AVAudioEngine node churn.

Processing is block-based (128-sample blocks, matching WebAudio's render
quantum), with no per-sample allocation and voice stealing at the cap.

**Performance envelope**: 64-voice polyphony with full FX at < 25% of one
core on a mid-tier phone.

### Patch model

A `Patch` is a versioned, pure-data document (TS interfaces, JSON-
serializable; Codable mirror in Swift):

```
Patch
├─ meta: id, name, category, gmProgram? (for the future GM module)
├─ schemaVersion (engine refuses newer majors)
├─ layers: 1–4 ×
│   ├─ keyRange / velRange (+ crossfade widths)
│   ├─ generator: sampleZone | fm | va | additive
│   ├─ tvf: SVF mode, cutoff, resonance, env amount, key-track, vel→cutoff
│   ├─ tva: level, pan, ADSR, exponential velocity curve
│   └─ lfo: shape, rate, delay, routes → pitch / cutoff / amp / pan
├─ inserts: ordered effect list
└─ sends: reverb / delay levels (today's VoiceSends shape)
```

Modulation routing is fixed but parameterized: velocity→cutoff,
velocity→FM index, env→cutoff, LFO→pitch/amp/pan, key-tracking→cutoff.

First-wave mapping (schema sanity check):

- **Acoustic piano**: 3 crossfaded velocity sample layers, vel→cutoff
  brightness, quiet `va` body-resonance layer, optional damper-noise
  micro-layer.
- **FM EP**: single `fm` layer, velocity→modulator index, tremolo, chorus.
  Zero samples.
- **Tine EP**: small sampled strike layer + `fm` body layer, phaser insert.
- **Strings/pads**: looped sampleZone or saw ensemble, slow envelopes,
  ensemble chorus, filter key-tracking.
- **Organs**: `additive` layer, no envelope shaping, rotary insert.

### Effects

All effects are DSP-core units under the same twin/golden-test regime,
replacing the graph-node master chain.

Inserts (per patch, ordered, ~2–3 budget): chorus/ensemble (2-voice stereo +
3-phase ensemble mode — the identity effect, gets the most tuning),
phaser (4/8-stage), tremolo/auto-pan, rotary speaker (simplified crossed
AM/FM model with slow/fast ramp — polished over realistic), drive + 3-band
EQ, compressor.

Sends (shared, two buses, API-compatible with `VoiceSends`):

- **Reverb**: algorithmic (Dattorro/FDN family) replacing the noise-IR
  convolver — identical across platforms, tunable (predelay, damping, size,
  modulation), zero asset bytes. Hardest DSP in the project; budgeted
  accordingly.
- **Delay**: tempo-syncable stereo/ping-pong with damped feedback.

Master: lookahead limiter in-core, replacing the compressor-as-limiter.

Out of scope: per-patch arbitrary FX graphs; user-tweakable FX UI. Patches
bake their FX settings; apps get wet/dry levels at most.

### Content pipeline

New `tools/samplepack/` Node scripts, offline only:

1. **Loop finder** — autocorrelation loop-point search + crossfade baking
   (the biggest size lever).
2. **Velocity-layer assembler** — picks/normalizes N layers per zone.
3. **Encoder + verifier** — AAC (`.m4a`, both platforms decode natively)
   with encoder-delay compensation so loop points stay sample-accurate
   after decode; round-trips every file and rejects packs whose loops drift.
4. **Manifest generator** — per-pack JSON: zone→file map, loop points,
   tuning, layer levels. Patches reference zones by stable id, resolved
   against whichever tier pack is installed — the patch bank is identical
   across tiers.

Every source sample gets the same polish pass (trim, denoise, tune-correct,
normalize). CC-BY attribution manifest (`CREDITS.md` per pack) is generated
automatically.

**Delivery**: packs fetch on demand, progressive like today's
`SampleLoader` (playable from the first decoded zone, synth fallback until
then). Hosting sits behind a `PackSource` seam — apps choose bundled asset,
CDN, or GitHub release asset. The tiny tier is small enough to bundle.

### Public API and migration

- `SynthEngine` note-on/off and instrument-selection surface unchanged.
- `InstrumentDescriptor` gains `{ kind: 'patch', patch: Patch }` alongside
  legacy `sampled`/`supersaw` specs — apps migrate instrument-by-instrument,
  no flag day. Legacy specs deprecate after AllyPiano migrates.
- New APIs: `loadPack(manifestUrl)`, pack/tier status queries, patch-bank
  listing.

### Proving ground

The `examples/` web harness becomes the **patch workbench**: parameter knobs
(alloy-ui knobs design language), A/B audition against reference renders,
patch JSON export. Patch authoring is a listening activity; the workbench is
its instrument. The macOS harness mirrors playback for twin verification by
ear.

## Testing

- **Unit**: every DSP unit golden-rendered against stored reference blocks
  on both platforms.
- **Twin agreement**: full patch renders web-vs-Swift within a tight epsilon
  — the flagship mirror test, stronger than any current Alloy guarantee.
- **Pack integrity**: loop-drift verifier in CI for every shipped pack.
- **Performance**: 64-voice render benchmark asserting the CPU envelope.

## Phasing

Each phase independently shippable:

1. **DSP core + hosts** — units, voice/layer mixer, worklet + source-node
   hosts, golden tests. Silent milestone: correct patch renders.
2. **Effects** — inserts + algorithmic reverb/delay/limiter.
3. **Pipeline + piano** — `tools/samplepack/`, Salamander-derived clean
   piano pack (tiny tier first), piano patch tuned in the workbench.
   First audible "fantastic" checkpoint.
4. **First wave** — FM EP, tine EP, strings/pads, organs; factory bank v1.
5. **AllyPiano migration** — patch voices in the app; legacy specs
   deprecated.
6. **GM buildout** — content-driven, tier by tier; budgets from the table
   above bind here.

## Non-goals

- Kontakt-style sampled realism, room tone, or player noise.
- React bindings, Linux, Windows (per platform scope).
- Resampling hardware ROMs for shipped content.
- User-facing synthesis-editing UI (patches are factory-authored data).
- MIDI file playback / sequencing — the engine plays notes; sequencing is an
  app concern.
