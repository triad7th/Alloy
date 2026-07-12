import { describe, expect, it } from 'vitest';
import { validateInsert, type InsertSpec, type RotaryParams } from './effect-types.js';
import { RotarySpeaker } from './rotary-speaker.js';

const FS = 48_000;

const TWIN_REFERENCE_L: number[] = [
  -0.5976319909095764, -0.609201192855835, -0.6187569499015808, -0.6262661218643188, -0.6317020654678345,
  -0.6350451707839966, -0.6362826824188232, -0.6354088187217712,
];
const TWIN_REFERENCE_R: number[] = [
  -0.3396499752998352, -0.34659186005592346, -0.352377325296402, -0.3569888174533844, -0.3604126572608948,
  -0.3626391291618347, -0.3636625111103058, -0.3634810447692871,
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

describe('RotarySpeaker', () => {
  it('mix 0 is a perfect bypass', () => {
    const params: RotaryParams = { speed: 'fast', depth: 0.7, mix: 0 };
    const rotary = new RotarySpeaker(params, FS);
    const left = sine(440, 0.5, 256, FS);
    const right = sine(660, 0.4, 256, FS);
    const originalLeft = left.slice();
    const originalRight = right.slice();
    rotary.process(left, right, 256);
    for (let i = 0; i < 256; i++) {
      expect(left[i]).toBe(originalLeft[i]);
      expect(right[i]).toBe(originalRight[i]);
    }
  });

  it('depth 0 mix 1 collapses to the crossover-flat mono sum on both channels', () => {
    const params: RotaryParams = { speed: 'fast', depth: 0, mix: 1 };
    const rotary = new RotarySpeaker(params, FS);
    const frames = 1024;
    // Small amplitudes keep |m| < 2^-7, so float32 output storage quantizes
    // by less than half an ulp = 2^-31 — well inside the 1e-9 budget. The
    // double-precision path itself reconstructs m to ~1e-16 (low + (m - low)).
    const left = sine(440, 0.006, frames, FS);
    const right = sine(330, 0.005, frames, FS);
    const originalLeft = left.slice();
    const originalRight = right.slice();
    rotary.process(left, right, frames);
    for (let i = 0; i < frames; i++) {
      // Unity-center gains: wet = 1*high + 1*low = m per channel. The two
      // channels run the identical computation, so they are bit-equal; each
      // matches the mono sum m within 1e-9.
      const m = (originalLeft[i] + originalRight[i]) / 2;
      expect(left[i]).toBe(right[i]);
      expect(Math.abs(left[i] - m)).toBeLessThanOrEqual(1e-9);
    }
  });

  it('anti-phase pan probe: fast horn rotor alternates L-loud / R-loud half-cycles', () => {
    const params: RotaryParams = { speed: 'fast', depth: 1, mix: 1 };
    const rotary = new RotarySpeaker(params, FS);
    // DC-free high-band input: 2 kHz sine, well above the 800 Hz crossover.
    const halfCycle = Math.floor(FS / 6.6 / 2); // half-cycle of the fast horn rotor ~ 3636 frames
    const frames = 2 * halfCycle;
    const left = sine(2000, 0.5, frames, FS);
    const right = left.slice();
    rotary.process(left, right, frames);

    // hornPhase starts at 0: sin >= 0 across the first half-cycle (L gain
    // 1+depth*sin >= 1 >= R gain), sin <= 0 across the second (reversed).
    const rmsL1 = rms(left, 0, halfCycle);
    const rmsR1 = rms(right, 0, halfCycle);
    const rmsL2 = rms(left, halfCycle, halfCycle);
    const rmsR2 = rms(right, halfCycle, halfCycle);
    expect(rmsL1).toBeGreaterThan(rmsR1);
    expect(rmsR2).toBeGreaterThan(rmsL2);
  });

  it('slow differs from fast for the same input', () => {
    const input = sine(440, 0.5, 24_000, FS);

    const slow = new RotarySpeaker({ speed: 'slow', depth: 0.7, mix: 1 }, FS);
    const leftSlow = input.slice();
    const rightSlow = input.slice();
    slow.process(leftSlow, rightSlow, 24_000);

    const fast = new RotarySpeaker({ speed: 'fast', depth: 0.7, mix: 1 }, FS);
    const leftFast = input.slice();
    const rightFast = input.slice();
    fast.process(leftFast, rightFast, 24_000);

    let maxDiff = 0;
    for (let i = 0; i < 24_000; i++) {
      maxDiff = Math.max(maxDiff, Math.abs(leftSlow[i] - leftFast[i]), Math.abs(rightSlow[i] - rightFast[i]));
    }
    expect(maxDiff).toBeGreaterThan(0.01);
  });

  it('reset() restores initial state exactly', () => {
    const params: RotaryParams = { speed: 'fast', depth: 0.6, mix: 0.8 };
    const rotary = new RotarySpeaker(params, FS);
    const input = sine(330, 0.6, 512, FS);

    const leftA = input.slice();
    const rightA = input.slice();
    rotary.process(leftA, rightA, 512);

    rotary.reset();

    const leftB = input.slice();
    const rightB = input.slice();
    rotary.process(leftB, rightB, 512);

    for (let i = 0; i < 512; i++) {
      expect(leftB[i]).toBe(leftA[i]);
      expect(rightB[i]).toBe(rightA[i]);
    }
  });

  it('validateInsert enforces rotary bounds, including speed must be slow or fast', () => {
    const base: RotaryParams = { speed: 'fast', depth: 0.5, mix: 0.5 };
    expect(validateInsert({ kind: 'rotary', rotary: base })).toEqual([]);
    expect(validateInsert({ kind: 'rotary', rotary: { ...base, speed: 'slow' } })).toEqual([]);
    expect(
      validateInsert({ kind: 'rotary', rotary: { ...base, speed: 'medium' as unknown as 'slow' | 'fast' } }),
    ).not.toHaveLength(0);
    expect(validateInsert({ kind: 'rotary', rotary: { ...base, depth: -0.1 } })).not.toHaveLength(0);
    expect(validateInsert({ kind: 'rotary', rotary: { ...base, depth: 1.1 } })).not.toHaveLength(0);
    expect(validateInsert({ kind: 'rotary', rotary: { ...base, mix: -0.1 } })).not.toHaveLength(0);
    expect(validateInsert({ kind: 'rotary', rotary: { ...base, mix: 1.1 } })).not.toHaveLength(0);
  });

  it('rotary insert JSON pin: parses and validates clean', () => {
    const json = `{ "kind": "rotary", "rotary": { "speed": "fast", "depth": 0.5, "mix": 0.6 } }`;
    const insert = JSON.parse(json) as InsertSpec;
    expect(validateInsert(insert)).toEqual([]);
  });

  it('matches the twin reference (fast, depth 0.7, mix 1)', () => {
    const params: RotaryParams = { speed: 'fast', depth: 0.7, mix: 1 };
    const rotary = new RotarySpeaker(params, FS);
    const warmupFrames = 512;
    const captureFrames = 8;
    const totalFrames = warmupFrames + captureFrames;
    const input = sine(440, 0.5, totalFrames, FS);
    const left = input.slice();
    const right = input.slice();
    rotary.process(left, right, totalFrames);
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
