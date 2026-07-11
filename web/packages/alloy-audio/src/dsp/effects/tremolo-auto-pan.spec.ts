import { describe, expect, it } from 'vitest';
import { validateInsert, type TremoloParams } from './effect-types.js';
import { TremoloAutoPan } from './tremolo-auto-pan.js';

const FS = 48_000;

const TWIN_REFERENCE_L: number[] = [
  -0.24551498889923096, -0.25025153160095215, -0.25415417551994324, -0.25721076130867004, -0.25941193103790283,
  -0.2607511281967163, -0.2612246572971344, -0.2608318030834198,
];
const TWIN_REFERENCE_R: number[] = [
  -0.15161016583442688, -0.1546478569507599, -0.15717428922653198, -0.15918081998825073, -0.16066047549247742,
  -0.16160807013511658, -0.16202014684677124, -0.16189506649971008,
];

function sine(freq: number, amp: number, frames: number, sampleRate: number): Float32Array {
  const out = new Float32Array(frames);
  for (let i = 0; i < frames; i++) {
    out[i] = amp * Math.sin((2 * Math.PI * freq * i) / sampleRate);
  }
  return out;
}

describe('TremoloAutoPan', () => {
  it('spread 0 keeps L and R exactly identical (classic tremolo)', () => {
    const params: TremoloParams = { rateHz: 3, depth: 0.6, spread: 0 };
    const tremolo = new TremoloAutoPan(params, FS);
    const mono = sine(220, 0.7, 1000, FS);
    const left = mono.slice();
    const right = mono.slice();
    tremolo.process(left, right, 1000);
    for (let i = 0; i < 1000; i++) {
      expect(left[i]).toBe(right[i]);
    }
  });

  it('spread 1 is anti-phase: at quarter phase, one channel is at min gain while the other is at max', () => {
    // rate 1 Hz at fs 1000 => phase advances by exactly 1/1000 per sample,
    // so phase == i / 1000 for sample i (hand-computable quarter points).
    const params: TremoloParams = { rateHz: 1, depth: 1, spread: 1 };
    const tremolo = new TremoloAutoPan(params, 1000);
    const frames = 1000;
    const left = new Float32Array(frames).fill(1);
    const right = new Float32Array(frames).fill(1);
    tremolo.process(left, right, frames);

    // phase 0.25 (index 250): gainL = 1 - (0.5 + 0.5*sin(pi/2)) = 0 (min),
    // gainR = 1 - (0.5 + 0.5*sin(pi/2 + pi)) = 1 (max).
    expect(left[250]).toBeCloseTo(0, 6);
    expect(right[250]).toBeCloseTo(1, 6);

    // phase 0.75 (index 750): gainL = 1 - (0.5 + 0.5*sin(3pi/2)) = 1 (max),
    // gainR = 1 - (0.5 + 0.5*sin(3pi/2 + pi)) = 0 (min).
    expect(left[750]).toBeCloseTo(1, 6);
    expect(right[750]).toBeCloseTo(0, 6);
  });

  it('depth 0 is an exact bypass', () => {
    const params: TremoloParams = { rateHz: 4.2, depth: 0, spread: 0.5 };
    const tremolo = new TremoloAutoPan(params, FS);
    const left = sine(440, 0.5, 512, FS);
    const right = sine(330, 0.4, 512, FS);
    const originalLeft = left.slice();
    const originalRight = right.slice();
    tremolo.process(left, right, 512);
    for (let i = 0; i < 512; i++) {
      expect(left[i]).toBe(originalLeft[i]);
      expect(right[i]).toBe(originalRight[i]);
    }
  });

  it('reset() restores initial state exactly', () => {
    const params: TremoloParams = { rateHz: 2.7, depth: 0.5, spread: 0.3 };
    const tremolo = new TremoloAutoPan(params, FS);
    const input = sine(330, 0.6, 512, FS);

    const leftA = input.slice();
    const rightA = input.slice();
    tremolo.process(leftA, rightA, 512);

    tremolo.reset();

    const leftB = input.slice();
    const rightB = input.slice();
    tremolo.process(leftB, rightB, 512);

    for (let i = 0; i < 512; i++) {
      expect(leftB[i]).toBe(leftA[i]);
      expect(rightB[i]).toBe(rightA[i]);
    }
  });

  it('validateInsert enforces tremolo bounds', () => {
    expect(validateInsert({ kind: 'tremolo', tremolo: { rateHz: 0, depth: 0.5, spread: 0.5 } })).not.toHaveLength(0);
    expect(validateInsert({ kind: 'tremolo', tremolo: { rateHz: 41, depth: 0.5, spread: 0.5 } })).not.toHaveLength(0);
    expect(validateInsert({ kind: 'tremolo', tremolo: { rateHz: 5, depth: -0.1, spread: 0.5 } })).not.toHaveLength(0);
    expect(validateInsert({ kind: 'tremolo', tremolo: { rateHz: 5, depth: 1.1, spread: 0.5 } })).not.toHaveLength(0);
    expect(validateInsert({ kind: 'tremolo', tremolo: { rateHz: 5, depth: 0.5, spread: -0.1 } })).not.toHaveLength(0);
    expect(validateInsert({ kind: 'tremolo', tremolo: { rateHz: 5, depth: 0.5, spread: 1.1 } })).not.toHaveLength(0);
    expect(validateInsert({ kind: 'tremolo', tremolo: { rateHz: 5, depth: 0.5, spread: 0.5 } })).toEqual([]);
  });

  it('matches the twin reference (rate 5.5 depth 0.7 spread 0.5)', () => {
    const params: TremoloParams = { rateHz: 5.5, depth: 0.7, spread: 0.5 };
    const tremolo = new TremoloAutoPan(params, FS);
    const warmupFrames = 512;
    const captureFrames = 8;
    const totalFrames = warmupFrames + captureFrames;
    const input = sine(440, 0.5, totalFrames, FS);
    const left = input.slice();
    const right = input.slice();
    tremolo.process(left, right, totalFrames);
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
