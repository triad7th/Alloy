# Rompler Effects 2c — Sends, Master Limiter, Benchmark — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close phase 2 of the rompler engine: the two shared send buses (algorithmic **reverb** — FDN family, zero asset bytes — and tempo-syncable stereo/ping-pong **delay**), the in-core **master lookahead limiter** (replacing the compressor-as-limiter), the **MasterBus** that wires the patch's `sends` levels through them into the engine, and the deferred **64-voice CPU render benchmark** that only became meaningful once full FX exist.

**Architecture:** Reverb, delay, and limiter are pure per-sample DSP-core units under the same twin/golden-test regime as the six inserts. A new `MasterBus` owns one instance of each; `PatchEngine` holds one `MasterBus` and runs it at the tail of every render segment — after the insert chain writes the stereo scratch pair, before that pair adds into the caller's output. Because the master path lives inside `PatchEngine.process`, `renderPatch` and both platform hosts inherit it with zero new wiring, preserving the flagship "host path bit-exactly equals `renderPatch`" guarantee. The reverb/delay are 100%-wet send processors: the patch's `sends.reverb`/`sends.delay` levels scale their *input*, and their wet output adds back to the dry bus. The limiter is always-on and stereo-linked, with a fixed 64-sample lookahead.

**Tech Stack:** TypeScript (`web/packages/alloy-audio`, canonical) + Swift twin (`swift/Sources/AlloyAudio`), Vitest + XCTest, no runtime deps, no WebAudio/AVFoundation imports in the DSP core.

## Global Constraints

