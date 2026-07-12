import { describe, expect, it } from 'vitest';
import { Delay } from './delay.js';
import { DEFAULT_MASTER_CONFIG, type DelayParams } from './effect-types.js';

const FS = 48_000;

function delaySamplesFor(params: DelayParams): number {
  return Math.max(1, Math.round((params.timeMs / 1000) * FS));
}

function sine(freq: number, amp: number, frames: number): Float32Array {
  const out = new Float32Array(frames);
  for (let i = 0; i < frames; i++) out[i] = amp * Math.sin((2 * Math.PI * freq * i) / FS);
  return out;
}

const TWIN_DELAY_L: number[] = [0, 0, 0, 0, 0, 0, 0, 0];
const TWIN_DELAY_R: number[] = [
  0, 0, 0, 0, 0.15199999511241913, 0.09120000153779984, 0.05471999943256378, 0.03283200040459633,
];

describe('Delay', () => {
  it('first echo timing (stereo): impulse -> outL[delaySamples] ~= 1, near-zero before', () => {
    const params: DelayParams = { mode: 'stereo', timeMs: 10, feedback: 0.5, damping: 0.4 };
    const D = delaySamplesFor(params);
    const delay = new Delay(params, FS);
    const frames = D + 5;
    const inL = new Float32Array(frames);
    const inR = new Float32Array(frames);
    inL[0] = 1;
    const outL = new Float32Array(frames);
    const outR = new Float32Array(frames);
    delay.process(inL, inR, outL, outR, frames);

    for (let i = 0; i < D; i++) {
      expect(Math.abs(outL[i])).toBeLessThan(1e-9);
    }
    expect(outL[D]).toBeCloseTo(1, 6);
  });

  it('feedback decay: successive echoes decay by ~feedback each (damping=1 isolates pure feedback)', () => {
    const params: DelayParams = { mode: 'stereo', timeMs: 10, feedback: 0.6, damping: 1 };
    const D = delaySamplesFor(params);
    const delay = new Delay(params, FS);
    const frames = 3 * D + 5;
    const inL = new Float32Array(frames);
    const inR = new Float32Array(frames);
    inL[0] = 1;
    const outL = new Float32Array(frames);
    const outR = new Float32Array(frames);
    delay.process(inL, inR, outL, outR, frames);

    const peak1 = outL[D];
    const peak2 = outL[2 * D];
    const peak3 = outL[3 * D];
    expect(peak1).toBeCloseTo(1, 6);
    expect(peak2 / peak1).toBeCloseTo(params.feedback, 3);
    expect(peak3 / peak2).toBeCloseTo(params.feedback, 3);
  });

  it('ping-pong crossing: echo bounces L -> R across the stereo field', () => {
    const params: DelayParams = { mode: 'pingpong', timeMs: 10, feedback: 0.5, damping: 0.4 };
    const D = delaySamplesFor(params);
    const delay = new Delay(params, FS);
    const frames = 2 * D + 5;
    const inL = new Float32Array(frames);
    const inR = new Float32Array(frames);
    inL[0] = 1;
    const outL = new Float32Array(frames);
    const outR = new Float32Array(frames);
    delay.process(inL, inR, outL, outR, frames);

    // First echo lands on L (the direct, undamped tap of the input).
    expect(outL[D]).toBeCloseTo(1, 6);
    expect(Math.abs(outR[D])).toBeLessThan(1e-9);

    // Second echo, fed back through R's line, crosses to the R channel.
    expect(Math.abs(outR[2 * D])).toBeGreaterThan(1e-6);
    expect(Math.abs(outL[2 * D])).toBeLessThan(1e-9);
  });

  it('damping attenuates feedback beyond pure feedback scaling', () => {
    const params: DelayParams = { mode: 'stereo', timeMs: 10, feedback: 0.6, damping: 0.4 };
    const D = delaySamplesFor(params);
    const delay = new Delay(params, FS);
    const frames = 2 * D + 5;
    const inL = new Float32Array(frames);
    const inR = new Float32Array(frames);
    inL[0] = 1;
    const outL = new Float32Array(frames);
    const outR = new Float32Array(frames);
    delay.process(inL, inR, outL, outR, frames);

    const peak1 = outL[D];
    const peak2 = outL[2 * D];
    // With damping < 1 the one-pole LPF attenuates the fed-back signal on
    // top of the feedback gain, so the ratio is strictly below `feedback`.
    expect(peak2 / peak1).toBeLessThan(params.feedback);
    expect(peak2 / peak1).toBeGreaterThan(0);
  });

  it('determinism: two fresh instances, same input, bit-identical output', () => {
    const params: DelayParams = { mode: 'pingpong', timeMs: 15, feedback: 0.5, damping: 0.5 };
    const frames = 4000;
    const inL = sine(330, 0.6, frames);
    const inR = sine(330, 0.6, frames);
    const a = new Delay(params, FS);
    const b = new Delay(params, FS);
    const outLa = new Float32Array(frames);
    const outRa = new Float32Array(frames);
    const outLb = new Float32Array(frames);
    const outRb = new Float32Array(frames);
    a.process(inL.slice(), inR.slice(), outLa, outRa, frames);
    b.process(inL.slice(), inR.slice(), outLb, outRb, frames);
    for (let i = 0; i < frames; i++) {
      expect(outLb[i]).toBe(outLa[i]);
      expect(outRb[i]).toBe(outRa[i]);
    }
  });

  it('reset() restores initial state exactly', () => {
    const params: DelayParams = { mode: 'pingpong', timeMs: 15, feedback: 0.5, damping: 0.5 };
    const delay = new Delay(params, FS);
    const frames = 4000;
    const input = sine(330, 0.6, frames);

    const inLa = input.slice();
    const inRa = input.slice();
    const outLa = new Float32Array(frames);
    const outRa = new Float32Array(frames);
    delay.process(inLa, inRa, outLa, outRa, frames);

    delay.reset();

    const inLb = input.slice();
    const inRb = input.slice();
    const outLb = new Float32Array(frames);
    const outRb = new Float32Array(frames);
    delay.process(inLb, inRb, outLb, outRb, frames);

    for (let i = 0; i < frames; i++) {
      expect(outLb[i]).toBe(outLa[i]);
      expect(outRb[i]).toBe(outRa[i]);
    }
  });

  it('matches the twin reference (DEFAULT_MASTER_CONFIG.delay, second echo)', () => {
    const params = DEFAULT_MASTER_CONFIG.delay;
    const D = delaySamplesFor(params);
    const delay = new Delay(params, FS);
    const frames = 2 * D + 8;
    const inL = new Float32Array(frames);
    const inR = new Float32Array(frames);
    inL[0] = 1;
    const outL = new Float32Array(frames);
    const outR = new Float32Array(frames);
    delay.process(inL, inR, outL, outR, frames);

    const start = 2 * D - 4;
    const capturedL = outL.subarray(start, start + 8);
    const capturedR = outR.subarray(start, start + 8);
    expect(TWIN_DELAY_L).toHaveLength(8);
    expect(TWIN_DELAY_R).toHaveLength(8);
    TWIN_DELAY_L.forEach((v, i) => expect(capturedL[i]).toBeCloseTo(v, 6));
    TWIN_DELAY_R.forEach((v, i) => expect(capturedR[i]).toBeCloseTo(v, 6));
  });
});
