# FM Anti-Aliasing (Phase 3c) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop the FM generator aliasing on high notes, so phase 4 can build FM8-class electric pianos on a generator that does not fold sidebands back into the bass.

**Architecture:** Adaptive per-voice oversampling, entirely inside `FmGenerator`. At `noteOn` the generator computes its operator stack's highest frequency (`f0 × max(ratio)`) and picks an oversampling factor **K ∈ {1, 4}**: K=1 below `sampleRate/4`, K=4 above. Above the threshold the operator loop runs 4× and a fixed 32-tap FIR band-limits the result before dropping to every 4th sample. Operator envelopes advance **once per output sample** and are held across the sub-samples — that is what keeps the **K=1 path bit-identical to today's code**, so nothing below the threshold changes and no goldens move.

**Tech Stack:** TypeScript (canonical) + Vitest; Swift + XCTest. Pure DSP — no platform APIs.

**Design spec:** `docs/superpowers/specs/2026-07-14-rompler-fm-antialiasing-3c-design.md`

---

## Global Constraints

Every task's requirements implicitly include this section.

- **Do NOT run any formatter or linter.** The repo has **no** prettier, eslint, or swiftformat config. Running one reformats 100+ unrelated files. Match the surrounding file's style by hand.
- **Mirrored twins, same change set.** TypeScript is canonical; Swift ports in the **same commit** (`docs/mirroring.md`). Never ship half-updated twins.
- **Determinism is absolute.** No `Date.now()`, no `Math.random()` anywhere in `src/dsp/**`. Repeat renders must be bit-identical.
- **Swift computes in `Double`; buffers stay `[Float]`.** Existing convention.
- **The K=1 path must stay bit-exact with today's code.** This is the load-bearing property of the whole design: it is what guarantees no golden churn. If a golden's pinned value moves, the change is **wrong** — stop and report, do not regenerate the golden.
- **The decimation coefficients are a hardcoded constant table**, byte-identical in both twins. Do NOT compute them at runtime from a formula: `Math.sin` in JS and `sin` in Swift may differ in the last ulp, which would silently diverge the twins.
- **Only `FmGenerator` changes.** The `ToneGenerator` interface, the voice, the patch schema, `PatchEngine`, and every other generator are untouched. If the task appears to need a change there, that is a plan bug — escalate, do not edit.
- Commit style: conventional commits, imperative subject ≤ 72 chars.

## Commands

| What | Command (from repo root) |
| --- | --- |
| Web tests | `cd web/packages/alloy-audio && npx vitest run` |
| Swift tests | `swift build && swift test` (`Package.swift` is at the **repo root**) |
| Swift benchmark (release) | `swift test -c release --filter BenchmarkTests` |
| Harness typecheck | `cd examples/web-harness && npx ng build` |

**Do NOT run the root `cd web && npm test`.** A runaway vitest worker from an earlier session can make it flaky with "Worker exited unexpectedly". The per-package command above is reliable.

## The measurements this plan is built on

Alias floor = energy below the fundamental, in dB relative to the fundamental. An FM spectrum built on `f0` has **no legitimate content beneath `f0`**, so anything there is aliased foldback. Measured on the workbench EP operator stack with its original ratio-14 modulator:

| | C4 | C6 | G#6 (midi 92) | C7 | C8 (midi 108) |
| --- | --- | --- | --- | --- | --- |
| **1× (today)** | −53 | −45 | **−25** | −37 | **−21** |
| **4×** | −51 | −54 | **−63** | −63 | **−46** |

The measurement's own noise floor is ≈ −52 dB (C4 does not improve, because it has nothing to improve). Sweeping the highest operator frequency, 1× and 4× are **indistinguishable up to 13.1 kHz** and diverge by +9…+38 dB **from 14.7 kHz** upward — which is why the threshold sits at `sampleRate/4` (12 kHz), just below where divergence begins.

---

## File Structure

| File | Responsibility |
| --- | --- |
| `web/packages/alloy-audio/src/dsp/fm-oversampling.ts` (create) | The oversampling constants: factor, the 32-tap decimation table, `chooseOversampling`, and the `FmDecimator` FIR. Separate from `fm-generator.ts` so it is independently testable. |
| `swift/Sources/AlloyAudio/DSP/FmOversampling.swift` (create) | Swift twin of the above. |
| `web/packages/alloy-audio/src/dsp/fm-generator.ts` (modify) | Pick K at `noteOn`; run the operator loop K× and decimate; step envelopes once per output sample. |
| `swift/Sources/AlloyAudio/DSP/FmGenerator.swift` (modify) | Swift twin. |
| `web/packages/alloy-audio/src/dsp/fm-oversampling.spec.ts` (create) | Tap table + decimator + `chooseOversampling` tests. |
| `swift/Tests/AlloyAudioTests/FmOversamplingTests.swift` (create) | Swift twin. |
| `web/packages/alloy-audio/src/dsp/fm-generator.spec.ts` (modify) | The alias-floor test — the test that would have caught the original bug and did not exist. |
| `swift/Tests/AlloyAudioTests/FmGeneratorTests.swift` (modify) | Swift twin. |
| `examples/web-harness/src/app/sections/rompler-section.component.ts` (modify) | EP operator 3 back to ratio 14. |
| `docs/mirroring.md` (modify) | Record the oversampling contract. |
| `docs/superpowers/specs/2026-07-10-alloy-rompler-engine-design.md` (modify) | Mark 3c complete in the phasing. |

---

### Task 1: The decimator and the K-selection rule

The two pure pieces, isolated and tested before anything touches the generator.

**Files:**
- Create: `web/packages/alloy-audio/src/dsp/fm-oversampling.ts`
- Create: `swift/Sources/AlloyAudio/DSP/FmOversampling.swift`
- Test: `web/packages/alloy-audio/src/dsp/fm-oversampling.spec.ts` (create)
- Test: `swift/Tests/AlloyAudioTests/FmOversamplingTests.swift` (create)

