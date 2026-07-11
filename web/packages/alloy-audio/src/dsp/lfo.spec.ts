import { describe, expect, it } from 'vitest';
import { Lfo } from './lfo.js';

const FS = 1000; // low rate keeps hand math easy

const TWIN_REFERENCE: number[] = [0, 0.30901700258255005, 0.5877852439880371, 0.80901700258255, 0.9510565400123596, 1, 0.9510565400123596, 0.80901700258255];

describe('Lfo', () => {
  it('outputs zero during the delay window', () => {
    const lfo = new Lfo({ shape: 'sine', rateHz: 10, delay: 0.1, fadeIn: 0 }, FS);
    for (let i = 0; i < 100; i++) {
      expect(lfo.nextSample()).toBe(0);
    }
    expect(lfo.nextSample()).not.toBe(0);
  });

  it('fades depth in linearly after the delay', () => {
    const lfo = new Lfo({ shape: 'triangle', rateHz: 1, delay: 0, fadeIn: 1 }, FS);
    const out = Array.from({ length: 260 }, () => lfo.nextSample());
    // At 1 Hz triangle, sample 250 is the crest (+1 raw); fade gate there is 0.25.
    expect(out[250]).toBeCloseTo(0.25, 2);
  });

  it('stays within [-1, 1] and is periodic', () => {
    const lfo = new Lfo({ shape: 'sine', rateHz: 50, delay: 0, fadeIn: 0 }, FS);
    const out = Array.from({ length: 200 }, () => lfo.nextSample());
    out.forEach((v) => {
      expect(Math.abs(v)).toBeLessThanOrEqual(1);
    });
    // 50 Hz at 1 kHz -> period 20 samples.
    for (let i = 0; i < 100; i++) {
      expect(out[i]).toBeCloseTo(out[i + 20], 9);
    }
  });

  it('matches the twin reference (sine 50 Hz, no gate)', () => {
    const lfo = new Lfo({ shape: 'sine', rateHz: 50, delay: 0, fadeIn: 0 }, FS);
    const out = new Float32Array(8);
    for (let i = 0; i < 8; i++) out[i] = lfo.nextSample();
    // console.log(JSON.stringify(Array.from(out.subarray(0, 8))));
    expect(TWIN_REFERENCE).toHaveLength(8);
    TWIN_REFERENCE.forEach((v, i) => expect(out[i]).toBeCloseTo(v, 6));
  });
});