- **Mirrored twins, web canonical.** Every unit ships TS + Swift in the same change set with identical API shapes and identical per-sample math. Swift internals compute in `Double`, buffers are `[Float]`, effect classes conform to the existing protocols. Mirror the sibling files for style: `Compressor.swift`/`compressor.ts`, `Phaser.swift`/`phaser.ts`. Binding contract: `docs/mirroring.md`.
- **Determinism is absolute.** No `Date.now`/`Math.random`/`Math.random`-equivalent. Reverb/delay modulation uses an internal deterministic sine LFO (phase accumulator), never `DspPrng`. Fractional delay reads use linear interpolation, identical on both platforms. Twin reference arrays match within `toBeCloseTo(v, 6)` (1e-6) for unit tests; the golden full-render probes stay at `toBeCloseTo(v, 4)` (1e-4).
- **No allocation and no throw in any `process()` / `reset()`.** All scratch buffers are preallocated at construction. `reset()` must not allocate (do not rebuild arrays — zero them in place). This is a hard rule for every new unit (the 2b review flagged `DriveEq.reset()` allocating; do not repeat that pattern).
- **Send effects are 100% wet.** Reverb and delay output wet-only; the send level scales the input, the dry bus is untouched by the unit. There is no `mix` param on reverb/delay (unlike the insert effects).
- **Denormal safety.** Every feedback-loop write in the reverb and delay flushes denormals to zero (guard: if `|v| < 1e-20` then `v = 0`, applied to the value written back into a delay line / one-pole state). Both twins apply it identically.
- **Validation is non-throwing.** New param validators return `string[]` (empty = valid) exactly like `validateCompressorParams`. `validateMasterConfig` composes them. Swift Codable decode is the structural gate on its side (see `validateInsert`'s doc comment).
- **Control-rate vs sample-rate.** The limiter's gain updates **per sample** (not per `EFFECT_CONTROL_INTERVAL`) — the 2b review flagged 16-sample control steps as zipper-sensitive for a limiter. Reverb/delay coefficient recomputes that are expensive may use control-rate ticks, but the signal path runs per sample.
- **Golden regeneration is expected and controlled.** The master limiter's 64-sample lookahead shifts the full-render output by 64 samples; the four existing golden probe arrays are regenerated on both platforms from identical code, and the onset probe window moves past the latency. This is mirroring-protocol step 3 (regenerate generated data when the source path changes), not tampering.

---

## File Structure

- Create: `web/packages/alloy-audio/src/dsp/effects/reverb.ts` (+ `reverb.spec.ts`) — FDN reverb send unit.
- Create: `web/packages/alloy-audio/src/dsp/effects/delay.ts` (+ `delay.spec.ts`) — stereo/ping-pong delay send unit.
- Create: `web/packages/alloy-audio/src/dsp/effects/limiter.ts` (+ `limiter.spec.ts`) — lookahead brickwall limiter.
- Create: `web/packages/alloy-audio/src/dsp/effects/master-bus.ts` (+ `master-bus.spec.ts`) — owns reverb+delay+limiter, applies send routing + limiting.
- Modify: `web/packages/alloy-audio/src/dsp/effects/effect-types.ts` — add `ReverbParams`, `DelayParams`, `LimiterParams`, `MasterConfig`, `SendEffect`, validators, `DEFAULT_MASTER_CONFIG`, `LIMITER_LOOKAHEAD_SAMPLES`.
- Modify: `web/packages/alloy-audio/src/dsp/patch-engine.ts` — hold a `MasterBus`, set its sends in `setPatch`, run it in `renderSegment`.
- Modify: `web/packages/alloy-audio/src/dsp/golden-render.spec.ts` + `web/packages/alloy-audio/src/dsp/testing/golden-patches.ts` — regenerate probes, move onset window, add a wet (`sends > 0`) golden case.
- Create: `web/packages/alloy-audio/src/dsp/benchmark.spec.ts` — 64-voice throughput guard + denormal-flush assessment.
- Swift twins (create): `swift/Sources/AlloyAudio/DSP/Effects/Reverb.swift`, `Delay.swift`, `Limiter.swift`, `MasterBus.swift`; tests `swift/Tests/AlloyAudioTests/ReverbTests.swift`, `DelayTests.swift`, `LimiterTests.swift`, `MasterBusTests.swift`, `BenchmarkTests.swift`.
- Swift twins (modify): `swift/Sources/AlloyAudio/DSP/Effects/EffectTypes.swift`, `swift/Sources/AlloyAudio/DSP/PatchEngine.swift`, `swift/Tests/AlloyAudioTests/GoldenRenderTests.swift`, `swift/Tests/AlloyAudioTests/GoldenPatchFixtures.swift`.

---

### Task 1: Send/master param types and validation

**Files:**
- Modify: `web/packages/alloy-audio/src/dsp/effects/effect-types.ts`
- Modify: `swift/Sources/AlloyAudio/DSP/Effects/EffectTypes.swift`
- Test: extend `web/packages/alloy-audio/src/dsp/effects/effect-types.spec.ts` if it exists, else assert bounds inside each unit's spec (Tasks 2–4 cover them).

**Interfaces produced (later tasks consume these exact shapes):**

- [ ] **Step 1: Add the param interfaces, constants, and `SendEffect` to `effect-types.ts`** (append after `CompressorParams`, before `InsertSpec`):

```ts
/** Output-only wet processor fed by a send tap. Unlike EffectUnit (in-place),
 * a send effect READS a pre-scaled send input and WRITES wet output to a
 * separate pair — the dry bus it taps from stays untouched. Non-allocating,
 * must not throw. */
export interface SendEffect {
  process(inL: Float32Array, inR: Float32Array, outL: Float32Array, outR: Float32Array, frames: number): void;
  reset(): void;
}

export interface ReverbParams {
  /** Pre-network predelay, 0..100 ms. */
  predelayMs: number;
  /** Tank feedback / tail length, 0..1 (maps to loop gain 0.70..0.98). */
  decay: number;
  /** HF damping in the feedback path, 0..1 (0 = bright, 1 = dark). */
  damping: number;
  /** Input low-pass bandwidth, 0..1 (1 = full band into the network). */
  bandwidth: number;
  /** Chorus modulation depth of the modulated lines, 0..1. */
  modDepth: number;
  /** Modulation LFO rate, (0, 5] Hz. */
  modRateHz: number;
}

export interface DelayParams {
  mode: 'stereo' | 'pingpong';
  /** Base delay time, (0, 2000] ms. */
  timeMs: number;
  /** Feedback gain, 0..0.95 (< 1 for stability). */
  feedback: number;
  /** HF damping in the feedback path, 0..1. */
  damping: number;
}

export interface LimiterParams {
  /** Output brickwall ceiling in dBFS, -24..0. Output |sample| never exceeds this. */
  ceilingDb: number;
  /** Gain recovery time after a peak, (0, 1000] ms. */
  releaseMs: number;
}

export interface MasterConfig {
  reverb: ReverbParams;
  delay: DelayParams;
  limiter: LimiterParams;
}

/** Fixed lookahead of the master limiter, in samples (~1.3 ms at 48 kHz). The
 * master path delays the whole render by exactly this many samples. */
export const LIMITER_LOOKAHEAD_SAMPLES = 64;

export const DEFAULT_MASTER_CONFIG: MasterConfig = {
  reverb: { predelayMs: 12, decay: 0.72, damping: 0.35, bandwidth: 0.85, modDepth: 0.35, modRateHz: 0.7 },
  delay: { mode: 'pingpong', timeMs: 375, feedback: 0.38, damping: 0.4 },
  limiter: { ceilingDb: -0.3, releaseMs: 120 },
};
```

- [ ] **Step 2: Add the validators** (mirror `validateCompressorParams`'s pattern exactly — `!(x >= lo && x <= hi)` guards, descriptive messages):

```ts
export function validateReverbParams(p: ReverbParams): string[] {
  const e: string[] = [];
  if (!(p.predelayMs >= 0 && p.predelayMs <= 100)) e.push(`reverb.predelayMs ${p.predelayMs} outside [0, 100]`);
  if (!(p.decay >= 0 && p.decay <= 1)) e.push(`reverb.decay ${p.decay} outside [0, 1]`);
  if (!(p.damping >= 0 && p.damping <= 1)) e.push(`reverb.damping ${p.damping} outside [0, 1]`);
  if (!(p.bandwidth >= 0 && p.bandwidth <= 1)) e.push(`reverb.bandwidth ${p.bandwidth} outside [0, 1]`);
  if (!(p.modDepth >= 0 && p.modDepth <= 1)) e.push(`reverb.modDepth ${p.modDepth} outside [0, 1]`);
  if (!(p.modRateHz > 0 && p.modRateHz <= 5)) e.push(`reverb.modRateHz ${p.modRateHz} outside (0, 5]`);
  return e;
}

export function validateDelayParams(p: DelayParams): string[] {
  const e: string[] = [];
  if (p.mode !== 'stereo' && p.mode !== 'pingpong') e.push(`delay.mode '${(p as { mode: string }).mode}' must be 'stereo' or 'pingpong'`);
  if (!(p.timeMs > 0 && p.timeMs <= 2000)) e.push(`delay.timeMs ${p.timeMs} outside (0, 2000]`);
  if (!(p.feedback >= 0 && p.feedback <= 0.95)) e.push(`delay.feedback ${p.feedback} outside [0, 0.95]`);
  if (!(p.damping >= 0 && p.damping <= 1)) e.push(`delay.damping ${p.damping} outside [0, 1]`);
  return e;
}

export function validateLimiterParams(p: LimiterParams): string[] {
  const e: string[] = [];
  if (!(p.ceilingDb >= -24 && p.ceilingDb <= 0)) e.push(`limiter.ceilingDb ${p.ceilingDb} outside [-24, 0]`);
  if (!(p.releaseMs > 0 && p.releaseMs <= 1000)) e.push(`limiter.releaseMs ${p.releaseMs} outside (0, 1000]`);
  return e;
}

export function validateMasterConfig(c: MasterConfig): string[] {
  return [
    ...validateReverbParams(c.reverb),
    ...validateDelayParams(c.delay),
    ...validateLimiterParams(c.limiter),
  ];
}
```

- [ ] **Step 3: Mirror all of the above into `EffectTypes.swift`** — `struct ReverbParams`, `DelayParams`, `LimiterParams`, `MasterConfig` (Codable, matching field names), `protocol SendEffect`, `enum` or `String` for delay mode (mirror how rotary `speed` is modeled), the `limiterLookaheadSamples` constant, `defaultMasterConfig`, and `validateReverbParams`/`validateDelayParams`/`validateLimiterParams`/`validateMasterConfig` free functions returning `[String]`.

- [ ] **Step 4: Test the validators** (add `validateMasterConfig accepts DEFAULT_MASTER_CONFIG` and one out-of-range case per field to whichever spec file you add the unit tests in — Task 2's `reverb.spec.ts` is a fine home for the reverb ones; keep each near its unit). Example assertions:

```ts
expect(validateMasterConfig(DEFAULT_MASTER_CONFIG)).toEqual([]);
expect(validateReverbParams({ ...DEFAULT_MASTER_CONFIG.reverb, decay: 1.1 })).not.toHaveLength(0);
expect(validateDelayParams({ ...DEFAULT_MASTER_CONFIG.delay, feedback: 0.96 })).not.toHaveLength(0);
expect(validateLimiterParams({ ...DEFAULT_MASTER_CONFIG.limiter, ceilingDb: 0.1 })).not.toHaveLength(0);
```

- [ ] **Step 5: Build both sides** — `cd web && npm test -- effect-types` (or the spec you added to) green; `cd swift && swift build` green. **Commit:** `feat(audio): add reverb/delay/limiter/master param types and validation`

---

### Task 2: FDN reverb send unit

**Files:**
- Create: `web/packages/alloy-audio/src/dsp/effects/reverb.ts`, `web/packages/alloy-audio/src/dsp/effects/reverb.spec.ts`
- Create: `swift/Sources/AlloyAudio/DSP/Effects/Reverb.swift`, `swift/Tests/AlloyAudioTests/ReverbTests.swift`

**Interfaces:**
- Consumes: `ReverbParams`, `SendEffect` from Task 1.
- Produces: `class Reverb implements SendEffect` — `constructor(params: ReverbParams, sampleRate: number)`.

**Design:** An 8-line feedback delay network (the spec's "Dattorro/FDN family"). Mono send input → predelay → two series Schroeder allpasses (input diffusion) → distributed into 8 delay lines mixed each sample by a normalized 8×8 Hadamard matrix, each line one-pole-damped in the feedback path, loop gain `g` from `decay`, lines 0 and 4 length-modulated by a shared sine LFO (linear-interpolated reads). Output: even lines → L, odd lines → R. Fully deterministic; no PRNG.

- [ ] **Step 1: Write `reverb.ts` in full.**

```ts
// Algorithmic reverb send unit — an 8-line feedback delay network (FDN) with
// input diffusion, per-line HF damping, a normalized Hadamard feedback mix,
// and modulated lines for density. Zero sample bytes; identical on both
// platforms. Fed by the reverb send tap; outputs 100% wet. Twin: Reverb.swift.

import { type ReverbParams, type SendEffect } from './effect-types.js';

// Delay-line lengths in samples at 48 kHz (mutually near-prime, ~24..58 ms),
// the plate's fixed character. Rescaled by sampleRate/48000 at construction.
const LINE_LEN_48K = [1153, 1327, 1559, 1801, 2063, 2311, 2543, 2801];
const DIFFUSER_LEN_48K = [229, 173];
const DIFFUSER_COEF = 0.7;
const PREDELAY_MAX_48K = 4800; // 100 ms
const MOD_MAX_SAMPLES = 16; // peak modulation excursion on lines 0 and 4
const CONTROL_TWO_PI = Math.PI * 2;

function scaleLen(len48k: number, sampleRate: number): number {
  return Math.max(1, Math.round((len48k * sampleRate) / 48000));
}

/** Fixed-length circular delay line with integer and fractional reads. */
class Line {
  private readonly buf: Float32Array;
  private pos = 0;
  constructor(readonly length: number, extra: number) {
    this.buf = new Float32Array(length + extra);
  }
  /** Sample written `length` samples ago. */
  readInt(): number {
    return this.buf[this.pos];
  }
  /** Sample written `length + delta` samples ago, linear-interpolated
   * (delta >= 0, delta <= extra). */
  readFrac(delta: number): number {
    const size = this.buf.length;
    const d = Math.floor(delta);
    const f = delta - d;
    let i0 = this.pos - d;
    if (i0 < 0) i0 += size;
    let i1 = i0 - 1;
    if (i1 < 0) i1 += size;
    return this.buf[i0] * (1 - f) + this.buf[i1] * f;
  }
  write(v: number): void {
    this.buf[this.pos] = Math.abs(v) < 1e-20 ? 0 : v; // denormal flush
    this.pos++;
    if (this.pos >= this.buf.length) this.pos = 0;
  }
  clear(): void {
    this.buf.fill(0);
    this.pos = 0;
  }
}

/** Schroeder allpass diffuser: y = -g*x + z; z_next = x + g*y. */
class Allpass {
  private readonly buf: Float32Array;
  private pos = 0;
  constructor(length: number, private readonly g: number) {
    this.buf = new Float32Array(length);
  }
  process(x: number): number {
    const z = this.buf[this.pos];
    const y = -this.g * x + z;
    const w = x + this.g * y;
    this.buf[this.pos] = Math.abs(w) < 1e-20 ? 0 : w;
    this.pos++;
    if (this.pos >= this.buf.length) this.pos = 0;
    return y;
  }
  clear(): void {
    this.buf.fill(0);
    this.pos = 0;
  }
}

export class Reverb implements SendEffect {
  private readonly lines: Line[];
  private readonly diffusers: Allpass[];
  private readonly predelay: Float32Array;
  private predelayPos = 0;
  private readonly predelaySamples: number;
  private readonly damp = new Float64Array(8); // one-pole LPF state per line
  private readonly h = new Float64Array(8); // Hadamard scratch
  private lfoPhase = 0;
  private readonly lfoInc: number;
  private readonly g: number;
  private readonly dampCoef: number;
  private readonly bwCoef: number;
  private bwState = 0;
  private readonly modSamples: number;

  constructor(
    private readonly params: ReverbParams,
    sampleRate: number,
  ) {
    this.lines = LINE_LEN_48K.map((l) => new Line(scaleLen(l, sampleRate), MOD_MAX_SAMPLES + 2));
    this.diffusers = DIFFUSER_LEN_48K.map((l) => new Allpass(scaleLen(l, sampleRate), DIFFUSER_COEF));
    this.predelaySamples = Math.min(scaleLen(PREDELAY_MAX_48K, sampleRate), Math.max(1, Math.round((params.predelayMs / 1000) * sampleRate)));
    this.predelay = new Float32Array(scaleLen(PREDELAY_MAX_48K, sampleRate) + 1);
    this.g = 0.7 + 0.28 * params.decay;
    this.dampCoef = params.damping; // one-pole: lp += damp*(x - lp)
    this.bwCoef = params.bandwidth; // one-pole: bw += bwCoef*(x - bw)
    this.lfoInc = (CONTROL_TWO_PI * params.modRateHz) / sampleRate;
    this.modSamples = params.modDepth * MOD_MAX_SAMPLES;
  }

  reset(): void {
    for (const l of this.lines) l.clear();
    for (const d of this.diffusers) d.clear();
    this.predelay.fill(0);
    this.predelayPos = 0;
    this.damp.fill(0);
    this.h.fill(0);
    this.lfoPhase = 0;
    this.bwState = 0;
  }

  private hadamard(): void {
    const h = this.h;
    for (const step of [1, 2, 4]) {
      for (let i = 0; i < 8; i++) {
        if ((i & step) === 0) {
          const a = h[i];
          const b = h[i + step];
          h[i] = a + b;
          h[i + step] = a - b;
        }
      }
    }
    const norm = 1 / Math.sqrt(8);
    for (let i = 0; i < 8; i++) h[i] *= norm;
  }

  process(inL: Float32Array, inR: Float32Array, outL: Float32Array, outR: Float32Array, frames: number): void {
    const size = this.predelay.length;
    for (let n = 0; n < frames; n++) {
      // Mono send, input bandwidth roll-off.
      let x = (inL[n] + inR[n]) * 0.5;
      this.bwState += this.bwCoef * (x - this.bwState);
      x = this.bwState;

      // Predelay.
      let rp = this.predelayPos - this.predelaySamples;
      if (rp < 0) rp += size;
      const pre = this.predelay[rp];
      this.predelay[this.predelayPos] = x;
      this.predelayPos++;
      if (this.predelayPos >= size) this.predelayPos = 0;

      // Input diffusion.
      let d = pre;
      d = this.diffusers[0].process(d);
      d = this.diffusers[1].process(d);

      // Read line outputs (lines 0 and 4 modulated).
      const mod = this.modSamples * Math.sin(this.lfoPhase);
      this.lfoPhase += this.lfoInc;
      if (this.lfoPhase >= CONTROL_TWO_PI) this.lfoPhase -= CONTROL_TWO_PI;
      const s0 = this.lines[0].readFrac(mod < 0 ? 0 : mod);
      const s4 = this.lines[4].readFrac(mod < 0 ? -mod : 0);
      const s = [
        s0, this.lines[1].readInt(), this.lines[2].readInt(), this.lines[3].readInt(),
        s4, this.lines[5].readInt(), this.lines[6].readInt(), this.lines[7].readInt(),
      ];

      // Per-line damping in the feedback path.
      for (let k = 0; k < 8; k++) {
        this.damp[k] += this.dampCoef * (s[k] - this.damp[k]);
        this.h[k] = this.damp[k];
      }

      // Feedback mix, write back input + g * mixed.
      this.hadamard();
      for (let k = 0; k < 8; k++) {
        this.lines[k].write(d + this.g * this.h[k]);
      }

      // Output taps.
      outL[n] = (s[0] + s[2] + s[4] + s[6]) * 0.5;
      outR[n] = (s[1] + s[3] + s[5] + s[7]) * 0.5;
    }
  }
}
```

- [ ] **Step 2: Write `reverb.spec.ts`** — cover: (a) **silence in → silence out** exactly 0 for 4096 frames from a fresh instance (proves no self-oscillation / denormal leak); (b) **energy decays**: feed a 1-sample impulse (send input `inL[0]=inR[0]=1`, rest 0), render 96000 frames, assert RMS over `[0,4800)` > RMS over `[91200,96000)` and the tail RMS < 1e-3 (bounded, decaying); (c) **stereo decorrelation**: after the impulse, `outL` and `outR` are not identical everywhere (the network produces a stereo field); (d) **determinism**: two fresh instances, same input → bit-identical output; (e) **reset() restores initial state**: process, `reset()`, process the same input → bit-identical to the first run; (f) **twin reference**: capture 8 samples of `outL` and `outR` at frame 2000 after a sustained input (a 220 Hz sine at amplitude 0.5 fed as the send input for a 4000-frame warmup + 8-frame capture) with `DEFAULT_MASTER_CONFIG.reverb`, paste as `TWIN_REVERB_L`/`TWIN_REVERB_R`, assert `toBeCloseTo(v, 6)`. Use the `// console.log(JSON.stringify(Array.from(...)))` capture idiom from `compressor.spec.ts:233`.

```ts
// Skeleton — fill TWIN_REVERB_* from the first web run, then delete the console.logs.
import { describe, expect, it } from 'vitest';
import { Reverb } from './reverb.js';
import { DEFAULT_MASTER_CONFIG } from './effect-types.js';

const FS = 48_000;
const R = () => new Reverb(DEFAULT_MASTER_CONFIG.reverb, FS);

function sine(freq: number, amp: number, frames: number): Float32Array {
  const out = new Float32Array(frames);
  for (let i = 0; i < frames; i++) out[i] = amp * Math.sin((2 * Math.PI * freq * i) / FS);
  return out;
}
// ... (silence, impulse-decay, decorrelation, determinism, reset, twin-reference tests) ...
```

- [ ] **Step 3: Port `Reverb.swift`** — mirror the classes (`Line`, `Allpass`, `Reverb: SendEffect`) with `Double` internals, `[Float]` I/O buffers, the same constants and denormal flush. The Hadamard butterfly, LFO, and interpolation must match sample-for-sample.

- [ ] **Step 4: Write `ReverbTests.swift`** — the same six behaviors, and assert `TWIN_REVERB_L`/`TWIN_REVERB_R` (the exact values the web run produced) with `accuracy: 1e-6`.

- [ ] **Step 5: Run both suites.** `cd web && npm test -- reverb` green; `cd swift && swift test --filter ReverbTests` green. **Commit:** `feat(audio): add FDN reverb send unit (twin)`

---

### Task 3: Stereo / ping-pong delay send unit

**Files:**
- Create: `web/packages/alloy-audio/src/dsp/effects/delay.ts`, `delay.spec.ts`
- Create: `swift/Sources/AlloyAudio/DSP/Effects/Delay.swift`, `swift/Tests/AlloyAudioTests/DelayTests.swift`

**Interfaces:**
- Consumes: `DelayParams`, `SendEffect`.
- Produces: `class Delay implements SendEffect` — `constructor(params: DelayParams, sampleRate: number)`.

**Design:** Two delay lines (L, R). `stereo` mode: each channel feeds its own feedback loop. `pingpong` mode: L's delayed output feeds R's input and R's feeds L's, so echoes bounce across the field. Damped feedback: a one-pole LPF in each feedback path. 100% wet output. Denormal flush on the feedback write.

- [ ] **Step 1: Write `delay.ts` in full.**

```ts
// Tempo-syncable stereo / ping-pong delay send unit with damped feedback.
// 100% wet; fed by the delay send tap. Twin: Delay.swift.

import { type DelayParams, type SendEffect } from './effect-types.js';

export class Delay implements SendEffect {
  private readonly bufL: Float32Array;
  private readonly bufR: Float32Array;
  private readonly size: number;
  private pos = 0;
  private readonly delaySamples: number;
  private lpL = 0;
  private lpR = 0;
  private readonly fb: number;
  private readonly dampCoef: number;
  private readonly pingpong: boolean;

  constructor(
    private readonly params: DelayParams,
    sampleRate: number,
  ) {
    this.delaySamples = Math.max(1, Math.round((params.timeMs / 1000) * sampleRate));
    this.size = this.delaySamples + 1;
    this.bufL = new Float32Array(this.size);
    this.bufR = new Float32Array(this.size);
    this.fb = params.feedback;
    this.dampCoef = params.damping;
    this.pingpong = params.mode === 'pingpong';
  }

  reset(): void {
    this.bufL.fill(0);
    this.bufR.fill(0);
    this.pos = 0;
    this.lpL = 0;
    this.lpR = 0;
  }

  process(inL: Float32Array, inR: Float32Array, outL: Float32Array, outR: Float32Array, frames: number): void {
    for (let n = 0; n < frames; n++) {
      let rp = this.pos - this.delaySamples;
      if (rp < 0) rp += this.size;
      const dl = this.bufL[rp];
      const dr = this.bufR[rp];

      // Damped feedback (one-pole LPF on the delayed signal).
      this.lpL += this.dampCoef * (dl - this.lpL);
      this.lpR += this.dampCoef * (dr - this.lpR);

      // Feedback routing: ping-pong crosses channels.
      const fbL = this.pingpong ? this.lpR : this.lpL;
      const fbR = this.pingpong ? this.lpL : this.lpR;

      let wl = inL[n] + this.fb * fbL;
      let wr = inR[n] + this.fb * fbR;
      if (Math.abs(wl) < 1e-20) wl = 0;
      if (Math.abs(wr) < 1e-20) wr = 0;
      this.bufL[this.pos] = wl;
      this.bufR[this.pos] = wr;

      this.pos++;
      if (this.pos >= this.size) this.pos = 0;

      // 100% wet output = the delayed taps.
      outL[n] = dl;
      outR[n] = dr;
    }
  }
}
```

- [ ] **Step 2: Write `delay.spec.ts`** — cover: (a) **first echo timing**: impulse into `inL[0]=1` (stereo mode), assert `outL[delaySamples-1] ≈ 1` and near-zero before it; (b) **feedback decay**: successive echoes at `k*delaySamples` decay by ~`feedback` each (assert ratio within tolerance for the first 3 taps); (c) **ping-pong crossing**: `pingpong` mode, impulse into `inL[0]` only → the first echo appears on `outL` at `delaySamples`, the second (fed back through R) appears on `outR` at `2*delaySamples`; (d) **damping darkens feedback**: with `damping > 0`, the impulse-response high-frequency content drops across successive echoes (assert later-echo peak < earlier-echo peak beyond pure feedback scaling, or simpler: energy above Nyquist/4 decreases — a coarse check is fine); (e) **determinism**; (f) **reset()**; (g) **twin reference**: capture 8 samples around the second echo for `DEFAULT_MASTER_CONFIG.delay`, assert `toBeCloseTo(v, 6)`.

- [ ] **Step 3: Port `Delay.swift`** (Double internals, `[Float]` I/O, same routing + denormal flush).
- [ ] **Step 4: Write `DelayTests.swift`** — same behaviors + the exact twin-reference values.
- [ ] **Step 5:** `npm test -- delay` and `swift test --filter DelayTests` green. **Commit:** `feat(audio): add stereo/ping-pong delay send unit (twin)`

---

### Task 4: Lookahead master limiter

**Files:**
- Create: `web/packages/alloy-audio/src/dsp/effects/limiter.ts`, `limiter.spec.ts`
- Create: `swift/Sources/AlloyAudio/DSP/Effects/Limiter.swift`, `swift/Tests/AlloyAudioTests/LimiterTests.swift`

**Interfaces:**
- Consumes: `LimiterParams`, `LIMITER_LOOKAHEAD_SAMPLES`, `EffectUnit` (in-place — the limiter processes the master bus in place, unlike the send effects).
- Produces: `class Limiter implements EffectUnit` — `constructor(params: LimiterParams, sampleRate: number)`, `latencySamples: number` getter returning `LIMITER_LOOKAHEAD_SAMPLES`.

**Design:** True brickwall via a lookahead delay plus a sliding-window peak. A ring buffer delays L/R by `LIMITER_LOOKAHEAD_SAMPLES`; a parallel `peakBuf` of `max(|L|,|R|)` per input sample lets us take the **max over the lookahead window** each sample (O(L) scan, L=64 — trivial cost, exact, twin-safe). The gain that the currently-emerging (delayed) sample needs is `min(1, ceiling / windowPeak)`; because the peak enters the window `L` samples before it reaches the output, the gain is already correct when the peak emerges → zero overshoot. Gain moves to the target instantly (attack) and recovers with a per-sample one-pole **release** (never per control tick — zipper-safe). Stereo-linked: one gain for both channels.

- [ ] **Step 1: Write `limiter.ts` in full.**

```ts
// Master lookahead brickwall limiter. A LIMITER_LOOKAHEAD_SAMPLES ring delay
// plus a sliding window-peak guarantees the output never exceeds the ceiling
// with zero overshoot. Stereo-linked (one gain drives both channels).
// Per-sample gain — no control-rate stepping (zipper-safe). Twin: Limiter.swift.

import { LIMITER_LOOKAHEAD_SAMPLES, type EffectUnit, type LimiterParams } from './effect-types.js';

export class Limiter implements EffectUnit {
  private readonly L = LIMITER_LOOKAHEAD_SAMPLES;
  private readonly delayL = new Float32Array(LIMITER_LOOKAHEAD_SAMPLES);
  private readonly delayR = new Float32Array(LIMITER_LOOKAHEAD_SAMPLES);
  private readonly peakBuf = new Float32Array(LIMITER_LOOKAHEAD_SAMPLES);
  private pos = 0;
  private gain = 1;
  private readonly ceiling: number;
  private readonly releaseCoef: number;

  constructor(
    private readonly params: LimiterParams,
    sampleRate: number,
  ) {
    this.ceiling = 10 ** (params.ceilingDb / 20);
    this.releaseCoef = 1 - Math.exp(-1 / ((params.releaseMs / 1000) * sampleRate));
  }

  get latencySamples(): number {
    return this.L;
  }

  reset(): void {
    this.delayL.fill(0);
    this.delayR.fill(0);
    this.peakBuf.fill(0);
    this.pos = 0;
    this.gain = 1;
  }

  process(left: Float32Array, right: Float32Array, frames: number): void {
    const L = this.L;
    for (let i = 0; i < frames; i++) {
      const inL = left[i];
      const inR = right[i];

      // Emit the delayed sample at the current ring slot, then overwrite it.
      const outL = this.delayL[this.pos];
      const outR = this.delayR[this.pos];
      this.delayL[this.pos] = inL;
      this.delayR[this.pos] = inR;
      this.peakBuf[this.pos] = Math.max(Math.abs(inL), Math.abs(inR));

      this.pos++;
      if (this.pos >= L) this.pos = 0;

      // Peak over the whole lookahead window (the peak entered up to L samples
      // ago, so it is already accounted for before it reaches the output).
      let windowPeak = 0;
      for (let k = 0; k < L; k++) {
        const p = this.peakBuf[k];
        if (p > windowPeak) windowPeak = p;
      }
      const target = windowPeak > this.ceiling ? this.ceiling / windowPeak : 1;

      // Instant attack (clamp down immediately), per-sample one-pole release.
      if (target < this.gain) {
        this.gain = target;
      } else {
        this.gain += this.releaseCoef * (target - this.gain);
      }

      left[i] = outL * this.gain;
      right[i] = outR * this.gain;
    }
  }
}
```

- [ ] **Step 2: Write `limiter.spec.ts`** — cover: (a) **latency**: an impulse at `inL[0]=1` emerges at `outL[LIMITER_LOOKAHEAD_SAMPLES]` (delayed by exactly L); (b) **brickwall / hot chain** (the 2b review's required case): feed a signal that peaks at **10.0** (simulating phaser feedback 0.9 → ~10× peak, or stacked +12 dB shelves) and assert **every** output sample `|x| <= ceiling + 1e-6` — no overshoot anywhere, including the very first peak (this is the lookahead's whole job); (c) **below ceiling is unity after latency**: a -12 dBFS sine passes through at unity gain (within 1e-6) once past the L-sample delay; (d) **stereo link**: a loud L with a quiet R applies the same gain to both (equal `out/in` ratio where both inputs are non-trivial); (e) **release recovery**: after a loud burst ends, gain returns toward 1 within ~5×`releaseMs` on a following quiet passage; (f) **per-sample smoothing** (zipper guard): during release on a constant quiet signal, consecutive output samples change smoothly — assert `|out[i] - out[i-1]|` stays below a small bound across a window (no 16-sample stair-steps); (g) **determinism**; (h) **reset()**; (i) **twin reference**: 8 samples of both channels after a hot-then-settling input with `DEFAULT_MASTER_CONFIG.limiter`, `toBeCloseTo(v, 6)`.

- [ ] **Step 3: Port `Limiter.swift`** — `EffectUnit`, `latencySamples` property, Double gain math, same ring/window/release. The window-peak scan and instant-attack/one-pole-release must match sample-for-sample.
- [ ] **Step 4: Write `LimiterTests.swift`** — same nine behaviors + exact twin values.
- [ ] **Step 5:** `npm test -- limiter`, `swift test --filter LimiterTests` green. **Commit:** `feat(audio): add lookahead master limiter (twin)`

---

### Task 5: MasterBus + engine integration + golden regeneration

**Files:**
- Create: `web/packages/alloy-audio/src/dsp/effects/master-bus.ts`, `master-bus.spec.ts`
- Create: `swift/Sources/AlloyAudio/DSP/Effects/MasterBus.swift`, `swift/Tests/AlloyAudioTests/MasterBusTests.swift`
- Modify: `web/packages/alloy-audio/src/dsp/patch-engine.ts`, `swift/Sources/AlloyAudio/DSP/PatchEngine.swift`
- Modify: `web/packages/alloy-audio/src/dsp/golden-render.spec.ts`, `web/packages/alloy-audio/src/dsp/testing/golden-patches.ts`
- Modify: `swift/Tests/AlloyAudioTests/GoldenRenderTests.swift`, `swift/Tests/AlloyAudioTests/GoldenPatchFixtures.swift`

**Interfaces:**
- Consumes: `Reverb`, `Delay`, `Limiter`, `MasterConfig` (Task 1–4).
- Produces: `class MasterBus` — `constructor(config: MasterConfig, sampleRate: number)`, `setSends(reverb: number, delay: number): void`, `process(left: Float32Array, right: Float32Array, frames: number): void` (in place, adds wet, then limits; non-allocating), `reset(): void`, `latencySamples: number`.

- [ ] **Step 1: Write `master-bus.ts` in full.** Owns one `Reverb`, one `Delay`, one `Limiter`, plus preallocated scratch buffers (`MAX_BLOCK_FRAMES = 4096`, matching the engine). Routing invariant: **both reverb and delay tap the DRY (post-insert) bus** — snapshot the dry stereo pair at entry so the delay never echoes the reverb's wet tail — then sum both wets into the bus, then limit last. Reverb/delay `process` write to distinct `wet*` buffers (never aliased with their input) so the routing is obviously correct.

```ts
// Master send + limiter bus. Snapshots the (post-insert) dry stereo bus,
// taps it into the shared reverb and delay by the current patch's send
// levels, sums both wets back onto the dry, then brickwall-limits. In place,
// non-allocating. Adds limiter.latencySamples of latency to the whole render.
// Twin: MasterBus.swift.

import { Delay } from './delay.js';
import { Limiter } from './limiter.js';
import { Reverb } from './reverb.js';
import { type MasterConfig } from './effect-types.js';

const MAX_BLOCK_FRAMES = 4096;

export class MasterBus {
  private readonly reverb: Reverb;
  private readonly delay: Delay;
  private readonly limiter: Limiter;
  private sendReverb = 0;
  private sendDelay = 0;
  /** Dry snapshot at process() entry — both sends tap this, not the wet bus. */
  private readonly dryL = new Float32Array(MAX_BLOCK_FRAMES);
  private readonly dryR = new Float32Array(MAX_BLOCK_FRAMES);
  /** Pre-scaled send input. */
  private readonly sendL = new Float32Array(MAX_BLOCK_FRAMES);
  private readonly sendR = new Float32Array(MAX_BLOCK_FRAMES);
  /** Wet output of whichever send unit is running (reused sequentially). */
  private readonly wetL = new Float32Array(MAX_BLOCK_FRAMES);
  private readonly wetR = new Float32Array(MAX_BLOCK_FRAMES);

  constructor(config: MasterConfig, sampleRate: number) {
    this.reverb = new Reverb(config.reverb, sampleRate);
    this.delay = new Delay(config.delay, sampleRate);
    this.limiter = new Limiter(config.limiter, sampleRate);
  }

  get latencySamples(): number {
    return this.limiter.latencySamples;
  }

  setSends(reverb: number, delay: number): void {
    this.sendReverb = reverb;
    this.sendDelay = delay;
  }

  reset(): void {
    this.reverb.reset();
    this.delay.reset();
    this.limiter.reset();
    this.dryL.fill(0);
    this.dryR.fill(0);
    this.sendL.fill(0);
    this.sendR.fill(0);
    this.wetL.fill(0);
    this.wetR.fill(0);
  }

  process(left: Float32Array, right: Float32Array, frames: number): void {
    // Snapshot the dry bus; both send taps read from this snapshot.
    for (let i = 0; i < frames; i++) {
      this.dryL[i] = left[i];
      this.dryR[i] = right[i];
    }

    // Reverb send: dry * sendReverb -> reverb -> add wet. The reverb always
    // runs so its tail keeps ringing after the send level drops; the send
    // level scales only its input.
    for (let i = 0; i < frames; i++) {
      this.sendL[i] = this.dryL[i] * this.sendReverb;
      this.sendR[i] = this.dryR[i] * this.sendReverb;
    }
    this.reverb.process(this.sendL, this.sendR, this.wetL, this.wetR, frames);
    for (let i = 0; i < frames; i++) {
      left[i] += this.wetL[i];
      right[i] += this.wetR[i];
    }

    // Delay send: dry * sendDelay -> delay -> add wet (taps the SAME dry
    // snapshot, so it never echoes the reverb wet just added).
    for (let i = 0; i < frames; i++) {
      this.sendL[i] = this.dryL[i] * this.sendDelay;
      this.sendR[i] = this.dryR[i] * this.sendDelay;
    }
    this.delay.process(this.sendL, this.sendR, this.wetL, this.wetR, frames);
    for (let i = 0; i < frames; i++) {
      left[i] += this.wetL[i];
      right[i] += this.wetR[i];
    }

    // Master brickwall, last.
    this.limiter.process(left, right, frames);
  }
}
```

> **Twin note:** the reverb and delay always run every block (never conditionally skipped on a zero send level) so both twins execute the identical instruction stream regardless of send value — a `sendReverb === 0` fast-path is forbidden here because it would let the reverb's internal LFO/state advance differently than a zero-fed run and diverge the platforms. Feeding a zero-scaled input is cheap and keeps the tail behavior correct.

- [ ] **Step 2: Write `master-bus.spec.ts`** — (a) **sends = 0 is dry + limiter only**: `setSends(0,0)`, feed a below-ceiling signal, assert output equals the input delayed by `latencySamples` (within 1e-6) — no reverb/delay coloring; (b) **reverb send adds a decaying tail**: `setSends(0.3, 0)`, impulse, assert energy after the dry impulse (a wet tail exists); (c) **delay send adds an echo**: `setSends(0, 0.3)`, impulse, assert a peak near `delayTime + latency`; (d) **limiter still brickwalls**: `setSends(0.5,0.5)` with a hot input, assert output `|x| <= ceiling + 1e-6`; (e) **determinism + reset()**.

- [ ] **Step 3: Integrate into `patch-engine.ts`.**
  - Import `MasterBus` and `DEFAULT_MASTER_CONFIG` (and `type MasterConfig`).
  - Add `masterConfig?: MasterConfig` to `PatchEngineOptions`.
  - In the constructor: `this.master = new MasterBus(options?.masterConfig ?? DEFAULT_MASTER_CONFIG, sampleRate);`
  - In `setPatch`, after building inserts: `this.master.setSends(patch.sends.reverb, patch.sends.delay);`
  - In `renderSegment`, **after** the insert-chain loop and **before** the `left[offset+i] += scratchL[i]` accumulation: `this.master.process(this.scratchL, this.scratchR, length);`
  - Update the class doc comment: the segment path is now voice bus → inserts → **master (sends + limiter)** → add into output; note the master adds `LIMITER_LOOKAHEAD_SAMPLES` of latency to the whole render.
  - `renderPatch` and both hosts are unchanged (they call `process`, which now includes master).

- [ ] **Step 4: Mirror `MasterBus.swift` and the `PatchEngine.swift` integration** exactly — same option field (`masterConfig`), same call sites (set sends in `setPatch`, run master in `renderSegment` before the `+=`).

- [ ] **Step 5: Regenerate the golden full-render twins.** The master limiter now delays every render by 64 samples, so the four existing probe arrays must be recaptured and the onset window moved past the latency:
  - In `golden-render.spec.ts`, change the near-onset probe window from frame `0` to frame **`200`** (past the 64-sample latency, into the note's early attack) for all cases; keep `12000` and `30000`. Rename the `at0`/`TWIN_*_AT_0` symbols to `at200`/`TWIN_*_AT_200` for clarity, and update the `probe(out, 0)` call to `probe(out, 200)`. Leave the `insertFree` full-render `L === R` test as-is (sends = 0 → reverb/delay output 0, limiter is stereo-linked → `L === R` still holds bit-exactly for VA and SAMPLE).
  - Re-run web, capture the new values for all three windows × both channels × four patches, paste them in.
  - **Add a fifth golden case `masterWet`:** a new patch in `golden-patches.ts` — reuse `PATCH_FM`'s layers/inserts but with `sends: { reverb: 0.3, delay: 0.25 }` and a distinct `meta.id` (e.g. `golden-fm-wet`). This is the case that actually exercises reverb + delay + limiter end-to-end through the engine. Capture its three windows × both channels; it is **not** insert-free (`insertFree: false`; reverb decorrelates L/R). Add `GOLDEN_EVENTS`-driven probes just like the others.
  - Mirror every regenerated array and the new `masterWet` case into `GoldenRenderTests.swift` / `GoldenPatchFixtures.swift`. **Swift must independently reproduce the web numbers** — this is the flagship twin assertion; the whole point is that the Swift port lands on the same values, not that we copied them.

- [ ] **Step 6: Run everything.** `cd web && npm test` fully green (golden + master-bus + engine specs). `cd swift && swift test` fully green (GoldenRenderTests + MasterBusTests + PatchEngine host/engine tests). Confirm the `renderPatch == host` guarantee still holds: the existing worklet-host and PatchEngineHost golden-equivalence tests pass unchanged (they call `process`, which now includes master, on both sides).
- [ ] **Step 7: Commit:** `feat(audio): wire reverb/delay sends + master limiter into the engine (twin)`

---

### Task 6: 64-voice CPU render benchmark + denormal-flush assessment

**Files:**
- Create: `web/packages/alloy-audio/src/dsp/benchmark.spec.ts`
- Create: `swift/Tests/AlloyAudioTests/BenchmarkTests.swift`

**Design:** The spec's deferred "64-voice render benchmark asserting the CPU envelope" — now meaningful because full FX exist. Build a worst-case patch (multiple layers, an insert chain, `sends > 0` so reverb + delay + limiter all run), start 64 simultaneous voices, render several seconds in 128-frame blocks, and measure the **realtime ratio** (render wall-time ÷ audio duration). Assert a **loose** bound so CI never flakes (renders comfortably faster than realtime), and **log the actual ratio and the implied "% of one core"** so a human reads the real number against the spec's "< 25% of one core on a mid-tier phone" target. This is an indicative guard, not a phone measurement.

- [ ] **Step 1: Write `benchmark.spec.ts`.**

```ts
import { describe, expect, it } from 'vitest';
import { PatchEngine } from './patch-engine.js';
import { PATCH_FM } from './testing/golden-patches.js';

const FS = 48_000;
const SECONDS = 4;
const BLOCK = 128;
const VOICES = 64;

describe('64-voice render benchmark', () => {
  it('renders 64 voices with full FX faster than realtime (indicative CPU guard)', () => {
    const patch = { ...PATCH_FM, sends: { reverb: 0.3, delay: 0.25 } }; // full master path active
    const engine = new PatchEngine(FS, { masterConfig: undefined });
    engine.setPatch(patch);
    for (let v = 0; v < VOICES; v++) {
      engine.schedule({ frame: 0, kind: 'noteOn', midi: 36 + v, velocity: 0.8 });
    }
    const total = FS * SECONDS;
    const left = new Float32Array(BLOCK);
    const right = new Float32Array(BLOCK);
    const t0 = performance.now();
    for (let off = 0; off < total; off += BLOCK) {
      left.fill(0);
      right.fill(0);
      engine.process(left, right, Math.min(BLOCK, total - off));
    }
    const elapsedMs = performance.now() - t0;
    const audioMs = SECONDS * 1000;
    const ratio = elapsedMs / audioMs;
    // eslint-disable-next-line no-console
    console.log(`64-voice full-FX: ${elapsedMs.toFixed(1)} ms to render ${audioMs} ms audio ` +
      `= ${(ratio * 100).toFixed(1)}% of realtime on this machine (target < 25% of one mid-tier phone core)`);
    expect(engine.activeVoiceCount).toBeGreaterThan(0); // voices actually ran
    expect(ratio).toBeLessThan(1.0); // faster than realtime — loose, flake-proof
  });

  it('a decaying reverb tail into silence does not stall (denormal-flush assessment)', () => {
    const patch = { ...PATCH_FM, sends: { reverb: 0.6, delay: 0.4 } };
    const engine = new PatchEngine(FS);
    engine.setPatch(patch);
    engine.schedule({ frame: 0, kind: 'noteOn', midi: 60, velocity: 1 });
    engine.schedule({ frame: 2400, kind: 'noteOff', midi: 60 });
    const total = FS * 8; // long tail decaying toward zero
    const left = new Float32Array(BLOCK);
    const right = new Float32Array(BLOCK);
    const t0 = performance.now();
    for (let off = 0; off < total; off += BLOCK) {
      left.fill(0);
      right.fill(0);
      engine.process(left, right, Math.min(BLOCK, total - off));
    }
    const ratio = (performance.now() - t0) / (8 * 1000);
    // eslint-disable-next-line no-console
    console.log(`reverb-tail denormal check: ${(ratio * 100).toFixed(1)}% of realtime (should not spike as the tail decays)`);
    expect(ratio).toBeLessThan(1.0);
  });
});
```

- [ ] **Step 2: Write `BenchmarkTests.swift`** — the same two scenarios using `PatchEngine`, timed with `Date`/`CFAbsoluteTimeGetCurrent` (or `measure {}`), a `print(...)` of the ratio and implied core %, and a loose `XCTAssertLessThan(ratio, 1.0)`. (Note: `Date()` is fine in Swift *test* code — the determinism ban is for the DSP core, not for benchmark timing.)

- [ ] **Step 3: Run.** `cd web && npm test -- benchmark` green (read the logged ratio). `cd swift && swift test --filter BenchmarkTests` green. Note the logged percentages in the report so the human sees the real headroom against the < 25% target.
- [ ] **Step 4: Commit:** `test(audio): add 64-voice full-FX render benchmark and denormal check`

---

## Self-Review Notes

- **Flagship guarantee preserved:** the master path lives inside `PatchEngine.process`, so `renderPatch`, the worklet host, and the AVAudioSourceNode host all inherit it identically — no new integration surface where the twins could diverge. Task 5 Step 6 explicitly re-confirms the host-equals-`renderPatch` tests.
- **Golden regeneration is intentional, not tampering:** the limiter's 64-sample lookahead is a real, deliberate change to the render path; both platforms regenerate from identical code and the Swift side must independently reproduce the web numbers. The added `masterWet` case is what actually pins the reverb/delay/limiter twin behavior end-to-end (the four originals only gain latency because their sends are 0).
- **2b review guidance folded in:** limiter gain is per-sample (not control-rate) — zipper-safe; the hot-chain (10×-peak) brickwall case is a required limiter test; denormal flush is baked into every reverb/delay feedback write; the denormal-flush *assessment* is a benchmark scenario. `reset()` allocates nowhere (the `DriveEq.reset()` anti-pattern is called out in Global Constraints).
- **Scope discipline:** reverb delay-line lengths are fixed (the plate's character); `decay`/`damping`/`predelay`/`modulation` are the tunable surface. Runtime "size" morphing, per-generation FX chains, tempo-sync from a live clock, and multitimbral master relocation are explicit non-goals for 2c. `MasterConfig` is baked (default + optional engine override), matching the spec's "patches bake their FX settings; apps get wet/dry levels at most."
- **Send routing:** reverb and delay both tap the **dry** (post-insert) bus; their wet sums back; the limiter runs last. Task 5 Step 1b calls out the tap-ordering correctness the reviewer must check.