**Interfaces:**
- Consumes: nothing.
- Produces (consumed by Task 2):
  - TS: `FM_OVERSAMPLING = 4`, `FM_DECIMATION_TAPS: readonly number[]` (32 entries), `chooseOversampling(maxOpFrequency: number, sampleRate: number): number`, `class FmDecimator { reset(): void; push(x: number): void; output(): number }`
  - Swift: `fmOversampling: Int`, `fmDecimationTaps: [Double]`, `chooseOversampling(maxOpFrequency: Double, sampleRate: Double) -> Int`, `final class FmDecimator { func reset(); func push(_ x: Double); func output() -> Double }`

- [ ] **Step 1: Write the failing TS test**

Create `web/packages/alloy-audio/src/dsp/fm-oversampling.spec.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { FM_DECIMATION_TAPS, FM_OVERSAMPLING, FmDecimator, chooseOversampling } from './fm-oversampling.js';

const FS = 48_000;
const FS_OS = FS * FM_OVERSAMPLING; // 192 kHz

/** Push a sine at `hz` through the decimator and return the decimated output. */
function decimate(hz: number, frames: number): Float64Array {
  const dec = new FmDecimator();
  const out = new Float64Array(frames);
  let n = 0;
  for (let i = 0; i < frames; i++) {
    for (let k = 0; k < FM_OVERSAMPLING; k++) {
      dec.push(Math.sin((2 * Math.PI * hz * n) / FS_OS));
      n++;
    }
    out[i] = dec.output();
  }
  return out;
}

const rms = (x: Float64Array) => Math.sqrt(x.reduce((s, v) => s + v * v, 0) / x.length);

describe('fm oversampling', () => {
  it('the decimation table is 32 taps and sums to unity', () => {
    expect(FM_DECIMATION_TAPS.length).toBe(32);
    const sum = FM_DECIMATION_TAPS.reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(1, 12); // unity DC gain: the filter must not change level
  });

  it('passes a tone well inside the audio band at essentially unity gain', () => {
    // 1 kHz is far below the 24 kHz output Nyquist — it must survive untouched.
    const y = decimate(1000, 4096).subarray(64); // skip the FIR's fill-in
    expect(rms(y)).toBeGreaterThan(0.65); // a unit sine has RMS 0.707
    expect(rms(y)).toBeLessThan(0.75);
  });

  it('CRUSHES a tone above the output Nyquist — this is the whole point', () => {
    // 30 kHz exists at the 192 kHz oversampled rate but is above the 24 kHz
    // output Nyquist. Without the filter it would fold back to 18 kHz. With it,
    // it must be gone before we drop samples.
    const y = decimate(30_000, 4096).subarray(64);
    const attenuationDb = 20 * Math.log10(rms(y) / 0.707);
    expect(attenuationDb).toBeLessThan(-40);
  });

  it('chooseOversampling switches at sampleRate/4 and nowhere else', () => {
    // Below the threshold oversampling is a measured no-op, so do not pay for it.
    expect(chooseOversampling(1000, FS)).toBe(1);
    expect(chooseOversampling(11_999, FS)).toBe(1);
    expect(chooseOversampling(FS / 4, FS)).toBe(1); // boundary is exclusive
    expect(chooseOversampling(12_001, FS)).toBe(FM_OVERSAMPLING);
    expect(chooseOversampling(23_300, FS)).toBe(FM_OVERSAMPLING); // G#6 x ratio 14
  });

  it('chooseOversampling scales with the sample rate rather than hardcoding 12 kHz', () => {
    expect(chooseOversampling(20_000, 96_000)).toBe(1); // 96k/4 = 24 kHz
    expect(chooseOversampling(25_000, 96_000)).toBe(FM_OVERSAMPLING);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd web/packages/alloy-audio && npx vitest run fm-oversampling`
Expected: FAIL — cannot resolve `./fm-oversampling.js`.

- [ ] **Step 3: Write `web/packages/alloy-audio/src/dsp/fm-oversampling.ts`**

The coefficients are a **hardcoded table**, not computed at runtime: `Math.sin` in JS and `sin` in Swift can differ in the last ulp, and a runtime-designed filter would silently diverge the twins.

