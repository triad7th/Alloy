# Rompler Phase 3c — FM Anti-Aliasing (Design)

Prerequisite to phase 4 (founding spec:
`docs/superpowers/specs/2026-07-10-alloy-rompler-engine-design.md`, §Phasing
item 4). Phase 4's headline is **FM8-class electric pianos**; the FM generator
currently aliases badly on high notes, so it gates that work.

## The problem, measured

`FmGenerator` (`web/packages/alloy-audio/src/dsp/fm-generator.ts:107-136`)
renders phase modulation at the output rate with no band-limiting. Modulation
sidebands extend far past Nyquist and fold back as **inharmonic low-frequency
junk**.

Energy below the fundamental is the tell: an FM spectrum built on `f0` has no
legitimate content beneath `f0`, so whatever is there is aliased foldback.
Measured on the workbench EP stack with its original ratio-14 modulator
(dB below the fundamental — lower is better):

| note | C4 | C6 | **G#6** | C7 | **C8** |
| --- | --- | --- | --- | --- | --- |
| **1× (today)** | −53 | −45 | **−25** | −37 | **−21** |
| 2× | −51 | −53 | −57 | −45 | −38 |
| **4×** | −51 | −54 | **−63** | −63 | **−46** |
| 8× | −52 | −54 | −63 | −63 | −68 |

The measurement's own noise floor is ≈ **−52 dB** (C4 does not improve with
oversampling, because it has nothing to improve), so any figure near −52 means
"clean".

This is not theoretical: it was found by ear during the phase-3b listening pass
— "EP G#6 has weird bassy noise" — and G#6 is exactly where the ratio-14
operator crosses Nyquist (1661 Hz × 14 = 23.3 kHz, against a 24 kHz Nyquist).
It was worked around by dropping the workbench EP's operator to ratio 7, which
costs precisely the brightness an FM8-class EP needs. **C8 is worse still
(−21 dB) and simply had not been played.**

## Decisions (locked)

- **Target: clean through C7; C8 at −46 dB is accepted.** Reaching the top
  octave needs 8× (≈9× the FM CPU). Real EPs and organs do not live there. 4×
  puts everything through C7 at the measurement floor.
- **Adaptive per-voice oversampling, not uniform.** Uniform 4× charges every
  voice for a problem only high notes have — C4 measures −53 dB at 1× and
  −51 dB at 4×, i.e. oversampling there is *provably a no-op*. Today's whole
  64-voice full-FX render is 12% of one core against a **<25%** envelope, and
  FM is the dominant term; ×4.7 across the board would plausibly breach it.
- **No modulation-index key scaling.** Attenuating modulators as pitch rises
  (what a DX7 does) costs nothing but *dulls* the top rather than reproducing
  it — a principled version of the ratio-7 hack, and it does not deliver the
  brightness this phase exists to recover.

## Architecture

All of it lives inside `FmGenerator`. **No other generator, the patch schema, and
the `ToneGenerator` interface are untouched** — oversampling is an implementation
detail of one generator, not an engine-wide concern. `Voice` contributes exactly
one thing: it hands the layer's pitch-modulation depth to the `FmGenerator`
constructor, because K is chosen at `noteOn` and must account for how far the
LFO can bend the note (see below).

### 1. Oversampling factor, chosen at `noteOn`

```
maxPitchRatio = 2 ^ (|layer.mod.toPitchCents| / 1200)      // 1 when there is no vibrato
maxOpFreq     = midiToFrequency(midi) × max(op.ratio) × maxPitchRatio
K             = maxOpFreq > sampleRate / 4  ?  4  :  1
```

A pure function of the note and the patch: deterministic, twin-identical, and
decided once per note rather than per sample.

