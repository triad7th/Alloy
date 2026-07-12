import { describe, expect, it } from 'vitest';
import { Compressor } from './compressor.js';
import { validateInsert, type CompressorParams, type InsertSpec } from './effect-types.js';

const FS = 48_000;

const TWIN_REFERENCE_L: number[] = [
  5.5357342753530655e-15, 0.01805964484810829, 0.03605939820408821, 0.053939562290906906, 0.07164084911346436,
  0.0891045406460762, 0.10627273470163345, 0.12308848649263382,
];
const TWIN_REFERENCE_R: number[] = [
  2.7678671376765327e-15, 0.009029822424054146, 0.018029699102044106, 0.026969781145453453, 0.03582042455673218,
  0.0445522703230381, 0.05313636735081673, 0.06154424324631691,
];

function sine(freq: number, amp: number, frames: number, sampleRate: number, startPhase = 0): Float32Array {
  const out = new Float32Array(frames);
  for (let i = 0; i < frames; i++) {
    out[i] = amp * Math.sin(startPhase + (2 * Math.PI * freq * i) / sampleRate);
  }
  return out;
}

function rms(values: Float32Array, start: number, length: number): number {
  let sumSq = 0;
  for (let i = start; i < start + length; i++) {
    sumSq += values[i] * values[i];
  }
  return Math.sqrt(sumSq / length);
}