```ts
// Anti-aliasing for the FM generator. Phase modulation generates sidebands far
// above Nyquist; rendered at the output rate they fold back as inharmonic
// low-frequency junk (measured -25 dB below the fundamental on G#6 with a
// ratio-14 modulator, -21 dB on C8). Oversampling the operator loop and
// band-limiting before decimation removes them.
//
// The cost is paid per VOICE, only where it is needed: below the threshold,
// oversampling was measured to be a no-op (C4: -53 dB at 1x, -51 dB at 4x), so
// those notes run the original code path at the original cost.
// Twin: FmOversampling.swift.

/** Oversampling factor used above the threshold. 4x puts everything through C7
 *  at the measurement floor; 8x would be needed for a fully clean C8 and costs
 *  ~9x the FM CPU, which the <25%-of-a-core envelope will not absorb. */
export const FM_OVERSAMPLING = 4;

/** 32-tap Blackman-windowed sinc, cutoff 0.45/4 of the oversampled rate,
 *  normalized to unity DC gain. Generated once and pinned here: computing it at
 *  runtime would risk a last-ulp divergence between the JS and Swift math
 *  libraries, and these coefficients are part of the twin contract.
 *  64 taps measured no better than 32. Group delay is 15.5 oversampled samples
 *  = 3.875 output samples (~83 us) — an oversampled voice sits a hair behind a
 *  non-oversampled one in a layered patch. Inaudible, but real. */
export const FM_DECIMATION_TAPS: readonly number[] = [
  2.8477986181713758e-19, -6.047798834019103e-5, -4.3340271636890365e-5, 5.2916070916784888e-4,
  1.9038353814484067e-3, 3.3115968607472083e-3, 2.6042373642096179e-3, -2.7237870035835541e-3,
  -1.2906466905783016e-2, -2.3118576278907177e-2, -2.3226872620304369e-2, -1.9606343826616681e-3,
  4.5690838648908765e-2, 1.1232751779472532e-1, 1.7825129611097032e-1, 2.1942167258103942e-1,
  2.1942167258103948e-1, 1.7825129611097032e-1, 1.1232751779472533e-1, 4.5690838648908771e-2,
  -1.9606343826616690e-3, -2.3226872620304369e-2, -2.3118576278907201e-2, -1.2906466905783032e-2,
  -2.7237870035835541e-3, 2.6042373642096179e-3, 3.3115968607472083e-3, 1.9038353814484074e-3,
  5.2916070916784867e-4, -4.3340271636890290e-5, -6.0477988340191701e-5, 2.8477986181713758e-19,
];

/** The oversampling factor a voice needs, from the highest frequency anywhere in
 *  its operator stack. A pure function of the note and the patch, so it is
 *  deterministic and twin-identical, and it is decided ONCE per note rather than
 *  per sample.
 *
 *  The threshold is sampleRate/4, placed from measurement: sweeping the highest
 *  operator frequency, 1x and 4x are indistinguishable up to 13.1 kHz and
 *  diverge by +9..+38 dB from 14.7 kHz upward. 12 kHz sits just below that,
 *  which also leaves ~2 semitones of upward pitch-bend headroom — setPitchRatio
 *  does NOT re-pick the factor mid-note (that would glitch), so the margin
 *  matters. */
export function chooseOversampling(maxOpFrequency: number, sampleRate: number): number {
  return maxOpFrequency > sampleRate / 4 ? FM_OVERSAMPLING : 1;
}

/** Ring-buffered FIR: push every oversampled sample, read one output per
 *  FM_OVERSAMPLING pushes. */
export class FmDecimator {
  private readonly history = new Float64Array(FM_DECIMATION_TAPS.length);
  private pos = 0;

  reset(): void {
    this.history.fill(0);
    this.pos = 0;
  }

  push(x: number): void {
    this.history[this.pos] = x;
    this.pos = (this.pos + 1) % this.history.length;
  }

  /** Convolve the window. After push(), `pos` indexes the OLDEST sample, so
   *  tap j lines up with history[(pos + j) % n] — oldest to newest. */
  output(): number {
    const n = this.history.length;
    let y = 0;
    for (let j = 0; j < n; j++) {
      y += FM_DECIMATION_TAPS[j] * this.history[(this.pos + j) % n];
    }
    return y;
  }
}
```

- [ ] **Step 4: Run the TS test — it must pass**

Run: `cd web/packages/alloy-audio && npx vitest run fm-oversampling`
Expected: PASS, 5 tests.

- [ ] **Step 5: Write the Swift twin**

Create `swift/Sources/AlloyAudio/DSP/FmOversampling.swift`. **Use the identical decimal literals** — that is what makes the tables byte-identical across twins. Match the repo's existing Swift constant naming (look at how `SampleZoneGenerator.swift` / the effects twins name their constants) rather than inventing a convention.

```swift
// Anti-aliasing for the FM generator. Phase modulation generates sidebands far
// above Nyquist; rendered at the output rate they fold back as inharmonic
// low-frequency junk (measured -25 dB below the fundamental on G#6 with a
// ratio-14 modulator, -21 dB on C8). Oversampling the operator loop and
// band-limiting before decimation removes them.
//
// The cost is paid per VOICE, only where it is needed: below the threshold,
// oversampling was measured to be a no-op (C4: -53 dB at 1x, -51 dB at 4x).
// Twin of web src/dsp/fm-oversampling.ts (canonical).

/// Oversampling factor used above the threshold.
public let fmOversampling = 4

/// 32-tap Blackman-windowed sinc, cutoff 0.45/4 of the oversampled rate,
/// normalized to unity DC gain. PINNED, not computed: a runtime-designed filter
/// would risk a last-ulp divergence between the Swift and JS math libraries, and
/// these coefficients are part of the twin contract. Group delay is 3.875 output
/// samples (~83 us).
public let fmDecimationTaps: [Double] = [
    2.8477986181713758e-19, -6.0477988340191030e-5, -4.3340271636890365e-5, 5.2916070916784888e-4,
    1.9038353814484067e-3, 3.3115968607472083e-3, 2.6042373642096179e-3, -2.7237870035835541e-3,
    -1.2906466905783016e-2, -2.3118576278907177e-2, -2.3226872620304369e-2, -1.9606343826616681e-3,
    4.5690838648908765e-2, 1.1232751779472532e-1, 1.7825129611097032e-1, 2.1942167258103942e-1,
    2.1942167258103948e-1, 1.7825129611097032e-1, 1.1232751779472533e-1, 4.5690838648908771e-2,
    -1.9606343826616690e-3, -2.3226872620304369e-2, -2.3118576278907201e-2, -1.2906466905783032e-2,
    -2.7237870035835541e-3, 2.6042373642096179e-3, 3.3115968607472083e-3, 1.9038353814484074e-3,
    5.2916070916784867e-4, -4.3340271636890290e-5, -6.0477988340191701e-5, 2.8477986181713758e-19,
]

/// The oversampling factor a voice needs, from the highest frequency anywhere in
/// its operator stack. A pure function of the note and the patch: deterministic,
/// twin-identical, decided once per note. Threshold placed from measurement —
/// 1x and 4x are indistinguishable up to 13.1 kHz and diverge from 14.7 kHz up.
public func chooseOversampling(maxOpFrequency: Double, sampleRate: Double) -> Int {
    maxOpFrequency > sampleRate / 4 ? fmOversampling : 1
}

/// Ring-buffered FIR: push every oversampled sample, read one output per
/// `fmOversampling` pushes.
public final class FmDecimator {
    private var history: [Double]
    private var pos = 0

    public init() {
        history = [Double](repeating: 0, count: fmDecimationTaps.count)
    }

    public func reset() {
        for i in history.indices {
            history[i] = 0
        }
        pos = 0
    }

    public func push(_ x: Double) {
        history[pos] = x
        pos = (pos + 1) % history.count
    }

    /// After push(), `pos` indexes the OLDEST sample, so tap j lines up with
    /// history[(pos + j) % n] — oldest to newest.
    public func output() -> Double {
        let n = history.count
        var y = 0.0
        for j in 0..<n {
            y += fmDecimationTaps[j] * history[(pos + j) % n]
        }
        return y
    }
}
```

