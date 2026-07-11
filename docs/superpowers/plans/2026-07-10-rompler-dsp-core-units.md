# Rompler DSP Core Units — Implementation Plan (Phase 1a)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the pure per-sample DSP units of the rompler engine (spec: `docs/superpowers/specs/2026-07-10-alloy-rompler-engine-design.md`) as mirrored TypeScript/Swift twins with tests — PRNG, ADSR, LFO, polyBLEP oscillators, SVF, and the four tone generators (FM, additive, VA, sample-zone).

**Architecture:** Every unit is pure math over doubles with `Float32Array`/`[Float]` only at block boundaries — zero WebAudio/AVFoundation imports. Web is canonical; each task implements TS first, then the Swift twin in the same change set (one commit per task holds both). Voice assembly, patch model, transport clock, and platform hosts are Phase 1b (separate plan).

**Tech Stack:** TypeScript (ESM, Vitest) in `web/packages/alloy-audio`; Swift (Foundation only, swift-testing/XCTest per existing suite style) in `swift/Sources/AlloyAudio`.

## Global Constraints

- No WebAudio imports anywhere under `src/dsp/`; no AVFoundation imports anywhere under `Sources/AlloyAudio/DSP/`. Foundation only on Swift.
- Internal math in double precision (JS `number`, Swift `Double`); `Float32Array` / `[Float]` only at render boundaries.
- Determinism is a hard constraint: no `Math.random()`, `Date.now()`, or platform randomness — `DspPrng` (Task 1) is the only randomness source.
- Twin protocol (docs/mirroring.md): TS designed first, Swift ported in the same change set; every commit contains both twins and both test suites pass.
- Twin numeric tests: shared hard-coded reference values in both test files, tolerance 1e-6 absolute (transcendental functions differ by ULPs across stdlibs; integer-only units like the PRNG match exactly).
- ESM imports use the `.js` suffix (existing package style). Conventional commits, subject ≤ 72 chars.
- Existing suites must stay green: `cd web/packages/alloy-audio && npx vitest run` and `cd swift && swift test` before every commit.

## File Structure

Web (create; tests colocated per existing package style):

| File | Responsibility |
|---|---|
| `web/packages/alloy-audio/src/dsp/dsp-types.ts` | `ToneGenerator` interface, shared constants |
| `web/packages/alloy-audio/src/dsp/prng.ts` | `DspPrng` xorshift32 |
| `web/packages/alloy-audio/src/dsp/adsr-envelope.ts` | `AdsrEnvelope` exponential ADSR |
| `web/packages/alloy-audio/src/dsp/lfo.ts` | `Lfo` |
| `web/packages/alloy-audio/src/dsp/poly-blep-oscillator.ts` | `PolyBlepOscillator` |
| `web/packages/alloy-audio/src/dsp/svf.ts` | `Svf` TPT state-variable filter |
| `web/packages/alloy-audio/src/dsp/fm-generator.ts` | `FmGenerator` operator stack |
| `web/packages/alloy-audio/src/dsp/additive-generator.ts` | `AdditiveGenerator` partial bank |
| `web/packages/alloy-audio/src/dsp/va-generator.ts` | `VaGenerator` unison stack |
| `web/packages/alloy-audio/src/dsp/sample-zone-generator.ts` | `SampleZoneGenerator` zones/layers/loops |

Swift twins: `swift/Sources/AlloyAudio/DSP/<TypeName>.swift` (`ToneGenerator.swift`, `DspPrng.swift`, `AdsrEnvelope.swift`, `Lfo.swift`, `PolyBlepOscillator.swift`, `Svf.swift`, `FmGenerator.swift`, `AdditiveGenerator.swift`, `VaGenerator.swift`, `SampleZoneGenerator.swift`), tests in `swift/Tests/AlloyAudioTests/<TypeName>Tests.swift`. Match the assertion style you find in `swift/Tests/AlloyAudioTests/OscillatorTests.swift` (XCTest vs swift-testing) — read it before writing the first Swift test.

`web/packages/alloy-audio/src/index.ts` gains one `export * from './dsp/<file>.js';` line per public file as it lands.

## Twin reference-value workflow (used by every task)

TS spec files contain a `TWIN_REFERENCE` constant (first 8 rendered samples of a fixed scenario). To fill it: temporarily add `console.log(JSON.stringify(Array.from(out.subarray(0, 8))))` in the named spec test, run it, copy the printed array into `TWIN_REFERENCE` in the TS spec **and** into `twinReference` in the Swift test, delete the log line, re-run both. The plan marks this step in each task as **"Capture twin reference"**. Assert per element: TS `expect(out[i]).toBeCloseTo(TWIN_REFERENCE[i], 6)`, Swift `XCTAssertEqual(out[i], twinReference[i], accuracy: 1e-6)` (exact equality for the PRNG).

---

### Task 1: DSP scaffolding + seeded PRNG

**Files:**
- Create: `web/packages/alloy-audio/src/dsp/dsp-types.ts`
- Create: `web/packages/alloy-audio/src/dsp/prng.ts`
- Test: `web/packages/alloy-audio/src/dsp/prng.spec.ts`
- Create: `swift/Sources/AlloyAudio/DSP/ToneGenerator.swift`
- Create: `swift/Sources/AlloyAudio/DSP/DspPrng.swift`
- Test: `swift/Tests/AlloyAudioTests/DspPrngTests.swift`
- Modify: `web/packages/alloy-audio/src/index.ts` (add two export lines)

**Interfaces:**
- Consumes: nothing.
- Produces (every later task depends on these exact shapes):
  - TS `dsp-types.ts`: `TWO_PI: number`, `SILENCE_FLOOR: number` (= 1e-5), and
    ```ts
    export interface ToneGenerator {
      noteOn(midi: number, velocity: number): void;
      noteOff(): void;
      render(out: Float32Array, frames: number): void; // ADDS into out
      readonly finished: boolean;
    }
    ```
  - TS `prng.ts`: `class DspPrng { constructor(seed: number); next(): number }` — uniform in [0,1).
  - Swift: `enum DspConstants { static let twoPi: Double; static let silenceFloor: Double }`, `protocol ToneGenerator: AnyObject { func noteOn(midi: Int, velocity: Double); func noteOff(); func render(into out: inout [Float], frames: Int); var finished: Bool { get } }`, `final class DspPrng { init(seed: UInt32); func next() -> Double }`.

- [ ] **Step 1: Write the failing TS test**

`web/packages/alloy-audio/src/dsp/prng.spec.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { DspPrng } from './prng.js';

// Filled via the twin reference workflow (integer-exact: tolerance 0).
const TWIN_REFERENCE: number[] = [];

describe('DspPrng', () => {
  it('is deterministic for a given seed', () => {
    const a = new DspPrng(42);
    const b = new DspPrng(42);
    for (let i = 0; i < 100; i++) {
      expect(a.next()).toBe(b.next());
    }
  });

  it('yields different sequences for different seeds', () => {
    const a = new DspPrng(1);
    const b = new DspPrng(2);
    const same = Array.from({ length: 10 }, () => a.next() === b.next());
    expect(same).toContain(false);
  });

  it('stays in [0, 1)', () => {
    const prng = new DspPrng(7);
    for (let i = 0; i < 10_000; i++) {
      const v = prng.next();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('treats seed 0 as a nonzero default (xorshift fixed point guard)', () => {
    const prng = new DspPrng(0);
    expect(prng.next()).not.toBe(0);
  });

  it('matches the twin reference sequence (seed 1)', () => {
    const prng = new DspPrng(1);
    const out = new Float32Array(8).map(() => prng.next());
    // console.log(JSON.stringify(Array.from(out.subarray(0, 8))));  <-- capture step, then delete
    expect(TWIN_REFERENCE).toHaveLength(8);
    TWIN_REFERENCE.forEach((v, i) => expect(out[i]).toBeCloseTo(v, 6));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web/packages/alloy-audio && npx vitest run src/dsp/prng.spec.ts`
Expected: FAIL — cannot resolve `./prng.js`.

- [ ] **Step 3: Write the TS implementation**

`web/packages/alloy-audio/src/dsp/dsp-types.ts`:

```ts
// Shared DSP-core contracts. Everything under src/dsp/ is pure math: no
// WebAudio imports, double-precision internals, Float32 only at render
// boundaries. Twin: swift/Sources/AlloyAudio/DSP/ToneGenerator.swift.

export const TWO_PI = 2 * Math.PI;

/** Envelope level below this is treated as silence (≈ −100 dBFS). */
export const SILENCE_FLOOR = 1e-5;

/**
 * A tone source for one note. `render` ADDS into `out` (the caller owns
 * zero-fill) so layers and voices sum without scratch buffers.
 *
 * Lifetime contract: `finished` means self-terminated — only silence can
 * ever follow (FM with all carrier envelopes idle; an unlooped sample past
 * its last frame). Sustained kinds (VA, additive, looped samples) never
 * self-finish: `noteOff` only forwards key-up to intrinsic envelopes, and
 * the voice's TVA (phase 1b) owns the audible release and voice teardown.
 */
export interface ToneGenerator {
  noteOn(midi: number, velocity: number): void;
  noteOff(): void;
  render(out: Float32Array, frames: number): void;
  readonly finished: boolean;
}
```

`web/packages/alloy-audio/src/dsp/prng.ts`:

```ts
/**
 * Xorshift32 — the DSP core's only randomness source (engine determinism
 * is a hard constraint). Integer ops only, so the TS and Swift twins
 * produce bit-identical sequences. Twin: DspPrng.swift.
 */
export class DspPrng {
  private state: number;

  constructor(seed: number) {
    const s = seed >>> 0;
    this.state = s === 0 ? 0x9e3779b9 : s;
  }

  /** Uniform double in [0, 1). */
  next(): number {
    let x = this.state;
    x = (x ^ (x << 13)) >>> 0;
    x = (x ^ (x >>> 17)) >>> 0;
    x = (x ^ (x << 5)) >>> 0;
    this.state = x;
    return x / 4294967296;
  }
}
```

Append to `web/packages/alloy-audio/src/index.ts`:

```ts
export * from './dsp/dsp-types.js';
export * from './dsp/prng.js';
```

- [ ] **Step 4: Capture twin reference**

Uncomment the `console.log` line in the spec, run `npx vitest run src/dsp/prng.spec.ts`, copy the 8 printed values into `TWIN_REFERENCE`, delete the log line. Re-run: all tests PASS.

- [ ] **Step 5: Read the existing Swift test style**

Read `swift/Tests/AlloyAudioTests/OscillatorTests.swift` and use the same framework and assertion idioms for all Swift tests in this plan (the plan writes XCTest below; adapt mechanically if the suite uses swift-testing `#expect`).

- [ ] **Step 6: Write the failing Swift test**

`swift/Tests/AlloyAudioTests/DspPrngTests.swift`:

```swift
@testable import AlloyAudio
import XCTest

final class DspPrngTests: XCTestCase {
    // Same 8 values as prng.spec.ts TWIN_REFERENCE (integer-exact).
    private let twinReference: [Double] = [ /* paste from TS capture step */ ]

    func testDeterministicForSeed() {
        let a = DspPrng(seed: 42)
        let b = DspPrng(seed: 42)
        for _ in 0..<100 {
            XCTAssertEqual(a.next(), b.next())
        }
    }

    func testStaysInUnitInterval() {
        let prng = DspPrng(seed: 7)
        for _ in 0..<10000 {
            let v = prng.next()
            XCTAssertGreaterThanOrEqual(v, 0)
            XCTAssertLessThan(v, 1)
        }
    }

    func testSeedZeroUsesNonzeroDefault() {
        XCTAssertNotEqual(DspPrng(seed: 0).next(), 0)
    }

    func testMatchesTwinReference() {
        let prng = DspPrng(seed: 1)
        XCTAssertEqual(twinReference.count, 8)
        for expected in twinReference {
            XCTAssertEqual(prng.next(), expected, accuracy: 1e-12)
        }
    }
}
```

Paste the captured values into `twinReference` now.

- [ ] **Step 7: Run to verify it fails**

Run: `cd swift && swift test --filter DspPrngTests`
Expected: FAIL — `DspPrng` not found.

- [ ] **Step 8: Write the Swift implementation**

`swift/Sources/AlloyAudio/DSP/ToneGenerator.swift`:

```swift
/// Shared DSP-core contracts. Everything under DSP/ is pure math: no
/// AVFoundation imports, Double internals, Float only at render
/// boundaries. Twin of web alloy-audio src/dsp/dsp-types.ts (canonical).

public enum DspConstants {
    public static let twoPi = 2.0 * Double.pi
    /// Envelope level below this is treated as silence (≈ −100 dBFS).
    public static let silenceFloor = 1e-5
}

/// A tone source for one note. `render` ADDS into `out` (caller owns
/// zero-fill). `finished` means self-terminated — only silence can ever
/// follow. Sustained kinds never self-finish; `noteOff` only forwards
/// key-up to intrinsic envelopes (the voice TVA owns the audible release).
public protocol ToneGenerator: AnyObject {
    func noteOn(midi: Int, velocity: Double)
    func noteOff()
    func render(into out: inout [Float], frames: Int)
    var finished: Bool { get }
}
```

`swift/Sources/AlloyAudio/DSP/DspPrng.swift`:

```swift
/// Xorshift32 — the DSP core's only randomness source. Integer ops only,
/// bit-identical to the web twin (src/dsp/prng.ts).
public final class DspPrng {
    private var state: UInt32

    public init(seed: UInt32) {
        state = seed == 0 ? 0x9E37_79B9 : seed
    }

    /// Uniform double in [0, 1).
    public func next() -> Double {
        var x = state
        x ^= x << 13
        x ^= x >> 17
        x ^= x << 5
        state = x
        return Double(x) / 4_294_967_296.0
    }
}
```

- [ ] **Step 9: Run both suites**

Run: `cd swift && swift test --filter DspPrngTests` → PASS.
Run: `cd web/packages/alloy-audio && npx vitest run` → PASS (all existing + new).
Run: `cd swift && swift test` → PASS.

- [ ] **Step 10: Commit**

```bash
git add web/packages/alloy-audio/src/dsp web/packages/alloy-audio/src/index.ts swift/Sources/AlloyAudio/DSP swift/Tests/AlloyAudioTests/DspPrngTests.swift
git commit -m "feat(audio): add DSP core scaffolding and seeded PRNG twins"
```

---

### Task 2: ADSR envelope

**Files:**
- Create: `web/packages/alloy-audio/src/dsp/adsr-envelope.ts`
- Test: `web/packages/alloy-audio/src/dsp/adsr-envelope.spec.ts`
- Create: `swift/Sources/AlloyAudio/DSP/AdsrEnvelope.swift`
- Test: `swift/Tests/AlloyAudioTests/AdsrEnvelopeTests.swift`
- Modify: `web/packages/alloy-audio/src/index.ts`

