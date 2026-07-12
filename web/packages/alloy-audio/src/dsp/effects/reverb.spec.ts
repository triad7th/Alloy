import { describe, expect, it } from 'vitest';
import { Reverb } from './reverb.js';
import { DEFAULT_MASTER_CONFIG } from './effect-types.js';

const FS = 48_000;
const R = () => new Reverb(DEFAULT_MASTER_CONFIG.reverb, FS);

const TWIN_REVERB_L: number[] = [
  -0.13816002011299133, -0.14837245643138885, -0.15830713510513306, -0.1681739240884781,
  -0.17760393023490906, -0.18658016622066498, -0.19507570564746857, -0.20310428738594055,
];
const TWIN_REVERB_R: number[] = [
  -0.2664816975593567, -0.27564600110054016, -0.2845517694950104, -0.2928687632083893,
  -0.30044007301330566, -0.30745768547058105, -0.3139910101890564, -0.3200846016407013,
];

function sine(freq: number, amp: number, frames: number): Float32Array {
  const out = new Float32Array(frames);
  for (let i = 0; i < frames; i++) out[i] = amp * Math.sin((2 * Math.PI * freq * i) / FS);
  return out;
}

function rms(values: Float32Array, start: number, length: number): number {
  let sumSq = 0;
  for (let i = start; i < start + length; i++) {
    sumSq += values[i] * values[i];
  }
  return Math.sqrt(sumSq / length);
}

describe('Reverb', () => {
  it('silence in -> silence out exactly 0', () => {
    const reverb = R();
    const frames = 4096;
    const inL = new Float32Array(frames);
    const inR = new Float32Array(frames);
    const outL = new Float32Array(frames);
    const outR = new Float32Array(frames);
    reverb.process(inL, inR, outL, outR, frames);
    for (let i = 0; i < frames; i++) {
      expect(outL[i]).toBe(0);
      expect(outR[i]).toBe(0);
    }
  });

  it('impulse energy decays: bounded, tail RMS < 1e-3', () => {
    const reverb = R();
    const frames = 96_000;
    const inL = new Float32Array(frames);
    const inR = new Float32Array(frames);
    inL[0] = 1;
    inR[0] = 1;
    const outL = new Float32Array(frames);
    const outR = new Float32Array(frames);
    reverb.process(inL, inR, outL, outR, frames);

    const earlyRms = rms(outL, 0, 4800);
    const tailRms = rms(outL, 91_200, 4800);
    expect(earlyRms).toBeGreaterThan(tailRms);
    expect(tailRms).toBeLessThan(1e-3);

    // Bounded: no self-oscillation / NaN / runaway anywhere in the render.
    for (let i = 0; i < frames; i++) {
      expect(Number.isFinite(outL[i])).toBe(true);
      expect(Number.isFinite(outR[i])).toBe(true);
      expect(Math.abs(outL[i])).toBeLessThan(10);
      expect(Math.abs(outR[i])).toBeLessThan(10);
    }
  });

  it('stereo decorrelation: outL and outR are not identical everywhere', () => {
    const reverb = R();
    const frames = 8000;
    const inL = new Float32Array(frames);
    const inR = new Float32Array(frames);
    inL[0] = 1;
    inR[0] = 1;
    const outL = new Float32Array(frames);
    const outR = new Float32Array(frames);
    reverb.process(inL, inR, outL, outR, frames);

    let identical = true;
    for (let i = 0; i < frames; i++) {
      if (outL[i] !== outR[i]) {
        identical = false;
        break;
      }
    }
    expect(identical).toBe(false);
  });

  it('determinism: two fresh instances, same input, bit-identical output', () => {
    const frames = 4000;
    const inL = sine(330, 0.6, frames);
    const inR = sine(330, 0.6, frames);
    const a = R();
    const b = R();
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
    const reverb = R();
    const frames = 4000;
    const input = sine(330, 0.6, frames);

    const inLa = input.slice();
    const inRa = input.slice();
    const outLa = new Float32Array(frames);
    const outRa = new Float32Array(frames);
    reverb.process(inLa, inRa, outLa, outRa, frames);

    reverb.reset();

    const inLb = input.slice();
    const inRb = input.slice();
    const outLb = new Float32Array(frames);
    const outRb = new Float32Array(frames);
    reverb.process(inLb, inRb, outLb, outRb, frames);

    for (let i = 0; i < frames; i++) {
      expect(outLb[i]).toBe(outLa[i]);
      expect(outRb[i]).toBe(outRa[i]);
    }
  });

  it('matches the twin reference (DEFAULT_MASTER_CONFIG.reverb, 220 Hz sine warmup)', () => {
    const reverb = R();
    const warmupFrames = 4000;
    const captureFrames = 8;
    const totalFrames = warmupFrames + captureFrames;
    const inL = sine(220, 0.5, totalFrames);
    const inR = sine(220, 0.5, totalFrames);
    const outL = new Float32Array(totalFrames);
    const outR = new Float32Array(totalFrames);
    reverb.process(inL, inR, outL, outR, totalFrames);
    const capturedL = outL.subarray(warmupFrames, warmupFrames + captureFrames);
    const capturedR = outR.subarray(warmupFrames, warmupFrames + captureFrames);
    // console.log(JSON.stringify(Array.from(capturedL)));
    // console.log(JSON.stringify(Array.from(capturedR)));
    expect(TWIN_REVERB_L).toHaveLength(8);
    expect(TWIN_REVERB_R).toHaveLength(8);
    TWIN_REVERB_L.forEach((v, i) => expect(capturedL[i]).toBeCloseTo(v, 6));
    TWIN_REVERB_R.forEach((v, i) => expect(capturedR[i]).toBeCloseTo(v, 6));
  });
});