- [ ] **Step 6: Write the Swift twin test**

Create `swift/Tests/AlloyAudioTests/FmOversamplingTests.swift` — a mirror of the TS spec, assertion for assertion. Match the existing XCTest style in `swift/Tests/AlloyAudioTests/`.

```swift
@testable import AlloyAudio
import Foundation
import XCTest

/// Twin of web fm-oversampling.spec.ts (canonical).
final class FmOversamplingTests: XCTestCase {
    private let fs = 48_000.0

    private func decimate(hz: Double, frames: Int) -> [Double] {
        let fsOs = fs * Double(fmOversampling)
        let dec = FmDecimator()
        var out = [Double](repeating: 0, count: frames)
        var n = 0
        for i in 0..<frames {
            for _ in 0..<fmOversampling {
                dec.push(sin(2 * Double.pi * hz * Double(n) / fsOs))
                n += 1
            }
            out[i] = dec.output()
        }
        return out
    }

    private func rms(_ x: ArraySlice<Double>) -> Double {
        sqrt(x.reduce(0) { $0 + $1 * $1 } / Double(x.count))
    }

    func testDecimationTableIs32TapsAndSumsToUnity() {
        XCTAssertEqual(fmDecimationTaps.count, 32)
        XCTAssertEqual(fmDecimationTaps.reduce(0, +), 1, accuracy: 1e-12)
    }

    func testPassesAToneInsideTheAudioBandAtUnityGain() {
        let y = decimate(hz: 1000, frames: 4096)[64...]
        XCTAssertGreaterThan(rms(y), 0.65)
        XCTAssertLessThan(rms(y), 0.75)
    }

    func testCrushesAToneAboveTheOutputNyquist() {
        // 30 kHz exists at 192 kHz but is above the 24 kHz output Nyquist; without
        // the filter it would fold back to 18 kHz.
        let y = decimate(hz: 30_000, frames: 4096)[64...]
        XCTAssertLessThan(20 * log10(rms(y) / 0.707), -40)
    }

    func testChooseOversamplingSwitchesAtQuarterSampleRate() {
        XCTAssertEqual(chooseOversampling(maxOpFrequency: 1000, sampleRate: fs), 1)
        XCTAssertEqual(chooseOversampling(maxOpFrequency: 11_999, sampleRate: fs), 1)
        XCTAssertEqual(chooseOversampling(maxOpFrequency: fs / 4, sampleRate: fs), 1)
        XCTAssertEqual(chooseOversampling(maxOpFrequency: 12_001, sampleRate: fs), fmOversampling)
        XCTAssertEqual(chooseOversampling(maxOpFrequency: 23_300, sampleRate: fs), fmOversampling)
    }

    func testChooseOversamplingScalesWithTheSampleRate() {
        XCTAssertEqual(chooseOversampling(maxOpFrequency: 20_000, sampleRate: 96_000), 1)
        XCTAssertEqual(chooseOversampling(maxOpFrequency: 25_000, sampleRate: 96_000), fmOversampling)
    }
}
```

- [ ] **Step 7: Run both suites**

Run: `swift build && swift test --filter FmOversamplingTests`
Expected: PASS, 5 tests.
Run: `cd web/packages/alloy-audio && npx vitest run`
Expected: PASS — the whole suite, nothing else disturbed.

- [ ] **Step 8: Commit (both twins together)**

```bash
git add web/packages/alloy-audio/src/dsp/fm-oversampling.ts \
        web/packages/alloy-audio/src/dsp/fm-oversampling.spec.ts \
        swift/Sources/AlloyAudio/DSP/FmOversampling.swift \
        swift/Tests/AlloyAudioTests/FmOversamplingTests.swift
git commit -m "feat(audio): add FM decimation filter and oversampling rule"
```

---

### Task 2: Adaptive oversampling in `FmGenerator`

The generator picks K at `noteOn` and, above the threshold, runs its operator loop 4× and decimates.

**The one property that must not break:** at K=1, the render must be **bit-identical** to today. That is achieved by advancing each operator's envelope **once per output sample** (held across the K sub-samples) instead of inside the operator loop. Verify it, don't assume it: the existing golden tests are the proof, and they must not move.

**Files:**
- Modify: `web/packages/alloy-audio/src/dsp/fm-generator.ts` (the `render` method, lines 107-136, and `noteOn`, lines 85-95)
- Modify: `swift/Sources/AlloyAudio/DSP/FmGenerator.swift` (the same two methods)
- Test: `web/packages/alloy-audio/src/dsp/fm-generator.spec.ts` (extend)
- Test: `swift/Tests/AlloyAudioTests/FmGeneratorTests.swift` (extend)

**Interfaces:**
- Consumes (Task 1): `FM_OVERSAMPLING`, `chooseOversampling(maxOpFrequency, sampleRate)`, `FmDecimator` / `fmOversampling`, `chooseOversampling(maxOpFrequency:sampleRate:)`, `FmDecimator`.
- Produces: no new public API. `FmGenerator`'s constructor and `ToneGenerator` conformance are unchanged.

- [ ] **Step 1: Write the failing alias-floor test (TS)**

Append to `web/packages/alloy-audio/src/dsp/fm-generator.spec.ts`. This is **the test that would have caught the original bug and did not exist.**

