# Rompler Phase 3a — Pack Pipeline & Runtime Loading Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build and prove *the pack machine* — the offline `tools/samplepack/` pipeline, the `PackManifest` schema, and the twinned `PackSource`/`PackLoader` runtime — end to end against a procedurally-generated test pack, with no external sample assets.

**Architecture:** Offline Node `.mjs` tools (web-only build tooling, no Swift twin — same category as `tools/generate-tokens.mjs`) generate a deterministic test pack, find loops, assemble velocity layers, AAC-encode + loop-drift-verify, and emit a pack dir + `manifest.json` + `CREDITS.md`. At runtime, a twinned `PackLoader` fetches (via a `PackSource` seam) and decodes (via a `SampleDecoder` seam) the pack into the existing `SampleZoneData`, and *is* a stateful `ZoneSetProvider` returning `null` until a zone set decodes — so the engine's existing progressive-loading null-handling gives progressive delivery + synth fallback for free.

**Tech Stack:** Node `.mjs` + `node:test` for tools (afconvert/ffmpeg for AAC); TypeScript (`web/packages/alloy-audio`, canonical) + Swift twin (`swift/Sources/AlloyAudio`) + Vitest/XCTest for the runtime.

## Global Constraints

- **Mono voice bus.** Sample zones render mono through the existing `ToneGenerator.render(out, frames)`; the loader must NOT change `SampleZoneGenerator`, `SampleZoneData`, `VelocityLayerData`, or `ToneGenerator` (touching them would disturb the golden sample twin test and the `L === R` invariant). Fold `gain` into the PCM and `tuneCents` into a fractional `rootMidi`. Stereo sample playback is out of scope (roadmap).
- **Determinism.** The generated test pack uses a fixed harmonic formula — no PRNG, no `Date`/`Math.random`. Runtime twin tests use a fake in-memory `PackSource` + fake `SampleDecoder` returning known PCM, so twin agreement is bit-comparable (1e-6) and offline. Real `.m4a` decode (non-deterministic across platforms) is exercised ONLY by the web-side loop-drift verifier, never by a twin assertion.
- **Mirrored twins, web canonical.** The runtime (`manifest`, `PackSource`, `SampleDecoder`, `PackLoader`) ships TS + Swift in the same change set with identical shapes; Swift internals compute in `Double`, PCM buffers are `[Float]`. Binding contract: `docs/mirroring.md`. The `tools/samplepack/` scripts are web-only build tooling — no Swift twin.
- **No WebAudio/AVFoundation in the DSP core.** Decode is I/O at the host edge behind the `SampleDecoder` seam (web: injected `decodeAudioData`; Swift: `AVAudioFile` behind a protocol), never imported into DSP-core files. Fetch is behind `PackSource` with an injected `fetchFn` (mirror the storage package's injected-fetch pattern).
- **Encoder: `afconvert` preferred, `ffmpeg` fallback** for encode; `ffmpeg` for decode-to-WAV in the verifier. Both are present in the dev environment. A tool step that shells out must fail loudly (non-zero exit) if neither binary is found.
- **Manifest is the shared contract.** `zoneSets[zoneSetId]` keys are what patches reference; tiers differ in file contents, not zoneSetIds. `PACK_SCHEMA_VERSION` is independent of `PATCH_SCHEMA_VERSION`.
- **Commit style:** conventional commits, imperative subject ≤ 72 chars.

---

## File Structure

- `web/packages/alloy-audio/src/pack/manifest.ts` (+ `.spec.ts`) — `PackManifest` types + `validateManifest`.
- `web/packages/alloy-audio/src/pack/pack-source.ts` (+ `.spec.ts`) — `EncodedBytes`, `PackSource`, `BasePathPackSource`, `SampleDecoder`, `DecodedPcm`, `WebAudioDecoder` seam.
- `web/packages/alloy-audio/src/pack/pack-loader.ts` (+ `.spec.ts`) — `PackLoader` (stateful `ZoneSetProvider`).
- `web/packages/alloy-audio/src/index.ts` — re-export the pack surface.
- `swift/Sources/AlloyAudio/Pack/PackManifest.swift`, `PackSource.swift`, `SampleDecoder.swift`, `PackLoader.swift` + `swift/Tests/AlloyAudioTests/PackManifestTests.swift`, `PackLoaderTests.swift`.
- `tools/samplepack/wav.mjs` (+ `wav.test.mjs`) — mono 16-bit WAV read/write.
- `tools/samplepack/gen-test-pack.mjs` (+ `.test.mjs`) — deterministic source generator.
- `tools/samplepack/loop-finder.mjs` (+ `.test.mjs`) — autocorrelation loop search + crossfade.
- `tools/samplepack/layer-assembler.mjs` (+ `.test.mjs`) — velocity-layer grouping + normalization.
- `tools/samplepack/encode-verify.mjs` (+ `.test.mjs`) — AAC encode + measure-offset + loop-drift verify.
- `tools/samplepack/build-pack.mjs` (+ `.test.mjs`) — orchestrator; writes pack dir + manifest.json + CREDITS.md.
- `tools/samplepack/README.md` — how to run the pipeline.

Tool tests run with `node --test tools/samplepack/*.test.mjs` (use the glob, NOT the bare directory — on Node 25 `node --test <dir>` tries to load the directory as a module and errors). Runtime tests: `cd web && npm test -- pack` (alloy-audio Vitest) and `cd swift && swift test --filter Pack`.

---

### Task 1: Pack manifest schema + validation (twin)

**Files:**
- Create: `web/packages/alloy-audio/src/pack/manifest.ts`, `web/packages/alloy-audio/src/pack/manifest.spec.ts`
- Create: `swift/Sources/AlloyAudio/Pack/PackManifest.swift`, `swift/Tests/AlloyAudioTests/PackManifestTests.swift`

**Interfaces:**
- Produces: the types + `PACK_SCHEMA_VERSION` + `validateManifest(m): string[]` that every later task consumes.

- [ ] **Step 1: Write `manifest.ts` in full.**

```ts
// Pack manifest: the shared contract between the offline samplepack pipeline
// and the runtime PackLoader. Pure data (JSON), non-throwing validation.
// zoneSets[zoneSetId] keys are what patches reference; tiers differ in file
// contents, not zoneSetIds. Twin: PackManifest.swift.

export const PACK_SCHEMA_VERSION = 1;

export type PackTier = 'tiny' | 'standard' | 'hq';

export interface ZoneSpec {
  /** Original pitch of the recording, MIDI note. */
  rootMidi: number;
  /** Relative .m4a path within the pack directory. */
  file: string;
  /** Loop region [loopStart, loopEnd) in samples; omit for one-shots. */
  loopStart?: number;
  loopEnd?: number;
  /** Linear gain applied to the decoded PCM at load. */
  gain: number;
  /** Fine-tune added to the effective root at load (positive raises the
   *  effective root, i.e. plays the sample lower). Correction for recordings
   *  slightly off pitch. */
  tuneCents: number;
}

export interface LayerSpec {
  /** Inclusive upper velocity bound, 0..1; layers sorted ascending. */
  topVelocity: number;
  zones: ZoneSpec[];
}

export interface ZoneSetSpec {
  layers: LayerSpec[];
}

export interface CreditEntry {
  source: string;
  license: string;
  url?: string;
}

export interface PackManifest {
  schemaVersion: number;
  id: string;
  tier: PackTier;
  /** Sample rate the decoded zones assume. */
  sampleRate: number;
  format: 'm4a';
  zoneSets: Record<string, ZoneSetSpec>;
  credits: CreditEntry[];
}

/** Non-throwing; empty = safe to load. */
export function validateManifest(m: PackManifest): string[] {
  const e: string[] = [];
  if (m.schemaVersion !== PACK_SCHEMA_VERSION) {
    e.push(`schemaVersion ${m.schemaVersion} !== ${PACK_SCHEMA_VERSION}`);
  }
  if (m.id.length === 0) e.push('id must be non-empty');
  if (m.tier !== 'tiny' && m.tier !== 'standard' && m.tier !== 'hq') {
    e.push(`tier '${(m as { tier: string }).tier}' must be tiny|standard|hq`);
  }
  if (!(m.sampleRate > 0)) e.push(`sampleRate ${m.sampleRate} must be > 0`);
  if (m.format !== 'm4a') e.push(`format '${(m as { format: string }).format}' must be 'm4a'`);
  const zoneSetIds = Object.keys(m.zoneSets);
  if (zoneSetIds.length === 0) e.push('at least one zoneSet required');
  for (const id of zoneSetIds) {
    const prefix = `zoneSet '${id}': `;
    const { layers } = m.zoneSets[id];
    if (layers.length === 0) e.push(`${prefix}at least one layer required`);
    let prevTop = -Infinity;
    layers.forEach((layer, li) => {
      const lp = `${prefix}layer ${li + 1}: `;
      if (!(layer.topVelocity > 0 && layer.topVelocity <= 1)) {
        e.push(`${lp}topVelocity ${layer.topVelocity} outside (0, 1]`);
      }
      if (layer.topVelocity <= prevTop) e.push(`${lp}topVelocity ${layer.topVelocity} not strictly ascending`);
      prevTop = layer.topVelocity;
      if (layer.zones.length === 0) e.push(`${lp}at least one zone required`);
      layer.zones.forEach((z, zi) => {
        const zp = `${lp}zone ${zi + 1}: `;
        if (!(z.rootMidi >= 0 && z.rootMidi <= 127)) e.push(`${zp}rootMidi ${z.rootMidi} outside [0, 127]`);
        if (z.file.length === 0) e.push(`${zp}file must be non-empty`);
        if (!(z.gain > 0)) e.push(`${zp}gain ${z.gain} must be > 0`);
        const hasStart = z.loopStart !== undefined;
        const hasEnd = z.loopEnd !== undefined;
        if (hasStart !== hasEnd) e.push(`${zp}loopStart/loopEnd must both be set or both omitted`);
        if (hasStart && hasEnd && !(z.loopStart! >= 0 && z.loopStart! < z.loopEnd!)) {
          e.push(`${zp}loop ${z.loopStart}..${z.loopEnd} invalid`);
        }
      });
    });
  }
  return e;
}
```

- [ ] **Step 2: Write `manifest.spec.ts`** — a `goodManifest()` helper returning a valid one-zoneSet, two-layer manifest; assert `validateManifest(goodManifest())` is `[]`; then one rejecting case per rule (wrong schemaVersion, empty id, bad tier, sampleRate 0, non-`m4a` format, empty zoneSets, empty layers, non-ascending topVelocity, empty zones, rootMidi 200, empty file, gain 0, half-specified loop, inverted loop). Each asserts `.not.toHaveLength(0)`. Add a JSON round-trip pin: `JSON.parse(JSON.stringify(goodManifest()))` validates clean.

- [ ] **Step 3: Mirror `PackManifest.swift`** — `Codable` structs `ZoneSpec` (optional `loopStart`/`loopEnd` via `decodeIfPresent`), `LayerSpec`, `ZoneSetSpec`, `CreditEntry`, `PackManifest`; `enum PackTier: String, Codable` (`tiny`/`standard`/`hq`); `packSchemaVersion` constant; `func validateManifest(_:) -> [String]` mirroring every rule. `zoneSets` is a `[String: ZoneSetSpec]`. Add `Sendable` where a global/`let` needs it (mirror the 2c EffectTypes precedent).

- [ ] **Step 4: Write `PackManifestTests.swift`** — the same accept + reject-per-rule cases, plus a `Data`→`JSONDecoder` round-trip on a manifest JSON string that must decode and validate clean.

- [ ] **Step 5: Build both.** `cd web && npm test -- manifest` green; `cd swift && swift build && swift test --filter PackManifest` green. **Commit:** `feat(audio): add pack manifest schema and validation (twin)`

---

### Task 2: WAV I/O + deterministic test-pack generator (tools)

**Files:**
- Create: `tools/samplepack/wav.mjs`, `tools/samplepack/wav.test.mjs`
- Create: `tools/samplepack/gen-test-pack.mjs`, `tools/samplepack/gen-test-pack.test.mjs`

**Interfaces:**
- Produces: `writeWavMono(samples, sampleRate) → Buffer`, `readWavMono(buffer) → { sampleRate, samples }`; `genTestPack(config) → { sources, credits }` where each source is `{ name, rootMidi, velocity, sampleRate, samples }`.

- [ ] **Step 1: Write `wav.mjs`** (mono 16-bit PCM).

```js
// Minimal mono 16-bit PCM WAV read/write for the samplepack pipeline.
export function writeWavMono(samples, sampleRate) {
  const n = samples.length;
  const data = Buffer.alloc(n * 2);
  for (let i = 0; i < n; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    data.writeInt16LE((s < 0 ? s * 32768 : s * 32767) | 0, i * 2);
  }
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(1, 22); // mono
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28); // byte rate
  header.writeUInt16LE(2, 32); // block align
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}

export function readWavMono(buffer) {
  if (buffer.toString('ascii', 0, 4) !== 'RIFF' || buffer.toString('ascii', 8, 12) !== 'WAVE') {
    throw new Error('not a RIFF/WAVE file');
  }
  const sampleRate = buffer.readUInt32LE(24);
  const channels = buffer.readUInt16LE(22);
  // Find the 'data' chunk (skip any chunks between fmt and data).
  let offset = 12;
  let dataOffset = -1;
  let dataLen = 0;
  while (offset + 8 <= buffer.length) {
    const id = buffer.toString('ascii', offset, offset + 4);
    const size = buffer.readUInt32LE(offset + 4);
    if (id === 'data') {
      dataOffset = offset + 8;
      dataLen = size;
      break;
    }
    offset += 8 + size + (size & 1);
  }
  if (dataOffset < 0) throw new Error('no data chunk');
  const frames = Math.floor(dataLen / 2 / channels);
  const samples = new Float32Array(frames);
  for (let i = 0; i < frames; i++) {
    // Downmix to mono by averaging channels.
    let acc = 0;
    for (let c = 0; c < channels; c++) acc += buffer.readInt16LE(dataOffset + (i * channels + c) * 2) / 32768;
    samples[i] = acc / channels;
  }
  return { sampleRate, samples };
}
```

- [ ] **Step 2: Write `wav.test.mjs`** (`node:test`): round-trip a known Float32Array (a few hundred samples of a sine) through write→read; assert the read-back matches within 1/32768 tolerance and `sampleRate` preserved. Assert `readWavMono` throws on a non-RIFF buffer.

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeWavMono, readWavMono } from './wav.mjs';
// ... round-trip + throws tests ...
```

- [ ] **Step 3: Write `gen-test-pack.mjs`.** Pure `genTestPack(config)` builds deterministic harmonic tones; a CLI writes each as a WAV plus a `sources.json` index.

```js
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { writeWavMono } from './wav.mjs';

