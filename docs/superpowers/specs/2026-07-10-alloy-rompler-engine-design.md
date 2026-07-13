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

The host owns a **sample-position transport clock** as the engine's master
timebase: all events (note on/off, patch changes, future clicks/one-shots)
are scheduled at absolute sample offsets, never wall-clock timers. This is
cheap to build in from day one and is the foundation the AllyMetronome and
AllyStation roadmap items stand on.

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

Schema headroom for the roadmap: `meta.category` distinguishes melodic vs
kit patches, and the versioned schema leaves room for later drum-kit
per-key maps and a fifth `model` generator kind without breaking changes.

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
   (Phase 1 complete: 1a units, 1b-i engine, 1b-ii hosts — patches render
   identically offline, in the worklet path, and in the source-node path.
   The 64-voice CPU benchmark is deferred to phase 2: its <25% envelope is
   defined "with full FX", which don't exist until the effects land.)
2. **Effects** — inserts + algorithmic reverb/delay/limiter. **Phase 2
   complete:** 2a + 2b landed all six inserts; 2c landed the FDN reverb
   and stereo/ping-pong delay send buses, the in-core lookahead master
   limiter (64-sample lookahead, true brickwall), the `MasterBus` wiring
   the patch's `sends` through them inside `PatchEngine`, and the 64-voice
   full-FX render benchmark (measured ~12% of one core in Swift release —
   well under the <25% envelope).
3. **Pipeline + piano** — `tools/samplepack/`, Salamander-derived clean
   piano pack (tiny tier first), piano patch tuned in the workbench.
   First audible "fantastic" checkpoint. Split into two halves:
   - **3a complete** — *the pack machine*: the offline pipeline (test-pack
     generator, autocorrelation loop finder + crossfade, velocity-layer
     assembler, AAC encode + loop-drift verifier, build-pack orchestrator
     emitting `manifest.json` + `CREDITS.md`), the twinned `PackManifest`
     schema, and the twinned runtime (`PackSource`, `SampleDecoder`, and a
     progressive `PackLoader` that IS a stateful `ZoneSetProvider`). Proven
     end to end against a generated pack; needed no engine change —
     progressive delivery + synth fallback fall out of the voice's existing
     "unresolvable zoneSetId = layer inactive" behavior. Design:
     `docs/superpowers/specs/2026-07-12-rompler-pack-pipeline-3a-design.md`.
   - **3b next** — the real Salamander-derived piano pack (download, select
     layers/keys, loop, polish, encode) run through the proven machine, plus
     the piano patch tuned by ear in the workbench.
4. **First wave** — FM EP, tine EP, strings/pads, organs; factory bank v1.
5. **AllyPiano migration** — patch voices in the app; legacy specs
   deprecated.
6. **GM buildout** — content-driven, tier by tier; budgets from the table
   above bind here.

## Roadmap (beyond the phased plan)

Direction after phase 6, recorded here so early design choices don't
foreclose it. Ordered roughly by dependency, not priority; none of it is in
scope for the current phases.

**Stereo voice bus.** The voice bus and `ToneGenerator.render` are mono by
design through phase 3 (samples play mono; stereo width comes from the stereo
master reverb). True stereo sample playback — the standard/HQ piano tiers'
recorded stereo image — requires a stereo `ToneGenerator.render`, a stereo
voice mixer, regenerated golden tests, and a revised `L === R` insert-free
invariant. It is its own phase and a prerequisite to the stereo tiers; the
tiny tier deliberately ships mono first (decided phase 3a).

**Drums at XV expansion-card level.** Polished studio drums in the same
Japanese-synth aesthetic — tight, processed, zero room noise, the SRX-style
"finished record" sound. Engine implications reserved in the patch schema
now: drum-kit patches (per-key zone/level/pan/tune maps), exclusive groups
(hi-hat choke), optional round-robin per key, and per-key insert sends.

**MIDI input from physical devices.** Web MIDI API on web, CoreMIDI on
Apple, feeding the existing note-on/off surface. Velocity curves per patch
already exist; add sustain/sostenuto pedal (CC64/66), pitch bend, and mod
wheel → LFO depth routing to the modulation set.

**MIDI file playback, then sequencing.** A Standard MIDI File player over
the engine (GM program → factory bank mapping comes free with `gmProgram`
in patch meta), later a sequencer. Both live above the engine as separate
libraries/apps — the engine's job stays note events in, audio out.

**MIDI over LAN/WiFi.** RTP-MIDI (Apple Network MIDI session) and/or
WebRTC data-channel transport so devices can drive the module remotely.

**AllyMetronome adoption — precision playback engine.** The engine becomes
AllyMetronome's sound source, which imposes its hardest real-time
requirement: metronome-grade timing. Concretely: a sample-accurate
transport clock owned by the DSP host (sample position is the master
timebase — never wall-clock timers), lookahead event scheduling so clicks
land on exact sample offsets regardless of main-thread jitter, drift-free
long-run playback, and a **precise one-shot player** for raw WAV/MP3
buffers (click sounds, count-ins) alongside patch voices. The current
design already schedules note events by sample timestamp; this item
hardens that path into a public, tested contract (clicks placed with zero
sample error over hours of runtime).

**AllyStation adoption — rhythm-game / DAW-level playback.** A potential
rhythm game raises the bar from "notes on time" to "audio is the game
clock": streamed backing-track playback whose sample position drives the
gameplay/visual timeline, low-latency one-shot SFX triggering through the
same precise player, and **latency calibration** — the engine reports
output latency (`AudioContext.outputLatency` / AVAudioSession IO latency)
and supports a user tap-calibration offset so judged input aligns with
what the player hears. Same engine, same transport clock; the game sits
above it exactly like the MIDI player does.

**Physical modeling engine.** A fifth generator kind (`model`) in the patch
schema: waveguide/modal models for plucked/struck/blown tones and
piano-resonance modeling (sympathetic strings, damper behavior) layered
under sampled pianos. The generator abstraction is designed so this slots
in without schema surgery.

**Desktop pro-audio: macOS/Windows standalones, ASIO, VST3/AU.** A
standalone module app and plugin builds (AU on macOS, VST3 + ASIO on
Windows) — the true Virtual Sound Canvas replacement, including a virtual
MIDI destination so any GM MIDI file player on the system can drive it.
This is the one roadmap item that breaks the current two-platform scope:
plugins and Windows need a third, native rendition of the DSP core
(C++ or Rust, likely JUCE-hosted) sharing the same numeric contract and
golden-render fixtures. That is an explicit future scope decision to be
made when we get there — the determinism-first core design is what makes a
third rendition feasible at all.

### Long-term vision: DAW-level MIDI/audio recording

Not in the short- or mid-term plan, but the system is designed knowing this
may come. The end of this road is a DAW-class environment: multi-track MIDI
recording against the transport clock, audio recording (mic/line input),
sample-accurate punch-in/out, and mixdown.

What today's design must (and does) keep true so this stays reachable:

- **One master timebase.** The sample-position transport clock is the
  timeline for everything — playback, future recording, punch points. No
  second clock is ever introduced.
- **Deterministic offline rendering.** Because the DSP core is pure and
  deterministic, the same engine can render faster than real time — bounce,
  freeze, and export come almost free later.
- **Symmetric audio path.** The host boundary is designed as pull-based
  block I/O; adding an *input* stream (worklet input / AVAudioSourceNode's
  sibling sink) is an extension of the host, not a core redesign.
- **Events as data.** Note events are already timestamped values crossing a
  port — a MIDI recording is just capturing that stream; playback of a
  recording replays it. No engine change, only a store above it.
- **Mixer growth path.** The per-patch channel → sends → master structure
  is a mixing console in miniature; tracks later map onto channels without
  reshaping the graph.

The rule this imposes on every intermediate phase: never design an API that
assumes real-time-only, output-only, single-consumer audio.

- Kontakt-style sampled realism, room tone, or player noise.
- React bindings and Linux (per platform scope). Windows appears only as
  the desktop/plugin roadmap item above, not in the engine phases.
- Resampling hardware ROMs for shipped content.
- User-facing synthesis-editing UI (patches are factory-authored data).
- MIDI playback/sequencing inside the engine itself — roadmap items build
  these above the engine; the engine plays note events.