```ts
// --- anti-aliasing (phase 3c) ---------------------------------------------

const FS_AA = 48_000;

/** The workbench EP operator stack, at the ratio-14 modulator that made it
 *  alias. Operator 2 runs at 14x the note: on G#6 that is 23.3 kHz, against a
 *  24 kHz Nyquist. */
const EP_STACK: FmGeneratorParams = {
  operators: [
    { ratio: 1, level: 1, adsr: { attack: 0.002, decay: 1.3, sustain: 0.16, release: 0.4 } },
    { ratio: 1, level: 0.55, adsr: { attack: 0.001, decay: 0.5, sustain: 0.1, release: 0.3 } },
    { ratio: 14, level: 0.3, adsr: { attack: 0.001, decay: 0.06, sustain: 0, release: 0.05 } },
  ],
  algorithm: { routes: [{ from: 1, to: 0 }, { from: 2, to: 0 }], carriers: [0] },
};

function renderNote(params: FmGeneratorParams, midi: number, frames: number): Float32Array {
  const gen = new FmGenerator(params, FS_AA);
  gen.noteOn(midi, 0.8);
  const out = new Float32Array(frames);
  gen.render(out, frames);
  return out;
}

/** Energy below the fundamental, in dB relative to it. An FM spectrum built on
 *  f0 has NO legitimate content beneath f0, so whatever is down there is aliased
 *  foldback — which makes this a direct measurement of the defect. */
function aliasFloorDb(x: Float32Array, f0: number): number {
  const mag = (f: number) => {
    let re = 0;
    let im = 0;
    for (let i = 0; i < x.length; i++) {
      const t = (2 * Math.PI * f * i) / FS_AA;
      re += x[i] * Math.cos(t);
      im += x[i] * Math.sin(t);
    }
    return Math.hypot(re, im) / x.length;
  };
  const fundamental = mag(f0);
  let worst = 0;
  for (let f = 40; f < f0 * 0.75; f += 20) worst = Math.max(worst, mag(f));
  return 20 * Math.log10(worst / (fundamental + 1e-15));
}

const midiHz = (m: number) => 440 * 2 ** ((m - 69) / 12);

describe('FmGenerator anti-aliasing', () => {
  it('does not fold sidebands into the bass on G#6 (this is the bug that shipped)', () => {
    // Before oversampling this measured -25 dB. Oversampled it measures -63 dB;
    // -55 leaves margin without being so loose the regression could return.
    const y = renderNote(EP_STACK, 92, FS_AA / 2);
    expect(aliasFloorDb(y, midiHz(92))).toBeLessThan(-55);
  });

  it('holds up at C7', () => {
    const y = renderNote(EP_STACK, 96, FS_AA / 2);
    expect(aliasFloorDb(y, midiHz(96))).toBeLessThan(-55);
  });

  it('improves C8, even though C8 is not fully clean by design', () => {
    // Accepted limit: 8x would be needed to get C8 below -60, at ~9x the CPU.
    // Before oversampling this measured -21 dB; after, -46 dB.
    const y = renderNote(EP_STACK, 108, FS_AA / 2);
    expect(aliasFloorDb(y, midiHz(108))).toBeLessThan(-40);
  });

  it('leaves low notes on the original 1x path — oversampling there is a no-op', () => {
    const gen = new FmGenerator(EP_STACK, FS_AA);
    gen.noteOn(60, 0.8);
    expect(gen.oversampling).toBe(1); // C4 x 14 = 3.7 kHz, well under 12 kHz
    gen.noteOn(92, 0.8);
    expect(gen.oversampling).toBe(FM_OVERSAMPLING); // G#6 x 14 = 23.3 kHz
  });

  it('switches factor between adjacent notes without an audible level jump', () => {
    // The adaptive design is only legitimate because oversampling is a no-op
    // below the threshold. Two notes either side of the switch must match.
    // ratio 14: the threshold (12 kHz) falls at f0 = 857 Hz, i.e. between midi
    // 80 (830 Hz -> 1x) and midi 81 (880 Hz -> 4x).
    const below = renderNote(EP_STACK, 80, FS_AA / 4);
    const above = renderNote(EP_STACK, 81, FS_AA / 4);
    const rms = (v: Float32Array) => Math.sqrt(v.reduce((s, x) => s + x * x, 0) / v.length);
    const ratioDb = 20 * Math.log10(rms(above) / rms(below));
    expect(Math.abs(ratioDb)).toBeLessThan(1.5); // no step at the switch
  });

  it('is deterministic', () => {
    const a = renderNote(EP_STACK, 92, 4096);
    const b = renderNote(EP_STACK, 92, 4096);
    expect(Array.from(a)).toEqual(Array.from(b));
  });
});
```

Add `FM_OVERSAMPLING` to the file's imports from `./fm-oversampling.js`, and `FmGeneratorParams` / `FmGenerator` from `./fm-generator.js` if not already imported.

- [ ] **Step 2: Run it and watch it fail**

Run: `cd web/packages/alloy-audio && npx vitest run fm-generator`
Expected: FAIL. The G#6 test fails on the alias floor (it will report roughly −25 dB, nowhere near −55), and the `gen.oversampling` test fails to compile — the property does not exist yet. **Paste the actual reported alias-floor number into your report**; it is the before-measurement.

- [ ] **Step 3: Rewrite `render` and `noteOn` in `fm-generator.ts`**

Add the import at the top of the file:

```ts
import { FM_OVERSAMPLING, FmDecimator, chooseOversampling } from './fm-oversampling.js';
```

Add these fields to the class (beside the existing `private frequency = 0;` etc.):

```ts
  /** Highest ratio in the stack — hoisted so noteOn stays allocation-free. */
  private readonly maxRatio: number;
  /** Oversampling factor for the current note; 1 = the original code path.
   *  Named `oversamplingFactor` because the public getter takes `oversampling`. */
  private oversamplingFactor = 1;
  private readonly decimator = new FmDecimator();
  /** Envelope level per operator for the current OUTPUT sample. */
  private readonly envLevels: number[];
```

In the constructor, after the existing `this.outputs = ...` line:

```ts
    this.maxRatio = Math.max(...params.operators.map((op) => op.ratio));
    this.envLevels = params.operators.map(() => 0);
```

Replace `noteOn` (currently lines 85-95) with:

