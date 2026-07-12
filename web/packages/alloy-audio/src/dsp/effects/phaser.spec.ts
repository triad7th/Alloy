import { describe, expect, it } from 'vitest';
import { DspPrng } from '../prng.js';
import { validateInsert, type InsertSpec, type PhaserParams } from './effect-types.js';
import { Phaser } from './phaser.js';

const FS = 48_000;

const TWIN_REFERENCE_L: number[] = [
  -0.6855601072311401, -0.701745867729187, -0.7152063846588135, -0.726597249507904, -0.7353339195251465,
  -0.7417957782745361, -0.7456986904144287, -0.7471609711647034,
];
const TWIN_REFERENCE_R: number[] = [
  -0.6780648827552795, -0.6947558522224426, -0.7091800570487976, -0.7212420701980591, -0.7309039235115051,
  -0.738163948059082, -0.7429497838020325, -0.7452953457832336,
];

function sine(freq: number, amp: number, frames: number, sampleRate: number): Float32Array {
  const out = new Float32Array(frames);
  for (let i = 0; i < frames; i++) {
    out[i] = amp * Math.sin((2 * Math.PI * freq * i) / sampleRate);
  }
  return out;
}

function noise(seed: number, amp: number, frames: number): Float32Array {
  const prng = new DspPrng(seed);
  const out = new Float32Array(frames);
  for (let i = 0; i < frames; i++) {
    out[i] = (prng.next() * 2 - 1) * amp;
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

describe('Phaser', () => {
  it('mix 0 is a perfect bypass', () => {
    const params: PhaserParams = { stages: 4, rateHz: 0.9, depth: 0.8, feedback: 0.5, mix: 0 };
    const phaser = new Phaser(params, FS);
    const left = sine(440, 0.5, 256, FS);
    const right = sine(440, 0.5, 256, FS);
    const originalLeft = left.slice();
    const originalRight = right.slice();
    phaser.process(left, right, 256);
    for (let i = 0; i < 256; i++) {
      expect(left[i]).toBe(originalLeft[i]);
      expect(right[i]).toBe(originalRight[i]);
    }
  });

  it('notch motion probe: broadband RMS of the wet signal differs between two windows 1s apart (the sweep moved)', () => {
    const params: PhaserParams = { stages: 4, rateHz: 0.5, depth: 1, feedback: 0, mix: 0.5 };
    const phaser = new Phaser(params, FS);
    const totalFrames = FS + 4800; // second window starts exactly 1s after the first
    const dryLeft = noise(1234, 0.5, totalFrames);
    const left = dryLeft.slice();
    const right = dryLeft.slice();
    phaser.process(left, right, totalFrames);

    // diff[i] = out[i] - dry[i] = mix * (allpass(x)[i] - x[i]). The allpass
    // chain output alone is energy-preserving (broadband RMS constant no
    // matter where the sweep sits), but |AP(w) - 1| = 2|sin(phi(w)/2)| is
    // NOT flat — it tracks the swept phase response, so this difference
    // signal's RMS moves as the notches move.
    const wet = new Float32Array(totalFrames);
    for (let i = 0; i < totalFrames; i++) {
      wet[i] = left[i] - dryLeft[i];
    }

    const window1Rms = rms(wet, 0, 4800);
    const window2Rms = rms(wet, FS, 4800);
    const relDiff = Math.abs(window1Rms - window2Rms) / Math.max(window1Rms, window2Rms);
    expect(relDiff).toBeGreaterThan(0.05);
  });

  it('stages 8 differs from stages 4 for the same input', () => {
    const base = { rateHz: 0.9, depth: 0.8, feedback: 0.3, mix: 0.7 };
    const input = noise(77, 0.5, 2048);

    const phaser4 = new Phaser({ stages: 4, ...base }, FS);
    const left4 = input.slice();
    const right4 = input.slice();
    phaser4.process(left4, right4, 2048);

    const phaser8 = new Phaser({ stages: 8, ...base }, FS);
    const left8 = input.slice();
    const right8 = input.slice();
    phaser8.process(left8, right8, 2048);

    let maxDiff = 0;
    for (let i = 0; i < 2048; i++) {
      maxDiff = Math.max(maxDiff, Math.abs(left4[i] - left8[i]), Math.abs(right4[i] - right8[i]));
    }
    expect(maxDiff).toBeGreaterThan(0.01);
  });

  it('feedback 0.8 output stays bounded', () => {
    const params: PhaserParams = { stages: 4, rateHz: 0.9, depth: 0.8, feedback: 0.8, mix: 0.7 };
    const phaser = new Phaser(params, FS);
    const frames = 48_000;
    const left = sine(440, 0.5, frames, FS);
    const right = sine(440, 0.5, frames, FS);
    phaser.process(left, right, frames);
    let peak = 0;
    for (let i = 0; i < frames; i++) {
      peak = Math.max(peak, Math.abs(left[i]), Math.abs(right[i]));
    }
    expect(peak).toBeLessThan(4);
  });

  it('reset() restores initial state exactly', () => {
    const params: PhaserParams = { stages: 8, rateHz: 1.1, depth: 0.6, feedback: 0.4, mix: 0.5 };
    const phaser = new Phaser(params, FS);
    const input = sine(330, 0.6, 512, FS);

    const leftA = input.slice();
    const rightA = input.slice();
    phaser.process(leftA, rightA, 512);

    phaser.reset();

    const leftB = input.slice();
    const rightB = input.slice();
    phaser.process(leftB, rightB, 512);

    for (let i = 0; i < 512; i++) {
      expect(leftB[i]).toBe(leftA[i]);
      expect(rightB[i]).toBe(rightA[i]);
    }
  });

  it('validateInsert enforces phaser bounds, including stages must be 4 or 8', () => {
    const base: PhaserParams = { stages: 4, rateHz: 1, depth: 0.5, feedback: 0.3, mix: 0.5 };
    expect(validateInsert({ kind: 'phaser', phaser: base })).toEqual([]);
    expect(validateInsert({ kind: 'phaser', phaser: { ...base, stages: 5 as unknown as 4 | 8 } })).not.toHaveLength(0);
    expect(validateInsert({ kind: 'phaser', phaser: { ...base, rateHz: 0 } })).not.toHaveLength(0);
    expect(validateInsert({ kind: 'phaser', phaser: { ...base, rateHz: 10.1 } })).not.toHaveLength(0);
    expect(validateInsert({ kind: 'phaser', phaser: { ...base, depth: -0.1 } })).not.toHaveLength(0);
    expect(validateInsert({ kind: 'phaser', phaser: { ...base, depth: 1.1 } })).not.toHaveLength(0);
    expect(validateInsert({ kind: 'phaser', phaser: { ...base, feedback: -0.1 } })).not.toHaveLength(0);
    expect(validateInsert({ kind: 'phaser', phaser: { ...base, feedback: 0.91 } })).not.toHaveLength(0);
    expect(validateInsert({ kind: 'phaser', phaser: { ...base, mix: -0.1 } })).not.toHaveLength(0);
    expect(validateInsert({ kind: 'phaser', phaser: { ...base, mix: 1.1 } })).not.toHaveLength(0);
  });

  it('phaser insert JSON pin: parses and validates clean', () => {
    const json = `{ "kind": "phaser", "phaser": { "stages": 8, "rateHz": 1.2, "depth": 0.6, "feedback": 0.4, "mix": 0.5 } }`;
    const insert = JSON.parse(json) as InsertSpec;
    expect(validateInsert(insert)).toEqual([]);
  });

  it('matches the twin reference (stages 4, rate 0.9, depth 0.8, feedback 0.5, mix 0.5)', () => {
    const params: PhaserParams = { stages: 4, rateHz: 0.9, depth: 0.8, feedback: 0.5, mix: 0.5 };
    const phaser = new Phaser(params, FS);
    const warmupFrames = 512;
    const captureFrames = 8;
    const totalFrames = warmupFrames + captureFrames;
    const input = sine(440, 0.5, totalFrames, FS);
    const left = input.slice();
    const right = input.slice();
    phaser.process(left, right, totalFrames);
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
