# Rompler Phase 3b — Salamander Piano, Tiny Tier (Design)

Second half of phase 3 (founding spec:
`docs/superpowers/specs/2026-07-10-alloy-rompler-engine-design.md`). Phase 3a
built and proved *the pack machine*
(`docs/superpowers/specs/2026-07-12-rompler-pack-pipeline-3a-design.md`); 3b
runs real content through it.

## Goal

The first audible "fantastic" checkpoint: a **Salamander-derived tiny-tier
piano pack** built by the proven pipeline, loadable on both platforms, playable
in the workbench, and tuned by ear.

## Source

**Salamander Grand Piano V3**, Alexander Holm — **CC-BY 3.0**.
`SalamanderGrandPianoV3+20161209_48khz24bit.tar.xz` (1.2 GB, 48 kHz / 24-bit —
native 48 kHz matches the engine, no extra resample; 24-bit gives headroom for
the polish pass).

Verified archive contents:

- **480 note samples** = **30 roots × 16 velocity layers**, named
  `{Note}{Octave}v{1..16}.wav` (e.g. `A0v10.wav`, `D#5v2.wav`).
- The 30 roots are `A0, C1, D#1, F#1, A1, … C8` — every **3 semitones**
  (MIDI 21, 24, 27 … 108). Max pitch-shift at playback is therefore
  **±1.5 semitones**, which is well inside transparent range.
- `SalamanderGrandPianoV3.sfz` — the authoritative key/velocity mapping, used
  to cross-check the filename-derived mapping.
- **Excluded:** 88 `rel*.wav` (key-off/release samples) and 69 `harm*.wav`
  (sympathetic-resonance harmonics). The engine has no release-sample or
  sympathetic-resonance support, so these are out of scope for the tiny tier.
  They are a natural fit for a future HQ tier and are **not** a 3b deliverable.

**Attribution is a license obligation, not a nicety.** CC-BY 3.0 requires
crediting Alexander Holm. The pipeline's generated `CREDITS.md` (already
emitted by 3a's `build-pack`) must carry the attribution, the license name, and
the source URL, and it ships inside the pack.

## Decisions (locked)

- **One-shot, not looped.** Piano decay is inharmonic and non-steady; looping it
  produces the static, buzzy "cheap ROMpler piano" this project explicitly
  rejects. Zones omit `loopStart`/`loopEnd` — already supported by the manifest,
  and by `SampleZoneGenerator` (`noteOff` is a no-op; unlooped content rings out
  and the voice TVA owns key-up). 3a's `findLoop` simply goes **unused** for
  piano; it remains for the looped instruments of phase 4 (strings/pads/organs).
  Going one-shot also sidesteps the 3a-flagged integer-lag phase residual in
  `findLoop` entirely for this pack.
- **Tiny-tier budget — "balanced":** all **30 roots × 4 velocity layers**, each
  truncated to **≤ 12 s**, **mono AAC @ 128 kbps**. Estimated **~23 MB** — well
  under the 100 MB tiny-tier ceiling. The budget is not the binding constraint
  here; quality is, so the headroom is spent on velocity layers and decay length
  rather than hoarded.
- **Mono.** Per 3a, the voice bus is mono; Salamander's stereo sources are
  downmixed. Stereo width comes from the stereo master reverb. (A stereo voice
  bus is its own roadmap phase and gates the future stereo tiers.)
- **The pack is a build artifact, never committed.** Binary packs do not belong
  in the library repo. `build-pack` writes to a gitignored output directory; the
  workbench serves it locally. Publishing it as a GitHub Release asset — the
  hosting seam the founding spec calls for, and the pattern `tools/release.mjs`
  already uses for npm tarballs — is a separate, deliberate step, not part of 3b.
- **Patch: pure-sampled first.** The first pass is sampled layers only, so we
  are judging the samples and the pipeline honestly. The quiet `va`
  body-resonance layer from the founding spec's first-wave mapping is a
  *second* tuning pass, once the raw pack's character is known.

## Architecture

### 1. Swift `AVAudioFileDecoder` (prerequisite)

