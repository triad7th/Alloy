import { describe, expect, it } from 'vitest';
import { Svf } from './svf.js';

const FS = 48_000;

const TWIN_REFERENCE: number[] = [0,0.00022542514489032328,0.001310171326622367,0.0039899712428450584,0.008845254778862,0.016315346583724022,0.026712505146861076,0.040235623717308044];

function rms(xs: number[]): number {
  return Math.sqrt(xs.reduce((a, x) => a + x * x, 0) / xs.length);
}

function renderSine(filter: Svf, freq: number, n: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    out.push(filter.process(Math.sin((2 * Math.PI * freq * i) / FS)));
  }
  return out.slice(Math.floor(n / 2)); // discard transient
}

describe('Svf', () => {
  it('lowpass passes DC', () => {
    const f = new Svf('lowpass', FS);
    f.setParams(1000, 0.707);
    let y = 0;
    for (let i = 0; i < 4800; i++) y = f.process(1);
    expect(y).toBeCloseTo(1, 3);
  });

  it('highpass blocks DC', () => {
    const f = new Svf('highpass', FS);
    f.setParams(1000, 0.707);
    let y = 1;
    for (let i = 0; i < 4800; i++) y = f.process(1);
    expect(Math.abs(y)).toBeLessThan(1e-3);
  });

  it('lowpass attenuates far-above-cutoff content', () => {
    const f = new Svf('lowpass', FS);
    f.setParams(500, 0.707);
    const out = renderSine(f, 10_000, 9600);
    expect(rms(out)).toBeLessThan(0.05);
  });

  it('bandpass peaks at the cutoff and rejects far bands', () => {
    const make = () => {
      const f = new Svf('bandpass', FS);
      f.setParams(1000, 4);
      return f;
    };
    const atCenter = rms(renderSine(make(), 1000, 9600));
    const below = rms(renderSine(make(), 100, 9600));
    const above = rms(renderSine(make(), 10_000, 9600));
    expect(atCenter).toBeGreaterThan(below * 5);
    expect(atCenter).toBeGreaterThan(above * 5);
  });

  it('survives per-sample cutoff modulation without blowing up', () => {
    const f = new Svf('lowpass', FS);
    let peak = 0;
    for (let i = 0; i < 48_000; i++) {
      f.setParams(500 + 8000 * (0.5 + 0.5 * Math.sin(i / 40)), 4);
      peak = Math.max(peak, Math.abs(f.process(Math.sin(i / 3))));
    }
    expect(peak).toBeLessThan(4);
  });

  it('passes signal before setParams is called (open lowpass default)', () => {
    const f = new Svf('lowpass', FS);
    const out: number[] = [];
    for (let i = 0; i < 480; i++) out.push(f.process(Math.sin((2 * Math.PI * 440 * i) / FS)));
    const settled = out.slice(240);
    expect(Math.max(...settled.map(Math.abs))).toBeGreaterThan(0.9);
  });

  it('matches the twin reference (lowpass 1 kHz on a 440 Hz sine)', () => {
    const f = new Svf('lowpass', FS);
    f.setParams(1000, 0.707);
    const out = new Float32Array(8);
    for (let i = 0; i < 8; i++) out[i] = f.process(Math.sin((2 * Math.PI * 440 * i) / FS));
    // console.log(JSON.stringify(Array.from(out.subarray(0, 8))));
    expect(TWIN_REFERENCE).toHaveLength(8);
    TWIN_REFERENCE.forEach((v, i) => expect(out[i]).toBeCloseTo(v, 6));
  });
});
