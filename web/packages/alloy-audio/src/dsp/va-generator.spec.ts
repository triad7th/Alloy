import { describe, expect, it } from 'vitest';
import { PolyBlepOscillator } from './poly-blep-oscillator.js';
import { VaGenerator } from './va-generator.js';

const FS = 48_000;

const TWIN_REFERENCE: number[] = [
  -0.6720842123031616, -1.0865157842636108, -1.0660182237625122, -1.0455206632614136,
  -1.0250232219696045, -1.0045256614685059, -0.9840281009674072, -0.9635306000709534,
];

function render(gen: VaGenerator, frames: number): Float32Array {
  const out = new Float32Array(frames);
  gen.render(out, frames);
  return out;
}

describe('VaGenerator', () => {
  it('unison 1 with no detune equals a single polyBLEP saw', () => {
    const gen = new VaGenerator({ shape: 'saw', unison: 1, detuneCents: 0 }, FS);
    gen.noteOn(69, 1);
    const out = render(gen, 256);
    const osc = new PolyBlepOscillator('saw', FS, referencePhaseForSeed1());
    osc.setFrequency(440);
    for (let i = 0; i < 256; i++) {
      expect(out[i]).toBeCloseTo(osc.nextSample(), 5);
    }
  });

  it('is deterministic for a given seed and differs across seeds', () => {
    const a = new VaGenerator({ shape: 'saw', unison: 5, detuneCents: 30 }, FS, 7);
    const b = new VaGenerator({ shape: 'saw', unison: 5, detuneCents: 30 }, FS, 7);
    const c = new VaGenerator({ shape: 'saw', unison: 5, detuneCents: 30 }, FS, 8);
    a.noteOn(60, 1);
    b.noteOn(60, 1);
    c.noteOn(60, 1);
    const outA = render(a, 256);
    const outB = render(b, 256);
    const outC = render(c, 256);
    for (let i = 0; i < 256; i++) {
      expect(outA[i]).toBe(outB[i]);
    }
    let differs = false;
    for (let i = 0; i < 256; i++) {
      if (outA[i] !== outC[i]) differs = true;
    }
    expect(differs).toBe(true);
  });

  it('unison output stays bounded by sqrt-scaling', () => {
    const gen = new VaGenerator({ shape: 'saw', unison: 7, detuneCents: 40 }, FS);
    gen.noteOn(60, 1);
    const out = render(gen, 48_000);
    const peak = Math.max(...Array.from(out, Math.abs));
    expect(peak).toBeLessThanOrEqual(Math.sqrt(7) + 0.2);
    expect(peak).toBeGreaterThan(0.3);
  });

  it('keeps sounding after noteOff and never self-finishes', () => {
    const gen = new VaGenerator({ shape: 'saw', unison: 3, detuneCents: 20 }, FS);
    gen.noteOn(60, 1);
    render(gen, 64);
    gen.noteOff();
    expect(gen.finished).toBe(false);
    const after = render(gen, 64);
    expect(Math.max(...Array.from(after, Math.abs))).toBeGreaterThan(0);
  });

  it('matches the twin reference (5-voice saw, seed 1)', () => {
    const gen = new VaGenerator({ shape: 'saw', unison: 5, detuneCents: 24 }, FS);
    gen.noteOn(57, 1);
    const out = render(gen, 8);
    // console.log(JSON.stringify(Array.from(out.subarray(0, 8))));
    expect(TWIN_REFERENCE).toHaveLength(8);
    TWIN_REFERENCE.forEach((v, i) => expect(out[i]).toBeCloseTo(v, 6));
  });
});

/** First DspPrng(1) draw — the phase VaGenerator gives its first oscillator. */
function referencePhaseForSeed1(): number {
  // Computed inline to avoid exporting internals: xorshift32(1) first output.
  let x = 1;
  x = (x ^ (x << 13)) >>> 0;
  x = (x ^ (x >>> 17)) >>> 0;
  x = (x ^ (x << 5)) >>> 0;
  return x / 4294967296;
}
