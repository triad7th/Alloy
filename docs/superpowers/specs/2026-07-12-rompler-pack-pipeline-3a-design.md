# Rompler Phase 3a — Pack Pipeline & Runtime Loading (Design)

Sub-project of the rompler engine (founding spec:
`docs/superpowers/specs/2026-07-10-alloy-rompler-engine-design.md`, §Content
pipeline + §Phasing item 3). Phase 2 (effects) is complete; this is the first
half of phase 3.

## Goal

Build and prove **the pack machine** end to end: the offline content pipeline
(`tools/samplepack/`), the pack **manifest** schema, and the runtime pack
**loader** (`PackSource` seam, zone resolution, progressive delivery) — all
verified against a small **procedurally-generated test pack**, with zero
dependency on external sample assets. The real Salamander-derived piano pack
and by-ear patch tuning are deliberately deferred to **phase 3b**, which feeds
real samples through this proven machine.

## Why split 3a / 3b

Phase 3 as specced ("Pipeline + piano") is two subsystems with different
natures:

- **The machine (3a)** — pure code: offline Node tooling + a twinned runtime
  loader. Deterministic, twin-testable, reviewable in the same regime as
  phases 1–2. A generated test pack exercises every stage without a multi-GB
  download or subjective judgement.
- **The content (3b)** — the real Salamander Grand Piano: download → select
  layers/keys → loop → polish → AAC-encode → manifest, then tune the piano
  patch by ear in the workbench. Real assets, listening activity — not
  something a code-review loop verifies.

Building the machine first de-risks the content pass: 3b becomes "run the
proven pipeline on real input and tune," not "invent pipeline + loader +
content at once."

## Scope decisions (locked)

- **Mono voice bus.** The tiny-tier pack plays **mono**: sample zones render
  through the existing mono `ToneGenerator.render(out, frames)` path; stereo
  width comes from the stereo master reverb downstream. Making sample zones
  stereo would require changing `ToneGenerator` to stereo across every
  generator, the voice mixer, and the golden tests, and would break the
  established mono-voice-bus `L === R` invariant — that is a separate future
  effort (see Roadmap note below), **out of 3a and 3b scope**. A mono dry
  piano through the stereo master reverb is a strong first "fantastic"
  checkpoint.
- **Encoder: `afconvert`, `ffmpeg` fallback.** Prefer macOS-native
  `afconvert` (best AAC, matches the Apple native-decode path); fall back to
  `ffmpeg` where `afconvert` is absent. Format is AAC in an `.m4a` container
  (both platforms decode natively), with encoder-delay compensation so loop
  points stay sample-accurate after decode.
- **Tools are web-only build tooling, no Swift twin.** `tools/samplepack/*`
  are offline Node `.mjs` scripts, same category as `tools/generate-tokens.mjs`
  and `tools/release.mjs`. Only the *runtime* loader + manifest resolution are
  twinned (they feed the engine).

## Architecture

### 1. Pipeline tools (`tools/samplepack/`, offline Node `.mjs`)

Each stage is a standalone script with a small pure core (testable via
Vitest) and a thin CLI wrapper:

- **`gen-test-pack.mjs`** — synthesizes a tiny **deterministic** source pack:
  a few keys (e.g. C2/C3/C4/C5 roots) × 2 velocity layers of short harmonic
  tones (summed sines, fixed seed-free formula) as mono WAVs with a clean
  sustained loop region. This is the pipeline's test fixture — real input
  without a download. Deterministic so twin/round-trip tests are stable.
- **`loop-finder.mjs`** — autocorrelation loop-point search over a sustain
  window + equal-power crossfade bake into the looped region. Emits
  `{ loopStart, loopEnd }` in samples plus the crossfaded WAV. Pure core:
  `findLoop(samples, sampleRate) → { loopStart, loopEnd, score }`.
- **`layer-assembler.mjs`** — groups source files into zone sets, assigns
  `topVelocity` bands, peak-normalizes each layer to a target, records
  per-zone `gain`/`tuneCents`. Pure core: `assembleLayers(files, config) →
  ZoneSetSpec`.
- **`encode-verify.mjs`** — encodes each WAV to `.m4a` (afconvert→ffmpeg),
  then **decodes it back and verifies the loop region did not drift** beyond a
  sample tolerance (encoder-delay compensation applied); **rejects the pack**
  if any file drifts. This is the spec's pack-integrity gate. Pure core for
  the drift math: `loopDrift(originalLoop, decodedOffset) → samples`.
- **`build-pack.mjs`** — orchestrates gen→loop→assemble→encode→verify, writes
  the pack directory (`<packDir>/*.m4a`), `manifest.json`, and an
  auto-generated `CREDITS.md` (CC-BY attribution rows from a source-credits
  config). Exit non-zero on any verifier rejection.

### 2. Manifest schema (shared contract, JSON)