**Interfaces:**
- Consumes: `SILENCE_FLOOR` from `./dsp-types.js` / `DspConstants.silenceFloor`.
- Produces:
  - TS: `interface AdsrParams { attack: number; decay: number; sustain: number; release: number }` (attack in seconds to full level; decay/release are one-pole time constants in seconds; sustain 0..1) and `class AdsrEnvelope { constructor(params: AdsrParams, sampleRate: number); noteOn(): void; noteOff(): void; nextSample(): number; readonly isActive: boolean }`.
  - Swift: `struct AdsrParams { let attack, decay, sustain, release: Double }` + `final class AdsrEnvelope { init(params: AdsrParams, sampleRate: Double); func noteOn(); func noteOff(); func nextSample() -> Double; var isActive: Bool }`.

- [ ] **Step 1: Write the failing TS test**

`web/packages/alloy-audio/src/dsp/adsr-envelope.spec.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { AdsrEnvelope } from './adsr-envelope.js';

const FS = 48_000;
const PARAMS = { attack: 0.01, decay: 0.1, sustain: 0.5, release: 0.05 };

const TWIN_REFERENCE: number[] = [];

function renderSamples(env: AdsrEnvelope, n: number): number[] {
  return Array.from({ length: n }, () => env.nextSample());
}

describe('AdsrEnvelope', () => {
  it('is silent and inactive before noteOn', () => {
    const env = new AdsrEnvelope(PARAMS, FS);
    expect(env.isActive).toBe(false);
    expect(env.nextSample()).toBe(0);
  });

  it('rises monotonically to 1 within ~2x attack time', () => {
    const env = new AdsrEnvelope(PARAMS, FS);
    env.noteOn();
    const out = renderSamples(env, Math.round(2 * PARAMS.attack * FS));
    for (let i = 1; i < out.length; i++) {
      expect(out[i]).toBeGreaterThanOrEqual(out[i - 1] - 1e-12);
    }
    expect(Math.max(...out)).toBe(1);
  });

  it('decays toward sustain after the peak', () => {
    const env = new AdsrEnvelope(PARAMS, FS);
    env.noteOn();
    renderSamples(env, Math.round((PARAMS.attack + 6 * PARAMS.decay) * FS));
    const settled = env.nextSample();
    expect(settled).toBeGreaterThan(PARAMS.sustain * 0.98);
    expect(settled).toBeLessThan(PARAMS.sustain * 1.02);
  });

  it('releases to silence and goes inactive after noteOff', () => {
    const env = new AdsrEnvelope(PARAMS, FS);
    env.noteOn();
    renderSamples(env, Math.round(0.2 * FS));
    env.noteOff();
    renderSamples(env, Math.round(15 * PARAMS.release * FS));
    expect(env.isActive).toBe(false);
    expect(env.nextSample()).toBe(0);
  });

  it('matches the twin reference (first 8 samples of attack)', () => {
    const env = new AdsrEnvelope(PARAMS, FS);
    env.noteOn();
    const out = new Float32Array(8);
    for (let i = 0; i < 8; i++) out[i] = env.nextSample();
    // console.log(JSON.stringify(Array.from(out.subarray(0, 8))));
    expect(TWIN_REFERENCE).toHaveLength(8);
    TWIN_REFERENCE.forEach((v, i) => expect(out[i]).toBeCloseTo(v, 6));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web/packages/alloy-audio && npx vitest run src/dsp/adsr-envelope.spec.ts`
Expected: FAIL — cannot resolve `./adsr-envelope.js`.

- [ ] **Step 3: Write the TS implementation**

`web/packages/alloy-audio/src/dsp/adsr-envelope.ts`:

```ts
// Exponential-segment ADSR: one-pole approach toward a target per stage —
// the classic analog RC shape (and the reason it never clicks). Twin:
// AdsrEnvelope.swift.

import { SILENCE_FLOOR } from './dsp-types.js';

export interface AdsrParams {
  /** Seconds for the attack stage to reach full level from silence. */
  attack: number;
  /** One-pole time constant (seconds) of the fall toward sustain. */
  decay: number;
  /** Level held while the key is down, 0..1. */
  sustain: number;
  /** One-pole time constant (seconds) of the fall toward silence. */
  release: number;
}

const ATTACK_OVERSHOOT = 1.3;
// A one-pole aiming at 1.3 crosses 1.0 after ln(1.3/0.3) time constants;
// dividing the requested attack time by this makes the stage complete in
// ≈ `attack` seconds.
const ATTACK_TAU_FACTOR = Math.log(ATTACK_OVERSHOOT / (ATTACK_OVERSHOOT - 1));

type Stage = 'idle' | 'attack' | 'decay' | 'release';

export class AdsrEnvelope {
  private stage: Stage = 'idle';
  private level = 0;
  private readonly attackCoef: number;
  private readonly decayCoef: number;
  private readonly releaseCoef: number;

  constructor(
    private readonly params: AdsrParams,
    sampleRate: number,
  ) {
    this.attackCoef = onePoleCoef(params.attack / ATTACK_TAU_FACTOR, sampleRate);
    this.decayCoef = onePoleCoef(params.decay, sampleRate);
    this.releaseCoef = onePoleCoef(params.release, sampleRate);
  }

  get isActive(): boolean {
    return this.stage !== 'idle';
  }

  noteOn(): void {
    this.stage = 'attack';
  }

  noteOff(): void {
    if (this.stage !== 'idle') {
      this.stage = 'release';
    }
  }

  nextSample(): number {
    switch (this.stage) {
      case 'idle':
        return 0;
      case 'attack':
        this.level += this.attackCoef * (ATTACK_OVERSHOOT - this.level);
        if (this.level >= 1) {
          this.level = 1;
          this.stage = 'decay';
        }
        return this.level;
      case 'decay':
        this.level += this.decayCoef * (this.params.sustain - this.level);
        return this.level;
      case 'release':
        this.level += this.releaseCoef * (0 - this.level);
        if (this.level <= SILENCE_FLOOR) {
          this.level = 0;
          this.stage = 'idle';
        }
        return this.level;
    }
  }
}

/** Coefficient for `level += coef * (target - level)` with time constant `tau` seconds. */
function onePoleCoef(tau: number, sampleRate: number): number {
  return 1 - Math.exp(-1 / (Math.max(tau, 1e-4) * sampleRate));
}
```

Append to `index.ts`: `export * from './dsp/adsr-envelope.js';`

- [ ] **Step 4: Capture twin reference**

Uncomment the log, run `npx vitest run src/dsp/adsr-envelope.spec.ts`, paste the 8 values into `TWIN_REFERENCE`, delete the log. Re-run: PASS.

- [ ] **Step 5: Write the failing Swift test**

`swift/Tests/AlloyAudioTests/AdsrEnvelopeTests.swift`:

```swift
@testable import AlloyAudio
import XCTest

final class AdsrEnvelopeTests: XCTestCase {
    private let fs = 48_000.0
    private let params = AdsrParams(attack: 0.01, decay: 0.1, sustain: 0.5, release: 0.05)
    // Same values as adsr-envelope.spec.ts TWIN_REFERENCE.
    private let twinReference: [Double] = [ /* paste from TS capture step */ ]

    private func render(_ env: AdsrEnvelope, _ n: Int) -> [Double] {
        (0..<n).map { _ in env.nextSample() }
    }

    func testSilentBeforeNoteOn() {
        let env = AdsrEnvelope(params: params, sampleRate: fs)
        XCTAssertFalse(env.isActive)
        XCTAssertEqual(env.nextSample(), 0)
    }

    func testMonotonicAttackReachesOne() {
        let env = AdsrEnvelope(params: params, sampleRate: fs)
        env.noteOn()
        let out = render(env, Int(2 * params.attack * fs))
        for i in 1..<out.count {
            XCTAssertGreaterThanOrEqual(out[i], out[i - 1] - 1e-12)
        }
        XCTAssertEqual(out.max(), 1)
    }

    func testDecaysTowardSustain() {
        let env = AdsrEnvelope(params: params, sampleRate: fs)
        env.noteOn()
        _ = render(env, Int((params.attack + 6 * params.decay) * fs))
        let settled = env.nextSample()
        XCTAssertGreaterThan(settled, params.sustain * 0.98)
        XCTAssertLessThan(settled, params.sustain * 1.02)
    }

    func testReleaseEndsInactive() {
        let env = AdsrEnvelope(params: params, sampleRate: fs)
        env.noteOn()
        _ = render(env, Int(0.2 * fs))
        env.noteOff()
        _ = render(env, Int(15 * params.release * fs))
        XCTAssertFalse(env.isActive)
        XCTAssertEqual(env.nextSample(), 0)
    }

    func testMatchesTwinReference() {
        let env = AdsrEnvelope(params: params, sampleRate: fs)
        env.noteOn()
        XCTAssertEqual(twinReference.count, 8)
        for expected in twinReference {
            XCTAssertEqual(env.nextSample(), expected, accuracy: 1e-6)
        }
    }
}
```

- [ ] **Step 6: Run to verify it fails**

Run: `cd swift && swift test --filter AdsrEnvelopeTests`
Expected: FAIL — `AdsrParams`/`AdsrEnvelope` not found.

- [ ] **Step 7: Write the Swift implementation**

`swift/Sources/AlloyAudio/DSP/AdsrEnvelope.swift`:

```swift
import Foundation

/// Exponential-segment ADSR — one-pole approach toward a per-stage target.
/// Twin of web src/dsp/adsr-envelope.ts (canonical).
public struct AdsrParams {
    public let attack: Double
    public let decay: Double
    public let sustain: Double
    public let release: Double

    public init(attack: Double, decay: Double, sustain: Double, release: Double) {
        self.attack = attack
        self.decay = decay
        self.sustain = sustain
        self.release = release
    }
}

public final class AdsrEnvelope {
    private enum Stage { case idle, attack, decay, release }

    private static let attackOvershoot = 1.3
    private static let attackTauFactor = log(attackOvershoot / (attackOvershoot - 1))

    private var stage = Stage.idle
    private var level = 0.0
    private let params: AdsrParams
    private let attackCoef: Double
    private let decayCoef: Double
    private let releaseCoef: Double

    public init(params: AdsrParams, sampleRate: Double) {
        self.params = params
        attackCoef = Self.onePoleCoef(tau: params.attack / Self.attackTauFactor, sampleRate: sampleRate)
        decayCoef = Self.onePoleCoef(tau: params.decay, sampleRate: sampleRate)
        releaseCoef = Self.onePoleCoef(tau: params.release, sampleRate: sampleRate)
    }

    public var isActive: Bool { stage != .idle }

    public func noteOn() { stage = .attack }

    public func noteOff() {
        if stage != .idle { stage = .release }
    }

    public func nextSample() -> Double {
        switch stage {
        case .idle:
            return 0
        case .attack:
            level += attackCoef * (Self.attackOvershoot - level)
            if level >= 1 {
                level = 1
                stage = .decay
            }
            return level
        case .decay:
            level += decayCoef * (params.sustain - level)
            return level
        case .release:
            level += releaseCoef * (0 - level)
            if level <= DspConstants.silenceFloor {
                level = 0
                stage = .idle
            }
            return level
        }
    }

    private static func onePoleCoef(tau: Double, sampleRate: Double) -> Double {
        1 - exp(-1 / (max(tau, 1e-4) * sampleRate))
    }
}
```

- [ ] **Step 8: Run both suites**

Run: `cd swift && swift test --filter AdsrEnvelopeTests` → PASS.
Run: `cd web/packages/alloy-audio && npx vitest run && cd ../../../swift && swift test` → PASS.

- [ ] **Step 9: Commit**

```bash
git add web/packages/alloy-audio/src swift/Sources/AlloyAudio/DSP swift/Tests/AlloyAudioTests/AdsrEnvelopeTests.swift
git commit -m "feat(audio): add exponential ADSR envelope twins"
```

---

### Task 3: LFO

**Files:**
- Create: `web/packages/alloy-audio/src/dsp/lfo.ts`
- Test: `web/packages/alloy-audio/src/dsp/lfo.spec.ts`
- Create: `swift/Sources/AlloyAudio/DSP/Lfo.swift`
- Test: `swift/Tests/AlloyAudioTests/LfoTests.swift`
- Modify: `web/packages/alloy-audio/src/index.ts`

**Interfaces:**
- Consumes: `TWO_PI` / `DspConstants.twoPi`.
- Produces:
  - TS: `type LfoShape = 'sine' | 'triangle'`, `interface LfoParams { shape: LfoShape; rateHz: number; delay: number; fadeIn: number }`, `class Lfo { constructor(params: LfoParams, sampleRate: number); nextSample(): number }` — output in [−1, 1], gated by delay then linear fade-in; both shapes start at 0 and rise.
  - Swift: `enum LfoShape { case sine, triangle }`, `struct LfoParams`, `final class Lfo { init(params: LfoParams, sampleRate: Double); func nextSample() -> Double }`.

- [ ] **Step 1: Write the failing TS test**

`web/packages/alloy-audio/src/dsp/lfo.spec.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { Lfo } from './lfo.js';

const FS = 1000; // low rate keeps hand math easy

const TWIN_REFERENCE: number[] = [];

describe('Lfo', () => {
  it('outputs zero during the delay window', () => {
    const lfo = new Lfo({ shape: 'sine', rateHz: 10, delay: 0.1, fadeIn: 0 }, FS);
    for (let i = 0; i < 100; i++) {
      expect(lfo.nextSample()).toBe(0);
    }
    expect(lfo.nextSample()).not.toBe(0);
  });

  it('fades depth in linearly after the delay', () => {
    const lfo = new Lfo({ shape: 'triangle', rateHz: 1, delay: 0, fadeIn: 1 }, FS);
    const out = Array.from({ length: 260 }, () => lfo.nextSample());
    // At 1 Hz triangle, sample 250 is the crest (+1 raw); fade gate there is 0.25.
    expect(out[250]).toBeCloseTo(0.25, 2);
  });

  it('stays within [-1, 1] and is periodic', () => {
    const lfo = new Lfo({ shape: 'sine', rateHz: 50, delay: 0, fadeIn: 0 }, FS);
    const out = Array.from({ length: 200 }, () => lfo.nextSample());
    out.forEach((v) => {
      expect(Math.abs(v)).toBeLessThanOrEqual(1);
    });
    // 50 Hz at 1 kHz -> period 20 samples.
    for (let i = 0; i < 100; i++) {
      expect(out[i]).toBeCloseTo(out[i + 20], 9);
    }
  });

  it('matches the twin reference (sine 50 Hz, no gate)', () => {
    const lfo = new Lfo({ shape: 'sine', rateHz: 50, delay: 0, fadeIn: 0 }, FS);
    const out = new Float32Array(8);
    for (let i = 0; i < 8; i++) out[i] = lfo.nextSample();
    // console.log(JSON.stringify(Array.from(out.subarray(0, 8))));
    expect(TWIN_REFERENCE).toHaveLength(8);
    TWIN_REFERENCE.forEach((v, i) => expect(out[i]).toBeCloseTo(v, 6));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web/packages/alloy-audio && npx vitest run src/dsp/lfo.spec.ts`
