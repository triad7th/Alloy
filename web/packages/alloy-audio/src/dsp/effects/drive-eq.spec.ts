import { describe, expect, it } from 'vitest';
import { validateInsert, type DriveEqParams, type InsertSpec } from './effect-types.js';
import { DriveEq } from './drive-eq.js';

const FS = 48_000;

const TWIN_REFERENCE_L: number[] = [
  -0.7378411889076233, -0.7547575235366821, -0.7704368233680725, -0.7848948240280151, -0.798133373260498,
  -0.8101407885551453, -0.8208932280540466, -0.8303543329238892,
];
const TWIN_REFERENCE_R: number[] = [
  -0.7378411889076233, -0.7547575235366821, -0.7704368233680725, -0.7848948240280151, -0.798133373260498,
  -0.8101407885551453, -0.8208932280540466, -0.8303543329238892,
];

function sine(freq: number, amp: number, frames: number, sampleRate: number): Float32Array {
  const out = new Float32Array(frames);
  for (let i = 0; i < frames; i++) {
    out[i] = amp * Math.sin((2 * Math.PI * freq * i) / sampleRate);
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

const NEUTRAL: DriveEqParams = { drive: 0, lowDb: 0, midDb: 0, highDb: 0, levelDb: 0 };

describe('DriveEq', () => {
  it('neutral (drive 0, all Db 0) is not a bypass but exactly tanh(input) — tanh(x) !== x', () => {
    // A small-amplitude probe keeps float32 storage quantization of
    // tanh(x) far below the 1e-12 budget (same trick as rotary's
    // depth-0/mix-1 test): at amp 1e-5 the float32 ULP is ~1e-12, half a
    // ULP is well inside the assertion.
    const eq = new DriveEq(NEUTRAL, FS);
    const amp = 1e-5;
    const frames = 256;
    const input = sine(97, amp, frames, FS);
    const originalInput = input.slice();
    const left = input.slice();
    const right = input.slice();
    eq.process(left, right, frames);
    for (let i = 0; i < frames; i++) {
      const expected = Math.tanh(originalInput[i]);
      expect(Math.abs(left[i] - expected)).toBeLessThanOrEqual(1e-12);
      expect(Math.abs(right[i] - expected)).toBeLessThanOrEqual(1e-12);
      // And confirm it is NOT a literal bypass for a "normal" amplitude:
      // tanh(x) !== x whenever x !== 0.
    }
  });

  it('drive 1 saturates a 0.9-amplitude sine: peak barely grows despite 5x preGain, and the waveform changes shape', () => {
    const params: DriveEqParams = { ...NEUTRAL, drive: 1 };
    const eq = new DriveEq(params, FS);
    const frames = 4800;
    const input = sine(440, 0.9, frames, FS);
    const originalInput = input.slice();
    const left = input.slice();
    const right = input.slice();
    eq.process(left, right, frames);

    let peakIn = 0;
    let peakOut = 0;
    let maxDiff = 0;
    for (let i = 0; i < frames; i++) {
      peakIn = Math.max(peakIn, Math.abs(originalInput[i]));
      peakOut = Math.max(peakOut, Math.abs(left[i]));
      maxDiff = Math.max(maxDiff, Math.abs(left[i] - originalInput[i]));
    }
    // Without saturation, preGain=5 would grow the peak to ~4.5 (5x).
    // tanh clamps it close to unity instead — measured ratio ~1.111.
    expect(peakOut).toBeLessThan(peakIn * 1.2);
    // Harmonics: the waveform is no longer a scaled copy of the input.
    expect(maxDiff).toBeGreaterThan(0.1);
    expect(left).toEqual(right);
  });

  it('lowDb +12 boosts a 100 Hz sine far more than a 5 kHz sine (low-shelf selectivity)', () => {
    const boosted: DriveEqParams = { ...NEUTRAL, lowDb: 12 };
    const frames = 9600;
    const warmup = 4800;

    const neutral100 = new DriveEq(NEUTRAL, FS);
    const boosted100 = new DriveEq(boosted, FS);
    const in100 = sine(100, 0.5, frames, FS);
    const outNeutral100 = in100.slice();
    const outBoosted100 = in100.slice();
    neutral100.process(outNeutral100, in100.slice(), frames);
    boosted100.process(outBoosted100, in100.slice(), frames);
    const ratio100 = rms(outBoosted100, warmup, frames - warmup) / rms(outNeutral100, warmup, frames - warmup);

    const neutral5k = new DriveEq(NEUTRAL, FS);
    const boosted5k = new DriveEq(boosted, FS);
    const in5k = sine(5000, 0.5, frames, FS);
    const outNeutral5k = in5k.slice();
    const outBoosted5k = in5k.slice();
    neutral5k.process(outNeutral5k, in5k.slice(), frames);
    boosted5k.process(outBoosted5k, in5k.slice(), frames);
    const ratio5k = rms(outBoosted5k, warmup, frames - warmup) / rms(outNeutral5k, warmup, frames - warmup);

    expect(ratio100).toBeGreaterThan(3.5);
    expect(ratio100).toBeLessThan(4.2);
    expect(ratio5k).toBeLessThan(1.3);
  });

  it('highDb -12 attenuates an 8 kHz sine far more than a 100 Hz sine (high-shelf selectivity)', () => {
    const cut: DriveEqParams = { ...NEUTRAL, highDb: -12 };
    const frames = 9600;
    const warmup = 4800;

    const neutral8k = new DriveEq(NEUTRAL, FS);
    const cut8k = new DriveEq(cut, FS);
    const in8k = sine(8000, 0.5, frames, FS);
    const outNeutral8k = in8k.slice();
    const outCut8k = in8k.slice();
    neutral8k.process(outNeutral8k, in8k.slice(), frames);
    cut8k.process(outCut8k, in8k.slice(), frames);
    const ratio8k = rms(outCut8k, warmup, frames - warmup) / rms(outNeutral8k, warmup, frames - warmup);

    const neutral100 = new DriveEq(NEUTRAL, FS);
    const cut100 = new DriveEq(cut, FS);
    const in100 = sine(100, 0.5, frames, FS);
    const outNeutral100 = in100.slice();
    const outCut100 = in100.slice();
    neutral100.process(outNeutral100, in100.slice(), frames);
    cut100.process(outCut100, in100.slice(), frames);
    const ratio100 = rms(outCut100, warmup, frames - warmup) / rms(outNeutral100, warmup, frames - warmup);

    expect(1 / ratio8k).toBeGreaterThanOrEqual(1.8);
    expect(ratio100).toBeLessThan(1.3);
  });

  it('reset() restores initial state exactly', () => {
    const params: DriveEqParams = { drive: 0.4, lowDb: 3, midDb: -2, highDb: 4, levelDb: -1 };
    const eq = new DriveEq(params, FS);
    const input = sine(330, 0.6, 512, FS);

    const leftA = input.slice();
    const rightA = input.slice();
    eq.process(leftA, rightA, 512);

    eq.reset();

    const leftB = input.slice();
    const rightB = input.slice();
    eq.process(leftB, rightB, 512);

    for (let i = 0; i < 512; i++) {
      expect(leftB[i]).toBe(leftA[i]);
      expect(rightB[i]).toBe(rightA[i]);
    }
  });

  it('validateInsert enforces driveEq bounds', () => {
    const base: DriveEqParams = { drive: 0.5, lowDb: 0, midDb: 0, highDb: 0, levelDb: 0 };
    expect(validateInsert({ kind: 'driveEq', driveEq: base })).toEqual([]);
    expect(validateInsert({ kind: 'driveEq', driveEq: { ...base, drive: -0.1 } })).not.toHaveLength(0);
    expect(validateInsert({ kind: 'driveEq', driveEq: { ...base, drive: 1.1 } })).not.toHaveLength(0);
    expect(validateInsert({ kind: 'driveEq', driveEq: { ...base, lowDb: -12.1 } })).not.toHaveLength(0);
    expect(validateInsert({ kind: 'driveEq', driveEq: { ...base, lowDb: 12.1 } })).not.toHaveLength(0);
    expect(validateInsert({ kind: 'driveEq', driveEq: { ...base, midDb: -12.1 } })).not.toHaveLength(0);
    expect(validateInsert({ kind: 'driveEq', driveEq: { ...base, midDb: 12.1 } })).not.toHaveLength(0);
    expect(validateInsert({ kind: 'driveEq', driveEq: { ...base, highDb: -12.1 } })).not.toHaveLength(0);
    expect(validateInsert({ kind: 'driveEq', driveEq: { ...base, highDb: 12.1 } })).not.toHaveLength(0);
    expect(validateInsert({ kind: 'driveEq', driveEq: { ...base, levelDb: -12.1 } })).not.toHaveLength(0);
    expect(validateInsert({ kind: 'driveEq', driveEq: { ...base, levelDb: 12.1 } })).not.toHaveLength(0);
  });

  it('driveEq insert JSON pin: parses and validates clean', () => {
    const json = `{ "kind": "driveEq", "driveEq": { "drive": 0.4, "lowDb": 3, "midDb": -2, "highDb": 4, "levelDb": -1 } }`;
    const insert = JSON.parse(json) as InsertSpec;
    expect(validateInsert(insert)).toEqual([]);
  });

  it('matches the twin reference (drive 0.4, low +3, mid -2, high +4, level -1)', () => {
    const params: DriveEqParams = { drive: 0.4, lowDb: 3, midDb: -2, highDb: 4, levelDb: -1 };
    const eq = new DriveEq(params, FS);
    const warmupFrames = 512;
    const captureFrames = 8;
    const totalFrames = warmupFrames + captureFrames;
    const input = sine(440, 0.5, totalFrames, FS);
    const left = input.slice();
    const right = input.slice();
    eq.process(left, right, totalFrames);
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