const DEFAULT_CONFIG = {
  sampleRate: 48000,
  roots: [36, 48, 60, 72], // C2..C5
  velocities: [0.4, 0.9], // two layers: soft, hard (topVelocity bands 0.6, 1.0)
  durationSec: 1.5,
};

function midiToHz(m) {
  return 440 * 2 ** ((m - 69) / 12);
}

/** Deterministic decaying-harmonic tone with a short attack and a long steady
 *  sustain (so the loop finder has a clean periodic region). No randomness. */
function renderTone(rootMidi, velocity, sampleRate, durationSec) {
  const n = Math.round(sampleRate * durationSec);
  const freq = midiToHz(rootMidi);
  const out = new Float32Array(n);
  const attack = Math.round(sampleRate * 0.01);
  for (let i = 0; i < n; i++) {
    const t = i / sampleRate;
    let s = 0;
    for (let h = 1; h <= 5; h++) s += (1 / h) * Math.sin(2 * Math.PI * freq * h * t);
    const env = i < attack ? i / attack : 1; // attack then flat sustain (steady loop region)
    out[i] = 0.2 * env * (0.4 + 0.6 * velocity) * s;
  }
  return out;
}

export function genTestPack(config = DEFAULT_CONFIG) {
  const { sampleRate, roots, velocities, durationSec } = config;
  const sources = [];
  for (const root of roots) {
    velocities.forEach((vel, vi) => {
      sources.push({
        name: `zone_${root}_v${vi}.wav`,
        rootMidi: root,
        velocity: vel,
        layerIndex: vi,
        sampleRate,
        samples: renderTone(root, vel, sampleRate, durationSec),
      });
    });
  }
  const credits = [{ source: 'Alloy generated test pack (procedural harmonics)', license: 'CC0' }];
  return { sources, credits, sampleRate, velocities };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const outDir = process.argv[2] ?? 'build/test-pack-src';
  mkdirSync(outDir, { recursive: true });
  const pack = genTestPack();
  const index = pack.sources.map(({ samples, ...meta }) => meta);
  for (const src of pack.sources) writeFileSync(join(outDir, src.name), writeWavMono(src.samples, src.sampleRate));
  writeFileSync(join(outDir, 'sources.json'), JSON.stringify({ ...pack, sources: index }, null, 2));
  console.log(`wrote ${pack.sources.length} source WAVs + sources.json to ${outDir}`);
}
```

- [ ] **Step 4: Write `gen-test-pack.test.mjs`**: `genTestPack()` returns `roots.length * velocities.length` sources (8); it's deterministic (two calls → identical samples for source 0, checked element-wise on the first 100); each tone is non-silent (RMS of the sustain half > 0.01); the mid-sustain region is periodic (sample at index k ≈ sample at index k + round(sampleRate/freq) within 0.02 for root 60).

- [ ] **Step 5: Run.** `node --test tools/samplepack/wav.test.mjs tools/samplepack/gen-test-pack.test.mjs` green. **Commit:** `feat(samplepack): add mono WAV io and deterministic test-pack generator`

---

### Task 3: Loop finder + crossfade bake (tools)

**Files:**
- Create: `tools/samplepack/loop-finder.mjs`, `tools/samplepack/loop-finder.test.mjs`

**Interfaces:**
- Consumes: source samples from Task 2.
- Produces: `findLoop(samples, sampleRate, opts) → { loopStart, loopEnd, score }`; `bakeCrossfade(samples, loopStart, loopEnd, fadeLen) → Float32Array`.

- [ ] **Step 1: Write `loop-finder.mjs`.**

```js
// Autocorrelation loop-point search over a steady sustain window, plus an
// equal-power crossfade bake so the loop wrap is seamless.