Expected: FAIL — cannot resolve `./lfo.js`.

- [ ] **Step 3: Write the TS implementation**

`web/packages/alloy-audio/src/dsp/lfo.ts`:

```ts
// Modulation LFO with delay + fade-in gate (vibrato that arrives late is
// the single most "played by a human" trick in the rompler book).
// Twin: Lfo.swift.

import { TWO_PI } from './dsp-types.js';

export type LfoShape = 'sine' | 'triangle';

export interface LfoParams {
  shape: LfoShape;
  rateHz: number;
  /** Seconds of silence before the LFO starts. */
  delay: number;
  /** Seconds to ramp depth 0 → 1 once started. */
  fadeIn: number;
}

export class Lfo {
  private phase = 0;
  private elapsed = 0;

  constructor(
    private readonly params: LfoParams,
    private readonly sampleRate: number,
  ) {}

  /** Next value in [−1, 1], gated by the delay/fade-in window. */
  nextSample(): number {
    const delaySamples = this.params.delay * this.sampleRate;
    const fadeSamples = this.params.fadeIn * this.sampleRate;
    const since = this.elapsed - delaySamples;
    this.elapsed += 1;
    if (since < 0) {
      return 0;
    }
    const gate = fadeSamples <= 0 ? 1 : Math.min(1, since / fadeSamples);
    const raw = this.params.shape === 'sine' ? Math.sin(TWO_PI * this.phase) : triangle(this.phase);
    this.phase += this.params.rateHz / this.sampleRate;
    this.phase -= Math.floor(this.phase);
    return raw * gate;
  }
}

/** Sine-aligned triangle: 0 → +1 → −1 → 0 across one cycle. */
function triangle(p: number): number {
  if (p < 0.25) {
    return 4 * p;
  }
  if (p < 0.75) {
    return 2 - 4 * p;
  }
  return 4 * p - 4;
}
```

Append to `index.ts`: `export * from './dsp/lfo.js';`

- [ ] **Step 4: Capture twin reference**

Same workflow. Re-run: PASS.

- [ ] **Step 5: Write the failing Swift test**

`swift/Tests/AlloyAudioTests/LfoTests.swift`:

```swift
@testable import AlloyAudio
import XCTest

final class LfoTests: XCTestCase {
    private let fs = 1000.0
    private let twinReference: [Double] = [ /* paste from TS capture step */ ]

    func testZeroDuringDelay() {
        let lfo = Lfo(params: LfoParams(shape: .sine, rateHz: 10, delay: 0.1, fadeIn: 0), sampleRate: fs)
        for _ in 0..<100 {
            XCTAssertEqual(lfo.nextSample(), 0)
        }
        XCTAssertNotEqual(lfo.nextSample(), 0)
    }

    func testLinearFadeIn() {
        let lfo = Lfo(params: LfoParams(shape: .triangle, rateHz: 1, delay: 0, fadeIn: 1), sampleRate: fs)
        let out = (0..<260).map { _ in lfo.nextSample() }
        XCTAssertEqual(out[250], 0.25, accuracy: 0.01)
    }

    func testBoundedAndPeriodic() {
        let lfo = Lfo(params: LfoParams(shape: .sine, rateHz: 50, delay: 0, fadeIn: 0), sampleRate: fs)
        let out = (0..<200).map { _ in lfo.nextSample() }
        for v in out {
            XCTAssertLessThanOrEqual(abs(v), 1)
        }
        for i in 0..<100 {
            XCTAssertEqual(out[i], out[i + 20], accuracy: 1e-9)
        }
    }

    func testMatchesTwinReference() {
        let lfo = Lfo(params: LfoParams(shape: .sine, rateHz: 50, delay: 0, fadeIn: 0), sampleRate: fs)
        XCTAssertEqual(twinReference.count, 8)
        for expected in twinReference {
            XCTAssertEqual(lfo.nextSample(), expected, accuracy: 1e-6)
        }
    }
}
```

- [ ] **Step 6: Run to verify it fails**

Run: `cd swift && swift test --filter LfoTests`
Expected: FAIL — `Lfo` not found.

- [ ] **Step 7: Write the Swift implementation**

`swift/Sources/AlloyAudio/DSP/Lfo.swift`:

```swift
import Foundation

/// Modulation LFO with delay + fade-in gate. Twin of web src/dsp/lfo.ts.
public enum LfoShape {
    case sine
    case triangle
}

public struct LfoParams {
    public let shape: LfoShape
    public let rateHz: Double
    public let delay: Double
    public let fadeIn: Double

    public init(shape: LfoShape, rateHz: Double, delay: Double, fadeIn: Double) {
        self.shape = shape
        self.rateHz = rateHz
        self.delay = delay
        self.fadeIn = fadeIn
    }
}

public final class Lfo {
    private var phase = 0.0
    private var elapsed = 0.0
    private let params: LfoParams
    private let sampleRate: Double

    public init(params: LfoParams, sampleRate: Double) {
        self.params = params
        self.sampleRate = sampleRate
    }

    public func nextSample() -> Double {
        let delaySamples = params.delay * sampleRate
        let fadeSamples = params.fadeIn * sampleRate
        let since = elapsed - delaySamples
        elapsed += 1
        if since < 0 { return 0 }
        let gate = fadeSamples <= 0 ? 1 : min(1, since / fadeSamples)
        let raw: Double
        switch params.shape {
        case .sine:
            raw = sin(DspConstants.twoPi * phase)
        case .triangle:
            raw = Self.triangle(phase)
        }
        phase += params.rateHz / sampleRate
        phase -= phase.rounded(.down)
        return raw * gate
    }

    /// Sine-aligned triangle: 0 → +1 → −1 → 0 across one cycle.
    private static func triangle(_ p: Double) -> Double {
        if p < 0.25 { return 4 * p }
        if p < 0.75 { return 2 - 4 * p }
        return 4 * p - 4
    }
}
```

- [ ] **Step 8: Run both suites**

`cd swift && swift test --filter LfoTests` → PASS; then full `npx vitest run` + `swift test` → PASS.

- [ ] **Step 9: Commit**

```bash
git add web/packages/alloy-audio/src swift/Sources/AlloyAudio/DSP/Lfo.swift swift/Tests/AlloyAudioTests/LfoTests.swift
git commit -m "feat(audio): add LFO twins with delay and fade-in gate"
```

---

### Task 4: polyBLEP oscillators

**Files:**
- Create: `web/packages/alloy-audio/src/dsp/poly-blep-oscillator.ts`
- Test: `web/packages/alloy-audio/src/dsp/poly-blep-oscillator.spec.ts`
- Create: `swift/Sources/AlloyAudio/DSP/PolyBlepOscillator.swift`
- Test: `swift/Tests/AlloyAudioTests/PolyBlepOscillatorTests.swift`
- Modify: `web/packages/alloy-audio/src/index.ts`

**Interfaces:**
- Consumes: `TWO_PI` / `DspConstants.twoPi`.
- Produces:
  - TS: `type OscShape = 'sine' | 'saw' | 'pulse'`, `class PolyBlepOscillator { constructor(shape: OscShape, sampleRate: number, initialPhase?: number, pulseWidth?: number); setFrequency(hz: number): void; nextSample(): number }`.
  - Swift: `enum OscShape { case sine, saw, pulse }`, `final class PolyBlepOscillator { init(shape: OscShape, sampleRate: Double, initialPhase: Double = 0, pulseWidth: Double = 0.5); func setFrequency(_ hz: Double); func nextSample() -> Double }`.

- [ ] **Step 1: Write the failing TS test**

`web/packages/alloy-audio/src/dsp/poly-blep-oscillator.spec.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { PolyBlepOscillator } from './poly-blep-oscillator.js';

const FS = 48_000;

const TWIN_REFERENCE: number[] = [];

function render(osc: PolyBlepOscillator, n: number): number[] {
  return Array.from({ length: n }, () => osc.nextSample());
}

describe('PolyBlepOscillator', () => {
  it('sine matches Math.sin exactly', () => {
    const osc = new PolyBlepOscillator('sine', FS);
    osc.setFrequency(440);
    const out = render(osc, 100);
    out.forEach((v, i) => {
      expect(v).toBeCloseTo(Math.sin((2 * Math.PI * 440 * i) / FS), 9);
    });
  });

  it('saw softens the reset step relative to a naive saw', () => {
    const osc = new PolyBlepOscillator('saw', FS);
    osc.setFrequency(2000);
    const out = render(osc, 200);
    let maxJump = 0;
    for (let i = 1; i < out.length; i++) {
      maxJump = Math.max(maxJump, Math.abs(out[i] - out[i - 1]));
    }
    // Naive saw at 2 kHz/48 kHz jumps by 2 at reset; polyBLEP spreads it.
    expect(maxJump).toBeLessThan(1.4);
    expect(maxJump).toBeGreaterThan(0.2);
  });

  it('pulse mean tracks pulse width', () => {
    const osc = new PolyBlepOscillator('pulse', FS, 0, 0.25);
    osc.setFrequency(100);
    const out = render(osc, 4800); // 10 full cycles
    const mean = out.reduce((a, b) => a + b, 0) / out.length;
    expect(mean).toBeCloseTo(2 * 0.25 - 1, 1);
  });

  it('honors the initial phase', () => {
    const a = new PolyBlepOscillator('sine', FS, 0.25);
    a.setFrequency(440);
    expect(a.nextSample()).toBeCloseTo(1, 9);
  });

  it('matches the twin reference (saw 440 Hz)', () => {
    const osc = new PolyBlepOscillator('saw', FS);
    osc.setFrequency(440);
    const out = new Float32Array(8);
    for (let i = 0; i < 8; i++) out[i] = osc.nextSample();
    // console.log(JSON.stringify(Array.from(out.subarray(0, 8))));
    expect(TWIN_REFERENCE).toHaveLength(8);
    TWIN_REFERENCE.forEach((v, i) => expect(out[i]).toBeCloseTo(v, 6));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web/packages/alloy-audio && npx vitest run src/dsp/poly-blep-oscillator.spec.ts`
Expected: FAIL — cannot resolve module.

- [ ] **Step 3: Write the TS implementation**

`web/packages/alloy-audio/src/dsp/poly-blep-oscillator.ts`:

```ts
// Band-limited oscillator via polyBLEP edge correction: each waveform
// discontinuity is replaced by a 2-sample polynomial band-limited step.
// Sine needs no correction. Twin: PolyBlepOscillator.swift.

import { TWO_PI } from './dsp-types.js';

export type OscShape = 'sine' | 'saw' | 'pulse';

export class PolyBlepOscillator {
  private phase: number;
  private increment = 0;

  constructor(
    private readonly shape: OscShape,
    private readonly sampleRate: number,
    initialPhase = 0,
    private readonly pulseWidth = 0.5,
  ) {
    this.phase = wrap(initialPhase);
  }

  setFrequency(hz: number): void {
    this.increment = hz / this.sampleRate;
  }

  nextSample(): number {
    const t = this.phase;
    const dt = this.increment;
    let value: number;
    switch (this.shape) {
      case 'sine':
        value = Math.sin(TWO_PI * t);
        break;
      case 'saw':
        value = 2 * t - 1 - polyBlep(t, dt);
        break;
      case 'pulse': {
        const w = this.pulseWidth;
        value = (t < w ? 1 : -1) + polyBlep(t, dt) - polyBlep(wrap(t - w), dt);
        break;
      }
    }
    this.phase = wrap(t + dt);
    return value;
  }
}

function wrap(p: number): number {
  return p - Math.floor(p);
}

/** 2-sample polynomial band-limited step centered on the phase reset. */
function polyBlep(t: number, dt: number): number {
  if (dt <= 0) {
    return 0;
  }
  if (t < dt) {
    const x = t / dt;
    return x + x - x * x - 1;
  }
  if (t > 1 - dt) {
    const x = (t - 1) / dt;
    return x * x + x + x + 1;
  }
  return 0;
}
```

Append to `index.ts`: `export * from './dsp/poly-blep-oscillator.js';`

- [ ] **Step 4: Capture twin reference**

Same workflow. Re-run: PASS.

- [ ] **Step 5: Write the failing Swift test**

`swift/Tests/AlloyAudioTests/PolyBlepOscillatorTests.swift`:

```swift
@testable import AlloyAudio
import XCTest

final class PolyBlepOscillatorTests: XCTestCase {
    private let fs = 48_000.0
    private let twinReference: [Double] = [ /* paste from TS capture step */ ]

    func testSineMatchesStdlib() {
        let osc = PolyBlepOscillator(shape: .sine, sampleRate: fs)
        osc.setFrequency(440)
        for i in 0..<100 {
            XCTAssertEqual(osc.nextSample(), sin(2 * Double.pi * 440 * Double(i) / fs), accuracy: 1e-9)
        }
    }

    func testSawSoftensResetStep() {
        let osc = PolyBlepOscillator(shape: .saw, sampleRate: fs)
        osc.setFrequency(2000)
        let out = (0..<200).map { _ in osc.nextSample() }
        var maxJump = 0.0
        for i in 1..<out.count {
            maxJump = max(maxJump, abs(out[i] - out[i - 1]))
        }
        XCTAssertLessThan(maxJump, 1.4)
        XCTAssertGreaterThan(maxJump, 0.2)
    }

    func testPulseMeanTracksWidth() {
        let osc = PolyBlepOscillator(shape: .pulse, sampleRate: fs, pulseWidth: 0.25)
        osc.setFrequency(100)
        let out = (0..<4800).map { _ in osc.nextSample() }
        let mean = out.reduce(0, +) / Double(out.count)
        XCTAssertEqual(mean, 2 * 0.25 - 1, accuracy: 0.05)
    }

    func testInitialPhase() {
        let osc = PolyBlepOscillator(shape: .sine, sampleRate: fs, initialPhase: 0.25)
        osc.setFrequency(440)
        XCTAssertEqual(osc.nextSample(), 1, accuracy: 1e-9)
    }

    func testMatchesTwinReference() {
        let osc = PolyBlepOscillator(shape: .saw, sampleRate: fs)
        osc.setFrequency(440)
        XCTAssertEqual(twinReference.count, 8)
        for expected in twinReference {
            XCTAssertEqual(osc.nextSample(), expected, accuracy: 1e-6)
        }
    }
}
```

- [ ] **Step 6: Run to verify it fails**

Run: `cd swift && swift test --filter PolyBlepOscillatorTests`
Expected: FAIL — type not found.

