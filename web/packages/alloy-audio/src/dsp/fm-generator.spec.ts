import { describe, expect, it } from 'vitest';
import { AdsrEnvelope } from './adsr-envelope.js';
import { FmGenerator, type FmGeneratorParams, validateFmGeneratorParams } from './fm-generator.js';

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
