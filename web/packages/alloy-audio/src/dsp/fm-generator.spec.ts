import { describe, expect, it } from 'vitest';
import { AdsrEnvelope } from './adsr-envelope.js';
import { FmGenerator, type FmGeneratorParams, validateFmGeneratorParams } from './fm-generator.js';
import { FM_OVERSAMPLING } from './fm-oversampling.js';

const FS = 48_000;
const FAST_ADSR = { attack: 0.001, decay: 1, sustain: 1, release: 0.01 };

const TWIN_REFERENCE: number[] = [
  0, 0.004423217847943306, 0.015922080725431442, 0.037106290459632874, 0.07009749114513397,
  0.11572307348251343, 0.1723853349685669, 0.23498837649822235,
];

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

  it('is not finished before noteOn', () => {
    const gen = new FmGenerator(twoOp(0.5), FS);
    expect(gen.finished).toBe(false);
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
  algorithm: {
    routes: [
      { from: 1, to: 0 },
      { from: 2, to: 0 },
    ],
    carriers: [0],
  },
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

  it('prices the patch’s worst-case pitch modulation into the factor', () => {
    // midi 80 x ratio 14 = 11.63 kHz: under the 12 kHz threshold, so K=1 — until
    // the layer carries a deep LFO pitch route. At 1200 cents the LFO peak doubles
    // the pitch, putting the modulator at 23.3 kHz WHILE the voice renders. K is
    // committed at noteOn (re-picking it mid-note would glitch), so the depth has
    // to be priced in up front or the aliasing sweeps back in every LFO cycle.
    expect(new FmGenerator(EP_STACK, FS_AA, 0).oversampling).toBe(1); // not keyed yet
    const plain = new FmGenerator(EP_STACK, FS_AA, 0);
    plain.noteOn(80, 0.8);
    expect(plain.oversampling).toBe(1); // no vibrato: unchanged, and free

    const vibrato = new FmGenerator(EP_STACK, FS_AA, 1200);
    vibrato.noteOn(80, 0.8);
    expect(vibrato.oversampling).toBe(FM_OVERSAMPLING);

    // Sign-blind: -1200 cents bends up just as far on the LFO's negative half.
    const down = new FmGenerator(EP_STACK, FS_AA, -1200);
    down.noteOn(80, 0.8);
    expect(down.oversampling).toBe(FM_OVERSAMPLING);

    // Shallow vibrato on a low note must not drag a voice onto the 4x path.
    const shallow = new FmGenerator(EP_STACK, FS_AA, 50);
    shallow.noteOn(60, 0.8);
    expect(shallow.oversampling).toBe(1);
  });

  it('stays clean at the LFO’s pitch peak — the aliasing bug’s second door', () => {
    // The behavioral half of the test above. Hold the LFO at its +1 peak
    // (pitchRatio = 2 for the whole render) so the spectrum sits on 2*f0 and
    // everything below it can only be foldback — no vibrato sweep to confound the
    // measurement. midi 80 + 1200 cents: with the depth priced in, the voice runs
    // at 4x and measures -66 dB. Ignoring the depth (the pre-fix behavior) leaves
    // it on the 1x path at -25 dB — the shipped bug, back again.
    const gen = new FmGenerator(EP_STACK, FS_AA, 1200);
    gen.noteOn(80, 0.8);
    gen.setPitchRatio(2);
    const out = new Float32Array(FS_AA / 2);
    gen.render(out, out.length);
    expect(aliasFloorDb(out, midiHz(92))).toBeLessThan(-55); // -65.8 dB measured
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
