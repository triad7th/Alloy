import { describe, expect, it } from 'vitest';
import { PolyBlepOscillator } from './poly-blep-oscillator.js';

const FS = 48_000;

const TWIN_REFERENCE: number[] = [0,-0.9816666841506958,-0.9633333086967468,-0.9449999928474426,-0.9266666769981384,-0.9083333611488342,-0.8899999856948853,-0.871666669845581];

function render(osc: PolyBlepOscillator, n: number): number[] {
  return Array.from({ length: n }, () => osc.nextSample());
}

describe('PolyBlepOscillator', () => {
  it('sine matches Math.sin exactly', () => {
    const osc = new PolyBlepOscillator('sine', FS);
    osc.setFrequency(440);
    const out = render(osc, 100);
    out.forEach((v, i) => {
      expect(v).toBeCloseTo(Math.sin((2 * Math.PI * 440 * i) / FS), 9);
    });
  });

  it('saw softens the reset step relative to a naive saw', () => {
    const osc = new PolyBlepOscillator('saw', FS);
    osc.setFrequency(2000);
    const out = render(osc, 200);
    let maxJump = 0;
    for (let i = 1; i < out.length; i++) {
      maxJump = Math.max(maxJump, Math.abs(out[i] - out[i - 1]));
    }
    // Naive saw at 2 kHz/48 kHz jumps by 2 at reset; polyBLEP spreads it.
    expect(maxJump).toBeLessThan(1.4);
    expect(maxJump).toBeGreaterThan(0.2);
  });

  it('pulse mean tracks pulse width', () => {
    const osc = new PolyBlepOscillator('pulse', FS, 0, 0.25);
    osc.setFrequency(100);
    const out = render(osc, 4800); // 10 full cycles
    const mean = out.reduce((a, b) => a + b, 0) / out.length;
    expect(mean).toBeCloseTo(2 * 0.25 - 1, 1);
  });

  it('honors the initial phase', () => {
    const a = new PolyBlepOscillator('sine', FS, 0.25);
    a.setFrequency(440);
    expect(a.nextSample()).toBeCloseTo(1, 9);
  });

  it('matches the twin reference (saw 440 Hz)', () => {
    const osc = new PolyBlepOscillator('saw', FS);
    osc.setFrequency(440);
    const out = new Float32Array(8);
    for (let i = 0; i < 8; i++) out[i] = osc.nextSample();
    // console.log(JSON.stringify(Array.from(out.subarray(0, 8))));
    expect(TWIN_REFERENCE).toHaveLength(8);
    TWIN_REFERENCE.forEach((v, i) => expect(out[i]).toBeCloseTo(v, 6));
  });
});