/** Find the best single-period loop lag in [sampleRate/maxHz, sampleRate/minHz]
 *  by maximizing normalized correlation of a sustain window against itself
 *  shifted by the lag. loopStart is winStart; loopEnd = winStart + bestLag. */
export function findLoop(samples, sampleRate, opts = {}) {
  const minHz = opts.minHz ?? 40;
  const maxHz = opts.maxHz ?? 2000;
  const winStart = opts.winStart ?? Math.floor(samples.length * 0.4);
  const winLen = opts.winLen ?? Math.floor(samples.length * 0.2);
  const minLag = Math.max(1, Math.floor(sampleRate / maxHz));
  const maxLag = Math.ceil(sampleRate / minHz);
  if (winStart + winLen + maxLag > samples.length) {
    throw new Error('sample too short for the requested loop window + lag range');
  }
  let bestLag = minLag;
  let bestScore = -Infinity;
  for (let lag = minLag; lag <= maxLag; lag++) {
    let num = 0;
    let e1 = 0;
    let e2 = 0;
    for (let i = 0; i < winLen; i++) {
      const a = samples[winStart + i];
      const b = samples[winStart + i + lag];
      num += a * b;
      e1 += a * a;
      e2 += b * b;
    }
    const score = num / Math.sqrt(e1 * e2 + 1e-20);
    if (score > bestScore) {
      bestScore = score;
      bestLag = lag;
    }
  }
  return { loopStart: winStart, loopEnd: winStart + bestLag, score: bestScore };
}

