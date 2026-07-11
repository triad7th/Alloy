# Rompler Voice Engine — Implementation Plan (Phase 1b-i)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the phase-1a DSP units into a playing engine: patch data model, voice assembly (layers → generator → TVF → TVA with LFO modulation), a polyphonic engine core with a sample-position transport clock and event scheduling, and golden patch-render twin tests. Spec: `docs/superpowers/specs/2026-07-10-alloy-rompler-engine-design.md`. Platform hosts (AudioWorklet / AVAudioSourceNode) are phase 1b-ii, a separate plan.

**Architecture:** Everything stays pure DSP (no platform audio imports) so the whole engine is twin-testable offline. Modulation is two-rate: TVA envelopes run per-sample (click-free), TVF envelope + LFO run at control rate (sampleRate/16, ticked once per 16-sample chunk). Voice lifetime = TVA active AND generator not finished. Web TS is canonical; Swift twins land in the same commit per task.

**Tech Stack:** TypeScript (ESM, Vitest) in `web/packages/alloy-audio`; Swift (Foundation only, XCTest for DSP tests) in `swift/`.

## Global Constraints

- All 1a constraints hold: no WebAudio/AVFoundation imports under `src/dsp/` / `Sources/AlloyAudio/DSP/`; double-precision internals, Float32 at render boundaries only; determinism (DspPrng is the only randomness; no Date.now/Math.random); ESM `.js` import suffixes; conventional commits; one commit per task containing both twins; both suites green before every commit.
- Twin reference workflow (established in 1a): TS spec holds `TWIN_REFERENCE`, filled via a temporary console.log, pasted identically into the Swift test's `twinReference`, log deleted. Tolerances: 1e-6 for single-unit renders; golden full-engine renders use 1e-4 probes (transcendental drift accumulates over seconds of audio).
- Established twin conventions (reuse, don't rediscover): Swift midi→frequency is `Pitch.frequency(midi:)`; XCTest; `toBeCloseTo(x, n)` → `accuracy: 5·10^-(n+1)`; TS throws `Error` for validation, Swift uses `precondition` — and NEW in this phase, both platforms get non-throwing `validate*` functions returning `[String]` so Apple callers can validate patch data BEFORE construction (1a final-review carry-over).
- Do not run configless formatters (swiftformat/prettier) — the repo has no configs; match checked-in style by eye.
- 1a behavioral contracts that must NOT change: existing twin reference values in all 1a spec files; generators apply LINEAR velocity to amplitude (the TVA applies only the perceptual residual, see Task 4); `AdsrEnvelope.noteOn()` intentionally does NOT reset `level` (click-free retrigger — do not "fix").

## File Structure

| File (web `src/dsp/`, Swift `Sources/AlloyAudio/DSP/`) | Responsibility |
|---|---|
| MODIFY `sample-zone-generator.ts` / `SampleZoneGenerator.swift` | degenerate-loop guard |
| MODIFY `svf.ts` / `Svf.swift` | safe default params |
| MODIFY `fm-generator.ts` / `FmGenerator.swift` | `validateFmGeneratorParams` + feedback.op check |
| MODIFY `adsr-envelope.ts` / `AdsrEnvelope.swift` | `fastRelease(tau)` |
| CREATE `patch.ts` / `Patch.swift` | patch data model + `validatePatch` |
| MODIFY all four generators + `dsp-types.ts` / `ToneGenerator.swift` | `setPitchRatio` contract |
| CREATE `voice.ts` / `Voice.swift` | one note: layers → gen → TVF → TVA + LFO routes |
| CREATE `patch-engine.ts` / `PatchEngine.swift` | voice pool, transport clock, event queue, `renderPatch` offline helper |
| CREATE `golden-render.spec.ts` / `GoldenRenderTests.swift` | 4 fixture patches, full-engine twin renders |

Tests colocated per 1a conventions. `index.ts` gains exports as files land.

---

### Task 1: 1a hardening carry-overs

**Files:**
- Modify: `web/packages/alloy-audio/src/dsp/sample-zone-generator.ts`, `svf.ts`, `fm-generator.ts`, `adsr-envelope.ts` (+ their `.spec.ts`)
- Modify: `swift/Sources/AlloyAudio/DSP/SampleZoneGenerator.swift`, `Svf.swift`, `FmGenerator.swift`, `AdsrEnvelope.swift` (+ their test files)

**Interfaces:**
- Consumes: 1a code as landed.
- Produces (later tasks rely on): `AdsrEnvelope.fastRelease(tau: number): void` — recomputes the release coefficient for time-constant `tau` seconds and enters the release stage (used for voice stealing / allNotesOff); `validateFmGeneratorParams(params): string[]` (TS export; Swift `validateFmGeneratorParams(_:) -> [String]`) — returns human-readable errors, empty = valid; FM constructor now delegates to it (TS throws on non-empty joined message; Swift `precondition(errors.isEmpty, ...)`), and it ALSO checks `feedback.op` is in `[0, opCount)`; `Svf` constructor now initializes coefficients via `setParams(sampleRate * 0.49, 0.707)` (fully open, neutral) so an unconfigured filter passes signal instead of outputting zeros; sample-zone loops are active only when `loopEnd > loopStart` (a zone with `loopStart === loopEnd` behaves as a one-shot; the wrap `while` loops can no longer hang).

Four changes, each TDD (failing test → implement → pass), both twins, all in ONE commit at the end.

- [ ] **Step 1: Degenerate loop guard.** TS failing test (add to `sample-zone-generator.spec.ts`):

```ts
  it('treats a zero-length loop region as a one-shot instead of hanging', () => {
    const zone = { rootMidi: 69, sampleRate: FS, data: new Float32Array(480).fill(0.5), loopStart: 100, loopEnd: 100 };
    const gen = new SampleZoneGenerator([{ topVelocity: 1, zones: [zone] }], 0, FS);
    gen.noteOn(69, 1);
    render(gen, 600); // must return, not hang
    expect(gen.finished).toBe(true);
  });
```

Implementation: in `render`, change the loop-availability check to `const loop = read.zone.loopStart !== undefined && read.zone.loopEnd !== undefined && read.zone.loopEnd > read.zone.loopStart;` and pass that same flag into `cubicRead` (its signature already takes `loop`). Swift mirror: `let loop = zone.loopStart != nil && zone.loopEnd != nil && zone.loopEnd! > zone.loopStart!`. Mirror the test in `SampleZoneGeneratorTests.swift`.

- [ ] **Step 2: Svf safe defaults.** TS failing test (add to `svf.spec.ts`):

```ts
  it('passes signal before setParams is called (open lowpass default)', () => {
    const f = new Svf('lowpass', FS);
    const out: number[] = [];
    for (let i = 0; i < 480; i++) out.push(f.process(Math.sin((2 * Math.PI * 440 * i) / FS)));
    const settled = out.slice(240);
    expect(Math.max(...settled.map(Math.abs))).toBeGreaterThan(0.9);
  });
```

Implementation: at the end of the TS constructor add `this.setParams(sampleRate * 0.49, 0.707);` (Swift mirror in `init`). Update the class doc comment: "Constructed fully open; call setParams to shape." Existing twin references are unaffected (every existing test calls setParams first). Mirror test in Swift.

- [ ] **Step 3: FM validation function + feedback.op check.** TS failing tests (add to `fm-generator.spec.ts`):

```ts
  it('validateFmGeneratorParams reports errors instead of throwing', () => {
    const bad = {
      operators: [{ ratio: 1, level: 1, adsr: FAST_ADSR }],
      algorithm: { routes: [], carriers: [0], feedback: { op: 5, amount: 0.3 } },
    };
    const errors = validateFmGeneratorParams(bad);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0]).toMatch(/feedback/i);
  });

  it('constructor rejects out-of-range feedback.op', () => {
    expect(() => new FmGenerator({
      operators: [{ ratio: 1, level: 1, adsr: FAST_ADSR }],
      algorithm: { routes: [], carriers: [0], feedback: { op: 5, amount: 0.3 } },
    }, FS)).toThrow();
  });
```

Implementation (TS): export

```ts
/** Non-throwing validation: empty array = constructible on both platforms. */
export function validateFmGeneratorParams(params: FmGeneratorParams): string[] {
  const errors: string[] = [];
  const opCount = params.operators.length;
  if (opCount < 1 || opCount > 6) {
    errors.push(`operator count ${opCount} outside 1..6`);
  }
  for (const route of params.algorithm.routes) {
    if (route.from <= route.to || route.from >= opCount || route.to < 0) {
      errors.push(`route ${route.from}->${route.to} must flow from a higher to a lower operator index`);
    }
  }
  for (const carrier of params.algorithm.carriers) {
    if (carrier < 0 || carrier >= opCount) {
      errors.push(`carrier index ${carrier} out of range`);
    }
  }
  if (params.algorithm.carriers.length === 0) {
    errors.push('at least one carrier required');
  }
  const feedback = params.algorithm.feedback;
  if (feedback && (feedback.op < 0 || feedback.op >= opCount)) {
    errors.push(`feedback.op ${feedback.op} out of range`);
  }
  return errors;
}
```

Constructor replaces its inline checks with `const errors = validateFmGeneratorParams(params); if (errors.length > 0) throw new Error(errors.join('; '));`. Swift: free function `public func validateFmGeneratorParams(_ params: FmGeneratorParams) -> [String]` with the same checks and messages; `FmGenerator.init` uses `let errors = validateFmGeneratorParams(params); precondition(errors.isEmpty, errors.joined(separator: "; "))`. Swift test: `XCTAssertFalse(validateFmGeneratorParams(bad).isEmpty)` (no constructor-trap test, per package style).

- [ ] **Step 4: AdsrEnvelope.fastRelease.** TS failing test (add to `adsr-envelope.spec.ts`):

```ts
  it('fastRelease overrides the release time constant', () => {
    const env = new AdsrEnvelope(PARAMS, FS);
    env.noteOn();
    renderSamples(env, Math.round(0.2 * FS));
    env.fastRelease(0.002);
    renderSamples(env, Math.round(0.05 * FS)); // 25 tau of the fast release
    expect(env.isActive).toBe(false);
  });
```

Implementation: make the release coefficient mutable (`private releaseCoef: number` — drop `readonly`; Swift `var`), add:

```ts
  /** Enter release with an overriding time constant (voice steal / allNotesOff). */
  fastRelease(tau: number): void {
    this.releaseCoef = onePoleCoef(tau, this.sampleRate);
    this.noteOff();
  }
```

This requires storing `sampleRate` as a field (currently only used in the constructor). Swift mirror identical. Existing twin references unaffected (fastRelease never called in old tests).

- [ ] **Step 5: Run both full suites** (`cd web/packages/alloy-audio && npx vitest run`; `cd swift && swift test`) → all green, including every untouched 1a twin-reference test.

- [ ] **Step 6: Commit**

```bash
git add web/packages/alloy-audio/src swift/Sources/AlloyAudio/DSP swift/Tests/AlloyAudioTests
git commit -m "feat(audio): harden DSP units per phase 1a review"
```

---

### Task 2: Patch data model + validation

**Files:**
- Create: `web/packages/alloy-audio/src/dsp/patch.ts`, test `patch.spec.ts`
- Modify: `web/packages/alloy-audio/src/index.ts`
- Create: `swift/Sources/AlloyAudio/DSP/Patch.swift`, test `swift/Tests/AlloyAudioTests/PatchTests.swift`
- Modify (Codable conformance only, no behavior): `AdsrEnvelope.swift` (`AdsrParams: Codable`), `FmGenerator.swift` (all five param structs `: Codable`), `AdditiveGenerator.swift` (`AdditivePartial: Codable`), `VaGenerator.swift` (`VaParams: Codable`), `PolyBlepOscillator.swift` (`OscShape: String, Codable` with raw values `"sine"`, `"saw"`, `"pulse"`), `Svf.swift` (`SvfMode: String, Codable` — `"lowpass"`, `"bandpass"`, `"highpass"`), `Lfo.swift` (`LfoShape: String, Codable` — `"sine"`, `"triangle"`; `LfoParams: Codable`)

**Interfaces:**
- Consumes: 1a param types.
- Produces — the patch schema every later task builds on (TS canonical; JSON field names are the wire contract, Swift Codable must match them exactly):

```ts
export const PATCH_SCHEMA_VERSION = 1;

export interface PatchMeta {
  id: string;
  name: string;
  category: 'melodic' | 'kit';
  gmProgram?: number;
}

export interface KeyRange { lowMidi: number; highMidi: number }
export interface VelRange { low: number; high: number } // 0..1 inclusive

export type GeneratorSpec =
  | { kind: 'fm'; fm: FmGeneratorParams }
  | { kind: 'additive'; partials: AdditivePartial[] }
  | { kind: 'va'; va: VaParams; seed: number }
  | { kind: 'sample'; zoneSetId: string; crossfade: number };

export interface TvfParams {
  mode: SvfMode;
  cutoffHz: number;
  q: number;
  /** Extra Hz opened by the filter envelope at full level. */
  envAmountHz: number;
  env?: AdsrParams;
  /** 0 = fixed cutoff; 1 = cutoff doubles per octave above middle C. */
  keyTrack: number;
  /** Extra Hz opened at velocity 1. */
  velAmountHz: number;
}

export interface TvaParams {
  level: number; // linear layer gain
  adsr: AdsrParams;
  /** Perceptual velocity exponent; generators already apply velocity^1. */
  velCurve: number;
}

export interface LfoRouting {
  lfo: LfoParams;
  toPitchCents: number;
  toCutoffHz: number;
  toAmpDepth: number; // 0..1 tremolo depth
}

export interface PatchLayer {
  keyRange: KeyRange;
  velRange: VelRange;
  generator: GeneratorSpec;
  tvf?: TvfParams;
  tva: TvaParams;
  mod?: LfoRouting;
}

export interface Patch {
  schemaVersion: number;
  meta: PatchMeta;
  layers: PatchLayer[]; // 1..4
  sends: { reverb: number; delay: number }; // consumed in phase 2
}

/** Non-throwing validation; empty = safe to construct voices from on both platforms. */
export function validatePatch(patch: Patch): string[];
```

`validatePatch` checks: `schemaVersion === PATCH_SCHEMA_VERSION`; 1–4 layers; per layer: key range `0 <= lowMidi <= highMidi <= 127`; vel range `0 <= low <= high <= 1`; `tva.level > 0`; generator-specific — `fm` delegates to `validateFmGeneratorParams` (Task 1) prefixing errors with `layer N:`; `va` requires `unison >= 1`; `additive` requires ≥1 partial; `sample` requires non-empty `zoneSetId` and `crossfade >= 0`. Swift twin: `public func validatePatch(_ patch: Patch) -> [String]` with identical messages.

Swift `GeneratorSpec` is an enum with a custom Codable implementation keyed on `kind`:

```swift
public enum GeneratorSpec: Codable {
    case fm(FmGeneratorParams)
    case additive([AdditivePartial])
    case va(VaParams, seed: UInt32)
    case sample(zoneSetId: String, crossfade: Double)

    private enum CodingKeys: String, CodingKey { case kind, fm, partials, va, seed, zoneSetId, crossfade }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        switch try c.decode(String.self, forKey: .kind) {
        case "fm": self = try .fm(c.decode(FmGeneratorParams.self, forKey: .fm))
        case "additive": self = try .additive(c.decode([AdditivePartial].self, forKey: .partials))
        case "va": self = try .va(c.decode(VaParams.self, forKey: .va), seed: c.decode(UInt32.self, forKey: .seed))
        case "sample": self = try .sample(zoneSetId: c.decode(String.self, forKey: .zoneSetId), crossfade: c.decode(Double.self, forKey: .crossfade))
        default: throw DecodingError.dataCorruptedError(forKey: .kind, in: c, debugDescription: "unknown generator kind")
        }
    }

    public func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        switch self {
        case let .fm(params): try c.encode("fm", forKey: .kind); try c.encode(params, forKey: .fm)
        case let .additive(partials): try c.encode("additive", forKey: .kind); try c.encode(partials, forKey: .partials)
        case let .va(params, seed): try c.encode("va", forKey: .kind); try c.encode(params, forKey: .va); try c.encode(seed, forKey: .seed)
        case let .sample(zoneSetId, crossfade): try c.encode("sample", forKey: .kind); try c.encode(zoneSetId, forKey: .zoneSetId); try c.encode(crossfade, forKey: .crossfade)
        }
    }
}
```

Remaining Swift structs (`PatchMeta`, `KeyRange`, `VelRange`, `TvfParams`, `TvaParams`, `LfoRouting`, `PatchLayer`, `Patch`, `PatchSends`) are plain Codable structs with public memberwise inits, field names matching the TS JSON exactly (`category` decodes the strings `"melodic"`/`"kit"` via `PatchCategory: String, Codable`).

- [ ] **Step 1: TS failing tests.** `patch.spec.ts` — one shared fixture used by BOTH platforms (the twin agreement artifact of this task):

```ts
import { describe, expect, it } from 'vitest';
import { validatePatch, PATCH_SCHEMA_VERSION, type Patch } from './patch.js';

export const FIXTURE_PATCH_JSON = `{
  "schemaVersion": 1,
  "meta": { "id": "test.duo", "name": "Test Duo", "category": "melodic" },
  "layers": [
    {
      "keyRange": { "lowMidi": 0, "highMidi": 127 },
      "velRange": { "low": 0, "high": 1 },
      "generator": { "kind": "va", "va": { "shape": "saw", "unison": 3, "detuneCents": 18, "pulseWidth": 0.5 }, "seed": 7 },
      "tvf": { "mode": "lowpass", "cutoffHz": 900, "q": 0.9, "envAmountHz": 2200, "env": { "attack": 0.004, "decay": 0.18, "sustain": 0.25, "release": 0.2 }, "keyTrack": 0.5, "velAmountHz": 1200 },
      "tva": { "level": 0.8, "adsr": { "attack": 0.005, "decay": 0.3, "sustain": 0.7, "release": 0.25 }, "velCurve": 2 },
      "mod": { "lfo": { "shape": "sine", "rateHz": 5.5, "delay": 0.3, "fadeIn": 0.4 }, "toPitchCents": 8, "toCutoffHz": 0, "toAmpDepth": 0 }
    },
    {
      "keyRange": { "lowMidi": 48, "highMidi": 96 },
      "velRange": { "low": 0.5, "high": 1 },
      "generator": { "kind": "fm", "fm": { "operators": [ { "ratio": 1, "level": 1, "adsr": { "attack": 0.002, "decay": 0.6, "sustain": 0, "release": 0.3 } }, { "ratio": 14, "level": 0.4, "adsr": { "attack": 0.001, "decay": 0.08, "sustain": 0, "release": 0.05 } } ], "algorithm": { "routes": [ { "from": 1, "to": 0 } ], "carriers": [0] } } },
      "tva": { "level": 0.5, "adsr": { "attack": 0.002, "decay": 0.5, "sustain": 0.4, "release": 0.15 }, "velCurve": 1.5 }
    }
  ],
  "sends": { "reverb": 0.2, "delay": 0 }
}`;

describe('Patch', () => {
  it('fixture parses and validates clean', () => {
    const patch = JSON.parse(FIXTURE_PATCH_JSON) as Patch;
    expect(patch.schemaVersion).toBe(PATCH_SCHEMA_VERSION);
    expect(patch.layers).toHaveLength(2);
    expect(validatePatch(patch)).toEqual([]);
  });

  it('rejects wrong schema version, empty layers, and >4 layers', () => {
    const base = JSON.parse(FIXTURE_PATCH_JSON) as Patch;
    expect(validatePatch({ ...base, schemaVersion: 2 })).not.toEqual([]);
    expect(validatePatch({ ...base, layers: [] })).not.toEqual([]);
    expect(validatePatch({ ...base, layers: [base.layers[0], base.layers[0], base.layers[0], base.layers[0], base.layers[0]] })).not.toEqual([]);
  });

  it('surfaces nested FM errors with a layer prefix', () => {
    const base = JSON.parse(FIXTURE_PATCH_JSON) as Patch;
    const broken = structuredClone(base);
    (broken.layers[1].generator as { kind: 'fm'; fm: { algorithm: { carriers: number[] } } }).fm.algorithm.carriers = [9];
    const errors = validatePatch(broken);
    expect(errors.some((e) => e.startsWith('layer 2:'))).toBe(true);
  });

  it('rejects bad ranges and generator specifics', () => {
    const base = JSON.parse(FIXTURE_PATCH_JSON) as Patch;
    const badKeys = structuredClone(base);
    badKeys.layers[0].keyRange = { lowMidi: 80, highMidi: 40 };
    expect(validatePatch(badKeys)).not.toEqual([]);
    const badVa = structuredClone(base);
    (badVa.layers[0].generator as { kind: 'va'; va: { unison: number } }).va.unison = 0;
    expect(validatePatch(badVa)).not.toEqual([]);
  });
});
```

- [ ] **Step 2: run, verify FAIL** (`npx vitest run src/dsp/patch.spec.ts` — module not found).
- [ ] **Step 3: implement `patch.ts`** (types + `validatePatch` per the Interfaces block; layer errors prefixed `layer ${i + 1}: `). Add `export * from './dsp/patch.js';` to `index.ts`. Run → PASS.
- [ ] **Step 4: Swift twin.** Add Codable conformances listed under Files (raw-value string enums MUST use the exact TS strings). Write `Patch.swift` (structs + `GeneratorSpec` enum above + `validatePatch`). `PatchTests.swift` embeds the SAME fixture JSON string (copy verbatim) and mirrors all four tests using `JSONDecoder` (`XCTAssertEqual(try JSONDecoder().decode(Patch.self, from: fixture).layers.count, 2)`, `XCTAssertTrue(validatePatch(patch).isEmpty)`, mutation tests rebuild the struct with broken values rather than JSON surgery). Also assert round-trip: encode the decoded patch with `JSONEncoder`, decode again, `validatePatch` still empty.
- [ ] **Step 5: run Swift tests, verify FAIL first on missing types, then PASS after implementing.**
- [ ] **Step 6: both full suites green → Commit** `feat(audio): add patch data model and validation twins`

---

### Task 3: setPitchRatio on the generator contract

**Files:**
- Modify: `web/packages/alloy-audio/src/dsp/dsp-types.ts`, all four generator files + specs
- Modify: `swift/Sources/AlloyAudio/DSP/ToneGenerator.swift`, all four generator files + tests

**Interfaces:**
- Produces: `ToneGenerator.setPitchRatio(ratio: number): void` — multiplies the sounding frequency relative to the noteOn pitch (1 = unbent). Contract doc line: "Cheap; intended to be called at control rate. Ratio persists until the next call or noteOn (noteOn resets it to 1)."
- Semantics per generator (all: store `private pitchRatio = 1`, reset to 1 in `noteOn` BEFORE applying, so `noteOn(midi)` then `setPitchRatio(r)` is the canonical order):
  - `FmGenerator`: phase advance becomes `(frequency * pitchRatio * operators[i].ratio) / sampleRate`.
  - `AdditiveGenerator`: phase advance becomes `(frequency * pitchRatio * partials[p].ratio) / sampleRate`.
  - `VaGenerator`: store `baseFrequencies: number[]` computed in noteOn (per-osc detuned Hz); `setPitchRatio` re-applies `osc.setFrequency(baseFrequencies[i] * ratio)` per oscillator; noteOn computes baseFrequencies then calls the same apply path with ratio 1.
  - `SampleZoneGenerator`: `ZoneRead.rate` renamed `baseRate`; effective advance per sample is `baseRate * pitchRatio`.

- [ ] **Step 1: TS failing tests.** Add ONE test per generator spec file; all four use the same identity: `noteOn(60); setPitchRatio(2)` must produce the identical render to a fresh instance with `noteOn(72)` (same seed/fixtures), because every generator's phase math starts at zero and scales linearly with frequency. Example for FM (`fm-generator.spec.ts`); mirror the same shape in the other three specs (VA uses seed 7 both sides; additive uses the two-partial fixture; sample-zone uses the looped 48000-frame sine zone and compares 512 frames):

```ts
  it('setPitchRatio(2) equals playing an octave higher', () => {
    const bent = new FmGenerator(twoOp(0.5), FS);
    bent.noteOn(60, 1);
    bent.setPitchRatio(2);
    const reference = new FmGenerator(twoOp(0.5), FS);
    reference.noteOn(72, 1);
    const a = render(bent, 512);
    const b = render(reference, 512);
    for (let i = 0; i < 512; i++) expect(a[i]).toBeCloseTo(b[i], 9);
  });
```

- [ ] **Step 2: run all four specs, verify FAIL** (setPitchRatio not a function).
- [ ] **Step 3: implement TS** — interface member in `dsp-types.ts` (+ contract doc line), then the four generators per the semantics above. Run → PASS. All existing twin references must be untouched and green (pitchRatio 1 is the default everywhere).
- [ ] **Step 4: Swift twins** — protocol member in `ToneGenerator.swift`, four implementations, four mirrored tests (`accuracy: 1e-9`). FAIL first (protocol conformance breaks compile — that is the RED), then PASS.
- [ ] **Step 5: both full suites green → Commit** `feat(audio): add pitch-ratio modulation to all generators`

---

### Task 4: Voice

**Files:**
- Create: `web/packages/alloy-audio/src/dsp/voice.ts`, test `voice.spec.ts`; modify `index.ts`
- Create: `swift/Sources/AlloyAudio/DSP/Voice.swift`, test `swift/Tests/AlloyAudioTests/VoiceTests.swift`

**Interfaces:**
- Consumes: `Patch`/`PatchLayer` (Task 2), all generators + `setPitchRatio` (Task 3), `Svf`, `AdsrEnvelope` (+`fastRelease`), `Lfo`, `midiToFrequency`/`Pitch.frequency`.
- Produces:

```ts
/** Resolves a patch's sample zoneSetId to concrete zone data (packs in phase 3; fixtures in tests). */
export type ZoneSetProvider = (zoneSetId: string) => readonly VelocityLayerData[] | null;

export const CONTROL_INTERVAL = 16; // samples per modulation tick

export class Voice {
  constructor(patch: Patch, sampleRate: number, zoneSetProvider?: ZoneSetProvider);
  noteOn(midi: number, velocity: number): void; // selects layers whose key/vel ranges contain the note; builds units
  noteOff(): void;                              // key-up: every layer's TVA + TVF envelopes and generator get noteOff
  quickRelease(): void;                         // fastRelease(0.008) on all TVA envelopes + generator noteOff (steal/allNotesOff)
  /** ADDS into out. Returns false once every layer is silent (voice reapable). */
  render(out: Float32Array, frames: number): boolean;
  readonly active: boolean;
}
```

- Layer activation at noteOn: `keyRange.lowMidi <= midi <= keyRange.highMidi && velRange.low <= velocity <= velRange.high`. A patch note that matches zero layers renders silence and is immediately inactive.
- Per active layer, built at noteOn: generator (from `GeneratorSpec` — `fm` → `new FmGenerator(spec.fm, fs)`, `additive` → `new AdditiveGenerator(spec.partials, fs)`, `va` → `new VaGenerator(spec.va, fs, spec.seed)`, `sample` → `new SampleZoneGenerator(zoneSetProvider(spec.zoneSetId) ?? [], spec.crossfade, fs)`; an unresolvable zoneSetId or missing provider makes that layer inactive, NOT an error — progressive-loading semantics); `tva = new AdsrEnvelope(layer.tva.adsr, fs)` (per-sample); if `layer.tvf`: `svf = new Svf(tvf.mode, fs)` + optional `tvfEnv = new AdsrEnvelope(tvf.env, fs / CONTROL_INTERVAL)` (CONTROL RATE); if `layer.mod`: `lfo = new Lfo(mod.lfo, fs / CONTROL_INTERVAL)` (CONTROL RATE).
- Render, per layer, in chunks of ≤ CONTROL_INTERVAL samples (final chunk may be short; chunking is by absolute sample index within the voice so determinism survives arbitrary render() call sizes — keep a `samplePos` counter and tick when `samplePos % CONTROL_INTERVAL === 0`):
  1. Tick (once per chunk): `lfoVal = lfo?.nextSample() ?? 0`; `tvfEnvVal = tvfEnv?.nextSample() ?? 0`.
  2. If routing: `generator.setPitchRatio(2 ** ((mod.toPitchCents * lfoVal) / 1200))` (only when `toPitchCents !== 0`).
  3. If tvf: `cutoff = tvf.cutoffHz * 2 ** ((tvf.keyTrack * (midi - 60)) / 12) + tvf.envAmountHz * tvfEnvVal + tvf.velAmountHz * velocity + (mod?.toCutoffHz ?? 0) * lfoVal; svf.setParams(cutoff, tvf.q)` (Svf clamps internally).
  4. `ampMod = 1 - (mod?.toAmpDepth ?? 0) * (0.5 + 0.5 * lfoVal)`.
  5. Zero the layer scratch chunk, `generator.render(scratchChunk, chunkLen)`.
  6. Per sample: `const shaped = svf ? svf.process(scratch[i]) : scratch[i]; out[n] += shaped * tva.nextSample() * layerGain * ampMod;` where `layerGain = tva.level * velocityResidual` and `velocityResidual = velocity <= 0 ? 0 : velocity ** (tva.velCurve - 1)` — generators already applied `velocity^1`; the TVA contributes the perceptual residual so total velocity gain is `velocity^velCurve`. Document this equation verbatim in the code comment.
- Layer alive = `tva.isActive && !generator.finished`. Voice `active` = any layer alive. Scratch: one preallocated `Float32Array(CONTROL_INTERVAL)` per layer (Swift `[Float](repeating: 0, count: 16)`), zero-filled per chunk — no allocation in render.

- [ ] **Step 1: TS failing tests** (`voice.spec.ts`). Build small inline patches (helper `makePatch(layers)` filling schemaVersion/meta/sends). Tests:

```ts
// 1. Layer selection: two layers with disjoint key ranges; noteOn(40) sounds only layer A.
//    Construct layer A = additive [{ratio 1, level 1}] keyRange 0-59; layer B = additive [{ratio 2, level 1}] keyRange 60-127.
//    Render 64 frames; compare against a bare AdditiveGenerator+AdsrEnvelope hand-built equivalent of layer A (same adsr, velCurve 1, no tvf):
//    per-sample expected = gen.render into scratch, scratch[i] * env.nextSample() * level — assert toBeCloseTo(…, 6).
// 2. Velocity residual: velCurve 2, velocity 0.5 → render is exactly 0.5x the velCurve-1 render at the same velocity
//    (two Voices, identical otherwise; factor velocity^(2-1) = 0.5), assert ratio within 1e-9 on nonzero samples.
// 3. Vel-range gating: layer velRange {low: 0.6, high: 1}; noteOn(60, 0.3) → active === false immediately; render returns false; out all zeros.
// 4. TVF darkens: layer with tvf cutoff 300, q 0.707, no env/keytrack/vel amounts vs same layer without tvf;
//    saw VA generator; RMS(filtered second half) < 0.4 * RMS(unfiltered second half).
// 5. noteOff → release → inactive: sustain 0.5, release 0.03; render 0.1 s, noteOff, render 0.5 s → active false, next render returns false and adds nothing.
// 6. quickRelease reaps fast: same voice, quickRelease() then 0.05 s render → active false.
// 7. Unresolvable zoneSetId: sample-generator layer with no provider → voice immediately inactive, renders silence, no throw.
// 8. Chunk determinism: render(out64, 64) in one call vs four render(out16,16) calls on identical voices → byte-identical outputs (assert exact equality per sample). This pins the samplePos-based ticking.
// 9. TWIN_REFERENCE: the Task 2 FIXTURE_PATCH_JSON patch, noteOn(60, 0.8), first 8 samples (capture workflow), tolerance 1e-6.
```

Write these as real code in the spec file — each comment line above becomes a full `it(...)` with the described construction and assertions.

- [ ] **Step 2: run, verify FAIL.**
- [ ] **Step 3: implement `voice.ts`** per the Interfaces block. Export from `index.ts`. Run → PASS. Capture the twin reference.
- [ ] **Step 4: Swift twin.** `Voice.swift` is a direct port (the TS file is the spec; follow the established twin conventions — `Pitch.frequency(midi:)`, `[Float]` scratch, same chunking arithmetic). `VoiceTests.swift` mirrors tests 1–9 (same fixtures and tolerances; test 8 asserts exact equality; test 9 uses the pasted twinReference at `accuracy: 1e-6`, decoding the fixture patch JSON from Task 2's test — extract the fixture string into a shared test helper `TestFixtures.swift` if PatchTests and VoiceTests both need it, and on the TS side export it from `patch.spec.ts`… no: specs must not import from specs. Put `FIXTURE_PATCH_JSON` in a new `web/packages/alloy-audio/src/dsp/testing/fixtures.ts` (exported, excluded from the public index) and have both TS specs import it; Swift equivalent `swift/Tests/AlloyAudioTests/PatchFixtures.swift` with the same string as a `let` constant. Adjust Task 2's files accordingly when you get here — or if you are implementing Task 2, put the fixture there directly.)
- [ ] **Step 5: both full suites green → Commit** `feat(audio): add patch voice with TVF/TVA and LFO modulation twins`

---

### Task 5: PatchEngine (voice pool, transport, events)

**Files:**
- Create: `web/packages/alloy-audio/src/dsp/patch-engine.ts`, test `patch-engine.spec.ts`; modify `index.ts`
- Create: `swift/Sources/AlloyAudio/DSP/PatchEngine.swift`, test `swift/Tests/AlloyAudioTests/PatchEngineTests.swift`

**Interfaces:**
- Consumes: `Voice`, `Patch`, `validatePatch`, `ZoneSetProvider`.
- Produces:

```ts
export type EngineEvent =
  | { frame: number; kind: 'noteOn'; midi: number; velocity: number }
  | { frame: number; kind: 'noteOff'; midi: number }
  | { frame: number; kind: 'allNotesOff' };

export interface PatchEngineOptions {
  maxVoices?: number; // default 64
  zoneSetProvider?: ZoneSetProvider;
}

export class PatchEngine {
  constructor(sampleRate: number, options?: PatchEngineOptions);
  /** Throws (TS) on validatePatch errors; Swift twin returns Bool + errors out-param style: `@discardableResult func setPatch(_ patch: Patch) -> [String]` returning validation errors, [] = accepted. New notes use the new patch; sounding voices finish on the old one. */
  setPatch(patch: Patch): void;
  /** Sample-position transport clock: frames rendered since construction. */
  readonly frame: number;
  readonly activeVoiceCount: number;
  /** Schedule at an absolute frame. Events at frames already passed fire at the start of the next process() block. Same-frame events fire in schedule order. */
  schedule(event: EngineEvent): void;
  /** Render the next `frames` samples ADDING into out; advances the transport. Consumes due events at exact sample offsets (render up to the event's offset, apply, continue). */
  process(out: Float32Array, frames: number): void;
}

/** Offline render harness — the golden-test and future bounce path. Fresh engine, schedule all, process in 128-frame blocks, return the full buffer. */
export function renderPatch(
  patch: Patch,
  events: readonly EngineEvent[],
  totalFrames: number,
  sampleRate: number,
  zoneSetProvider?: ZoneSetProvider,
): Float32Array;
```

- Voice management: `voices: Array<{ midi: number; voice: Voice; startFrame: number; released: boolean }>`. noteOn: if a non-released voice with the same midi exists, `quickRelease()` it (restrike; it stays in the list until silent, `released = true`). If `voices.length >= maxVoices`: steal — remove the entry with the earliest `startFrame` among released voices, or earliest overall if none released (hard drop, documented as acceptable for 1b; a dying-voice fade list is a later refinement). Then push the new voice, `voice.noteOn(midi, velocity)`. noteOff: mark that midi's newest non-released entry released + `voice.noteOff()`. allNotesOff: `quickRelease()` every voice, mark all released. After each process block, reap entries whose `render` returned false (track per-voice return).
- Event queue: array kept sorted by frame (stable insert — equal frames keep insertion order). `process` renders segment-wise: while the next event's frame < currentFrame + remaining, render up to it (if any samples), apply ALL events at that frame, continue; then render the tail. Events with `frame < engine.frame` are treated as due immediately.
- `process` renders voices into `out` additively via a per-engine scratch: zero scratch segment, sum every voice's render into it… no — voices already ADD; render voices directly into the target segment (subarray TS / `withUnsafeMutableBufferPointer` slices Swift are overkill: pass an offset. Give `Voice.render` an explicit variant? Keep it simple and allocation-free: `PatchEngine` keeps one preallocated `Float32Array(4096)` block scratch; for each segment it zero-fills `scratch[0..len)`, has each voice add into it, then adds `scratch[i]` into `out[offset + i]`. Segment length is capped at 4096 (assert frames per process call ≤ 4096 — hosts use 128).

- [ ] **Step 1: TS failing tests** (`patch-engine.spec.ts`) — use the additive one-layer patch for exact-math cases (deterministic, no PRNG):

```ts
// 1. Transport: fresh engine frame === 0; process(256) twice → frame === 512.
// 2. Sample-accurate scheduling: noteOn at frame 100 → out[0..99] all exactly 0, out[100] onward nonzero within 8 samples (attack 0.001).
// 3. Same-frame order: noteOn(60)@0 and noteOff(60)@0 scheduled in that order → note keys up immediately: render 0.5 s → activeVoiceCount 0 by the end but out[0] is release-shaped (nonzero briefly), i.e. both events applied.
// 4. Restrike: noteOn(60)@0, noteOn(60)@4800 → at frame 4805 activeVoiceCount === 2 (old voice releasing + new voice), by 4800 + release*15 → 1.
// 5. Polyphony + steal: maxVoices 4; five noteOns at frames 0,10,20,30,40 (midis 60..64) → activeVoiceCount never exceeds 4; the stolen voice is midi 60 (earliest start): schedule noteOff for 61..64 late; assert render proceeds without error and count drops.
// 6. allNotesOff: three notes, allNotesOff@2400, render 0.15 s (quickRelease tau 8 ms → 18 tau) → activeVoiceCount === 0.
// 7. setPatch rejects invalid: expect(() => engine.setPatch(brokenPatch)).toThrow(); engine still renders with the old patch.
// 8. renderPatch determinism: two renderPatch calls with identical args → byte-identical Float32Arrays (assert every sample with toBe).
// 9. renderPatch equals manual engine loop with different block sizes: renderPatch (128 blocks) vs manual 48-frame process loop → identical within 0 (exact; chunk determinism came from Task 4 test 8).
```

Each comment becomes a real `it(...)`.

- [ ] **Step 2: run, verify FAIL.**
- [ ] **Step 3: implement `patch-engine.ts`**; export from `index.ts`. Run → PASS.
- [ ] **Step 4: Swift twin** — direct port (`PatchEngine.swift`); `setPatch` returns `[String]` (empty = accepted) instead of throwing, per the twin-validation convention; `renderPatch` free function returns `[Float]`. `PatchEngineTests.swift` mirrors tests 1–9 (test 8/9 assert exact equality with `XCTAssertEqual(a, b)` on the arrays).
- [ ] **Step 5: both full suites green → Commit** `feat(audio): add polyphonic patch engine with sample transport twins`

---

### Task 6: Golden patch-render twin tests

**Files:**
- Create: `web/packages/alloy-audio/src/dsp/testing/golden-patches.ts` (fixture patches + event script + zone fixture, exported for both this spec and future workbench use; NOT exported from the public index)
- Create: `web/packages/alloy-audio/src/dsp/golden-render.spec.ts`
- Create: `swift/Tests/AlloyAudioTests/GoldenPatchFixtures.swift`, `swift/Tests/AlloyAudioTests/GoldenRenderTests.swift`

**Interfaces:**
- Consumes: `renderPatch` (Task 5), Task 2 patch types.
- Produces: the flagship cross-platform guarantee — four patches, one per generator kind, each rendered 24 000 frames at 48 kHz through the full engine with the same event script, asserted identical across platforms at three probe windows.

Fixtures (`golden-patches.ts`, mirrored verbatim into `GoldenPatchFixtures.swift`):

```ts
export const GOLDEN_EVENTS: EngineEvent[] = [
  { frame: 0, kind: 'noteOn', midi: 60, velocity: 0.8 },
  { frame: 6000, kind: 'noteOn', midi: 67, velocity: 0.6 },
  { frame: 12000, kind: 'noteOff', midi: 60 },
  { frame: 18000, kind: 'noteOff', midi: 67 },
];
export const GOLDEN_FRAMES = 36_000; // last release (0.3 s after noteOff@18000) ends ≈ frame 32 400
export const GOLDEN_FS = 48_000;

// PATCH_FM: single fm layer (the Task 2 fixture's FM layer promoted to full range, velRange 0-1, tva velCurve 1.5), no tvf, no mod.
// PATCH_VA: single va layer (saw, unison 3, detune 18, seed 7) + tvf (lowpass 900, q 0.9, envAmountHz 2200, env, keyTrack 0.5, velAmountHz 1200) + mod (sine 5.5 Hz, delay 0.3, fadeIn 0.4, toPitchCents 8).
// PATCH_ORGAN: single additive layer, partials ratios [0.5, 1, 1.5, 2, 3, 4] levels [0.7, 1, 0.35, 0.25, 0.12, 0.08], tva adsr {0.003, 0.05, 1, 0.04} velCurve 1, mod tremolo: lfo sine 6.8 Hz delay 0 fadeIn 0.1, toAmpDepth 0.35.
// PATCH_SAMPLE: single sample layer, zoneSetId 'golden.sine', crossfade 0.2, tva adsr {0.001, 0.2, 0.8, 0.1} velCurve 2.
// GOLDEN_ZONES ('golden.sine'): one velocity layer (topVelocity 1) with one zone: rootMidi 69, sampleRate 48000,
//   data = 48000-sample sine of 440 cycles baked by a for-loop (deterministic, no assets), loopStart 0, loopEnd 48000.
```

Write each PATCH_* as a complete `Patch` literal in the fixture file (they are data, ~20 lines each — no shorthand). The Swift fixture file constructs the identical values with the memberwise inits.

- [ ] **Step 1: TS spec.** For each of the four patches: `const out = renderPatch(PATCH_X, GOLDEN_EVENTS, GOLDEN_FRAMES, GOLDEN_FS, X === sample ? goldenProvider : undefined)`. Assertions:
  - determinism: second render identical (`toBe` per probe sample);
  - non-silence: RMS of frames 6000–12000 > 0.01;
  - tail silence: RMS of the last 1000 frames < 0.01 (the longest release, 0.3 s after noteOff@18 000, ends ≈ frame 32 400, safely inside GOLDEN_FRAMES 36 000);
  - TWIN probes: three 8-sample windows starting at frames 0, 12 000, 30 000 — twelve `TWIN_REFERENCE_X` arrays total (4 patches × 3 windows), captured via the established workflow, tolerance `toBeCloseTo(v, 4)` / Swift `accuracy: 1e-4` (drift accumulates over 0.75 s of transcendental phase math). Non-silence RMS window stays 6 000–12 000.
- [ ] **Step 2: run, verify FAIL** (fixture module missing), **Step 3: write fixtures, run → PASS, capture all twelve reference windows.**
- [ ] **Step 4: Swift twin fixtures + `GoldenRenderTests.swift`** mirroring all assertions (probe equality at `accuracy: 1e-4`; determinism via exact array equality). RED = compile failure on missing fixtures; GREEN after.
- [ ] **Step 5: both full suites green → Commit** `test(audio): add golden patch-render twin fixtures`
- [ ] **Step 6: Update the spec** — in `docs/superpowers/specs/2026-07-10-alloy-rompler-engine-design.md` phase 1 status line, change to "(1a + 1b-i landed — engine renders patches correctly, twin-verified; 1b-ii hosts next.)" Commit `docs: mark rompler phase 1b-i landed`.

---

## Self-Review Notes

- **Spec coverage (1b-i slice):** patch-as-data (Task 2), fixed-but-parameterized mod routes vel→cutoff/env→cutoff/LFO→pitch·cutoff·amp/key-track (Task 4), exponential velocity curve (Task 4 residual equation), voice/layer mixer + 64-voice cap + stealing (Task 5), sample-position transport clock + sample-accurate scheduling (Task 5), deterministic offline render (Task 5 `renderPatch`), golden-render flagship test (Task 6), 1a review carry-overs (Task 1). Deferred to 1b-ii: AudioWorklet/AVAudioSourceNode hosts, `createWorkletHost` seam, real-time command paths. Deferred to phase 2+: sends/effects (schema field carried), stereo, pan, `InstrumentDescriptor` `patch` kind (lands with the first playable patch in phase 3).
- **velocity double-count resolved:** generators keep 1a's linear velocity; TVA applies `velocity^(velCurve-1)`; total = `velocity^velCurve`. 1a twin references untouched.
- **Control-rate design:** TVF env and LFO are constructed at `fs/16` — their `AdsrParams`/`LfoParams` seconds keep wall-clock meaning; ticking is driven by absolute voice samplePos so render-call chunking cannot change output (pinned by Voice test 8 and Engine test 9).
- **Type consistency:** `ZoneSetProvider` defined once in `voice.ts`, imported by `patch-engine.ts`; `CONTROL_INTERVAL` exported from `voice.ts`; fixture JSON lives in `dsp/testing/fixtures.ts` (TS) / `PatchFixtures.swift` (Swift tests) shared by Patch/Voice specs.
