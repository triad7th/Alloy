# Rompler Effects 2b — Phaser, Rotary, Drive+EQ, Compressor — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The remaining four insert effects from the spec's Effects section, on the 2a insert infrastructure. Sends/limiter/benchmark stay in 2c.

**Architecture:** Each effect follows the proven recipe: one `InsertSpec` union arm (TS) / enum case + Codable arms (Swift), one validator, one `createInsert` factory case, one `EffectUnit` class pair with twin-reference tests at 1e-6. Control-heavy math (tan/log/pow) runs at a 16-sample control interval (`EFFECT_CONTROL_INTERVAL`, exported from effect-types) — same two-rate philosophy as the voice. All processing per-sample state machines: segment splitting stays transparent by construction.

## Global Constraints

- Everything from 2a holds: determinism, no alloc/throw in process, twin protocol one commit per task, capture workflow, no formatters, `.js` suffixes, both suites green per commit, `schemaVersion` stays 1.
- `validateInsert`'s unknown-kind default arm keeps working: each new kind adds its switch arm ABOVE the default (TS) / new enum case with Codable arms (Swift decode still rejects kinds it doesn't know — which after this phase means only genuinely unknown ones).
- Established naming: payload field = kind name (`{ kind: 'phaser'; phaser: PhaserParams }`).
- Swift param structs get Codable; enums with raw values use the exact TS strings.
- Existing golden twin arrays must stay byte-untouched (no golden patch gains a 2b insert in this phase; chain-level integration is Task 5's dedicated test).

## Per-effect task recipe (Tasks 1–4 all follow this; per-task sections give the specifics)

1. TS failing tests (bypass exactness where neutral params exist; behavior probes; reset determinism; validateInsert bounds; TWIN_REFERENCE 8 L + 8 R at 1e-6 after the stated warmup).
2. Implement TS: effect class file under `src/dsp/effects/`, union arm + validator + factory case in `effect-types.ts`, export from `index.ts`. PASS + capture.
3. Swift twins: `DSP/Effects/<Name>.swift`, enum case + Codable arms + validator + factory in `EffectTypes.swift`, mirrored tests, pasted refs. RED = compile break.
4. Both full suites green → one commit (message given per task).
5. Also add, on BOTH platforms, one Codable/JSON pin: the same JSON string for the new insert kind decodes (Swift) / validates (TS) — extend the shared inserts fixture pattern from 2a Task 3.

---

### Task 1: Phaser

**Files:** `web/.../src/dsp/effects/phaser.ts` (+spec); `swift/.../DSP/Effects/Phaser.swift` (+tests); both `effect-types` files; `index.ts`.

**Params/validation:** `interface PhaserParams { stages: 4 | 8; rateHz: number; depth: number; feedback: number; mix: number }` — stages must be 4 or 8; `rateHz` (0, 10]; `depth` [0, 1]; `feedback` [0, 0.9]; `mix` [0, 1]. Union arm `{ kind: 'phaser'; phaser: PhaserParams }`.

**Algorithm (exact):** constants `PHASER_F_MIN = 200`, `PHASER_F_MAX = 2200`; channel LFO offsets L 0, R 0.25 (quadrature, like chorus). Per channel: a chain of `stages` first-order allpass filters sharing one swept coefficient, plus feedback from the chain's last output.

```ts
// per control tick (every EFFECT_CONTROL_INTERVAL samples, both channels, using the SAME phase value):
//   sweep_ch = 0.5 + 0.5 * depth * sin(TWO_PI * (phase + offset_ch))
//   f_ch = PHASER_F_MIN * (PHASER_F_MAX / PHASER_F_MIN) ** sweep_ch
//   t = Math.tan(Math.PI * f_ch / sampleRate); coef_ch = (t - 1) / (t + 1)
// per sample, per channel:
//   x = input + lastOut_ch * feedback
//   for each stage s: y = -coef_ch * x + z_ch[s]; z_ch[s] = x + coef_ch * y; x = y
//   (first-order allpass, one-multiply form: H(z) = (-c + z^-1)/(1 - c z^-1), |H| = 1)
//   lastOut_ch = x
//   out = input * (1 - mix) + x * mix
// phase += rateHz / sampleRate per SAMPLE (wrapped); ticks fire when sampleCounter % 16 === 0.
```

State: `z` arrays (stages × 2), `lastOut` × 2, `phase`, `sampleCounter`; `reset()` zeroes all. Add `EFFECT_CONTROL_INTERVAL = 16` to `effect-types.ts` (Swift `EffectConstants.controlInterval`) in this task.

**Tests:** mix 0 exact bypass; notch motion probe — feed white-ish deterministic input (seeded DspPrng samples), render 2 × 4800-frame windows 1s apart at rate 0.5: per-window RMS of (out − dry-scaled) differs between windows by > 5% (the sweep moved); stages 8 differs from stages 4 (same input, max abs diff > 0.01); feedback 0.8 output stays bounded (peak < 4 over 48000 frames); reset determinism (exact); validation bounds incl. stages 5 rejected; twin ref: stages 4, rate 0.9, depth 0.8, feedback 0.5, mix 0.5, input L=R= 440 Hz sine amp 0.5, warmup 512, then 8 L + 8 R.

**Commit:** `feat(audio): add phaser insert twins`

---

### Task 2: RotarySpeaker

**Files:** `rotary-speaker.ts` / `RotarySpeaker.swift` (+tests); effect-types pair; index.

**Params/validation:** `interface RotaryParams { speed: 'slow' | 'fast'; depth: number; mix: number }` — depth [0, 1]; mix [0, 1]. Union arm `{ kind: 'rotary'; rotary: RotaryParams }`. Speed is baked per patch (no live-switch path exists yet; the slow→fast ramp arrives with runtime insert control, recorded in the plan's deferrals). Swift `RotarySpeed: String, Codable` with raw values `"slow"`/`"fast"`.

**Algorithm (exact):** rotor rates: fast horn 6.6 Hz / drum 5.7 Hz; slow horn 0.8 / drum 0.7. Mono source, one-pole crossover at 800 Hz, opposed-pan AM per band ("polished over realistic" — AM + pan, no doppler):

```ts
// crossoverCoef = 1 - Math.exp((-TWO_PI * 800) / sampleRate)   // one-pole LP state `lowState`
// per sample:
//   m = (L + R) / 2
//   lowState += crossoverCoef * (m - lowState); low = lowState; high = m - low
//   hornL = 0.5 * (1 + depth * sin(TWO_PI * hornPhase));      hornR = 0.5 * (1 + depth * sin(TWO_PI * hornPhase + PI))
//   drumL = 0.5 * (1 + depth * sin(TWO_PI * drumPhase));      drumR = 0.5 * (1 + depth * sin(TWO_PI * drumPhase + PI))
//   wetL = high * hornL + low * drumL; wetR = high * hornR + low * drumR
//   outL = L * (1 - mix) + wetL * mix   (same for R)
//   hornPhase += hornRate / fs; drumPhase += drumRate / fs (both wrapped)
```

**Tests:** mix 0 exact bypass; depth 0 mix 1 collapses to the crossover-flat mono sum on both channels (L === R, equal to lowpass+highpass reconstruction = m exactly — one-pole LP + complement reconstructs m bit-exactly: assert out === mono sum within 1e-9); anti-phase pan: fast speed, DC-free high-band input (2 kHz sine), L and R envelopes anticorrelate (probe: RMS over each half-cycle of the 6.6 Hz rotor alternates L>R then R>L); slow vs fast differ; reset determinism; validation bounds; twin ref: fast, depth 0.7, mix 1, input L=R= 440 sine amp 0.5, warmup 512, 8 L + 8 R.

**Commit:** `feat(audio): add rotary speaker insert twins`

---

### Task 3: DriveEq

**Files:** `drive-eq.ts` / `DriveEq.swift` (+tests); effect-types pair; index.

**Params/validation:** `interface DriveEqParams { drive: number; lowDb: number; midDb: number; highDb: number; levelDb: number }` — drive [0, 1]; each Db field [-12, 12]. Union arm `{ kind: 'driveEq'; driveEq: DriveEqParams }` (Swift CodingKey `driveEq`).

**Algorithm (exact):** per channel, in order drive → low shelf → mid peak → high shelf → level:

```ts
// preGain = 1 + drive * 4; gLow/gMid/gHigh/gLevel = 10 ** (db / 20)
// low shelf: one-pole LP at 250 Hz (coef 1 - exp(-TWO_PI*250/fs), state per channel): y = x + (gLow - 1) * lp(x)
// mid peak:  Svf bandpass at 1000 Hz, q 0.707 (one Svf per channel, import from '../svf.js'): y = x + (gMid - 1) * bp(x)
// high shelf: one-pole LP at 3000 Hz: hp = x - lp3k(x); y = x + (gHigh - 1) * hp
// per sample: s = Math.tanh(input * preGain); then the three EQ stages; then * gLevel
```

Gains precomputed in the constructor (params are static). Svf's existing `setParams` is called once at construction.

**Tests:** neutral exact-ish bypass — drive 0 all Db 0: output equals input within 1e-9 (preGain 1, tanh(x)≈x is NOT exact — tanh(x) ≠ x! So: neutral EQ with drive 0 means s = tanh(x); NOT a bypass. Instead assert the EQ path is neutral: drive 0, all Db 0 → output === tanh(input) computed by hand in the test, within 1e-12); drive saturates: drive 1 on a 0.9-amplitude sine — peak(out) < peak(in) * 1.05 AND waveform differs (harmonics); lowDb +12 boosts a 100 Hz sine RMS by ~3.5–4.2x vs neutral while a 5 kHz sine changes < 1.3x (shelf selectivity, generous bounds); highDb −12 attenuates 8 kHz ≥ 2.5x while 100 Hz changes < 1.3x; reset determinism; validation bounds; twin ref: drive 0.4, low +3, mid −2, high +4, level −1, 440 sine amp 0.5, warmup 512, 8 L + 8 R.

**Commit:** `feat(audio): add drive + 3-band EQ insert twins`

---

### Task 4: Compressor

**Files:** `compressor.ts` / `Compressor.swift` (+tests); effect-types pair; index.

**Params/validation:** `interface CompressorParams { thresholdDb: number; ratio: number; attackMs: number; releaseMs: number; makeupDb: number }` — thresholdDb [-60, 0]; ratio [1, 20]; attackMs (0, 100]; releaseMs (0, 1000]; makeupDb [0, 24]. Union arm `{ kind: 'compressor'; compressor: CompressorParams }`.

**Algorithm (exact):** stereo-linked feed-forward, per-sample detector, control-rate gain computer:

```ts
// attackCoef = 1 - exp(-1 / (attackMs / 1000 * fs)); releaseCoef likewise
// per sample: d = max(|L|, |R|); env += (d > env ? attackCoef : releaseCoef) * (d - env)
// per control tick (every EFFECT_CONTROL_INTERVAL samples):
//   envDb = 20 * log10(max(env, 1e-6))
//   over = max(0, envDb - thresholdDb); reductionDb = over * (1 - 1 / ratio)
//   gain = 10 ** ((makeupDb - reductionDb) / 20)
// per sample: L *= gain; R *= gain  (gain constant within the tick)
```

State: `env`, `gain` (init `10 ** (makeupDb / 20)`), `sampleCounter`; reset restores all.

**Tests:** below-threshold near-bypass — quiet sine (-40 dB) with threshold -20, makeup 0: output === input * 1.0 within 1e-6 after warmup; loud compressed — 0dB sine, threshold -20 ratio 4: steady-state RMS reduced by ≈15 dB ±2 (over 20 dB × (1−1/4)); attack behavior — step from silence to full: |out| in the first ms exceeds steady-state gain level (gain hasn't clamped yet with attackMs 50); release recovery — after the loud burst ends, a following quiet passage returns toward unity within ~5× releaseMs; makeup applies below threshold (quiet sine, makeup +6 → ×2 within 1e-3); stereo link — loud L only still compresses R (feed L loud, R quiet: R's gain reduction matches L's); reset determinism; validation bounds; twin ref: threshold -18, ratio 4, attack 5, release 80, makeup 3, input L= 440 sine amp 0.9 / R= amp 0.45, warmup 4800 (let the detector settle), 8 L + 8 R.

**Commit:** `feat(audio): add stereo-linked compressor insert twins`

---

### Task 5: Chain integration + docs close

**Files:** `web/.../src/dsp/patch-engine.spec.ts` (one new test) + Swift `PatchEngineTests.swift` twin; `docs/mirroring.md`; spec status line.

- Integration test both platforms: a patch whose insert chain is `[phaser, driveEq, compressor]` (three kinds from this phase) renders through `renderPatch`: deterministic (two renders exact-equal), non-silent, L !== R after warmup, and — the chain-order pin — differs from the same patch with the chain reversed (max abs diff > 1e-3).
- mirroring.md: extend the effects section with the four new kinds' constants (PHASER_F_MIN/MAX, rotor rates, crossover/shelf frequencies, compressor detector semantics, EFFECT_CONTROL_INTERVAL) and the full six-kind InsertSpec union.
- Spec status under Phasing item 2: "(2a + 2b landed — all six inserts; 2c: sends + limiter + benchmark.)"
- Full verification (web workspace, alloy-audio build, swift build+test).
- **Commit:** `feat(audio): six-insert chain integration; close phase 2b docs`

---

## Self-Review Notes

- **Spec coverage (2b):** phaser 4/8-stage ✓ (Task 1), rotary simplified crossed AM "polished over realistic" ✓ (Task 2 — doppler explicitly out, slow/fast baked until runtime insert control exists, recorded), drive + 3-band EQ ✓ (Task 3 — shelves at 250/3k + mid peak 1k), compressor ✓ (Task 4 — simple feed-forward per spec). Deferred: sends/reverb/delay/limiter/benchmark (2c); live speed switching + insert-param modulation (needs a control path that doesn't exist yet).
- **Two-rate honesty:** phaser coefficients and compressor gain at EFFECT_CONTROL_INTERVAL (16) — same tick philosophy as the voice; rotary and drive-EQ are cheap enough to stay fully per-sample.
- **Codable growth:** four new kinds double EffectTypes.swift's switches — reviewed as acceptable at six kinds (2a final review).
- **No golden re-baseline:** golden patches unchanged; Task 5's chain test provides multi-effect integration coverage without re-capturing 18 arrays.
