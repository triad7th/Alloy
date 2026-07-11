import { describe, expect, it } from 'vitest';
import { DspPrng } from './prng.js';

// Filled via the twin reference workflow (integer-exact: tolerance 0).
const TWIN_REFERENCE: number[] = [0.00006295018829405308,0.015747428173199296,0.6164041024167091,0.07161863497458398,0.5584883580449969,0.17357419803738594,0.14725036034360528,0.10145739885047078];

describe('DspPrng', () => {
  it('is deterministic for a given seed', () => {
    const a = new DspPrng(42);
    const b = new DspPrng(42);
    for (let i = 0; i < 100; i++) {
      expect(a.next()).toBe(b.next());
    }
  });

  it('yields different sequences for different seeds', () => {
    const a = new DspPrng(1);
    const b = new DspPrng(2);
    const same = Array.from({ length: 10 }, () => a.next() === b.next());
    expect(same).toContain(false);
  });

  it('stays in [0, 1)', () => {
    const prng = new DspPrng(7);
    for (let i = 0; i < 10_000; i++) {
      const v = prng.next();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('treats seed 0 as a nonzero default (xorshift fixed point guard)', () => {
    const prng = new DspPrng(0);
    expect(prng.next()).not.toBe(0);
  });

  it('matches the twin reference sequence (seed 1)', () => {
    const prng = new DspPrng(1);
    const out = Array.from({ length: 8 }, () => prng.next());
    expect(TWIN_REFERENCE).toHaveLength(8);
    TWIN_REFERENCE.forEach((v, i) => expect(out[i]).toBe(v));
  });
});