/** Equal-power crossfade the fadeLen samples approaching loopEnd with those
 *  approaching loopStart, so wrapping loopEnd -> loopStart is continuous.
 *  Requires loopStart >= fadeLen and loopEnd - loopStart >= fadeLen. */
export function bakeCrossfade(samples, loopStart, loopEnd, fadeLen) {
  if (loopStart < fadeLen || loopEnd - loopStart < fadeLen) {
    throw new Error('loop too short for the requested crossfade length');
  }
  const out = Float32Array.from(samples);
  for (let i = 0; i < fadeLen; i++) {
    const f = (i + 1) / fadeLen; // 0..1 across the fade
    const wEnd = Math.cos((f * Math.PI) / 2); // fade out the pre-loopEnd tail
    const wStart = Math.sin((f * Math.PI) / 2); // fade in the pre-loopStart tail
    const dst = loopEnd - fadeLen + i;
    const src = loopStart - fadeLen + i;
    out[dst] = wEnd * samples[dst] + wStart * samples[src];
  }
  return out;
}

/** Discontinuity magnitude at the loop wrap: |out[loopStart] - out[loopEnd-1]|. */
export function wrapDiscontinuity(samples, loopStart, loopEnd) {
  return Math.abs(samples[loopStart] - samples[loopEnd - 1]);
}
```

- [ ] **Step 2: Write `loop-finder.test.mjs`**: on a pure 200 Hz sine at 48k, `findLoop` returns a lag within ±2 samples of 240 (48000/200) and `score > 0.99`; `findLoop` throws on a too-short buffer; `bakeCrossfade` on a loop whose period is deliberately off by ~10 samples REDUCES `wrapDiscontinuity` vs the raw slice (baked < raw); `bakeCrossfade` throws when `loopStart < fadeLen`.

- [ ] **Step 3: Run.** `node --test tools/samplepack/loop-finder.test.mjs` green. **Commit:** `feat(samplepack): add autocorrelation loop finder and crossfade bake`

---

### Task 4: Layer assembler (tools)

**Files:**
- Create: `tools/samplepack/layer-assembler.mjs`, `tools/samplepack/layer-assembler.test.mjs`

**Interfaces:**
- Consumes: the source list from Task 2 (`{ name, rootMidi, velocity, layerIndex, samples }`), loop points from Task 3.
- Produces: `assembleLayers(sources, config) → { layers: [{ topVelocity, zones: [{ rootMidi, file, gain, tuneCents, loopStart?, loopEnd? }] }] }` — one `ZoneSetSpec`-shaped object (minus the runtime types). `peakGain(samples, target) → number`.

- [ ] **Step 1: Write `layer-assembler.mjs`.**

```js
/** Linear gain that brings the sample's peak to `target` (default 0.9). */
export function peakGain(samples, target = 0.9) {
  let peak = 0;
  for (let i = 0; i < samples.length; i++) {
    const a = Math.abs(samples[i]);
    if (a > peak) peak = a;
  }
  return peak > 0 ? target / peak : 1;
}

/** Group sources into ascending velocity layers and build a ZoneSetSpec-shaped
 *  object. `config.topVelocities` maps layerIndex -> inclusive top velocity
 *  bound (ascending). `config.loops` maps source name -> { loopStart, loopEnd }
 *  (omit a name for a one-shot). `config.target` is the peak-normalize target. */
export function assembleLayers(sources, config) {
  const { topVelocities, loops = {}, target = 0.9 } = config;
  const byLayer = new Map();
  for (const s of sources) {
    if (!byLayer.has(s.layerIndex)) byLayer.set(s.layerIndex, []);
    byLayer.get(s.layerIndex).push(s);
  }
  const layerIndices = [...byLayer.keys()].sort((a, b) => a - b);
  const layers = layerIndices.map((li) => {
    const zones = byLayer
      .get(li)
      .sort((a, b) => a.rootMidi - b.rootMidi)
      .map((s) => {
        const loop = loops[s.name];
        return {
          rootMidi: s.rootMidi,
          file: s.name.replace(/\.wav$/, '.m4a'),
          gain: peakGain(s.samples, target),
          tuneCents: 0,
          ...(loop ? { loopStart: loop.loopStart, loopEnd: loop.loopEnd } : {}),
        };
      });
    return { topVelocity: topVelocities[li], zones };
  });
  return { layers };
}
```

- [ ] **Step 2: Write `layer-assembler.test.mjs`**: with 8 test-pack sources (2 layers × 4 roots) and `topVelocities: [0.6, 1.0]`, `assembleLayers` yields 2 layers with ascending `topVelocity`, each 4 zones sorted by `rootMidi`, `.m4a` file names, `gain > 0`, `tuneCents === 0`; a source with a `loops` entry gets `loopStart`/`loopEnd`, one without stays a one-shot; `peakGain` on a 0.5-peak buffer with target 0.9 returns ~1.8.

- [ ] **Step 3: Run.** `node --test tools/samplepack/layer-assembler.test.mjs` green. **Commit:** `feat(samplepack): add velocity-layer assembler with peak normalization`

---

### Task 5: AAC encode + loop-drift verifier (tools)

**Files:**
- Create: `tools/samplepack/encode-verify.mjs`, `tools/samplepack/encode-verify.test.mjs`

**Interfaces:**
- Consumes: WAV files (Task 2), loop points (Task 3).
- Produces: `encodeAac(wavPath, m4aPath) → void` (afconvert→ffmpeg); `decodeToWav(m4aPath, wavPath) → void` (ffmpeg); `measureOffset(original, decoded, maxLag) → number` (cross-correlation lag); `loopDrift(originalLoop, offset, decodedLoop) → number`; `verifyZone(originalSamples, decodedSamples, loop, tolerance) → { offset, drift, ok }`.

- [ ] **Step 1: Write `encode-verify.mjs`.**

```js
import { execFileSync } from 'node:child_process';