```ts
  noteOn(midi: number, velocity: number): void {
    this.keyed = true;
    this.pitchRatio = 1;
    this.frequency = midiToFrequency(midi);
    this.amp = velocity;
    // Decide the oversampling factor ONCE per note, from the highest frequency
    // anywhere in the stack. setPitchRatio deliberately does not re-decide it
    // mid-note — that would glitch — which is why the threshold carries ~2
    // semitones of bend headroom.
    this.oversamplingFactor = chooseOversampling(this.frequency * this.maxRatio, this.sampleRate);
    this.decimator.reset();
    this.phases.fill(0);
    this.outputs.fill(0);
    for (const env of this.envelopes) {
      env.noteOn();
    }
  }
```

Expose the factor for the tests (add next to `get finished`):

```ts
  /** Oversampling factor chosen for the current note (1 or FM_OVERSAMPLING). */
  get oversampling(): number {
    return this.oversamplingFactor;
  }
```

Replace `render` (currently lines 107-136) with:

```ts
  render(out: Float32Array, frames: number): void {
    const { operators, algorithm } = this.params;
    const carrierScale = this.amp / algorithm.carriers.length;
    const os = this.oversamplingFactor;
    const phaseRate = (this.frequency * this.pitchRatio) / (this.sampleRate * os);
    for (let n = 0; n < frames; n++) {
      if (this.finished) {
        return;
      }
      // Envelopes advance ONCE per output sample and are held across the K
      // sub-samples. They are slow control signals (<= 83 us of hold at K=4), so
      // this is inaudible — and it is what makes the os === 1 path bit-identical
      // to the pre-oversampling code, which is why no golden moves.
      for (let i = 0; i < operators.length; i++) {
        this.envLevels[i] = this.envelopes[i].nextSample();
      }
      let sample = 0;
      for (let k = 0; k < os; k++) {
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
          this.outputs[i] = Math.sin(TWO_PI * (this.phases[i] + mod)) * this.envLevels[i] * operators[i].level;
          this.phases[i] += phaseRate * operators[i].ratio;
          this.phases[i] -= Math.floor(this.phases[i]);
        }
        let sum = 0;
        for (const c of algorithm.carriers) {
          sum += this.outputs[c];
        }
        if (os === 1) {
          sample = sum;
        } else {
          this.decimator.push(sum);
          if (k === os - 1) {
            sample = this.decimator.output();
          }
        }
      }
      out[n] += sample * carrierScale;
    }
  }
```

- [ ] **Step 4: Run the TS suite — the alias tests pass AND every golden is untouched**

Run: `cd web/packages/alloy-audio && npx vitest run`
Expected: PASS, whole suite. **The golden tests must pass with their existing pinned values.** If a golden fails, the K=1 path is not bit-identical — that is a real defect in this change. Do NOT regenerate the golden; stop and report.

- [ ] **Step 5: Port to Swift**

In `swift/Sources/AlloyAudio/DSP/FmGenerator.swift`, add these stored properties beside the existing `private var frequency = 0.0` etc.:

```swift
    /// Highest ratio in the stack — hoisted so noteOn stays allocation-free.
    private let maxRatio: Double
    /// Oversampling factor for the current note; 1 = the original code path.
    private var oversamplingFactor = 1
    private let decimator = FmDecimator()
    /// Envelope level per operator for the current OUTPUT sample.
    private var envLevels: [Double]
```

In `init`, after the existing `outputs = ...` line:

```swift
        maxRatio = params.operators.map(\.ratio).max() ?? 1
        envLevels = [Double](repeating: 0, count: opCount)
```

Expose the factor for the tests, next to `public var finished`:

```swift
    /// Oversampling factor chosen for the current note (1 or fmOversampling).
    public var oversampling: Int { oversamplingFactor }
```

Replace `noteOn`:

```swift
    public func noteOn(midi: Int, velocity: Double) {
        keyed = true
        pitchRatio = 1
        frequency = Pitch.frequency(midi: midi)
        amp = velocity
        // Decide the oversampling factor ONCE per note, from the highest frequency
        // anywhere in the stack. setPitchRatio deliberately does not re-decide it
        // mid-note — that would glitch — which is why the threshold carries ~2
        // semitones of bend headroom.
        oversamplingFactor = chooseOversampling(
            maxOpFrequency: frequency * maxRatio, sampleRate: sampleRate,
        )
        decimator.reset()
        for i in phases.indices {
            phases[i] = 0
            outputs[i] = 0
        }
        for env in envelopes {
            env.noteOn()
        }
    }
```

Replace `render(into:frames:)`:

```swift
    public func render(into out: inout [Float], frames: Int) {
        let operators = params.operators
        let algorithm = params.algorithm
        let carrierScale = amp / Double(algorithm.carriers.count)
        let os = oversamplingFactor
        let phaseRate = (frequency * pitchRatio) / (sampleRate * Double(os))
        for n in 0..<frames {
            if finished { return }
            // Envelopes advance ONCE per output sample and are held across the K
            // sub-samples. They are slow control signals (<= 83 us of hold at K=4),
            // so this is inaudible — and it is what makes the os == 1 path
            // bit-identical to the pre-oversampling code, which is why no golden
            // moves. Do NOT "tidy" this back inside the operator loop.
            for i in operators.indices {
                envLevels[i] = envelopes[i].nextSample()
            }
            var sample = 0.0
            for k in 0..<os {
                for i in stride(from: operators.count - 1, through: 0, by: -1) {
                    var mod = 0.0
                    for route in algorithm.routes where route.to == i {
                        mod += outputs[route.from]
                    }
                    if let feedback = algorithm.feedback, feedback.op == i {
                        mod += outputs[i] * feedback.amount
                    }
                    outputs[i] = sin(2 * Double.pi * (phases[i] + mod)) * envLevels[i] * operators[i].level
                    phases[i] += phaseRate * operators[i].ratio
                    phases[i] -= phases[i].rounded(.down)
                }
                var sum = 0.0
                for c in algorithm.carriers {
                    sum += outputs[c]
                }
                if os == 1 {
                    sample = sum
                } else {
                    decimator.push(sum)
                    if k == os - 1 {
                        sample = decimator.output()
                    }
                }
            }
            out[n] += Float(sample * carrierScale)
        }
    }
```