describe('Compressor', () => {
  it('below-threshold input is a near-bypass (envelope never crosses threshold, so gain stays at unity)', () => {
    // -40 dBFS sine, threshold -20 dB: env is bounded above by the input
    // amplitude (0.01), so envDb <= -40 always < thresholdDb, over is
    // always 0, and with makeupDb 0 the gain resolves to exactly 1 at
    // every control tick (including the very first, using the init env).
    const params: CompressorParams = { thresholdDb: -20, ratio: 4, attackMs: 5, releaseMs: 80, makeupDb: 0 };
    const compressor = new Compressor(params, FS);
    const amp = 10 ** (-40 / 20);
    const frames = 9600;
    const left = sine(440, amp, frames, FS);
    const right = sine(440, amp, frames, FS);
    const originalLeft = left.slice();
    const originalRight = right.slice();
    compressor.process(left, right, frames);
    for (let i = 0; i < frames; i++) {
      expect(Math.abs(left[i] - originalLeft[i])).toBeLessThanOrEqual(1e-6);
      expect(Math.abs(right[i] - originalRight[i])).toBeLessThanOrEqual(1e-6);
    }
  });

  it('loud signal is compressed: steady-state RMS reduction is ~15 dB (20 dB over threshold x (1 - 1/4)), within +-2 dB', () => {
    const params: CompressorParams = { thresholdDb: -20, ratio: 4, attackMs: 5, releaseMs: 80, makeupDb: 0 };
    const compressed = new Compressor(params, FS);
    const neutral = new Compressor({ ...params, ratio: 1 }, FS);
    const frames = 48_000;
    const left = sine(440, 1.0, frames, FS);
    const leftNeutral = left.slice();
    const right = left.slice();
    const rightNeutral = left.slice();
    compressed.process(left, right, frames);
    neutral.process(leftNeutral, rightNeutral, frames);

    // Late window, after the attack/release detector has settled into its
    // periodic steady state on the constant-amplitude sine.
    const start = 24_000;
    const length = 9600;
    const outRms = rms(left, start, length);
    const dryRms = rms(leftNeutral, start, length);
    const reductionDb = 20 * Math.log10(dryRms / outRms);
    // Measured ~14.34 dB: the detector tracks the rectified sine's smoothed
    // envelope, which sits below the 0 dBFS peak, so the realized reduction
    // is a bit under the naive 15 dB estimate — well within the +-2 dB band.
    expect(reductionDb).toBeGreaterThan(13);
    expect(reductionDb).toBeLessThan(17);
  });

  it('attack: right after a silence-to-full step, the first ~1 ms still passes near-unity gain (attackMs 50 has not caught up yet)', () => {
    const params: CompressorParams = { thresholdDb: -20, ratio: 4, attackMs: 50, releaseMs: 80, makeupDb: 0 };
    const compressor = new Compressor(params, FS);
    const silenceFrames = 2400;
    const burstFrames = 2400;
    const totalFrames = silenceFrames + burstFrames;
    const left = new Float32Array(totalFrames);
    const burst = sine(440, 1.0, burstFrames, FS);
    left.set(burst, silenceFrames);
    const right = left.slice();
    compressor.process(left, right, totalFrames);

    // First ~1 ms (48 samples) of the step.
    let earlyPeak = 0;
    for (let i = silenceFrames; i < silenceFrames + 48; i++) {
      earlyPeak = Math.max(earlyPeak, Math.abs(left[i]));
    }
    // Steady-state window, late into the burst once the gain has settled.
    let steadyPeak = 0;
    for (let i = silenceFrames + 2000; i < silenceFrames + 2200; i++) {
      steadyPeak = Math.max(steadyPeak, Math.abs(left[i]));
    }
    // The input peak is the same (1.0) in both windows, so comparing output
    // peaks directly compares the realized gain: early gain is near unity
    // (attack hasn't clamped down yet), steady-state gain is well below it.
    expect(earlyPeak).toBeGreaterThan(steadyPeak);
    expect(earlyPeak).toBeGreaterThan(0.9);
  });

  it('release: after the burst ends, gain recovers toward unity within ~5x releaseMs on the following quiet passage', () => {
    const params: CompressorParams = { thresholdDb: -20, ratio: 4, attackMs: 5, releaseMs: 80, makeupDb: 0 };
    const compressor = new Compressor(params, FS);
    const burstFrames = 9600;
    const burst = sine(440, 1.0, burstFrames, FS);
    const burstR = burst.slice();
    compressor.process(burst, burstR, burstFrames);

    const quietAmp = 10 ** (-40 / 20);
    const quietFrames = 20_000;
    const quietStartPhase = (2 * Math.PI * 440 * burstFrames) / FS;
    const quiet = sine(440, quietAmp, quietFrames, FS, quietStartPhase);
    const quietOriginal = quiet.slice();
    const quietRight = quiet.slice();
    compressor.process(quiet, quietRight, quietFrames);

    function peakRatio(start: number, length: number): number {
      let peakOut = 0;
      let peakIn = 0;
      for (let i = start; i < start + length; i++) {
        peakOut = Math.max(peakOut, Math.abs(quiet[i]));
        peakIn = Math.max(peakIn, Math.abs(quietOriginal[i]));
      }
      return peakOut / peakIn;
    }

    // Immediately after the burst: still heavily compressed (gain << 1).
    const earlyRatio = peakRatio(0, 50);
    // 5 x releaseMs (80ms) = 400ms = 19,200 frames: gain has recovered.
    const lateRatio = peakRatio(19_200 - 50, 100);
    expect(earlyRatio).toBeLessThan(0.5);
    expect(lateRatio).toBeGreaterThan(0.99);
  });

  it('makeup gain applies below threshold: quiet sine, makeup +6 dB -> x2 within 1e-3 (relative)', () => {
    const params: CompressorParams = { thresholdDb: -20, ratio: 4, attackMs: 5, releaseMs: 80, makeupDb: 6 };
    const compressor = new Compressor(params, FS);
    const amp = 10 ** (-40 / 20);
    const frames = 9600;
    const left = sine(440, amp, frames, FS);
    const right = left.slice();
    const originalLeft = left.slice();
    compressor.process(left, right, frames);

    const expectedGain = 10 ** (6 / 20);
    for (let i = 100; i < frames; i++) {
      if (Math.abs(originalLeft[i]) > 1e-6) {
        const relDiff = Math.abs(left[i] / originalLeft[i] - expectedGain) / expectedGain;
        expect(relDiff).toBeLessThan(1e-3);
      }
    }
  });

  it('stereo link: a loud L alone still compresses a quiet R by the same gain factor', () => {
    const params: CompressorParams = { thresholdDb: -20, ratio: 4, attackMs: 5, releaseMs: 80, makeupDb: 0 };
    const compressor = new Compressor(params, FS);
    const frames = 9600;
    const left = sine(440, 0.9, frames, FS);
    const right = sine(440, 0.05, frames, FS);
    const originalLeft = left.slice();
    const originalRight = right.slice();
    compressor.process(left, right, frames);

    for (let i = 200; i < frames; i++) {
      if (Math.abs(originalLeft[i]) > 0.01 && Math.abs(originalRight[i]) > 0.001) {
        const gainL = left[i] / originalLeft[i];
        const gainR = right[i] / originalRight[i];
        expect(Math.abs(gainL - gainR)).toBeLessThanOrEqual(1e-6);
      }
    }
  });

  it('reset() restores initial state exactly', () => {
    const params: CompressorParams = { thresholdDb: -18, ratio: 6, attackMs: 10, releaseMs: 120, makeupDb: 4 };
    const compressor = new Compressor(params, FS);
    const input = sine(330, 0.8, 2048, FS);

    const leftA = input.slice();
    const rightA = input.slice();
    compressor.process(leftA, rightA, 2048);

    compressor.reset();

    const leftB = input.slice();
    const rightB = input.slice();
    compressor.process(leftB, rightB, 2048);

    for (let i = 0; i < 2048; i++) {
      expect(leftB[i]).toBe(leftA[i]);
      expect(rightB[i]).toBe(rightA[i]);
    }
  });

  it('validateInsert enforces compressor bounds', () => {
    const base: CompressorParams = { thresholdDb: -18, ratio: 4, attackMs: 5, releaseMs: 80, makeupDb: 3 };
    expect(validateInsert({ kind: 'compressor', compressor: base })).toEqual([]);
    expect(validateInsert({ kind: 'compressor', compressor: { ...base, thresholdDb: -60.1 } })).not.toHaveLength(0);
    expect(validateInsert({ kind: 'compressor', compressor: { ...base, thresholdDb: 0.1 } })).not.toHaveLength(0);
    expect(validateInsert({ kind: 'compressor', compressor: { ...base, ratio: 0.9 } })).not.toHaveLength(0);
    expect(validateInsert({ kind: 'compressor', compressor: { ...base, ratio: 20.1 } })).not.toHaveLength(0);
    expect(validateInsert({ kind: 'compressor', compressor: { ...base, attackMs: 0 } })).not.toHaveLength(0);
    expect(validateInsert({ kind: 'compressor', compressor: { ...base, attackMs: 100.1 } })).not.toHaveLength(0);
    expect(validateInsert({ kind: 'compressor', compressor: { ...base, releaseMs: 0 } })).not.toHaveLength(0);
    expect(validateInsert({ kind: 'compressor', compressor: { ...base, releaseMs: 1000.1 } })).not.toHaveLength(0);
    expect(validateInsert({ kind: 'compressor', compressor: { ...base, makeupDb: -0.1 } })).not.toHaveLength(0);
    expect(validateInsert({ kind: 'compressor', compressor: { ...base, makeupDb: 24.1 } })).not.toHaveLength(0);
  });

  it('compressor insert JSON pin: parses and validates clean', () => {
    const json = `{ "kind": "compressor", "compressor": { "thresholdDb": -18, "ratio": 4, "attackMs": 5, "releaseMs": 80, "makeupDb": 3 } }`;
    const insert = JSON.parse(json) as InsertSpec;
    expect(validateInsert(insert)).toEqual([]);
  });

  it('matches the twin reference (threshold -18, ratio 4, attack 5, release 80, makeup 3)', () => {
    const params: CompressorParams = { thresholdDb: -18, ratio: 4, attackMs: 5, releaseMs: 80, makeupDb: 3 };
    const compressor = new Compressor(params, FS);
    const warmupFrames = 4800;
    const captureFrames = 8;
    const totalFrames = warmupFrames + captureFrames;
    const left = sine(440, 0.9, totalFrames, FS);
    const right = sine(440, 0.45, totalFrames, FS);
    compressor.process(left, right, totalFrames);
    const outLeft = left.subarray(warmupFrames, warmupFrames + captureFrames);
    const outRight = right.subarray(warmupFrames, warmupFrames + captureFrames);
    // console.log(JSON.stringify(Array.from(outLeft)));
    // console.log(JSON.stringify(Array.from(outRight)));
    expect(TWIN_REFERENCE_L).toHaveLength(8);
    expect(TWIN_REFERENCE_R).toHaveLength(8);
    TWIN_REFERENCE_L.forEach((v, i) => expect(outLeft[i]).toBeCloseTo(v, 6));
    TWIN_REFERENCE_R.forEach((v, i) => expect(outRight[i]).toBeCloseTo(v, 6));
  });
});