- [ ] **Step 7: Write the Swift implementation**

`swift/Sources/AlloyAudio/DSP/PolyBlepOscillator.swift`:

```swift
import Foundation

/// Band-limited oscillator via polyBLEP edge correction. Twin of web
/// src/dsp/poly-blep-oscillator.ts (canonical).
public enum OscShape {
    case sine
    case saw
    case pulse
}

public final class PolyBlepOscillator {
    private let shape: OscShape
    private let sampleRate: Double
    private let pulseWidth: Double
    private var phase: Double
    private var increment = 0.0

    public init(shape: OscShape, sampleRate: Double, initialPhase: Double = 0, pulseWidth: Double = 0.5) {
        self.shape = shape
        self.sampleRate = sampleRate
        self.pulseWidth = pulseWidth
        phase = Self.wrap(initialPhase)
    }

    public func setFrequency(_ hz: Double) {
        increment = hz / sampleRate
    }

    public func nextSample() -> Double {
        let t = phase
        let dt = increment
        let value: Double
        switch shape {
        case .sine:
            value = sin(DspConstants.twoPi * t)
        case .saw:
            value = 2 * t - 1 - Self.polyBlep(t, dt)
        case .pulse:
            let w = pulseWidth
            value = (t < w ? 1 : -1) + Self.polyBlep(t, dt) - Self.polyBlep(Self.wrap(t - w), dt)
        }
        phase = Self.wrap(t + dt)
        return value
    }

    private static func wrap(_ p: Double) -> Double {
        p - p.rounded(.down)
    }

    /// 2-sample polynomial band-limited step centered on the phase reset.
    private static func polyBlep(_ t: Double, _ dt: Double) -> Double {
        if dt <= 0 { return 0 }
        if t < dt {
            let x = t / dt
            return x + x - x * x - 1
        }
        if t > 1 - dt {
            let x = (t - 1) / dt
            return x * x + x + x + 1
        }
        return 0
    }
}
```

Note: existing `Oscillator.swift` keeps its name — no collision.

- [ ] **Step 8: Run both suites**

`cd swift && swift test --filter PolyBlepOscillatorTests` → PASS; full `npx vitest run` + `swift test` → PASS.

- [ ] **Step 9: Commit**

```bash
git add web/packages/alloy-audio/src swift/Sources/AlloyAudio/DSP/PolyBlepOscillator.swift swift/Tests/AlloyAudioTests/PolyBlepOscillatorTests.swift
git commit -m "feat(audio): add polyBLEP oscillator twins"
```

---

### Task 5: State-variable filter (TVF)

**Files:**
- Create: `web/packages/alloy-audio/src/dsp/svf.ts`
- Test: `web/packages/alloy-audio/src/dsp/svf.spec.ts`
- Create: `swift/Sources/AlloyAudio/DSP/Svf.swift`
- Test: `swift/Tests/AlloyAudioTests/SvfTests.swift`
- Modify: `web/packages/alloy-audio/src/index.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces:
  - TS: `type SvfMode = 'lowpass' | 'bandpass' | 'highpass'`, `class Svf { constructor(mode: SvfMode, sampleRate: number); setParams(cutoffHz: number, q: number): void; process(x: number): number }`. `setParams` must be callable per block (stable under modulation — this is the patch TVF).
  - Swift: `enum SvfMode { case lowpass, bandpass, highpass }`, `final class Svf { init(mode: SvfMode, sampleRate: Double); func setParams(cutoffHz: Double, q: Double); func process(_ x: Double) -> Double }`.

- [ ] **Step 1: Write the failing TS test**

`web/packages/alloy-audio/src/dsp/svf.spec.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { Svf } from './svf.js';

const FS = 48_000;

const TWIN_REFERENCE: number[] = [];

function rms(xs: number[]): number {
  return Math.sqrt(xs.reduce((a, x) => a + x * x, 0) / xs.length);
}

function renderSine(filter: Svf, freq: number, n: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    out.push(filter.process(Math.sin((2 * Math.PI * freq * i) / FS)));
  }
  return out.slice(Math.floor(n / 2)); // discard transient
}