function has(bin) {
  try {
    execFileSync('command', ['-v', bin], { stdio: 'ignore', shell: '/bin/zsh' });
    return true;
  } catch {
    return false;
  }
}

/** Encode a WAV to AAC (.m4a). Prefer afconvert (Apple native), fall back to
 *  ffmpeg. Throws if neither is available. */
export function encodeAac(wavPath, m4aPath) {
  if (has('afconvert')) {
    execFileSync('afconvert', ['-f', 'm4af', '-d', 'aac', '-b', '192000', wavPath, m4aPath], { stdio: 'ignore' });
  } else if (has('ffmpeg')) {
    execFileSync('ffmpeg', ['-y', '-i', wavPath, '-c:a', 'aac', '-b:a', '192k', m4aPath], { stdio: 'ignore' });
  } else {
    throw new Error('no AAC encoder found (need afconvert or ffmpeg)');
  }
}

/** Decode an .m4a back to a mono 16-bit WAV via ffmpeg (deterministic decode
 *  path for the verifier). Throws if ffmpeg is absent. */
export function decodeToWav(m4aPath, wavPath) {
  if (!has('ffmpeg')) throw new Error('ffmpeg required to decode for verification');
  execFileSync('ffmpeg', ['-y', '-i', m4aPath, '-ac', '1', '-c:a', 'pcm_s16le', wavPath], { stdio: 'ignore' });
}

/** Cross-correlation lag (0..maxLag) that best aligns `decoded` onto
 *  `original` within a window starting at `winStart` — recovers the AAC
 *  encoder/priming delay at that point in the signal without hardcoding it. */
export function measureOffset(original, decoded, winStart, winLen = 4096, maxLag = 4096) {
  const wl = Math.min(winLen, original.length - winStart);
  let bestLag = 0;
  let bestScore = -Infinity;
  for (let lag = 0; lag <= maxLag; lag++) {
    let num = 0;
    let e1 = 0;
    let e2 = 0;
    for (let i = 0; i < wl; i++) {
      const a = original[winStart + i];
      const b = decoded[winStart + i + lag] ?? 0;
      num += a * b;
      e1 += a * a;
      e2 += b * b;
    }
    const score = num / Math.sqrt(e1 * e2 + 1e-20);
    if (score > bestScore) {
      bestScore = score;
      bestLag = lag;
    }
  }
  return bestLag;
}

/** Drift = disagreement (in samples) between two alignment offsets measured at
 *  different points in the signal. Zero drift means the encode/decode kept the
 *  timeline rigid, so loop points expressed in original coordinates stay valid. */
export function loopDrift(offsetEarly, offsetLate) {
  return Math.abs(offsetLate - offsetEarly);
}

/** Verify one zone survived encode/decode without the loop region shifting
 *  relative to the rest of the signal: the encoder delay measured early must
 *  match the delay measured around the loop, within `tolerance` samples. A
 *  constant global delay is fine (compensated); a DIFFERENT delay near the
 *  loop means the content drifted and the loop points would click. */
export function verifyZone(original, decoded, loopStart, tolerance = 8) {
  const early = measureOffset(original, decoded, Math.floor(original.length * 0.1));
  const atLoop = measureOffset(original, decoded, loopStart);
  const drift = loopDrift(early, atLoop);
  return { offset: early, drift, ok: drift <= tolerance };
}
```

- [ ] **Step 2: Write `encode-verify.test.mjs`.** Two kinds:
  - Pure: `measureOffset` recovers a KNOWN offset — take a test-pack tone as `original`, build `decoded` as `original` shifted right by 137 samples (137 leading zeros); assert `measureOffset(original, decoded, Math.floor(original.length * 0.4)) === 137`. `loopDrift(5, 5) === 0`; `loopDrift(5, 18) === 13`.
  - Integration (guarded — skip via `test('...', { skip: !ffmpegPresent })` if neither encoder exists): write a test-pack tone to a temp WAV, `encodeAac` → `decodeToWav` → `readWavMono`, then `measureOffset(original, decoded, Math.floor(original.length * 0.1))` returns a small positive priming delay (0 < offset < 4096) and `verifyZone(original, decoded, loopStart).ok` is true (early and at-loop offsets agree — no drift). Use `node:os.tmpdir()` + `node:fs.mkdtempSync`; clean up.

- [ ] **Step 3: Run.** `node --test tools/samplepack/encode-verify.test.mjs` green (integration test runs when ffmpeg present, which it is in this env). **Commit:** `feat(samplepack): add AAC encode and loop-drift verifier`

---

### Task 6: build-pack orchestrator + CREDITS (tools)

**Files:**
- Create: `tools/samplepack/build-pack.mjs`, `tools/samplepack/build-pack.test.mjs`, `tools/samplepack/README.md`
- Modify: `tools/samplepack/loop-finder.mjs` (+ `loop-finder.test.mjs`) — add the `extendLoop` export below.

**Interfaces:**
- Consumes: all of Tasks 2–5.
- Produces: `buildPack(config) → { manifest, packDir }` (writes files); `renderCredits(credits) → string`; `extendLoop(loopStart, loopEnd, minLength, maxEnd) → number`.

**Why `extendLoop` exists (found by wiring the pipeline end to end):** `findLoop` returns a SINGLE fundamental period as the loop (367 samples for root 48 at 48 kHz = 7.6 ms). That is both musically unusable (a 7.6 ms loop buzzes) and shorter than the 512-sample crossfade, so `bakeCrossfade` throws on most sources. `extendLoop` grows the loop to the smallest **integer multiple** of the detected period that is at least `minLength` — integer multiples keep the loop phase-aligned, so it stays seamless — clamped so it never runs past `maxEnd`.

- [ ] **Step 0: Add `extendLoop` to `tools/samplepack/loop-finder.mjs`:**

```js
/** Grow a single-period loop to the smallest integer number of periods that is
 *  at least `minLength` samples, without running past `maxEnd`. Integer
 *  multiples of the detected period keep the loop phase-aligned (seamless). */
