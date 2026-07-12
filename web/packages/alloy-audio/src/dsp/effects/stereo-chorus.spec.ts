import { describe, expect, it } from 'vitest';
import { validateInsert, type ChorusParams } from './effect-types.js';
import { BASE_DELAY_MS, StereoChorus } from './stereo-chorus.js';

const FS = 48_000;

const TWIN_REFERENCE_L: number[] = [
  -0.23429641127586365, -0.2546550929546356, -0.27417752146720886, -0.2928009629249573, -0.31046581268310547,
  -0.32711538672447205, -0.34269648790359497, -0.3571593761444092,
];
const TWIN_REFERENCE_R: number[] = [
  -0.21921847760677338, -0.24005915224552155, -0.2601032257080078, -0.2792840600013733, -0.2975378930568695,
  -0.31480398774147034, -0.3310249447822571, -0.346146821975708,
];

function sine(freq: number, amp: number, frames: number, sampleRate: number): Float32Array {
  const out = new Float32Array(frames);
  for (let i = 0; i < frames; i++) {
    out[i] = amp * Math.sin((2 * Math.PI * freq * i) / sampleRate);
  }
  return out;
}

describe('StereoChorus', () => {
  it('mix 0 is a perfect bypass', () => {
    const params: ChorusParams = { mode: 'chorus', rateHz: 0.8, depthMs: 3, mix: 0 };
    const chorus = new StereoChorus(params, FS);
    const left = sine(440, 0.5, 256, FS);
    const right = sine(440, 0.5, 256, FS);
    const originalLeft = left.slice();
    const originalRight = right.slice();
    chorus.process(left, right, 256);
    for (let i = 0; i < 256; i++) {
      expect(left[i]).toBe(originalLeft[i]);
      expect(right[i]).toBe(originalRight[i]);
    }
  });

  it('widens a mono source: identical L/R diverge after the taps settle', () => {
    const params: ChorusParams = { mode: 'chorus', rateHz: 0.8, depthMs: 3, mix: 0.5 };
    const chorus = new StereoChorus(params, FS);
    const mono = sine(440, 1, 4800, FS);
    const left = mono.slice();
    const right = mono.slice();
    chorus.process(left, right, 4800);
    let maxDiff = 0;
    for (let i = 1000; i < 4800; i++) {
      maxDiff = Math.max(maxDiff, Math.abs(left[i] - right[i]));
    }
    expect(maxDiff).toBeGreaterThan(0.01);
  });

  it('delay bounds: an impulse arrives only within BASE_DELAY_MS +/- depthMs', () => {
    const depthMs = 3;
    const params: ChorusParams = { mode: 'chorus', rateHz: 1.3, depthMs, mix: 1 };
    const chorus = new StereoChorus(params, FS);
    const frames = 550; // stays inside the (7 + 3 + 2)ms = 12ms delay buffer, no wraparound
    const left = new Float32Array(frames);
    const right = new Float32Array(frames);
    left[0] = 1;
    right[0] = 1;
    chorus.process(left, right, frames);

    const nonzeroIndices: number[] = [];
    for (let i = 0; i < frames; i++) {
      if (left[i] !== 0 || right[i] !== 0) {
        nonzeroIndices.push(i);
      }
    }
    expect(nonzeroIndices.length).toBeGreaterThan(0);
    const minFrame = ((7 - depthMs - 0.1) / 1000) * FS;
    const maxFrame = ((7 + depthMs + 0.1) / 1000) * FS;
    for (const idx of nonzeroIndices) {
      expect(idx).toBeGreaterThanOrEqual(minFrame);
      expect(idx).toBeLessThanOrEqual(maxFrame);
    }
  });

  it('ensemble mode differs from chorus mode for the same input/params', () => {
    const base = { rateHz: 0.9, depthMs: 4, mix: 0.6 };
    const input = sine(220, 0.5, 2048, FS);

    const chorus = new StereoChorus({ mode: 'chorus', ...base }, FS);
    const chorusLeft = input.slice();
    const chorusRight = input.slice();
    chorus.process(chorusLeft, chorusRight, 2048);

    const ensemble = new StereoChorus({ mode: 'ensemble', ...base }, FS);
    const ensembleLeft = input.slice();
    const ensembleRight = input.slice();
    ensemble.process(ensembleLeft, ensembleRight, 2048);

    let maxDiff = 0;
    for (let i = 0; i < 2048; i++) {
      maxDiff = Math.max(maxDiff, Math.abs(chorusLeft[i] - ensembleLeft[i]), Math.abs(chorusRight[i] - ensembleRight[i]));
    }
    expect(maxDiff).toBeGreaterThan(0.01);
  });

  it('reset() restores initial state exactly', () => {
    const params: ChorusParams = { mode: 'ensemble', rateHz: 1.1, depthMs: 2, mix: 0.4 };
    const chorus = new StereoChorus(params, FS);
    const input = sine(330, 0.6, 512, FS);

    const leftA = input.slice();
    const rightA = input.slice();
    chorus.process(leftA, rightA, 512);

    chorus.reset();

    const leftB = input.slice();
    const rightB = input.slice();
    chorus.process(leftB, rightB, 512);

    for (let i = 0; i < 512; i++) {
      expect(leftB[i]).toBe(leftA[i]);
      expect(rightB[i]).toBe(rightA[i]);
    }
  });

  it('validateInsert enforces chorus bounds', () => {
    expect(validateInsert({ kind: 'chorus', chorus: { mode: 'chorus', rateHz: 0, depthMs: 3, mix: 0.5 } })).not.toHaveLength(0);
    expect(validateInsert({ kind: 'chorus', chorus: { mode: 'chorus', rateHz: 1, depthMs: 25, mix: 0.5 } })).not.toHaveLength(0);
    expect(validateInsert({ kind: 'chorus', chorus: { mode: 'chorus', rateHz: 1, depthMs: 3, mix: 1.5 } })).not.toHaveLength(0);
    expect(validateInsert({ kind: 'chorus', chorus: { mode: 'chorus', rateHz: 1, depthMs: 3, mix: 0.5 } })).toEqual([]);
  });

  it('validateInsert rejects a chorus depthMs beyond BASE_DELAY_MS (acausal swept delay)', () => {
    // depthMs > BASE_DELAY_MS makes (BASE_DELAY_MS - depthMs) negative for
    // part of the LFO cycle, i.e. the tap would have to read ahead of the
    // write head. depthMs === BASE_DELAY_MS is the causal boundary (delay
    // bottoms out at exactly 0) and must still pass.
    expect(
      validateInsert({ kind: 'chorus', chorus: { mode: 'chorus', rateHz: 1, depthMs: BASE_DELAY_MS + 1, mix: 0.5 } }),
    ).not.toHaveLength(0);
    expect(
      validateInsert({ kind: 'chorus', chorus: { mode: 'chorus', rateHz: 1, depthMs: BASE_DELAY_MS, mix: 0.5 } }),
    ).toEqual([]);
  });

  it('matches the twin reference (chorus rate 1.2 depth 2.5 mix 0.6)', () => {
    const params: ChorusParams = { mode: 'chorus', rateHz: 1.2, depthMs: 2.5, mix: 0.6 };
    const chorus = new StereoChorus(params, FS);
    const warmupFrames = 512;
    const captureFrames = 8;
    const totalFrames = warmupFrames + captureFrames;
    const input = sine(440, 0.5, totalFrames, FS);
    const left = input.slice();
    const right = input.slice();
    chorus.process(left, right, totalFrames);
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