**Match the existing file's spelling of the sine and the phase wrap** (it may use a `TWO_PI` constant and `floor(...)` rather than `2 * Double.pi` and `.rounded(.down)`). Reuse whatever is already there — a different spelling of the same math is fine, a different *result* is not.

- [ ] **Step 6: Write the Swift twin test**

Extend `swift/Tests/AlloyAudioTests/FmGeneratorTests.swift` with the mirror of Step 1's suite — same fixed inputs, same thresholds, per the repo's twin-test convention.

```swift
    // MARK: - anti-aliasing (phase 3c)

    /// The workbench EP operator stack, at the ratio-14 modulator that made it
    /// alias. Operator 2 runs at 14x the note: on G#6 that is 23.3 kHz, against a
    /// 24 kHz Nyquist. Twin of EP_STACK in fm-generator.spec.ts.
    private var epStack: FmGeneratorParams {
        FmGeneratorParams(
            operators: [
                FmOperatorParams(ratio: 1, level: 1,
                                 adsr: AdsrParams(attack: 0.002, decay: 1.3, sustain: 0.16, release: 0.4)),
                FmOperatorParams(ratio: 1, level: 0.55,
                                 adsr: AdsrParams(attack: 0.001, decay: 0.5, sustain: 0.1, release: 0.3)),
                FmOperatorParams(ratio: 14, level: 0.3,
                                 adsr: AdsrParams(attack: 0.001, decay: 0.06, sustain: 0, release: 0.05)),
            ],
            algorithm: FmAlgorithm(routes: [.init(from: 1, to: 0), .init(from: 2, to: 0)], carriers: [0]),
        )
    }

    private func renderNote(_ params: FmGeneratorParams, midi: Int, frames: Int) -> [Float] {
        let gen = FmGenerator(params: params, sampleRate: 48_000)
        gen.noteOn(midi: midi, velocity: 0.8)
        var out = [Float](repeating: 0, count: frames)
        gen.render(into: &out, frames: frames)
        return out
    }

    /// Energy below the fundamental, in dB relative to it. An FM spectrum built on
    /// f0 has NO legitimate content beneath f0, so whatever is down there is
    /// aliased foldback — a direct measurement of the defect.
    private func aliasFloorDb(_ x: [Float], f0: Double) -> Double {
        let fs = 48_000.0
        func mag(_ f: Double) -> Double {
            var re = 0.0
            var im = 0.0
            for i in 0..<x.count {
                let t = 2 * Double.pi * f * Double(i) / fs
                re += Double(x[i]) * cos(t)
                im += Double(x[i]) * sin(t)
            }
            return (re * re + im * im).squareRoot() / Double(x.count)
        }
        let fundamental = mag(f0)
        var worst = 0.0
        var f = 40.0
        while f < f0 * 0.75 {
            worst = max(worst, mag(f))
            f += 20
        }
        return 20 * log10(worst / (fundamental + 1e-15))
    }

    private func midiHz(_ m: Int) -> Double { 440 * pow(2, (Double(m) - 69) / 12) }

    func testDoesNotFoldSidebandsIntoTheBassOnGSharp6() {
        // Before oversampling this measured -25 dB; oversampled, -63 dB.
        let y = renderNote(epStack, midi: 92, frames: 24_000)
        XCTAssertLessThan(aliasFloorDb(y, f0: midiHz(92)), -55)
    }

    func testHoldsUpAtC7() {
        let y = renderNote(epStack, midi: 96, frames: 24_000)
        XCTAssertLessThan(aliasFloorDb(y, f0: midiHz(96)), -55)
    }

    func testImprovesC8EvenThoughC8IsNotFullyCleanByDesign() {
        // Accepted limit: 8x would be needed to get C8 below -60, at ~9x the CPU.
        let y = renderNote(epStack, midi: 108, frames: 24_000)
        XCTAssertLessThan(aliasFloorDb(y, f0: midiHz(108)), -40)
    }

    func testLeavesLowNotesOnTheOriginalOneTimesPath() {
        let gen = FmGenerator(params: epStack, sampleRate: 48_000)
        gen.noteOn(midi: 60, velocity: 0.8)
        XCTAssertEqual(gen.oversampling, 1) // C4 x 14 = 3.7 kHz, well under 12 kHz
        gen.noteOn(midi: 92, velocity: 0.8)
        XCTAssertEqual(gen.oversampling, fmOversampling) // G#6 x 14 = 23.3 kHz
    }

    func testSwitchesFactorBetweenAdjacentNotesWithoutALevelJump() {
        // The adaptive design is only legitimate because oversampling is a no-op
        // below the threshold. ratio 14 puts the 12 kHz threshold at f0 = 857 Hz,
        // i.e. between midi 80 (830 Hz -> 1x) and midi 81 (880 Hz -> 4x).
        func rms(_ v: [Float]) -> Double {
            (v.reduce(0.0) { $0 + Double($1) * Double($1) } / Double(v.count)).squareRoot()
        }
        let below = renderNote(epStack, midi: 80, frames: 12_000)
        let above = renderNote(epStack, midi: 81, frames: 12_000)
        XCTAssertLessThan(abs(20 * log10(rms(above) / rms(below))), 1.5)
    }

    func testAntiAliasedRenderIsDeterministic() {
        XCTAssertEqual(renderNote(epStack, midi: 92, frames: 4096),
                       renderNote(epStack, midi: 92, frames: 4096))
    }
```

**Before writing this, open `swift/Sources/AlloyAudio/DSP/FmGenerator.swift` and `AdsrEnvelope.swift` and use the REAL initializer signatures** for `FmGeneratorParams`, `FmOperatorParams`, `FmAlgorithm`, and `AdsrParams` — the calls above are reconstructed from how the TS twin uses them. Adjust to fit reality; do not change the source types to fit the test.

- [ ] **Step 7: Run both suites**