export function extendLoop(loopStart, loopEnd, minLength, maxEnd) {
  const period = loopEnd - loopStart;
  if (period <= 0) throw new Error('extendLoop: loopEnd must be greater than loopStart');
  let k = Math.max(1, Math.ceil(minLength / period));
  while (k > 1 && loopStart + k * period > maxEnd) k--;
  return loopStart + k * period;
}
```

Add to `loop-finder.test.mjs`: a period of 367 with `minLength` 4096 yields `k = 12` → `loopEnd = loopStart + 4404` (≥ minLength, and `(loopEnd - loopStart) % 367 === 0`); a loop already longer than `minLength` is returned unchanged (`k = 1`); extension is clamped by `maxEnd` (a small `maxEnd` forces `k` down, never past the buffer); `extendLoop` throws when `loopEnd <= loopStart`.

- [ ] **Step 1: Write `build-pack.mjs`.** Orchestrate gen → loop → assemble → encode → verify; write `<packDir>/<zone>.m4a`, `manifest.json`, `CREDITS.md`. Loop points found per source feed BOTH the assembler and the verifier.

```js
import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { writeWavMono, readWavMono } from './wav.mjs';
import { genTestPack } from './gen-test-pack.mjs';
import { findLoop, bakeCrossfade, extendLoop } from './loop-finder.mjs';
import { assembleLayers } from './layer-assembler.mjs';
import { encodeAac, decodeToWav, verifyZone } from './encode-verify.mjs';

export function renderCredits(credits) {
  const rows = credits.map((c) => `- **${c.source}** — ${c.license}${c.url ? ` (${c.url})` : ''}`);
  return `# Credits\n\n${rows.join('\n')}\n`;
}

const FADE = 512;
/** Minimum loop length in samples (~85 ms at 48k). findLoop returns a single
 *  fundamental period — 367 samples for C3, i.e. 7.6 ms — which is both
 *  musically unusable (buzzy) and too short to fit the 512-sample crossfade.
 *  extendLoop grows it to an integer multiple of that period (preserving
 *  phase alignment, so the loop stays seamless) of at least this length. */
const MIN_LOOP = 4096;

/** Build a full pack from the generated test sources into packDir. Finds a
 *  loop per source, extends it to a musical integer-period length,
 *  crossfade-bakes it, encodes to .m4a, verifies loop drift, and emits
 *  manifest.json + CREDITS.md. Throws if any zone fails verification. */