describe('Svf', () => {
  it('lowpass passes DC', () => {
    const f = new Svf('lowpass', FS);
    f.setParams(1000, 0.707);
    let y = 0;
    for (let i = 0; i < 4800; i++) y = f.process(1);
    expect(y).toBeCloseTo(1, 3);
  });

  it('highpass blocks DC', () => {
    const f = new Svf('highpass', FS);
    f.setParams(1000, 0.707);
    let y = 1;
    for (let i = 0; i < 4800; i++) y = f.process(1);
    expect(Math.abs(y)).toBeLessThan(1e-3);
  });

  it('lowpass attenuates far-above-cutoff content', () => {
    const f = new Svf('lowpass', FS);
    f.setParams(500, 0.707);
    const out = renderSine(f, 10_000, 9600);
    expect(rms(out)).toBeLessThan(0.05);
  });

  it('bandpass peaks at the cutoff and rejects far bands', () => {
    const make = () => {
      const f = new Svf('bandpass', FS);
      f.setParams(1000, 4);
      return f;
    };
    const atCenter = rms(renderSine(make(), 1000, 9600));
    const below = rms(renderSine(make(), 100, 9600));
    const above = rms(renderSine(make(), 10_000, 9600));
    expect(atCenter).toBeGreaterThan(below * 5);
    expect(atCenter).toBeGreaterThan(above * 5);
  });

  it('survives per-sample cutoff modulation without blowing up', () => {
    const f = new Svf('lowpass', FS);
    let peak = 0;
    for (let i = 0; i < 48_000; i++) {
      f.setParams(500 + 8000 * (0.5 + 0.5 * Math.sin(i / 40)), 4);
      peak = Math.max(peak, Math.abs(f.process(Math.sin(i / 3))));
    }
    expect(peak).toBeLessThan(4);
  });

  it('matches the twin reference (lowpass 1 kHz on a 440 Hz sine)', () => {
    const f = new Svf('lowpass', FS);
    f.setParams(1000, 0.707);
    const out = new Float32Array(8);
    for (let i = 0; i < 8; i++) out[i] = f.process(Math.sin((2 * Math.PI * 440 * i) / FS));
    // console.log(JSON.stringify(Array.from(out.subarray(0, 8))));
    expect(TWIN_REFERENCE).toHaveLength(8);
    TWIN_REFERENCE.forEach((v, i) => expect(out[i]).toBeCloseTo(v, 6));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web/packages/alloy-audio && npx vitest run src/dsp/svf.spec.ts`
Expected: FAIL — cannot resolve module.

- [ ] **Step 3: Write the TS implementation**

`web/packages/alloy-audio/src/dsp/svf.ts`:

```ts
// Topology-preserving-transform state variable filter (Zavalishin, "The
// Art of VA Filter Design"). Chosen over biquads because it stays stable
// under audio-rate cutoff modulation — this is the patch TVF, and filter
// envelopes sweep it constantly. Twin: Svf.swift.

export type SvfMode = 'lowpass' | 'bandpass' | 'highpass';

export class Svf {
  private ic1 = 0;
  private ic2 = 0;
  private k = 1;
  private a1 = 0;
  private a2 = 0;
  private a3 = 0;

  constructor(
    private readonly mode: SvfMode,
    private readonly sampleRate: number,
  ) {}

  setParams(cutoffHz: number, q: number): void {
    const clamped = Math.min(Math.max(cutoffHz, 10), this.sampleRate * 0.49);
    const g = Math.tan((Math.PI * clamped) / this.sampleRate);
    this.k = 1 / Math.max(q, 0.5);
    this.a1 = 1 / (1 + g * (g + this.k));
    this.a2 = g * this.a1;
    this.a3 = g * this.a2;
  }

  process(x: number): number {
    const v3 = x - this.ic2;
    const v1 = this.a1 * this.ic1 + this.a2 * v3;
    const v2 = this.ic2 + this.a2 * this.ic1 + this.a3 * v3;
    this.ic1 = 2 * v1 - this.ic1;
    this.ic2 = 2 * v2 - this.ic2;
    switch (this.mode) {
      case 'lowpass':
        return v2;
      case 'bandpass':
        return v1;
      case 'highpass':
        return x - this.k * v1 - v2;
    }
  }
}
```

Append to `index.ts`: `export * from './dsp/svf.js';`

- [ ] **Step 4: Capture twin reference**

Same workflow. Re-run: PASS.

- [ ] **Step 5: Write the failing Swift test**

`swift/Tests/AlloyAudioTests/SvfTests.swift` — mirror all six TS tests with the same numbers; the twin test:

```swift
@testable import AlloyAudio
import XCTest

final class SvfTests: XCTestCase {
    private let fs = 48_000.0
    private let twinReference: [Double] = [ /* paste from TS capture step */ ]

    private func rms(_ xs: [Double]) -> Double {
        sqrt(xs.reduce(0) { $0 + $1 * $1 } / Double(xs.count))
    }

    private func renderSine(_ filter: Svf, freq: Double, n: Int) -> [Double] {
        var out: [Double] = []
        for i in 0..<n {
            out.append(filter.process(sin(2 * Double.pi * freq * Double(i) / fs)))
        }
        return Array(out[(n / 2)...])
    }

    func testLowpassPassesDc() {
        let f = Svf(mode: .lowpass, sampleRate: fs)
        f.setParams(cutoffHz: 1000, q: 0.707)
        var y = 0.0
        for _ in 0..<4800 { y = f.process(1) }
        XCTAssertEqual(y, 1, accuracy: 1e-3)
    }

    func testHighpassBlocksDc() {
        let f = Svf(mode: .highpass, sampleRate: fs)
        f.setParams(cutoffHz: 1000, q: 0.707)
        var y = 1.0
        for _ in 0..<4800 { y = f.process(1) }
        XCTAssertLessThan(abs(y), 1e-3)
    }

    func testLowpassAttenuatesHighFrequencies() {
        let f = Svf(mode: .lowpass, sampleRate: fs)
        f.setParams(cutoffHz: 500, q: 0.707)
        XCTAssertLessThan(rms(renderSine(f, freq: 10_000, n: 9600)), 0.05)
    }

    func testBandpassPeaksAtCutoff() {
        func make() -> Svf {
            let f = Svf(mode: .bandpass, sampleRate: fs)
            f.setParams(cutoffHz: 1000, q: 4)
            return f
        }
        let atCenter = rms(renderSine(make(), freq: 1000, n: 9600))
        let below = rms(renderSine(make(), freq: 100, n: 9600))
        let above = rms(renderSine(make(), freq: 10_000, n: 9600))
        XCTAssertGreaterThan(atCenter, below * 5)
        XCTAssertGreaterThan(atCenter, above * 5)
    }

    func testStableUnderCutoffModulation() {
        let f = Svf(mode: .lowpass, sampleRate: fs)
        var peak = 0.0
        for i in 0..<48_000 {
            f.setParams(cutoffHz: 500 + 8000 * (0.5 + 0.5 * sin(Double(i) / 40)), q: 4)
            peak = max(peak, abs(f.process(sin(Double(i) / 3))))
        }
        XCTAssertLessThan(peak, 4)
    }

    func testMatchesTwinReference() {
        let f = Svf(mode: .lowpass, sampleRate: fs)
        f.setParams(cutoffHz: 1000, q: 0.707)
        XCTAssertEqual(twinReference.count, 8)
        for (i, expected) in twinReference.enumerated() {
            let y = f.process(sin(2 * Double.pi * 440 * Double(i) / fs))
            XCTAssertEqual(y, expected, accuracy: 1e-6)
        }
    }
}
```

- [ ] **Step 6: Run to verify it fails**

Run: `cd swift && swift test --filter SvfTests`
Expected: FAIL — `Svf` not found.

- [ ] **Step 7: Write the Swift implementation**

`swift/Sources/AlloyAudio/DSP/Svf.swift`:

```swift
import Foundation

/// Topology-preserving-transform state variable filter (Zavalishin).
/// Stable under audio-rate cutoff modulation — this is the patch TVF.
/// Twin of web src/dsp/svf.ts (canonical).
public enum SvfMode {
    case lowpass
    case bandpass
    case highpass
}

public final class Svf {
    private let mode: SvfMode
    private let sampleRate: Double
    private var ic1 = 0.0
    private var ic2 = 0.0
    private var k = 1.0
    private var a1 = 0.0
    private var a2 = 0.0
    private var a3 = 0.0

    public init(mode: SvfMode, sampleRate: Double) {
        self.mode = mode
        self.sampleRate = sampleRate
    }

    public func setParams(cutoffHz: Double, q: Double) {
        let clamped = min(max(cutoffHz, 10), sampleRate * 0.49)
        let g = tan(Double.pi * clamped / sampleRate)
        k = 1 / max(q, 0.5)
        a1 = 1 / (1 + g * (g + k))
        a2 = g * a1
        a3 = g * a2
    }

    public func process(_ x: Double) -> Double {
        let v3 = x - ic2
        let v1 = a1 * ic1 + a2 * v3
        let v2 = ic2 + a2 * ic1 + a3 * v3
        ic1 = 2 * v1 - ic1
        ic2 = 2 * v2 - ic2
        switch mode {
        case .lowpass: return v2
        case .bandpass: return v1
        case .highpass: return x - k * v1 - v2
        }
    }
}
```

- [ ] **Step 8: Run both suites**

`cd swift && swift test --filter SvfTests` → PASS; full `npx vitest run` + `swift test` → PASS.

- [ ] **Step 9: Commit**

```bash
git add web/packages/alloy-audio/src swift/Sources/AlloyAudio/DSP/Svf.swift swift/Tests/AlloyAudioTests/SvfTests.swift
git commit -m "feat(audio): add TPT state-variable filter twins"
```

---

### Task 6: FM generator

**Files:**
- Create: `web/packages/alloy-audio/src/dsp/fm-generator.ts`
- Test: `web/packages/alloy-audio/src/dsp/fm-generator.spec.ts`
- Create: `swift/Sources/AlloyAudio/DSP/FmGenerator.swift`
- Test: `swift/Tests/AlloyAudioTests/FmGeneratorTests.swift`
- Modify: `web/packages/alloy-audio/src/index.ts`

**Interfaces:**
- Consumes: `ToneGenerator`, `TWO_PI` (Task 1); `AdsrEnvelope`, `AdsrParams` (Task 2); `midiToFrequency` from `../pitch.js` (existing; Swift: `Pitch.swift`'s equivalent — check the exact Swift name in `swift/Sources/AlloyAudio/Pitch.swift` before use and mirror the call).
- Produces:
  - TS:
    ```ts
    export interface FmOperatorParams { ratio: number; level: number; adsr: AdsrParams }
    export interface FmAlgorithm {
      routes: ReadonlyArray<{ from: number; to: number }>; // from > to required
      carriers: readonly number[];
      feedback?: { op: number; amount: number };
    }
    export interface FmGeneratorParams { operators: readonly FmOperatorParams[]; algorithm: FmAlgorithm }
    export class FmGenerator implements ToneGenerator { constructor(params: FmGeneratorParams, sampleRate: number); /* ToneGenerator members */ }
    ```
    Semantics: operator output = `sin(TWO_PI * (phase + mod)) * env * level`; modulator `level` is phase-mod depth in cycles; `mod` = sum of routed modulator outputs (+ own previous output × feedback amount); carrier sum ÷ carrier count × noteOn velocity; `finished` = all carrier envelopes idle; velocity scales output amplitude only (velocity→mod-index routing is a phase-1b patch route).
  - Swift: same shapes (`FmOperatorParams`, `FmAlgorithm`, `FmRoute(from:to:)`, `FmFeedback(op:amount:)`, `FmGeneratorParams`, `final class FmGenerator: ToneGenerator`).

- [ ] **Step 1: Write the failing TS test**

`web/packages/alloy-audio/src/dsp/fm-generator.spec.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { AdsrEnvelope } from './adsr-envelope.js';
import { FmGenerator, type FmGeneratorParams } from './fm-generator.js';

const FS = 48_000;
const FAST_ADSR = { attack: 0.001, decay: 1, sustain: 1, release: 0.01 };

const TWIN_REFERENCE: number[] = [];

function twoOp(modLevel: number): FmGeneratorParams {
  return {
    operators: [
      { ratio: 1, level: 1, adsr: FAST_ADSR },
      { ratio: 2, level: modLevel, adsr: FAST_ADSR },
    ],
    algorithm: { routes: [{ from: 1, to: 0 }], carriers: [0] },
  };
}

function render(gen: FmGenerator, frames: number): Float32Array {
  const out = new Float32Array(frames);
  gen.render(out, frames);
  return out;
}

describe('FmGenerator', () => {
  it('with zero modulator level reduces to an enveloped sine', () => {
    const plain = new FmGenerator(twoOp(0), FS);
    plain.noteOn(69, 1);
    const out = render(plain, 512);
    // Compare against a hand-built enveloped sine using the same envelope params.
    const env = new AdsrEnvelope(FAST_ADSR, FS);
    env.noteOn();
    for (let i = 0; i < 512; i++) {
      const expected = Math.sin((2 * Math.PI * 440 * i) / FS) * env.nextSample();
      expect(out[i]).toBeCloseTo(expected, 5);
    }
  });

  it('modulation changes the waveform', () => {
    const plain = new FmGenerator(twoOp(0), FS);
    const modulated = new FmGenerator(twoOp(0.8), FS);
    plain.noteOn(69, 1);
    modulated.noteOn(69, 1);
    const a = render(plain, 512);
    const b = render(modulated, 512);
    let maxDiff = 0;
    for (let i = 0; i < 512; i++) maxDiff = Math.max(maxDiff, Math.abs(a[i] - b[i]));
    expect(maxDiff).toBeGreaterThan(0.1);
  });

  it('velocity scales amplitude linearly', () => {
    const loud = new FmGenerator(twoOp(0.5), FS);
    const quiet = new FmGenerator(twoOp(0.5), FS);
    loud.noteOn(60, 1);
    quiet.noteOn(60, 0.5);
    const a = render(loud, 256);
    const b = render(quiet, 256);
    for (let i = 0; i < 256; i++) expect(b[i]).toBeCloseTo(a[i] * 0.5, 6);
  });

  it('finishes after release and renders silence thereafter', () => {
    const gen = new FmGenerator(twoOp(0.5), FS);
    gen.noteOn(69, 1);
    render(gen, 256);
    gen.noteOff();
    render(gen, FS); // 1 s >> 10 ms release
    expect(gen.finished).toBe(true);
    const out = render(gen, 64);
    out.forEach((v) => expect(v).toBe(0));
  });

  it('rejects routes that do not flow from higher to lower index', () => {
    expect(
      () =>
        new FmGenerator(
          {
            operators: [
              { ratio: 1, level: 1, adsr: FAST_ADSR },
              { ratio: 1, level: 1, adsr: FAST_ADSR },
            ],
            algorithm: { routes: [{ from: 0, to: 1 }], carriers: [1] },
          },
          FS,
        ),
    ).toThrow();
  });

  it('matches the twin reference (2-op, feedback)', () => {
    const params = twoOp(0.7);
    const gen = new FmGenerator(
      { ...params, algorithm: { ...params.algorithm, feedback: { op: 1, amount: 0.3 } } },
      FS,
    );
    gen.noteOn(60, 1);
    const out = render(gen, 8);
    // console.log(JSON.stringify(Array.from(out.subarray(0, 8))));
    expect(TWIN_REFERENCE).toHaveLength(8);
    TWIN_REFERENCE.forEach((v, i) => expect(out[i]).toBeCloseTo(v, 6));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web/packages/alloy-audio && npx vitest run src/dsp/fm-generator.spec.ts`
Expected: FAIL — cannot resolve module.

- [ ] **Step 3: Write the TS implementation**

`web/packages/alloy-audio/src/dsp/fm-generator.ts`:

```ts
// Phase-modulation operator stack (DX-style "FM"). Modulators must sit at
// higher indices than the operators they modulate, so a single high-to-low
// evaluation pass per sample resolves every route without topology sorting.
// Twin: FmGenerator.swift.

import { AdsrEnvelope, type AdsrParams } from './adsr-envelope.js';
import { TWO_PI, type ToneGenerator } from './dsp-types.js';
import { midiToFrequency } from '../pitch.js';

export interface FmOperatorParams {
  /** Frequency ratio relative to the note frequency. */
  ratio: number;
  /** Carrier: output amplitude. Modulator: phase-mod depth in cycles. */
  level: number;
  adsr: AdsrParams;
}

export interface FmAlgorithm {
  /** Modulation routes; `from` must be greater than `to`. */
  routes: ReadonlyArray<{ from: number; to: number }>;
  /** Operator indices summed into the output. */
  carriers: readonly number[];
  /** Optional single-operator self phase-mod, depth in cycles. */
  feedback?: { op: number; amount: number };
}

export interface FmGeneratorParams {
  operators: readonly FmOperatorParams[];
  algorithm: FmAlgorithm;
}

export class FmGenerator implements ToneGenerator {
  private readonly envelopes: AdsrEnvelope[];
  private readonly phases: number[];
  private readonly outputs: number[];
  private frequency = 0;
  private amp = 0;

  constructor(
    private readonly params: FmGeneratorParams,
    private readonly sampleRate: number,
  ) {
    const opCount = params.operators.length;
    for (const route of params.algorithm.routes) {
      if (route.from <= route.to || route.from >= opCount || route.to < 0) {
        throw new Error('FM routes must flow from a higher to a lower operator index');
      }
    }
    for (const carrier of params.algorithm.carriers) {
      if (carrier < 0 || carrier >= opCount) {
        throw new Error('FM carrier index out of range');
      }
    }
    this.envelopes = params.operators.map((op) => new AdsrEnvelope(op.adsr, sampleRate));
    this.phases = params.operators.map(() => 0);
    this.outputs = params.operators.map(() => 0);
  }

  get finished(): boolean {
    return this.params.algorithm.carriers.every((c) => !this.envelopes[c].isActive);
  }

  noteOn(midi: number, velocity: number): void {
    this.frequency = midiToFrequency(midi);
    this.amp = velocity;
    this.phases.fill(0);
    this.outputs.fill(0);
    for (const env of this.envelopes) {
      env.noteOn();
    }
  }

  noteOff(): void {
    for (const env of this.envelopes) {
      env.noteOff();
    }
  }

  render(out: Float32Array, frames: number): void {
    const { operators, algorithm } = this.params;
    const carrierScale = this.amp / algorithm.carriers.length;
    for (let n = 0; n < frames; n++) {
      if (this.finished) {
        return;
      }
      for (let i = operators.length - 1; i >= 0; i--) {
        let mod = 0;
        for (const route of algorithm.routes) {
          if (route.to === i) {
            mod += this.outputs[route.from];
          }
        }
        const feedback = algorithm.feedback;
        if (feedback && feedback.op === i) {
          mod += this.outputs[i] * feedback.amount;
        }
        const env = this.envelopes[i].nextSample();
        this.outputs[i] = Math.sin(TWO_PI * (this.phases[i] + mod)) * env * operators[i].level;
        this.phases[i] += (this.frequency * operators[i].ratio) / this.sampleRate;
        this.phases[i] -= Math.floor(this.phases[i]);
      }
      let sample = 0;
      for (const c of algorithm.carriers) {
        sample += this.outputs[c];
      }
      out[n] += sample * carrierScale;
    }
  }
}
```

Append to `index.ts`: `export * from './dsp/fm-generator.js';`

- [ ] **Step 4: Capture twin reference**

Same workflow. Re-run: PASS.

- [ ] **Step 5: Write the failing Swift test**

`swift/Tests/AlloyAudioTests/FmGeneratorTests.swift` — mirror the TS tests (same params, same numbers). Structure:

```swift
@testable import AlloyAudio
import XCTest

final class FmGeneratorTests: XCTestCase {
    private let fs = 48_000.0
    private let fastAdsr = AdsrParams(attack: 0.001, decay: 1, sustain: 1, release: 0.01)
    private let twinReference: [Double] = [ /* paste from TS capture step */ ]

    private func twoOp(modLevel: Double) -> FmGeneratorParams {
        FmGeneratorParams(
            operators: [
                FmOperatorParams(ratio: 1, level: 1, adsr: fastAdsr),
                FmOperatorParams(ratio: 2, level: modLevel, adsr: fastAdsr),
            ],
            algorithm: FmAlgorithm(routes: [FmRoute(from: 1, to: 0)], carriers: [0], feedback: nil),
        )
    }

    private func render(_ gen: FmGenerator, _ frames: Int) -> [Float] {
        var out = [Float](repeating: 0, count: frames)
        gen.render(into: &out, frames: frames)
        return out
    }

    func testZeroModulationIsEnvelopedSine() {
        let gen = FmGenerator(params: twoOp(modLevel: 0), sampleRate: fs)
        gen.noteOn(midi: 69, velocity: 1)
        let out = render(gen, 512)
        let env = AdsrEnvelope(params: fastAdsr, sampleRate: fs)
        env.noteOn()
        for i in 0..<512 {
            let expected = sin(2 * Double.pi * 440 * Double(i) / fs) * env.nextSample()
            XCTAssertEqual(Double(out[i]), expected, accuracy: 1e-5)
        }
    }

    func testModulationChangesWaveform() {
        let plain = FmGenerator(params: twoOp(modLevel: 0), sampleRate: fs)
        let modulated = FmGenerator(params: twoOp(modLevel: 0.8), sampleRate: fs)
        plain.noteOn(midi: 69, velocity: 1)
        modulated.noteOn(midi: 69, velocity: 1)
        let a = render(plain, 512)
        let b = render(modulated, 512)
        let maxDiff = zip(a, b).map { abs($0 - $1) }.max() ?? 0
        XCTAssertGreaterThan(maxDiff, 0.1)
    }

    func testVelocityScalesAmplitude() {
        let loud = FmGenerator(params: twoOp(modLevel: 0.5), sampleRate: fs)
        let quiet = FmGenerator(params: twoOp(modLevel: 0.5), sampleRate: fs)
        loud.noteOn(midi: 60, velocity: 1)
        quiet.noteOn(midi: 60, velocity: 0.5)
        let a = render(loud, 256)
        let b = render(quiet, 256)
        for i in 0..<256 {
            XCTAssertEqual(b[i], a[i] * 0.5, accuracy: 1e-6)
        }
    }

    func testFinishesAfterRelease() {
        let gen = FmGenerator(params: twoOp(modLevel: 0.5), sampleRate: fs)
        gen.noteOn(midi: 69, velocity: 1)
        _ = render(gen, 256)
        gen.noteOff()
        _ = render(gen, Int(fs))
        XCTAssertTrue(gen.finished)
        for v in render(gen, 64) {
            XCTAssertEqual(v, 0)
        }
    }

    func testMatchesTwinReference() {
        var params = twoOp(modLevel: 0.7)
        params = FmGeneratorParams(
            operators: params.operators,
            algorithm: FmAlgorithm(
                routes: params.algorithm.routes,
                carriers: params.algorithm.carriers,
                feedback: FmFeedback(op: 1, amount: 0.3),
            ),
        )
        let gen = FmGenerator(params: params, sampleRate: fs)
        gen.noteOn(midi: 60, velocity: 1)
        let out = render(gen, 8)
        XCTAssertEqual(twinReference.count, 8)
        for (i, expected) in twinReference.enumerated() {
            XCTAssertEqual(Double(out[i]), expected, accuracy: 1e-6)
        }
    }
}
```

(Route validation throws in TS; in Swift use `precondition` — crash-on-misuse is the package's existing style, see `AVSynthEngine.init`. No Swift test for it.)

- [ ] **Step 6: Run to verify it fails**

Run: `cd swift && swift test --filter FmGeneratorTests`
Expected: FAIL — types not found.

- [ ] **Step 7: Write the Swift implementation**

`swift/Sources/AlloyAudio/DSP/FmGenerator.swift`:

```swift
import Foundation

/// Phase-modulation operator stack (DX-style "FM"). Twin of web
/// src/dsp/fm-generator.ts (canonical). Modulators sit at higher indices
/// than the operators they modulate (single high-to-low pass per sample).
public struct FmOperatorParams {
    public let ratio: Double
    public let level: Double
    public let adsr: AdsrParams

    public init(ratio: Double, level: Double, adsr: AdsrParams) {
        self.ratio = ratio
        self.level = level
        self.adsr = adsr
    }
}

public struct FmRoute {
    public let from: Int
    public let to: Int

    public init(from: Int, to: Int) {
        self.from = from
        self.to = to
    }
}

public struct FmFeedback {
    public let op: Int
    public let amount: Double

    public init(op: Int, amount: Double) {
        self.op = op
        self.amount = amount
    }
}

public struct FmAlgorithm {
    public let routes: [FmRoute]
    public let carriers: [Int]
    public let feedback: FmFeedback?

    public init(routes: [FmRoute], carriers: [Int], feedback: FmFeedback? = nil) {
        self.routes = routes
        self.carriers = carriers
        self.feedback = feedback
    }
}

public struct FmGeneratorParams {
    public let operators: [FmOperatorParams]
    public let algorithm: FmAlgorithm

    public init(operators: [FmOperatorParams], algorithm: FmAlgorithm) {
        self.operators = operators
        self.algorithm = algorithm
    }
}

public final class FmGenerator: ToneGenerator {
    private let params: FmGeneratorParams
    private let sampleRate: Double
    private let envelopes: [AdsrEnvelope]
    private var phases: [Double]
    private var outputs: [Double]
    private var frequency = 0.0
    private var amp = 0.0

    public init(params: FmGeneratorParams, sampleRate: Double) {
        let opCount = params.operators.count
        for route in params.algorithm.routes {
            precondition(
                route.from > route.to && route.from < opCount && route.to >= 0,
                "FM routes must flow from a higher to a lower operator index",
            )
        }
        for carrier in params.algorithm.carriers {
            precondition(carrier >= 0 && carrier < opCount, "FM carrier index out of range")
        }
        self.params = params
        self.sampleRate = sampleRate
        envelopes = params.operators.map { AdsrEnvelope(params: $0.adsr, sampleRate: sampleRate) }
        phases = [Double](repeating: 0, count: opCount)
        outputs = [Double](repeating: 0, count: opCount)
    }

    public var finished: Bool {
        params.algorithm.carriers.allSatisfy { !envelopes[$0].isActive }
    }

    public func noteOn(midi: Int, velocity: Double) {
        frequency = midiToFrequency(midi)
        amp = velocity
        for i in phases.indices {
            phases[i] = 0
            outputs[i] = 0
        }
        for env in envelopes {
            env.noteOn()
        }
    }

    public func noteOff() {
        for env in envelopes {
            env.noteOff()
        }
    }

    public func render(into out: inout [Float], frames: Int) {
        let operators = params.operators
        let algorithm = params.algorithm
        let carrierScale = amp / Double(algorithm.carriers.count)
        for n in 0..<frames {
            if finished { return }
            for i in stride(from: operators.count - 1, through: 0, by: -1) {
                var mod = 0.0
                for route in algorithm.routes where route.to == i {
                    mod += outputs[route.from]
                }
                if let feedback = algorithm.feedback, feedback.op == i {
                    mod += outputs[i] * feedback.amount
                }
                let env = envelopes[i].nextSample()
                outputs[i] = sin(DspConstants.twoPi * (phases[i] + mod)) * env * operators[i].level
                phases[i] += frequency * operators[i].ratio / sampleRate
                phases[i] -= phases[i].rounded(.down)
            }
            var sample = 0.0
            for c in algorithm.carriers {
                sample += outputs[c]
            }
            out[n] += Float(sample * carrierScale)
        }
    }
}
```

Before building: open `swift/Sources/AlloyAudio/Pitch.swift` and confirm the midi→frequency function name and signature; use the existing one (do not add a duplicate). If it is named differently (e.g. `frequency(forMidi:)`), adapt the call site only.

- [ ] **Step 8: Run both suites**

`cd swift && swift test --filter FmGeneratorTests` → PASS; full `npx vitest run` + `swift test` → PASS.

- [ ] **Step 9: Commit**

```bash
git add web/packages/alloy-audio/src swift/Sources/AlloyAudio/DSP/FmGenerator.swift swift/Tests/AlloyAudioTests/FmGeneratorTests.swift
git commit -m "feat(audio): add FM operator-stack generator twins"
```

---

### Task 7: Additive generator

**Files:**
- Create: `web/packages/alloy-audio/src/dsp/additive-generator.ts`
- Test: `web/packages/alloy-audio/src/dsp/additive-generator.spec.ts`
- Create: `swift/Sources/AlloyAudio/DSP/AdditiveGenerator.swift`
- Test: `swift/Tests/AlloyAudioTests/AdditiveGeneratorTests.swift`
- Modify: `web/packages/alloy-audio/src/index.ts`

**Interfaces:**
- Consumes: `ToneGenerator`, `TWO_PI`, `midiToFrequency`.
- Produces:
  - TS: `interface AdditivePartial { ratio: number; level: number }`, `class AdditiveGenerator implements ToneGenerator { constructor(partials: readonly AdditivePartial[], sampleRate: number) }`. Sustained kind: renders the partial-bank sum × velocity while keyed **and after noteOff** (TVA owns release, phase 1b); `finished` is always false; `noteOff` is a no-op. Drawbar organs are a preset partial list (ratios 0.5, 1.5, 1, 2, 3, 4, 5, 6, 8) — presets are patch content, phase 1b, not this class.
  - Swift: `struct AdditivePartial { let ratio, level: Double }`, `final class AdditiveGenerator: ToneGenerator`.

- [ ] **Step 1: Write the failing TS test**

`web/packages/alloy-audio/src/dsp/additive-generator.spec.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { AdditiveGenerator } from './additive-generator.js';

const FS = 48_000;

const TWIN_REFERENCE: number[] = [];

function render(gen: AdditiveGenerator, frames: number): Float32Array {
  const out = new Float32Array(frames);
  gen.render(out, frames);
  return out;
}

describe('AdditiveGenerator', () => {
  it('a single unit partial is a pure sine at the note frequency', () => {
    const gen = new AdditiveGenerator([{ ratio: 1, level: 1 }], FS);
    gen.noteOn(69, 1);
    const out = render(gen, 200);
    out.forEach((v, i) => {
      expect(v).toBeCloseTo(Math.sin((2 * Math.PI * 440 * i) / FS), 6);
    });
  });

  it('partials sum linearly', () => {
    const both = new AdditiveGenerator(
      [
        { ratio: 1, level: 0.5 },
        { ratio: 2, level: 0.25 },
      ],
      FS,
    );
    both.noteOn(60, 1);
    const out = render(both, 200);
    const f0 = midiHz(60);
    out.forEach((v, i) => {
      const expected =
        0.5 * Math.sin((2 * Math.PI * f0 * i) / FS) + 0.25 * Math.sin((2 * Math.PI * 2 * f0 * i) / FS);
      expect(v).toBeCloseTo(expected, 6);
    });
  });

  it('is silent before noteOn and keeps sounding after noteOff (TVA owns release)', () => {
    const gen = new AdditiveGenerator([{ ratio: 1, level: 1 }], FS);
    render(gen, 32).forEach((v) => expect(v).toBe(0));
    gen.noteOn(69, 1);
    render(gen, 32);
    gen.noteOff();
    expect(gen.finished).toBe(false);
    const after = render(gen, 32);
    expect(Math.max(...after.map(Math.abs))).toBeGreaterThan(0);
  });

  it('matches the twin reference (two partials, midi 60)', () => {
    const gen = new AdditiveGenerator(
      [
        { ratio: 1, level: 0.6 },
        { ratio: 3, level: 0.2 },
      ],
      FS,
    );
    gen.noteOn(60, 1);
    const out = render(gen, 8);
    // console.log(JSON.stringify(Array.from(out.subarray(0, 8))));
    expect(TWIN_REFERENCE).toHaveLength(8);
    TWIN_REFERENCE.forEach((v, i) => expect(out[i]).toBeCloseTo(v, 6));
  });
});

function midiHz(midi: number): number {
  return 440 * 2 ** ((midi - 69) / 12);
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web/packages/alloy-audio && npx vitest run src/dsp/additive-generator.spec.ts`
Expected: FAIL — cannot resolve module.

- [ ] **Step 3: Write the TS implementation**

`web/packages/alloy-audio/src/dsp/additive-generator.ts`:

```ts
// Sine partial bank — drawbar organs are literally this (a 9-partial
// preset), and it doubles as a clean pad/bell generator. Sustained kind:
// renders until the voice's TVA (phase 1b) ends the note; noteOff is a
// no-op here. Twin: AdditiveGenerator.swift.

import { TWO_PI, type ToneGenerator } from './dsp-types.js';
import { midiToFrequency } from '../pitch.js';

export interface AdditivePartial {
  /** Frequency ratio relative to the note frequency. */
  ratio: number;
  /** Linear amplitude of this partial. */
  level: number;
}

export class AdditiveGenerator implements ToneGenerator {
  private readonly phases: number[];
  private frequency = 0;
  private amp = 0;
  private keyed = false;

  constructor(
    private readonly partials: readonly AdditivePartial[],
    private readonly sampleRate: number,
  ) {
    this.phases = partials.map(() => 0);
  }

  /** Sustained kind: never self-finishes; the voice TVA ends the note. */
  get finished(): boolean {
    return false;
  }

  noteOn(midi: number, velocity: number): void {
    this.frequency = midiToFrequency(midi);
    this.amp = velocity;
    this.keyed = true;
    this.phases.fill(0);
  }

  noteOff(): void {
    // Intentionally empty: no intrinsic envelope to key up.
  }

  render(out: Float32Array, frames: number): void {
    if (!this.keyed) {
      return;
    }
    for (let n = 0; n < frames; n++) {
      let sample = 0;
      for (let p = 0; p < this.partials.length; p++) {
        sample += Math.sin(TWO_PI * this.phases[p]) * this.partials[p].level;
        this.phases[p] += (this.frequency * this.partials[p].ratio) / this.sampleRate;
        this.phases[p] -= Math.floor(this.phases[p]);
      }
      out[n] += sample * this.amp;
    }
  }
}
```

Append to `index.ts`: `export * from './dsp/additive-generator.js';`

- [ ] **Step 4: Capture twin reference**

Same workflow. Re-run: PASS.

- [ ] **Step 5: Write the failing Swift test**

`swift/Tests/AlloyAudioTests/AdditiveGeneratorTests.swift` — mirror the four TS tests (same partials, midi notes, tolerances; render helper identical to FmGeneratorTests). Twin test uses partials (1, 0.6) and (3, 0.2) at midi 60 with the pasted `twinReference`.

- [ ] **Step 6: Run to verify it fails**

Run: `cd swift && swift test --filter AdditiveGeneratorTests`
Expected: FAIL — type not found.

- [ ] **Step 7: Write the Swift implementation**

`swift/Sources/AlloyAudio/DSP/AdditiveGenerator.swift`:

```swift
import Foundation

/// Sine partial bank (drawbar organs are a 9-partial preset of this).
/// Sustained kind: never self-finishes; the voice TVA ends the note.
/// Twin of web src/dsp/additive-generator.ts (canonical).
public struct AdditivePartial {
    public let ratio: Double
    public let level: Double

    public init(ratio: Double, level: Double) {
        self.ratio = ratio
        self.level = level
    }
}

public final class AdditiveGenerator: ToneGenerator {
    private let partials: [AdditivePartial]
    private let sampleRate: Double
    private var phases: [Double]
    private var frequency = 0.0
    private var amp = 0.0
    private var keyed = false

    public init(partials: [AdditivePartial], sampleRate: Double) {
        self.partials = partials
        self.sampleRate = sampleRate
        phases = [Double](repeating: 0, count: partials.count)
    }

    public var finished: Bool { false }

    public func noteOn(midi: Int, velocity: Double) {
        frequency = midiToFrequency(midi)
        amp = velocity
        keyed = true
        for i in phases.indices {
            phases[i] = 0
        }
    }

    public func noteOff() {
        // Intentionally empty: no intrinsic envelope to key up.
    }

    public func render(into out: inout [Float], frames: Int) {
        guard keyed else { return }
        for n in 0..<frames {
            var sample = 0.0
            for p in partials.indices {
                sample += sin(DspConstants.twoPi * phases[p]) * partials[p].level
                phases[p] += frequency * partials[p].ratio / sampleRate
                phases[p] -= phases[p].rounded(.down)
            }
            out[n] += Float(sample * amp)
        }
    }
}
```

- [ ] **Step 8: Run both suites**

`cd swift && swift test --filter AdditiveGeneratorTests` → PASS; full suites → PASS.

- [ ] **Step 9: Commit**

```bash
git add web/packages/alloy-audio/src swift/Sources/AlloyAudio/DSP/AdditiveGenerator.swift swift/Tests/AlloyAudioTests/AdditiveGeneratorTests.swift
git commit -m "feat(audio): add additive partial-bank generator twins"
```

---

### Task 8: Virtual-analog generator

**Files:**
- Create: `web/packages/alloy-audio/src/dsp/va-generator.ts`
- Test: `web/packages/alloy-audio/src/dsp/va-generator.spec.ts`
- Create: `swift/Sources/AlloyAudio/DSP/VaGenerator.swift`
- Test: `swift/Tests/AlloyAudioTests/VaGeneratorTests.swift`
- Modify: `web/packages/alloy-audio/src/index.ts`

**Interfaces:**
- Consumes: `ToneGenerator`; `PolyBlepOscillator`, `OscShape` (Task 4); `DspPrng` (Task 1); `midiToFrequency`.
- Produces:
  - TS: `interface VaParams { shape: OscShape; unison: number; detuneCents: number; pulseWidth?: number }`, `class VaGenerator implements ToneGenerator { constructor(params: VaParams, sampleRate: number, seed?: number) }`. Unison oscillators start at PRNG-seeded phases (default seed 1); detune spread is `±detuneCents/2` spaced evenly; output scaled by `velocity / sqrt(unison)`. Sustained kind: `finished` always false, `noteOff` no-op. This is the engine the legacy supersaw migrates onto in phase 1b.
  - Swift: `struct VaParams`, `final class VaGenerator: ToneGenerator { init(params: VaParams, sampleRate: Double, seed: UInt32 = 1) }`.

- [ ] **Step 1: Write the failing TS test**

`web/packages/alloy-audio/src/dsp/va-generator.spec.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { PolyBlepOscillator } from './poly-blep-oscillator.js';
import { VaGenerator } from './va-generator.js';

const FS = 48_000;

const TWIN_REFERENCE: number[] = [];

function render(gen: VaGenerator, frames: number): Float32Array {
  const out = new Float32Array(frames);
  gen.render(out, frames);
  return out;
}

describe('VaGenerator', () => {
  it('unison 1 with no detune equals a single polyBLEP saw', () => {
    const gen = new VaGenerator({ shape: 'saw', unison: 1, detuneCents: 0 }, FS);
    gen.noteOn(69, 1);
    const out = render(gen, 256);
    const osc = new PolyBlepOscillator('saw', FS, referencePhaseForSeed1());
    osc.setFrequency(440);
    for (let i = 0; i < 256; i++) {
      expect(out[i]).toBeCloseTo(osc.nextSample(), 5);
    }
  });

  it('is deterministic for a given seed and differs across seeds', () => {
    const a = new VaGenerator({ shape: 'saw', unison: 5, detuneCents: 30 }, FS, 7);
    const b = new VaGenerator({ shape: 'saw', unison: 5, detuneCents: 30 }, FS, 7);
    const c = new VaGenerator({ shape: 'saw', unison: 5, detuneCents: 30 }, FS, 8);
    a.noteOn(60, 1);
    b.noteOn(60, 1);
    c.noteOn(60, 1);
    const outA = render(a, 256);
    const outB = render(b, 256);
    const outC = render(c, 256);
    for (let i = 0; i < 256; i++) {
      expect(outA[i]).toBe(outB[i]);
    }
    let differs = false;
    for (let i = 0; i < 256; i++) {
      if (outA[i] !== outC[i]) differs = true;
    }
    expect(differs).toBe(true);
  });

  it('unison output stays bounded by sqrt-scaling', () => {
    const gen = new VaGenerator({ shape: 'saw', unison: 7, detuneCents: 40 }, FS);
    gen.noteOn(60, 1);
    const out = render(gen, 48_000);
    const peak = Math.max(...Array.from(out, Math.abs));
    expect(peak).toBeLessThanOrEqual(Math.sqrt(7) + 0.2);
    expect(peak).toBeGreaterThan(0.3);
  });

  it('keeps sounding after noteOff and never self-finishes', () => {
    const gen = new VaGenerator({ shape: 'saw', unison: 3, detuneCents: 20 }, FS);
    gen.noteOn(60, 1);
    render(gen, 64);
    gen.noteOff();
    expect(gen.finished).toBe(false);
    const after = render(gen, 64);
    expect(Math.max(...Array.from(after, Math.abs))).toBeGreaterThan(0);
  });

  it('matches the twin reference (5-voice saw, seed 1)', () => {
    const gen = new VaGenerator({ shape: 'saw', unison: 5, detuneCents: 24 }, FS);
    gen.noteOn(57, 1);
    const out = render(gen, 8);
    // console.log(JSON.stringify(Array.from(out.subarray(0, 8))));
    expect(TWIN_REFERENCE).toHaveLength(8);
    TWIN_REFERENCE.forEach((v, i) => expect(out[i]).toBeCloseTo(v, 6));
  });
});

/** First DspPrng(1) draw — the phase VaGenerator gives its first oscillator. */
function referencePhaseForSeed1(): number {
  // Computed inline to avoid exporting internals: xorshift32(1) first output.
  let x = 1;
  x = (x ^ (x << 13)) >>> 0;
  x = (x ^ (x >>> 17)) >>> 0;
  x = (x ^ (x << 5)) >>> 0;
  return x / 4294967296;
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web/packages/alloy-audio && npx vitest run src/dsp/va-generator.spec.ts`
Expected: FAIL — cannot resolve module.

- [ ] **Step 3: Write the TS implementation**

`web/packages/alloy-audio/src/dsp/va-generator.ts`:

```ts
// Virtual-analog unison stack: N polyBLEP oscillators spread evenly across
// ±detuneCents/2, phases seeded from DspPrng so renders are deterministic.
// Absorbs the legacy supersaw (phase 1b migrates it here). Sustained kind:
// the voice TVA ends the note. Twin: VaGenerator.swift.

import { DspPrng } from './prng.js';
import { PolyBlepOscillator, type OscShape } from './poly-blep-oscillator.js';
import type { ToneGenerator } from './dsp-types.js';
import { midiToFrequency } from '../pitch.js';

export interface VaParams {
  shape: OscShape;
  /** Number of stacked oscillators, >= 1. */
  unison: number;
  /** Total detune spread in cents across the stack. */
  detuneCents: number;
  pulseWidth?: number;
}

export class VaGenerator implements ToneGenerator {
  private readonly oscillators: PolyBlepOscillator[];
  private readonly gainNorm: number;
  private amp = 0;
  private keyed = false;

  constructor(
    private readonly params: VaParams,
    sampleRate: number,
    seed = 1,
  ) {
    const prng = new DspPrng(seed);
    this.oscillators = Array.from(
      { length: Math.max(1, params.unison) },
      () => new PolyBlepOscillator(params.shape, sampleRate, prng.next(), params.pulseWidth ?? 0.5),
    );
    this.gainNorm = 1 / Math.sqrt(this.oscillators.length);
  }

  /** Sustained kind: never self-finishes; the voice TVA ends the note. */
  get finished(): boolean {
    return false;
  }

  noteOn(midi: number, velocity: number): void {
    const base = midiToFrequency(midi);
    const count = this.oscillators.length;
    this.oscillators.forEach((osc, i) => {
      const cents =
        count === 1 ? 0 : -this.params.detuneCents / 2 + (this.params.detuneCents * i) / (count - 1);
      osc.setFrequency(base * 2 ** (cents / 1200));
    });
    this.amp = velocity;
    this.keyed = true;
  }

  noteOff(): void {
    // Intentionally empty: no intrinsic envelope to key up.
  }

  render(out: Float32Array, frames: number): void {
    if (!this.keyed) {
      return;
    }
    for (let n = 0; n < frames; n++) {
      let sample = 0;
      for (const osc of this.oscillators) {
        sample += osc.nextSample();
      }
      out[n] += sample * this.gainNorm * this.amp;
    }
  }
}
```

Append to `index.ts`: `export * from './dsp/va-generator.js';`

- [ ] **Step 4: Capture twin reference**

Same workflow. Re-run: PASS.

- [ ] **Step 5: Write the failing Swift test**

`swift/Tests/AlloyAudioTests/VaGeneratorTests.swift` — mirror determinism (seeds 7/7/8), bounded-peak, sounds-after-noteOff, and the twin reference (5-voice saw, detune 24, midi 57, seed 1, pasted values). Skip the unison-1-equals-oscillator test on Swift (it is a TS-only structural check; the twin reference already pins cross-platform agreement).

- [ ] **Step 6: Run to verify it fails**

Run: `cd swift && swift test --filter VaGeneratorTests`
Expected: FAIL — type not found.

- [ ] **Step 7: Write the Swift implementation**

`swift/Sources/AlloyAudio/DSP/VaGenerator.swift`:

```swift
import Foundation

/// Virtual-analog unison stack: N polyBLEP oscillators spread across
/// ±detuneCents/2, phases seeded from DspPrng. Twin of web
/// src/dsp/va-generator.ts (canonical).
public struct VaParams {
    public let shape: OscShape
    public let unison: Int
    public let detuneCents: Double
    public let pulseWidth: Double

    public init(shape: OscShape, unison: Int, detuneCents: Double, pulseWidth: Double = 0.5) {
        self.shape = shape
        self.unison = unison
        self.detuneCents = detuneCents
        self.pulseWidth = pulseWidth
    }
}

public final class VaGenerator: ToneGenerator {
    private let params: VaParams
    private let oscillators: [PolyBlepOscillator]
    private let gainNorm: Double
    private var amp = 0.0
    private var keyed = false

    public init(params: VaParams, sampleRate: Double, seed: UInt32 = 1) {
        self.params = params
        let prng = DspPrng(seed: seed)
        let count = max(1, params.unison)
        oscillators = (0..<count).map { _ in
            PolyBlepOscillator(
                shape: params.shape,
                sampleRate: sampleRate,
                initialPhase: prng.next(),
                pulseWidth: params.pulseWidth,
            )
        }
        gainNorm = 1 / Double(count).squareRoot()
    }

    public var finished: Bool { false }

    public func noteOn(midi: Int, velocity: Double) {
        let base = midiToFrequency(midi)
        let count = oscillators.count
        for (i, osc) in oscillators.enumerated() {
            let cents = count == 1
                ? 0
                : -params.detuneCents / 2 + params.detuneCents * Double(i) / Double(count - 1)
            osc.setFrequency(base * pow(2, cents / 1200))
        }
        amp = velocity
        keyed = true
    }

    public func noteOff() {
        // Intentionally empty: no intrinsic envelope to key up.
    }

    public func render(into out: inout [Float], frames: Int) {
        guard keyed else { return }
        for n in 0..<frames {
            var sample = 0.0
            for osc in oscillators {
                sample += osc.nextSample()
            }
            out[n] += Float(sample * gainNorm * amp)
        }
    }
}
```

- [ ] **Step 8: Run both suites**

`cd swift && swift test --filter VaGeneratorTests` → PASS; full suites → PASS.

- [ ] **Step 9: Commit**

```bash
git add web/packages/alloy-audio/src swift/Sources/AlloyAudio/DSP/VaGenerator.swift swift/Tests/AlloyAudioTests/VaGeneratorTests.swift
git commit -m "feat(audio): add virtual-analog unison generator twins"
```

---

### Task 9: Sample-zone generator

**Files:**
- Create: `web/packages/alloy-audio/src/dsp/sample-zone-generator.ts`
- Test: `web/packages/alloy-audio/src/dsp/sample-zone-generator.spec.ts`
- Create: `swift/Sources/AlloyAudio/DSP/SampleZoneGenerator.swift`
- Test: `swift/Tests/AlloyAudioTests/SampleZoneGeneratorTests.swift`
- Modify: `web/packages/alloy-audio/src/index.ts`

**Interfaces:**
- Consumes: `ToneGenerator`, `midiToFrequency`.
- Produces:
  - TS:
    ```ts
    export interface SampleZoneData {
      rootMidi: number;
      sampleRate: number;
      data: Float32Array; // mono in 1a; stereo arrives with the pack pipeline
      loopStart?: number; // loop region [loopStart, loopEnd) in samples
      loopEnd?: number;
    }
    export interface VelocityLayerData {
      topVelocity: number; // inclusive upper bound, 0..1; layers sorted ascending
      zones: readonly SampleZoneData[];
    }
    export class SampleZoneGenerator implements ToneGenerator {
      constructor(layers: readonly VelocityLayerData[], crossfade: number, sampleRate: number);
    }
    ```
    Semantics: zone choice = nearest `rootMidi` (ties prefer lower — same tie-break as `SampleLoader.nearestLoaded`); playback rate = `midiToFrequency(midi)/midiToFrequency(zone.rootMidi) × zone.sampleRate/engineSampleRate`; Catmull-Rom cubic interpolation; looped zones wrap `pos -= loopEnd - loopStart` and never self-finish; unlooped zones self-finish past end-of-data; velocity picks the first layer with `topVelocity >= velocity` (clamp to last) and linearly crossfades two adjacent layers when within `crossfade/2` of the boundary; `noteOff` is a no-op (unlooped content rings out; TVA owns key-up).
  - Swift: `struct SampleZoneData`, `struct VelocityLayerData`, `final class SampleZoneGenerator: ToneGenerator { init(layers: [VelocityLayerData], crossfade: Double, sampleRate: Double) }`.

- [ ] **Step 1: Write the failing TS test**

`web/packages/alloy-audio/src/dsp/sample-zone-generator.spec.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { SampleZoneGenerator, type VelocityLayerData } from './sample-zone-generator.js';

const FS = 48_000;

const TWIN_REFERENCE: number[] = [];

/** Mono sine test asset: `cycles` full cycles over `length` samples. */
function sineZone(rootMidi: number, length: number, cycles: number, loop = false) {
  const data = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    data[i] = Math.sin((2 * Math.PI * cycles * i) / length);
  }
  return loop
    ? { rootMidi, sampleRate: FS, data, loopStart: 0, loopEnd: length }
    : { rootMidi, sampleRate: FS, data };
}

function constantZone(rootMidi: number, value: number, length = 4800) {
  const data = new Float32Array(length).fill(value);
  return { rootMidi, sampleRate: FS, data, loopStart: 0, loopEnd: length };
}

function oneLayer(zone: ReturnType<typeof sineZone>): VelocityLayerData[] {
  return [{ topVelocity: 1, zones: [zone] }];
}

function render(gen: SampleZoneGenerator, frames: number): Float32Array {
  const out = new Float32Array(frames);
  gen.render(out, frames);
  return out;
}

function zeroCrossings(out: Float32Array): number {
  let count = 0;
  for (let i = 1; i < out.length; i++) {
    if (out[i - 1] < 0 && out[i] >= 0) count += 1;
  }
  return count;
}

describe('SampleZoneGenerator', () => {
  it('plays a root-pitch note back at unity rate', () => {
    const gen = new SampleZoneGenerator(oneLayer(sineZone(69, 4800, 44)), 0, FS);
    gen.noteOn(69, 1);
    const out = render(gen, 4796); // stay clear of the unlooped tail
    const zone = sineZone(69, 4800, 44);
    for (let i = 1; i < 4700; i++) {
      expect(out[i]).toBeCloseTo(zone.data[i], 3); // cubic interp ≈ identity on-grid
    }
  });

  it('an octave up doubles the playback rate', () => {
    const gen = new SampleZoneGenerator(oneLayer(sineZone(69, 48_000, 440, true)), 0, FS);
    gen.noteOn(81, 1);
    const out = render(gen, 48_000);
    const crossings = zeroCrossings(out);
    expect(crossings).toBeGreaterThan(830);
    expect(crossings).toBeLessThan(930); // ≈ 880
  });

  it('looped zones sustain past the buffer length and never finish', () => {
    const gen = new SampleZoneGenerator(oneLayer(sineZone(69, 4800, 44, true)), 0, FS);
    gen.noteOn(69, 1);
    render(gen, 4800 * 3);
    expect(gen.finished).toBe(false);
    const later = render(gen, 256);
    expect(Math.max(...Array.from(later, Math.abs))).toBeGreaterThan(0.1);
  });

  it('unlooped zones finish at end of data and go silent', () => {
    const gen = new SampleZoneGenerator(oneLayer(sineZone(69, 4800, 44)), 0, FS);
    gen.noteOn(69, 1);
    render(gen, 4800 + 64);
    expect(gen.finished).toBe(true);
    render(gen, 64).forEach((v) => expect(v).toBe(0));
  });

  it('picks the nearest zone with lower-tie-break', () => {
    const layers: VelocityLayerData[] = [
      { topVelocity: 1, zones: [constantZone(60, 0.25), constantZone(64, 0.75)] },
    ];
    const gen = new SampleZoneGenerator(layers, 0, FS);
    gen.noteOn(62, 1); // equidistant: must prefer the lower zone (60)
    const out = render(gen, 16);
    expect(out[4]).toBeCloseTo(0.25, 3);
  });

  it('selects velocity layers and crossfades at the boundary', () => {
    const layers: VelocityLayerData[] = [
      { topVelocity: 0.5, zones: [constantZone(60, 0.2)] },
      { topVelocity: 1, zones: [constantZone(60, 0.8)] },
    ];
    const soft = new SampleZoneGenerator(layers, 0, FS);
    soft.noteOn(60, 0.3);
    expect(render(soft, 16)[4]).toBeCloseTo(0.2 * 0.3, 3);

    const hard = new SampleZoneGenerator(layers, 0, FS);
    hard.noteOn(60, 0.9);
    expect(render(hard, 16)[4]).toBeCloseTo(0.8 * 0.9, 3);

    const blended = new SampleZoneGenerator(layers, 0.2, FS);
    blended.noteOn(60, 0.5); // exactly on the boundary -> 50/50 blend
    expect(render(blended, 16)[4]).toBeCloseTo((0.2 * 0.5 + 0.8 * 0.5) * 0.5, 2);
  });

  it('matches the twin reference (octave-down sine, looped)', () => {
    const gen = new SampleZoneGenerator(oneLayer(sineZone(69, 4800, 44, true)), 0, FS);
    gen.noteOn(57, 1);
    const out = render(gen, 8);
    // console.log(JSON.stringify(Array.from(out.subarray(0, 8))));
    expect(TWIN_REFERENCE).toHaveLength(8);
    TWIN_REFERENCE.forEach((v, i) => expect(out[i]).toBeCloseTo(v, 6));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web/packages/alloy-audio && npx vitest run src/dsp/sample-zone-generator.spec.ts`
Expected: FAIL — cannot resolve module.

- [ ] **Step 3: Write the TS implementation**

`web/packages/alloy-audio/src/dsp/sample-zone-generator.ts`:

```ts
// Sample playback with zones, velocity layers, loops, and Catmull-Rom
// cubic interpolation. Loop crossfades are baked into pack assets by the
// content pipeline (phase 3); at runtime a loop is a plain wrap. noteOff
// is a no-op: unlooped content rings out, the voice TVA owns key-up.
// Twin: SampleZoneGenerator.swift.

import type { ToneGenerator } from './dsp-types.js';
import { midiToFrequency } from '../pitch.js';

export interface SampleZoneData {
  rootMidi: number;
  sampleRate: number;
  /** Mono in phase 1a; stereo arrives with the pack pipeline. */
  data: Float32Array;
  /** Loop region [loopStart, loopEnd) in samples; omit for one-shots. */
  loopStart?: number;
  loopEnd?: number;
}

export interface VelocityLayerData {
  /** Inclusive upper bound of this layer's velocity range, 0..1. Sorted ascending. */
  topVelocity: number;
  zones: readonly SampleZoneData[];
}

interface ZoneRead {
  zone: SampleZoneData;
  gain: number;
  pos: number;
  rate: number;
  ended: boolean;
}

export class SampleZoneGenerator implements ToneGenerator {
  private reads: ZoneRead[] = [];

  constructor(
    private readonly layers: readonly VelocityLayerData[],
    private readonly crossfade: number,
    private readonly sampleRate: number,
  ) {}

  get finished(): boolean {
    return this.reads.length > 0 && this.reads.every((r) => r.ended);
  }

  noteOn(midi: number, velocity: number): void {
    this.reads = this.pickLayers(velocity).map(({ layer, gain }) => {
      const zone = nearestZone(layer.zones, midi);
      return {
        zone,
        gain: gain * velocity,
        pos: 0,
        rate:
          (midiToFrequency(midi) / midiToFrequency(zone.rootMidi)) *
          (zone.sampleRate / this.sampleRate),
        ended: false,
      };
    });
  }

  noteOff(): void {
    // Intentionally empty: unlooped content rings out; the TVA owns key-up.
  }

  render(out: Float32Array, frames: number): void {
    for (const read of this.reads) {
      if (read.ended) {
        continue;
      }
      const { data } = read.zone;
      const loop = read.zone.loopStart !== undefined && read.zone.loopEnd !== undefined;
      for (let n = 0; n < frames; n++) {
        if (loop) {
          const loopStart = read.zone.loopStart!;
          const loopEnd = read.zone.loopEnd!;
          while (read.pos >= loopEnd) {
            read.pos -= loopEnd - loopStart;
          }
        } else if (read.pos >= data.length) {
          read.ended = true;
          break;
        }
        out[n] += cubicRead(read.zone, read.pos, loop) * read.gain;
        read.pos += read.rate;
      }
    }
  }

  /**
   * One or two layers with linear crossfade gains summing to 1. The
   * crossfade window straddles each boundary symmetrically: a velocity
   * within crossfade/2 of a boundary blends the layers on either side
   * (exactly on the boundary -> 50/50). Both directions must be checked
   * because findIndex lands an on-boundary velocity in the LOWER layer.
   */
  private pickLayers(velocity: number): Array<{ layer: VelocityLayerData; gain: number }> {
    const idx = this.layers.findIndex((l) => l.topVelocity >= velocity);
    const primary = idx === -1 ? this.layers.length - 1 : idx;
    if (this.crossfade > 0) {
      if (primary > 0) {
        const boundary = this.layers[primary - 1].topVelocity;
        const distance = velocity - boundary;
        if (distance >= 0 && distance < this.crossfade / 2) {
          const upperGain = 0.5 + distance / this.crossfade;
          return [
            { layer: this.layers[primary], gain: upperGain },
            { layer: this.layers[primary - 1], gain: 1 - upperGain },
          ];
        }
      }
      if (primary < this.layers.length - 1) {
        const boundary = this.layers[primary].topVelocity;
        const distance = boundary - velocity;
        if (distance >= 0 && distance < this.crossfade / 2) {
          const lowerGain = 0.5 + distance / this.crossfade;
          return [
            { layer: this.layers[primary], gain: lowerGain },
            { layer: this.layers[primary + 1], gain: 1 - lowerGain },
          ];
        }
      }
    }
    return [{ layer: this.layers[primary], gain: 1 }];
  }
}

/** Nearest zone by rootMidi; ties prefer the lower zone (mirrors SampleLoader). */
function nearestZone(zones: readonly SampleZoneData[], midi: number): SampleZoneData {
  let best = zones[0];
  for (const zone of zones) {
    const d = Math.abs(zone.rootMidi - midi);
    const bestD = Math.abs(best.rootMidi - midi);
    if (d < bestD || (d === bestD && zone.rootMidi < best.rootMidi)) {
      best = zone;
    }
  }
  return best;
}

/** Catmull-Rom 4-point read at fractional position `pos`. */
function cubicRead(zone: SampleZoneData, pos: number, loop: boolean): number {
  const data = zone.data;
  const i = Math.floor(pos);
  const f = pos - i;
  const at = (k: number): number => {
    let idx = i + k;
    if (loop) {
      const loopStart = zone.loopStart!;
      const loopEnd = zone.loopEnd!;
      while (idx >= loopEnd) {
        idx -= loopEnd - loopStart;
      }
    }
    if (idx < 0 || idx >= data.length) {
      return 0;
    }
    return data[idx];
  };
  const x0 = at(-1);
  const x1 = at(0);
  const x2 = at(1);
  const x3 = at(2);
  return (
    x1 +
    0.5 * f * (x2 - x0 + f * (2 * x0 - 5 * x1 + 4 * x2 - x3 + f * (3 * (x1 - x2) + x3 - x0)))
  );
}
```

Append to `index.ts`: `export * from './dsp/sample-zone-generator.js';`

- [ ] **Step 4: Capture twin reference**

Same workflow. Re-run: PASS.

- [ ] **Step 5: Write the failing Swift test**

`swift/Tests/AlloyAudioTests/SampleZoneGeneratorTests.swift` — mirror all seven TS tests with identical fixtures (sine zones built in-test the same way, same tolerances) and the pasted twin reference (octave-down looped sine, midi 57).

- [ ] **Step 6: Run to verify it fails**

Run: `cd swift && swift test --filter SampleZoneGeneratorTests`
Expected: FAIL — types not found.

- [ ] **Step 7: Write the Swift implementation**

`swift/Sources/AlloyAudio/DSP/SampleZoneGenerator.swift` — direct port of the TS above:

```swift
import Foundation

/// Sample playback with zones, velocity layers, loops, and Catmull-Rom
/// interpolation. Twin of web src/dsp/sample-zone-generator.ts (canonical).
public struct SampleZoneData {
    public let rootMidi: Int
    public let sampleRate: Double
    public let data: [Float]
    public let loopStart: Int?
    public let loopEnd: Int?

    public init(rootMidi: Int, sampleRate: Double, data: [Float], loopStart: Int? = nil, loopEnd: Int? = nil) {
        self.rootMidi = rootMidi
        self.sampleRate = sampleRate
        self.data = data
        self.loopStart = loopStart
        self.loopEnd = loopEnd
    }
}

public struct VelocityLayerData {
    public let topVelocity: Double
    public let zones: [SampleZoneData]

    public init(topVelocity: Double, zones: [SampleZoneData]) {
        self.topVelocity = topVelocity
        self.zones = zones
    }
}

public final class SampleZoneGenerator: ToneGenerator {
    private struct ZoneRead {
        let zone: SampleZoneData
        let gain: Double
        var pos: Double
        let rate: Double
        var ended: Bool
    }

    private let layers: [VelocityLayerData]
    private let crossfade: Double
    private let sampleRate: Double
    private var reads: [ZoneRead] = []

    public init(layers: [VelocityLayerData], crossfade: Double, sampleRate: Double) {
        self.layers = layers
        self.crossfade = crossfade
        self.sampleRate = sampleRate
    }

    public var finished: Bool {
        !reads.isEmpty && reads.allSatisfy(\.ended)
    }

    public func noteOn(midi: Int, velocity: Double) {
        reads = pickLayers(velocity: velocity).map { layer, gain in
            let zone = Self.nearestZone(layer.zones, midi: midi)
            return ZoneRead(
                zone: zone,
                gain: gain * velocity,
                pos: 0,
                rate: midiToFrequency(midi) / midiToFrequency(zone.rootMidi)
                    * (zone.sampleRate / sampleRate),
                ended: false,
            )
        }
    }

    public func noteOff() {
        // Intentionally empty: unlooped content rings out; the TVA owns key-up.
    }

    public func render(into out: inout [Float], frames: Int) {
        for r in reads.indices {
            if reads[r].ended { continue }
            let zone = reads[r].zone
            let loop = zone.loopStart != nil && zone.loopEnd != nil
            for n in 0..<frames {
                if loop {
                    let loopStart = zone.loopStart!
                    let loopEnd = zone.loopEnd!
                    while reads[r].pos >= Double(loopEnd) {
                        reads[r].pos -= Double(loopEnd - loopStart)
                    }
                } else if reads[r].pos >= Double(zone.data.count) {
                    reads[r].ended = true
                    break
                }
                out[n] += Float(Self.cubicRead(zone, pos: reads[r].pos, loop: loop) * reads[r].gain)
                reads[r].pos += reads[r].rate
            }
        }
    }

    private func pickLayers(velocity: Double) -> [(VelocityLayerData, Double)] {
        let primary = layers.firstIndex { $0.topVelocity >= velocity } ?? layers.count - 1
        if crossfade > 0 {
            if primary > 0 {
                let boundary = layers[primary - 1].topVelocity
                let distance = velocity - boundary
                if distance >= 0, distance < crossfade / 2 {
                    let upperGain = 0.5 + distance / crossfade
                    return [(layers[primary], upperGain), (layers[primary - 1], 1 - upperGain)]
                }
            }
            if primary < layers.count - 1 {
                let boundary = layers[primary].topVelocity
                let distance = boundary - velocity
                if distance >= 0, distance < crossfade / 2 {
                    let lowerGain = 0.5 + distance / crossfade
                    return [(layers[primary], lowerGain), (layers[primary + 1], 1 - lowerGain)]
                }
            }
        }
        return [(layers[primary], 1)]
    }

    /// Nearest zone by rootMidi; ties prefer the lower zone (mirrors SampleZoneStore).
    private static func nearestZone(_ zones: [SampleZoneData], midi: Int) -> SampleZoneData {
        var best = zones[0]
        for zone in zones {
            let d = abs(zone.rootMidi - midi)
            let bestD = abs(best.rootMidi - midi)
            if d < bestD || (d == bestD && zone.rootMidi < best.rootMidi) {
                best = zone
            }
        }
        return best
    }

    /// Catmull-Rom 4-point read at fractional position `pos`.
    private static func cubicRead(_ zone: SampleZoneData, pos: Double, loop: Bool) -> Double {
        let i = Int(pos.rounded(.down))
        let f = pos - Double(i)
        func at(_ k: Int) -> Double {
            var idx = i + k
            if loop {
                let loopStart = zone.loopStart!
                let loopEnd = zone.loopEnd!
                while idx >= loopEnd {
                    idx -= loopEnd - loopStart
                }
            }
            guard idx >= 0, idx < zone.data.count else { return 0 }
            return Double(zone.data[idx])
        }
        let x0 = at(-1)
        let x1 = at(0)
        let x2 = at(1)
        let x3 = at(2)
        return x1 + 0.5 * f * (x2 - x0 + f * (2 * x0 - 5 * x1 + 4 * x2 - x3 + f * (3 * (x1 - x2) + x3 - x0)))
    }
}
```

- [ ] **Step 8: Run both suites**

`cd swift && swift test --filter SampleZoneGeneratorTests` → PASS; full suites → PASS.

- [ ] **Step 9: Commit**

```bash
git add web/packages/alloy-audio/src swift/Sources/AlloyAudio/DSP/SampleZoneGenerator.swift swift/Tests/AlloyAudioTests/SampleZoneGeneratorTests.swift
git commit -m "feat(audio): add sample-zone generator twins"
```

---

### Task 10: Full-suite verification and docs touch-up

**Files:**
- Modify: `docs/superpowers/specs/2026-07-10-alloy-rompler-engine-design.md` (mark phase 1a landed)

**Interfaces:**
- Consumes: everything above.
- Produces: a clean baseline for the Phase 1b plan (patch model, voice/TVF/TVA assembly, transport clock, worklet + source-node hosts, golden patch renders).

- [ ] **Step 1: Run everything**

Run: `cd web && npm test`
Expected: all packages PASS.
Run: `cd swift && swift build && swift test`
Expected: PASS.

- [ ] **Step 2: Lint/format both sides**

Run the repo's lint/format flows (ESLint/Prettier for `web/`, SwiftLint/SwiftFormat for `swift/` — the repo has skills for both). Fix any findings.

- [ ] **Step 3: Note phase status in the spec**

In `docs/superpowers/specs/2026-07-10-alloy-rompler-engine-design.md`, under Phasing item 1, append: “(1a — DSP units — landed; 1b — patch model, voice assembly, transport, hosts — next.)”

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/specs/2026-07-10-alloy-rompler-engine-design.md
git commit -m "docs: mark rompler phase 1a (DSP units) landed"
```

---

## Self-Review Notes

- **Spec coverage (phase 1a slice):** oscillators/polyBLEP (Task 4), FM kernel (6), additive (7), VA/unison (8), sample-zone with cubic interpolation + loops + velocity layers (9), SVF (5), ADSR exponential (2), LFO (3), seeded PRNG (1). Deliberately deferred to the Phase 1b plan: voice/layer mixer, patch data model, mod routes, transport clock, worklet/source-node hosts, golden full-patch renders, 64-voice perf benchmark — the spec's phase 1 completes only when 1b lands.
- **Determinism:** the only nondeterminism source anywhere is `DspPrng`; `VaGenerator` takes an explicit seed.
- **Type consistency:** `ToneGenerator` members (`noteOn(midi, velocity)`, `noteOff()`, `render(out, frames)` adds-into, `finished`) are used identically in Tasks 6–9; `AdsrParams` shape from Task 2 is consumed verbatim by Task 6.
- **Known judgment calls recorded for 1b:** velocity is linear amplitude inside generators (perceptual velocity curves are TVA policy); sample zones are mono until the pack pipeline exists; `noteOff` semantics per kind are documented in `dsp-types.ts`.