Run: `swift build && swift test`
Expected: PASS — including `GoldenRenderTests` with its **existing** pinned values.
Run: `cd web/packages/alloy-audio && npx vitest run`
Expected: PASS.

Report the alias floor at midi 92 **before and after** on both platforms.

- [ ] **Step 8: Commit (both twins in one commit — the twin rule)**

```bash
git add web/packages/alloy-audio/src/dsp/fm-generator.ts \
        web/packages/alloy-audio/src/dsp/fm-generator.spec.ts \
        swift/Sources/AlloyAudio/DSP/FmGenerator.swift \
        swift/Tests/AlloyAudioTests/FmGeneratorTests.swift
git commit -m "fix(audio): oversample the FM generator to stop high-note aliasing"
```

---

### Task 3: Restore the EP's brightness, prove the CPU budget, record the contract

The payoff, the gate, and the paperwork.

**Files:**
- Modify: `examples/web-harness/src/app/sections/rompler-section.component.ts` (the EP catalog entry's operator 3)
- Modify: `docs/mirroring.md`
- Modify: `docs/superpowers/specs/2026-07-10-alloy-rompler-engine-design.md` (phasing)

**Interfaces:**
- Consumes: Tasks 1 and 2. Produces: nothing.

- [ ] **Step 1: Put the EP back to ratio 14**

In `examples/web-harness/src/app/sections/rompler-section.component.ts`, the EP Ensemble patch's third operator currently reads `{ ratio: 7, ... }` with a long comment explaining that ratio 14 aliased. Restore it and replace the comment:

```ts
                // The hammer "clank". Ratio 14 runs this operator at 23.3 kHz on
                // G#6 — right at Nyquist — which used to fold back as inharmonic
                // bass junk (-24.7 dB below the fundamental). It no longer does:
                // FmGenerator oversamples any voice whose stack reaches past
                // sampleRate/4. See fm-oversampling.ts.
                { ratio: 14, level: 0.3, adsr: { attack: 0.001, decay: 0.06, sustain: 0, release: 0.05 } },
```

- [ ] **Step 2: Run the CPU gate on BOTH platforms and report the numbers**

The benchmark plays `PATCH_FM` (a ratio-14 stack) across midi 36–99, so roughly 19 of its 64 voices now cross the threshold and oversample — it genuinely exercises the new path.

```bash
swift test -c release --filter BenchmarkTests 2>&1 | grep -i "64-voice"
cd web/packages/alloy-audio && npx vitest run benchmark 2>&1 | grep -i "64-voice"
```

The Swift release number is the one that matters: **before this change it was ~12% of one core, and the founding spec's envelope is <25%.** Report the new figure.

- If it is **under 25%**: the gate holds. Note it and move on.
- If it is **over 25%**: STOP and report to the controller with the number. Do not silently accept it, and do not start optimizing on your own initiative — the design has explicit levers (the `% n` in `FmDecimator.output` can be removed with a doubled ring buffer; the threshold can be raised) and choosing between them is a decision, not a fix.

- [ ] **Step 3: Record the twin contract in `docs/mirroring.md`**

`CLAUDE.md` calls this file "the twin-API contract. **Binding for every change.**" Read it first and match its existing structure and tone. Add an entry covering:

- `FmOversampling` / `fm-oversampling.ts`: `FM_OVERSAMPLING` / `fmOversampling` = 4, and the **32-tap decimation table, which is a pinned constant in both twins** — it must never be computed at runtime, because `Math.sin` (JS) and `sin` (Swift) may differ in the last ulp and would silently diverge the twins.
- `chooseOversampling(maxOpFrequency, sampleRate)`: threshold `sampleRate / 4`, exclusive. Pure function of the note and the patch; decided once per `noteOn` and deliberately NOT re-decided by `setPitchRatio`.
- The behavioural contract that matters most: **operator envelopes step once per OUTPUT sample, held across sub-samples.** This is what keeps the K=1 path bit-identical to the pre-3c code, and therefore what keeps the goldens stable. A future contributor who "tidies" the envelope step back inside the operator loop will silently break twin golden agreement.

- [ ] **Step 4: Mark phase 3c in the founding spec**

In `docs/superpowers/specs/2026-07-10-alloy-rompler-engine-design.md`, the phasing list has `3.` (pipeline + piano, with 3a/3b marked complete) and `4. First wave`. Add a **3c complete** entry in the same style as the 3a/3b ones, recording: adaptive per-voice oversampling in `FmGenerator` (K ∈ {1,4}, threshold `sampleRate/4`), the measured result (G#6 −25 → −63 dB, C8 −21 → −46 dB), that C8 is accepted at −46 dB rather than paying 8×, that the K=1 path is bit-identical so no goldens moved, and the benchmark figure from Step 2. Reference
`docs/superpowers/specs/2026-07-14-rompler-fm-antialiasing-3c-design.md`.

- [ ] **Step 5: Verify everything**

```bash
cd web/packages/alloy-audio && npx vitest run
swift build && swift test
cd examples/web-harness && npx ng build
```
Expected: all green.

- [ ] **Step 6: Commit**

```bash
git add examples/web-harness/src/app/sections/rompler-section.component.ts \
        docs/mirroring.md \
        docs/superpowers/specs/2026-07-10-alloy-rompler-engine-design.md
git commit -m "feat(harness): restore the EP's ratio-14 clank now FM is anti-aliased"
```

---

## After the plan

The listening check (the user's, not a subagent's): play the **EP** high on the keyboard — G#6 was where the bassy noise was — and confirm the clank is back and the noise is gone.

Known and accepted, recorded so they are not rediscovered as bugs:

- **C8 sits at −46 dB**, not fully clean. 8× would fix it at ~9× the FM CPU.
- **~83 µs of group delay** on an oversampled voice, from the decimation FIR. In a layered patch an oversampled voice sits a hair behind a non-oversampled one.
- **The VA generator is still un-anti-aliased.** Its saw/square are the other classic foldback source. Nobody has complained and it does not gate phase 4, so it is deliberately out of scope — but it is the same class of bug, and phase 4's strings/organs may surface it.