export function buildPack(config = {}) {
  const packDir = config.packDir ?? 'build/piano-tiny';
  const zoneSetId = config.zoneSetId ?? 'piano';
  const tmpDir = config.tmpDir ?? join(packDir, '.tmp');
  mkdirSync(packDir, { recursive: true });
  mkdirSync(tmpDir, { recursive: true });

  const pack = genTestPack(config.gen);
  const loops = {};
  for (const src of pack.sources) {
    const found = findLoop(src.samples, src.sampleRate);
    const loopStart = found.loopStart;
    const loopEnd = extendLoop(loopStart, found.loopEnd, MIN_LOOP, src.samples.length);
    // Defensive: never ask for a fade longer than the loop or the pre-roll.
    const fade = Math.min(FADE, loopEnd - loopStart, loopStart);
    const baked = bakeCrossfade(src.samples, loopStart, loopEnd, fade);
    const wavPath = join(tmpDir, src.name);
    const m4aName = src.name.replace(/\.wav$/, '.m4a');
    const m4aPath = join(packDir, m4aName);
    writeFileSync(wavPath, writeWavMono(baked, src.sampleRate));
    encodeAac(wavPath, m4aPath);
    const decWav = join(tmpDir, `dec_${src.name}`);
    decodeToWav(m4aPath, decWav);
    const decoded = readWavMono(readFileSync(decWav)).samples;
    const v = verifyZone(baked, decoded, loopStart);
    if (!v.ok) throw new Error(`loop drift too large for ${src.name}: ${v.drift} samples`);
    loops[src.name] = { loopStart, loopEnd };
  }

  const topVelocities = pack.velocities.map((_, i) => (i + 1) / pack.velocities.length);
  const zoneSet = assembleLayers(pack.sources, { topVelocities, loops });
  const manifest = {
    schemaVersion: 1,
    id: config.id ?? 'piano-tiny',
    tier: 'tiny',
    sampleRate: pack.sampleRate,
    format: 'm4a',
    zoneSets: { [zoneSetId]: zoneSet },
    credits: pack.credits,
  };
  writeFileSync(join(packDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
  writeFileSync(join(packDir, 'CREDITS.md'), renderCredits(pack.credits));
  return { manifest, packDir };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { packDir } = buildPack({ packDir: process.argv[2] });
  console.log(`built pack at ${packDir}`);
}
```

- [ ] **Step 2: Write `build-pack.test.mjs`** (guarded on ffmpeg present): `buildPack({ packDir: <tmp> })` returns a manifest whose `zoneSets.piano.layers` has 2 layers, each 4 zones with `loopStart`/`loopEnd` and `.m4a` files that exist on disk; every zone's `.m4a` file exists; `CREDITS.md` contains 'CC0'; the emitted `manifest.json` re-parsed passes a local structural check (2 layers, ascending topVelocity, all files present). `renderCredits` (pure, unguarded) formats a known credits array with the source and license.

- [ ] **Step 3: Write `README.md`** — one-paragraph how-to: `node tools/samplepack/build-pack.mjs <packDir>` builds the test pack; note the afconvert/ffmpeg requirement and that this is offline build tooling with no Swift twin. Reference the manifest schema in `manifest.ts`.

- [ ] **Step 4: Run.** `node --test tools/samplepack/build-pack.test.mjs` green. **Commit:** `feat(samplepack): add build-pack orchestrator and CREDITS generation`

---

### Task 7: PackSource + SampleDecoder + PackLoader (twin)

**Files:**
- Create: `web/packages/alloy-audio/src/pack/pack-source.ts` (+ `.spec.ts`), `web/packages/alloy-audio/src/pack/pack-loader.ts` (+ `.spec.ts`)
- Modify: `web/packages/alloy-audio/src/index.ts` (re-export pack surface)
- Create: `swift/Sources/AlloyAudio/Pack/PackSource.swift`, `swift/Sources/AlloyAudio/Pack/SampleDecoder.swift`, `swift/Sources/AlloyAudio/Pack/PackLoader.swift`, `swift/Tests/AlloyAudioTests/PackLoaderTests.swift`

**Interfaces:**
- Consumes: `PackManifest`, `validateManifest` (Task 1); `SampleZoneData`, `VelocityLayerData` (from `sample-zone-generator.ts`); `ZoneSetProvider` (from `voice.ts`); `PatchEngine`, `renderPatch`, a sample patch from `golden-patches.ts` (for the render test).
- Produces: `PackSource`, `BasePathPackSource`, `SampleDecoder`, `DecodedPcm`, `WebAudioDecoder`, `PackLoader` (with `load()` and a `provide` `ZoneSetProvider`).

- [ ] **Step 1: Write `pack-source.ts`.**

```ts
// Byte-origin + decode seams for pack loading. Both keep WebAudio/network at
// the host edge (injected), so the loader's logic stays testable offline.
// Twin: PackSource.swift + SampleDecoder.swift.

import { validateManifest, type PackManifest } from './manifest.js';

export type EncodedBytes = Uint8Array;

/** Mono PCM decoded from one .m4a. */
export interface DecodedPcm {
  sampleRate: number;
  data: Float32Array;
}

/** Decodes encoded (.m4a) bytes to mono PCM. Host-injected. */
export interface SampleDecoder {
  decode(bytes: EncodedBytes): Promise<DecodedPcm>;
}

/** Byte origin for a pack: manifest + per-zone encoded bytes. */
export interface PackSource {
  fetchManifest(): Promise<PackManifest>;
  fetchZone(file: string): Promise<EncodedBytes>;
}

/** Minimal fetch surface (inject globalThis.fetch or a test double). */
export type FetchFn = (url: string) => Promise<{
  json(): Promise<unknown>;
  arrayBuffer(): Promise<ArrayBuffer>;
}>;

/** Pack fetched from a base URL/path: `${base}/manifest.json`, `${base}/<file>`. */
export class BasePathPackSource implements PackSource {
  constructor(
    private readonly base: string,
    private readonly fetchFn: FetchFn,
  ) {}

  async fetchManifest(): Promise<PackManifest> {
    const res = await this.fetchFn(`${this.base}/manifest.json`);
    const manifest = (await res.json()) as PackManifest;
    const errors = validateManifest(manifest);
    if (errors.length > 0) throw new Error(`invalid manifest: ${errors.join('; ')}`);
    return manifest;
  }

  async fetchZone(file: string): Promise<EncodedBytes> {
    const res = await this.fetchFn(`${this.base}/${file}`);
    return new Uint8Array(await res.arrayBuffer());
  }
}

/** Minimal decode context (inject an AudioContext or a test double). */
export interface MinimalDecodeContext {
  decodeAudioData(data: ArrayBuffer): Promise<{
    sampleRate: number;
    numberOfChannels: number;
    getChannelData(channel: number): Float32Array;
  }>;
}

/** SampleDecoder backed by a WebAudio-like context; downmixes to mono. */
export class WebAudioDecoder implements SampleDecoder {
  constructor(private readonly ctx: MinimalDecodeContext) {}

  async decode(bytes: EncodedBytes): Promise<DecodedPcm> {
    const copy = bytes.slice();
    const buffer = await this.ctx.decodeAudioData(copy.buffer);
    const channels = buffer.numberOfChannels;
    const frames = buffer.getChannelData(0).length;
    const data = new Float32Array(frames);
    for (let c = 0; c < channels; c++) {
      const ch = buffer.getChannelData(c);
      for (let i = 0; i < frames; i++) data[i] += ch[i] / channels;
    }
    return { sampleRate: buffer.sampleRate, data };
  }
}
```

- [ ] **Step 2: Write `pack-loader.ts`.**

```ts
// Progressive pack loader: fetch + decode a pack into SampleZoneData, and BE a
// stateful ZoneSetProvider (null until a zone set finishes decoding). The
// engine's existing null-handling (voice.ts: unresolvable zoneSetId => layer
// inactive) turns this into progressive delivery + synth fallback for free.
// Twin: PackLoader.swift.

import type { SampleZoneData, VelocityLayerData } from '../sample-zone-generator.js';
import type { PackManifest, ZoneSpec } from './manifest.js';
import type { PackSource, SampleDecoder } from './pack-source.js';

export class PackLoader {
  private manifest: PackManifest | null = null;
  private readonly zoneSets = new Map<string, VelocityLayerData[]>();

  constructor(
    private readonly source: PackSource,
    private readonly decoder: SampleDecoder,
  ) {}

  /** Fetch the manifest, then fetch + decode each zone set; publish each zone
   *  set into the resolver map as it completes (progressive). */
  async load(): Promise<void> {
    const manifest = await this.source.fetchManifest();
    this.manifest = manifest;
    for (const [zoneSetId, spec] of Object.entries(manifest.zoneSets)) {
      const layers: VelocityLayerData[] = [];
      for (const layer of spec.layers) {
        const zones: SampleZoneData[] = [];
        for (const z of layer.zones) {
          const bytes = await this.source.fetchZone(z.file);
          const pcm = await this.decoder.decode(bytes);
          zones.push(buildZone(z, pcm.sampleRate, pcm.data));
        }
        layers.push({ topVelocity: layer.topVelocity, zones });
      }
      this.zoneSets.set(zoneSetId, layers);
    }
  }

  /** ZoneSetProvider: null until the zone set has decoded, then its layers. */
  provide = (zoneSetId: string): readonly VelocityLayerData[] | null => this.zoneSets.get(zoneSetId) ?? null;
}

/** Fold gain into the PCM and tuneCents into a fractional root; produce the
 *  runtime SampleZoneData without touching SampleZoneGenerator. */
export function buildZone(spec: ZoneSpec, sampleRate: number, pcm: Float32Array): SampleZoneData {
  const data = new Float32Array(pcm.length);
  for (let i = 0; i < pcm.length; i++) data[i] = pcm[i] * spec.gain;
  return {
    rootMidi: spec.rootMidi + spec.tuneCents / 100,
    sampleRate,
    data,
    ...(spec.loopStart !== undefined && spec.loopEnd !== undefined
      ? { loopStart: spec.loopStart, loopEnd: spec.loopEnd }
      : {}),
  };
}
```

- [ ] **Step 3: Re-export** from `web/packages/alloy-audio/src/index.ts`: add `export * from './pack/manifest.js';`, `export * from './pack/pack-source.js';`, `export * from './pack/pack-loader.js';` (match the file's existing export style).

- [ ] **Step 4: Write `pack-source.spec.ts`**: `BasePathPackSource.fetchManifest` calls `fetchFn` with `${base}/manifest.json`, returns the parsed manifest, and THROWS on an invalid manifest (fake fetchFn returns a manifest with a bad tier). `fetchZone` requests `${base}/<file>` and returns a `Uint8Array` of the arrayBuffer bytes. `WebAudioDecoder.decode` with a fake `MinimalDecodeContext` returning a 2-channel buffer downmixes to the per-sample average and preserves `sampleRate`.

- [ ] **Step 5: Write `pack-loader.spec.ts`**: a fake in-memory `PackSource` (returns a hand-built 1-zoneSet/2-layer manifest and, per file, marker bytes) + a fake `SampleDecoder` (maps marker bytes → a known non-silent `DecodedPcm`). Assert: `provide('piano')` is `null` before `load()`; after `await load()`, `provide('piano')` returns 2 layers with the right zone counts, roots, and loop points; `buildZone` folds `gain` (scales PCM: a gain-2 spec doubles the samples) and `tuneCents` (a +50-cent spec yields `rootMidi + 0.5`). Then a render test: build a sample `Patch` referencing `zoneSetId: 'piano'`, `renderPatch(patch, [noteOn@0, noteOff@N], frames, 48000, loader.provide)` — assert non-silence during sustain and determinism across two calls; and that WITHOUT calling `load()` the same render is silent (progressive fallback). (Reuse `PATCH_SAMPLE`'s shape from `golden-patches.ts` as the template, pointing at `'piano'`.)

- [ ] **Step 6: Mirror the Swift twin** — `PackSource.swift` (`protocol PackSource { func fetchManifest() async throws -> PackManifest; func fetchZone(_ file: String) async throws -> Data }`, `struct BasePathPackSource` with an injected async fetch closure), `SampleDecoder.swift` (`struct DecodedPcm { let sampleRate: Double; let data: [Float] }`, `protocol SampleDecoder { func decode(_ bytes: Data) async throws -> DecodedPcm }`; an `AVAudioFile`-backed impl may be added but is NOT required for tests — tests use a fake), `PackLoader.swift` (`final class PackLoader` with `func load() async throws`, `func provide(_ zoneSetId: String) -> [VelocityLayerData]?`, and the free `buildZone` with identical gain/tune folding). Match the existing Swift `SampleZoneData`/`VelocityLayerData` shapes and the `ZoneSetProvider` typealias in the Swift engine.

- [ ] **Step 7: Write `PackLoaderTests.swift`** — the twin of Steps 4–5: fake source + fake decoder, `provide` nil before load / populated after, `buildZone` gain+tune folding, and a `renderPatch`-equivalent render through the Swift `PatchEngine` with `loader.provide` as the provider asserting non-silence + determinism, plus twin agreement on the resolved zone roots/loops/gains (same numeric values the web test pins).

- [ ] **Step 8: Run both.** `cd web && npm test -- pack` green (manifest + pack-source + pack-loader specs); `cd swift && swift build && swift test --filter Pack` green. **Commit:** `feat(audio): add PackSource, SampleDecoder, and progressive PackLoader (twin)`

---

## Self-Review Notes

- **No engine/generator changes.** The loader produces the existing `SampleZoneData` (gain baked into PCM, tuneCents folded into a fractional root) and plugs into the existing `ZoneSetProvider` seam — the golden sample twin test and the `L === R` invariant are untouched. If any task finds it must modify `SampleZoneGenerator`/`ToneGenerator`/`voice.ts`, STOP with NEEDS_CONTEXT (that would be a stereo-voice-bus scope breach).
- **Determinism boundary.** Twin assertions only ever compare against fake-decoder PCM (deterministic, offline). Real AAC encode/decode is exercised solely by the web-side verifier (Task 5) and the build orchestrator (Task 6), never by a twin numeric assertion — AAC decode differs across platforms and must never gate a twin test.
- **Progressive delivery is free.** The loader returning `null` per un-decoded zoneSetId is exactly what `voice.ts:90,190` already treats as "layer inactive." Per-zoneSet granularity (publish when a whole zone set decodes) is the 3a target; per-zone streaming ("playable from the first decoded zone") is a later refinement — do not over-build it here.
- **Tools are web-only.** Tasks 2–6 have no Swift twin (build tooling, like `tools/generate-tokens.mjs`). Only Tasks 1 and 7 are twinned. The tool tests run under `node --test`, not Vitest.
- **Encoder availability.** Tasks 5–6 integration tests are guarded to skip when no encoder is present, but MUST run (not silently pass) where `ffmpeg`/`afconvert` exist — the dev environment has both. `encodeAac`/`decodeToWav` throw loudly when the binary is missing rather than producing an empty pack.
- **Deferred to 3b:** the real Salamander pack, by-ear patch tuning, standard/HQ tiers, CDN/release-asset `PackSource` impls, on-device caching. This plan ships the machine + a generated pack + the twinned loader only.