**The modulation depth is part of the patch, so it is part of K.** `setPitchRatio`
does not re-pick K mid-note (switching K under a sounding voice would glitch), so
the worst upward bend the note can reach must be priced in at `noteOn`. The
engine has no pitch bend; the mechanism is LFO vibrato: `Voice.tickModulation`
sets `pitchRatio = 2^(toPitchCents × lfoVal / 1200)` with `lfoVal ∈ [-1, 1]`, and
a layer has at most one `mod` route — hence the absolute value (a negative depth
still bends up on the LFO's negative half-cycle). Without this, a 1200-cent
vibrato on midi 80 with a ratio-14 modulator renders at K=1 while the LFO drives
that modulator to 23.3 kHz: **-25 dB of foldback, the original bug, swept back in
once per LFO cycle**. Patches without vibrato get `maxPitchRatio == 1`, so their K
— and their CPU cost — is unchanged. (This is the one place the fix reaches
outside `FmGenerator`: `Voice` passes `layer.mod?.toPitchCents ?? 0` to the
generator's constructor. The patch schema and `ToneGenerator` are untouched.)

The threshold is placed from measurement, not taste. Sweeping `maxOpFreq`, 1×
and 4× are indistinguishable up to **13.1 kHz** (SR/3.7) and diverge by
+9…+38 dB from **14.7 kHz** (SR/3.3) upward. `sampleRate / 4` (12 kHz) sits below
where divergence begins: **≈1.5 semitones of proven-clean headroom** (12 → 13.1
kHz) and **≈3.5 semitones to the first measured divergence** (12 → 14.7 kHz). With
modulation depth now handled explicitly, that margin is slack — cover for
unmodelled excursions — not an allowance anything is relying on.

Because oversampling is a no-op below the threshold, **the K=1/K=4 switch
between adjacent notes is inaudible**. That is a measured property, not an
assumption.

### 2. Envelopes step once per OUTPUT sample

Operator ADSRs advance once per output sample and are **held constant across
the K sub-samples**. They are slow control signals; holding one for ≤83 µs is
inaudible.

This is the load-bearing structural choice: it makes the **K=1 path
bit-identical to today's code**. Consequences:

- Existing goldens do not move. The golden FM patch does use a ratio-14
  modulator, but plays midi 60 and 67 — `maxOpFreq` 3.7 kHz and 5.5 kHz, far
  below the threshold — so it renders at K=1 and its pinned values are
  unchanged. **No golden regeneration.**
- Only notes that were already aliasing change, which is exactly the set we
  intend to change.

### 3. Decimation filter

A fixed **32-tap Blackman-windowed sinc** lowpass, cutoff `0.45 / K` of the
oversampled rate, applied before dropping to every K-th sample. 64 taps measured
no better than 32.

Coefficients are a **compile-time constant table**, identical in both twins —
no runtime filter design, nothing to drift between platforms. At K=1 the filter
is bypassed entirely (that is what preserves bit-exactness).

**Accepted cost — group delay:** ~4 output samples (83 µs) at K=4. In a layered
patch an oversampled voice sits a hair behind a non-oversampled one. Between
independent voices that is inaudible. The one case where it may not be: a LAYERED
patch whose layers are CORRELATED (the same note, two FM layers, one over the K
threshold and one under) — there the 83 µs offset combs the sum, with the first
notch near 6 kHz. Real, accepted, recorded here rather than discovered later.

**Accepted cost — transition band.** What matters about a decimation filter is
not its response *at* a frequency but where that frequency **folds to**. The
pinned 32-tap table, measured:

| freq at 192 kHz | folds down to | attenuation |
| --- | --- | --- |
| 10 kHz | 10 kHz | −0.1 dB (passband; survives) |
| 15 kHz | 15 kHz | −1.2 dB |
| 20 kHz | 20 kHz | −4.3 dB |
| **30 kHz** | **18 kHz** | **−23 dB** |
| 36 kHz | 12 kHz | −52 dB |
| 40 kHz | 8 kHz | −77 dB |
| 60 kHz | 12 kHz | −84 dB |

The one soft spot — 30 kHz at only −23 dB — folds to 18 kHz, the very top of
hearing, and is the price of 32 taps. Everything that would fold into the
audible midrange (36–60 kHz → 8–12 kHz) is crushed by 52–84 dB, which is why
the end-to-end alias floor still measures −63 dB at G#6.

**Do not "fix" the 30 kHz number by narrowing the cutoff.** That lowpasses the
*output*, gutting the brightness this phase exists to recover. The tests pin
both ends of this trade: the fold-down attenuations *and* the passband.

The passband droop above 15 kHz (−1.2 dB at 15 kHz, −4.3 dB at 20 kHz) applies
only to oversampled voices, i.e. high notes, and is accepted.

### 4. The payoff

The workbench EP patch returns to **ratio 14** — the brightness surrendered to
the phase-3b workaround.

## Twin contract

TypeScript is canonical; Swift ports in the same change set (`docs/mirroring.md`).
The K-selection rule, the threshold constant, the tap count, and the coefficient
table are all part of the twin contract and must be recorded in `docs/mirroring.md`
— they are exactly the kind of thing a future contributor would "simplify".
Swift computes in `Double`, buffers stay `[Float]`, per the existing convention.

## Testing

- **Alias-floor test (new, both platforms).** Render the EP stack at ratio 14
  across the keyboard and assert the energy below the fundamental — which can
  only be foldback — is under a pinned ceiling at G#6 and C7. This is the test
  that would have caught the original bug, and it did not exist.
- **Goldens unchanged.** Their pinned values must be byte-identical, proving the
  K=1 path is bit-exact with today. If a golden moves, the change is wrong.
- **K-selection test.** The chosen factor for a given (midi, ratios, sampleRate)
  is asserted directly, and asserted identical across twins.
- **Switch transparency.** A note just below the threshold and one just above
  must not differ audibly in level or spectrum — the property that licenses the
  adaptive design.
- **Benchmark gate.** The existing 64-voice full-FX benchmark plays midi 36–99,
  so it *will* exercise the oversampled path. It must stay under the
  **<25% of one core** envelope. This is a hard gate, not an observation — and it
  only means anything where it executes: the 0.25 bound lives in the RELEASE
  config, which CI (plain `swift test`, debug) never builds, so `tools/release.mjs`
  runs `swift test -c release --filter BenchmarkTests` in its preflight and no tag
  is cut without it. CI enforces the debug bound (13.5 vs ~10.4 measured) as the
  per-PR regression net. The benchmark takes the **minimum of 3 runs**: noise only
  makes a run slower, so the min is the robust estimate and the bound needs no
  slack for flake.
- **Determinism.** Repeat renders bit-identical; twins agree.

## Out of scope

- 8× oversampling / a fully clean C8 (accepted at −46 dB).
- Anti-aliasing for any other generator. The VA generator's saw/square are the
  other classic aliasing source, but they are not what gates phase 4 and there
  is no measured complaint. Separate phase if it ever matters.
- Modulation-index key scaling as a *musical* feature (as opposed to an
  anti-aliasing hack) — a patch-design tool, not this phase.
- Phase 4's instrument content itself.
