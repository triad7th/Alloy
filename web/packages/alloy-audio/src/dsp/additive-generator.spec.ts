import { describe, expect, it } from 'vitest';
import { AdditiveGenerator } from './additive-generator.js';

const FS = 48_000;

const TWIN_REFERENCE: number[] = [
  0, 0.04105590283870697, 0.0818713828921318, 0.12220834940671921, 0.1618332862854004,
  0.20051950216293335, 0.23804932832717896, 0.2742161452770233,
];

function render(gen: AdditiveGenerator, frames: number): Float32Array {
  const out = new Float32Array(frames);
  gen.render(out, frames);
  return out;
}

describe('AdditiveGenerator', () => {
  it('a single unit partial is a pure sine at the note frequency', () => {
    const gen = new AdditiveGenerator([{ ratio: 1, level: 1 }], FS);
    gen.noteOn(69, 1);
    const out = render(gen, 200);
    out.forEach((v, i) => {
      expect(v).toBeCloseTo(Math.sin((2 * Math.PI * 440 * i) / FS), 6);
    });
  });

  it('partials sum linearly', () => {
    const both = new AdditiveGenerator(
      [
        { ratio: 1, level: 0.5 },
        { ratio: 2, level: 0.25 },
      ],
      FS,
    );
    both.noteOn(60, 1);
    const out = render(both, 200);
    const f0 = midiHz(60);
    out.forEach((v, i) => {
      const expected =
        0.5 * Math.sin((2 * Math.PI * f0 * i) / FS) + 0.25 * Math.sin((2 * Math.PI * 2 * f0 * i) / FS);
      expect(v).toBeCloseTo(expected, 6);
    });
  });

  it('is silent before noteOn and keeps sounding after noteOff (TVA owns release)', () => {
    const gen = new AdditiveGenerator([{ ratio: 1, level: 1 }], FS);
    render(gen, 32).forEach((v) => expect(v).toBe(0));
    gen.noteOn(69, 1);
    render(gen, 32);
    gen.noteOff();
    expect(gen.finished).toBe(false);
    const after = render(gen, 32);
    expect(Math.max(...after.map(Math.abs))).toBeGreaterThan(0);
  });

  it('setPitchRatio(2) equals playing an octave higher', () => {
    const partials = [
      { ratio: 1, level: 0.6 },
      { ratio: 3, level: 0.2 },
    ];
    const bent = new AdditiveGenerator(partials, FS);
    bent.noteOn(60, 1);
    bent.setPitchRatio(2);
    const reference = new AdditiveGenerator(partials, FS);
    reference.noteOn(72, 1);
    const a = render(bent, 512);
    const b = render(reference, 512);
    for (let i = 0; i < 512; i++) expect(a[i]).toBeCloseTo(b[i], 9);
  });

  it('matches the twin reference (two partials, midi 60)', () => {
    const gen = new AdditiveGenerator(
      [
        { ratio: 1, level: 0.6 },
        { ratio: 3, level: 0.2 },
      ],
      FS,
    );
    gen.noteOn(60, 1);
    const out = render(gen, 8);
    // console.log(JSON.stringify(Array.from(out.subarray(0, 8))));
    expect(TWIN_REFERENCE).toHaveLength(8);
    TWIN_REFERENCE.forEach((v, i) => expect(out[i]).toBeCloseTo(v, 6));
  });
});

function midiHz(midi: number): number {
  return 440 * 2 ** ((midi - 69) / 12);
}