```
PackManifest {
  schemaVersion: number            // pack schema, independent of PATCH_SCHEMA_VERSION
  id: string                       // stable pack id, e.g. "piano-tiny"
  tier: "tiny" | "standard" | "hq"
  sampleRate: number               // decoded sample rate the zones assume
  format: "m4a"
  zoneSets: {
    [zoneSetId: string]: {
      layers: Array<{
        topVelocity: number        // inclusive upper vel bound, 0..1, ascending
        zones: Array<{
          rootMidi: number
          keyLow: number           // inclusive MIDI range this zone covers
          keyHigh: number
          file: string             // relative .m4a path within the pack
          loopStart?: number       // samples; omit for one-shots
          loopEnd?: number
          gain: number             // linear, applied at load
          tuneCents: number        // fine-tune correction, applied to root
        }>
      }>
    }
  }
  credits: Array<{ source: string; license: string; url?: string }>
}
```

Patches reference zones by stable `zoneSetId`; the identical patch bank
resolves against whichever tier pack is installed (tiers differ in file
contents/size, not in zoneSetIds).

### 3. Runtime loading (twinned)

- **`PackSource`** (twin interface) — abstracts byte origin so apps choose
  bundled asset / CDN URL / GitHub release asset:
  - `fetchManifest(): Promise<PackManifest>` (Swift: `async throws`)
  - `fetchZone(file: string): Promise<EncodedBytes>` (Swift: `Data`)
  Concrete impls per platform: a URL/base-path source (web `fetch`, Swift
  `URLSession`) and a bundled-asset source (web asset path, Swift `Bundle`).
  3a ships the base-path/URL source; a test/in-memory source drives the
  round-trip tests.
- **`PackLoader`** — orchestrates progressive load and **is a stateful
  `ZoneSetProvider`**:
  - `load(): Promise<void>` — fetch manifest, then fetch + **decode** each
    zone's `.m4a` into `SampleZoneData` (web: `decodeAudioData` behind the
    existing `Minimal*` context seam; Swift: `AVAudioFile`), applying
    `gain`/`tuneCents`/loop points; populate an internal
    `zoneSetId → VelocityLayerData[]` map as each zone set completes.
  - `provide(zoneSetId): VelocityLayerData[] | null` — the `ZoneSetProvider`
    function. Returns `null` until that zone set is fully decoded, then the
    concrete layers.
  **Progressive delivery + synth fallback fall out of the existing engine:**
  `voice.ts` already treats a `null` provider result as "layer inactive —
  progressive-loading, not an error" (`voice.ts:90,190`). A patch that pairs
  a sample layer with a quiet synth body layer plays the synth alone until the
  sample zone decodes, then both — no engine change needed.

### Decode seam (no WebAudio/AVFoundation in the DSP core)

Decoding is I/O at the host edge, not DSP-core code. Web decode goes through a
minimal injected context (same pattern as `MinimalWorkletContext`), so the
loader's pure logic (manifest parsing, zone-map assembly, `SampleZoneData`
construction from decoded PCM) is unit-testable with injected fake PCM. Swift
decode uses `AVAudioFile` behind a small protocol the tests fake.

## Testing

- **Pipeline unit tests (web):** `findLoop`, `assembleLayers`, `loopDrift`,
  and manifest emission each tested on the generated test pack's deterministic
  input.
- **Loop-drift verifier (web):** encode→decode the test pack, assert every
  loop point is within tolerance — the spec's CI pack-integrity gate, run
  against real `afconvert`/`ffmpeg` output.
- **Round-trip twin test (both platforms):** load the generated test pack
  through `PackLoader` (from a fake in-memory/base-path `PackSource` with
  pre-decoded PCM so the test is deterministic and offline), resolve a
  `zoneSetId`, render a note through `PatchEngine` with the loader as the
  `ZoneSetProvider`, assert non-silence during sustain, determinism across
  repeat renders, and twin agreement on the manifest→`SampleZoneData`
  resolution (same zone counts, roots, loop points, gains on both platforms).
- **Progressive-delivery test:** before `load()` completes, `provide()`
  returns `null` and a sample-only layer is silent; after, it renders — mirror
  on both platforms.

## Out of scope (3a)

- The real Salamander pack, AAC-encoding real recordings, and by-ear patch
  tuning → **3b**.
- Stereo sample playback / stereo voice bus → **roadmap** (below).
- Standard/HQ tiers, CDN/release-asset hosting wiring, on-device pack caching
  eviction → later.
- Per-patch arbitrary FX, user FX UI (already out of scope per founding spec).

## Roadmap note (to add to the founding spec)

**Stereo voice bus.** The voice bus and `ToneGenerator` are mono by design
through phase 3; stereo sample playback (and any stereo generator) requires a
stereo `ToneGenerator.render`, a stereo voice mixer, regenerated golden
tests, and a revised `L === R` insert-free invariant. This is its own phase,
prerequisite to the standard/HQ stereo piano tiers.