3a shipped only the `SampleDecoder` **protocol** plus test fakes on Swift — the
Swift side literally cannot decode a real pack today. 3b wires a concrete
`AVAudioFile`-backed decoder (adapting the existing decode path in
`BundleSampleSource.swift`), downmixing to mono, conforming to the existing
`SampleDecoder` protocol. Web already has `WebAudioDecoder`. This lives at the
host edge — **no AVFoundation in the DSP core**, and it is fake-able so the
twin tests stay offline and deterministic.

### 2. Pipeline: a real polish stage (`tools/samplepack/`, web-only Node)

3a's pipeline loops; piano does not. New pure, unit-tested cores (each a small
function + a thin CLI, matching the established `.mjs` + `node:test` pattern):

- **`ingest`** — read a source WAV (24-bit), downmix stereo → mono, and parse
  `{Note}{Octave}v{N}` → `{ rootMidi, velocityIndex }`. Cross-check the derived
  root map against the `.sfz`.
- **`trim`** — strip leading silence to the true attack, using an amplitude
  threshold with a small **lookback** so the transient is never clipped (a
  clipped piano attack is instantly audible).
- **`truncate-fade`** — cap at the max length (12 s) and bake an equal-power
  **fade-out** tail, so a one-shot ends in silence rather than a click. This is
  what makes one-shots viable at tiny-tier size.
- **`select`** — keep all 30 roots; map Salamander's 16 velocity layers → 4
  bands by taking the **quartile representatives `v4, v8, v12, v16`** (ascending,
  evenly spaced across the source's dynamic range), assigned `layerIndex` 0–3 and
  `topVelocity` `[0.25, 0.5, 0.75, 1.0]`. Which four indices sound best is itself
  a tuning parameter — the selection is a single config constant precisely so a
  listening pass can change it cheaply and rebuild.

Reused unchanged from 3a: peak-normalize (`layer-assembler`), AAC encode +
loop-drift verify (`encode-verify`), manifest + CREDITS emission
(`build-pack`). One-shot zones omit loop fields, which `validateManifest`
already accepts (`loopStart`/`loopEnd` are both-or-neither).

### 3. The pack

`piano-tiny`: `zoneSetId: "piano"`, 4 layers × 30 zones, mono AAC 128 kbps,
`schemaVersion` 1, `tier: "tiny"`, `sampleRate` 48000, `format: "m4a"`, and a
`credits` entry carrying the CC-BY 3.0 attribution to Alexander Holm.

### 4. The piano patch + workbench audition

A `piano` patch per the founding spec's first-wave mapping, first pass
**pure-sampled**: the sampled velocity layers, **velocity → cutoff** for
brightness (harder strikes open up), and a **TVA decay matched to the
truncation** so the envelope reaches silence at or before the sample ends (no
audible cut-off on held notes). The workbench (`examples/web-harness`) gains a
pack-loading path so the pack can actually be played and judged.

## Testing — and its honest limit

Automatically verifiable (and required):

- Pipeline cores unit-tested (`trim` never clips the attack; `truncate-fade`
  ends at true zero; `ingest` parses every one of the 480 filenames correctly
  and maps roots to the expected MIDI numbers).
- The built pack's `manifest.json` passes `validateManifest`, and `PackLoader`
  resolves it on **both** platforms (the 3a tool↔runtime contract, now against
  real content).
- A rendered note is non-silent, **deterministic**, does not clip (peak ≤
  ceiling), and has no discontinuity at the sample's end (the fade works).
- The Swift `AVAudioFileDecoder` decodes a real pack zone and agrees with the
  web decoder on duration and sample rate.

**Not automatically verifiable:** whether it *sounds fantastic*. That is the
actual goal of this phase and it is a listening judgement — the user's ear is
the gate. Expect one or more tuning iterations (velocity-band choice, TVA decay,
velocity→cutoff depth, master reverb amount). This is the first phase of the
project where the review loop is necessary but **not sufficient**, and the plan
should say so plainly rather than pretend a green test suite means success.

## Out of scope (3b)

- Release samples (`rel*`) and sympathetic-resonance harmonics (`harm*`) — no
  engine support; future HQ tier.
- Standard/HQ tiers; stereo sample playback (roadmap: stereo voice bus).
- Publishing the pack as a release asset / CDN hosting (separate deliberate
  step behind the existing `PackSource` seam).
- The `va` body-resonance layer (second tuning pass, after the raw pack is
  judged).
- Phase 4's first wave (FM EP, tine EP, strings/pads, organs).
