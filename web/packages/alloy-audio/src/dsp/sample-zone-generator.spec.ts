import { describe, expect, it } from 'vitest';
import { SampleZoneGenerator, type VelocityLayerData } from './sample-zone-generator.js';

const FS = 48_000;

const TWIN_REFERENCE: number[] = [
  0, 0.025196194648742676, 0.05756402760744095, 0.08628634363412857, 0.11493714898824692,
  0.14349259436130524, 0.17192910611629486, 0.2002229541540146,
];

/** Mono sine test asset: `cycles` full cycles over `length` samples. */
function sineZone(rootMidi: number, length: number, cycles: number, loop = false) {
  const data = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    data[i] = Math.sin((2 * Math.PI * cycles * i) / length);
  }
  return loop
    ? { rootMidi, sampleRate: FS, data, loopStart: 0, loopEnd: length }
    : { rootMidi, sampleRate: FS, data };
}

function constantZone(rootMidi: number, value: number, length = 4800) {
  const data = new Float32Array(length).fill(value);
  return { rootMidi, sampleRate: FS, data, loopStart: 0, loopEnd: length };
}

function oneLayer(zone: ReturnType<typeof sineZone>): VelocityLayerData[] {
  return [{ topVelocity: 1, zones: [zone] }];
}

function render(gen: SampleZoneGenerator, frames: number): Float32Array {
  const out = new Float32Array(frames);
  gen.render(out, frames);
  return out;
}

function zeroCrossings(out: Float32Array): number {
  let count = 0;
  for (let i = 1; i < out.length; i++) {
    if (out[i - 1] < 0 && out[i] >= 0) count += 1;
  }
  return count;
}

describe('SampleZoneGenerator', () => {
  it('plays a root-pitch note back at unity rate', () => {
    const gen = new SampleZoneGenerator(oneLayer(sineZone(69, 4800, 44)), 0, FS);
    gen.noteOn(69, 1);
    const out = render(gen, 4796); // stay clear of the unlooped tail
    const zone = sineZone(69, 4800, 44);
    for (let i = 1; i < 4700; i++) {
      expect(out[i]).toBeCloseTo(zone.data[i], 3); // cubic interp ≈ identity on-grid
    }
  });

  it('an octave up doubles the playback rate', () => {
    const gen = new SampleZoneGenerator(oneLayer(sineZone(69, 48_000, 440, true)), 0, FS);
    gen.noteOn(81, 1);
    const out = render(gen, 48_000);
    const crossings = zeroCrossings(out);
    expect(crossings).toBeGreaterThan(830);
    expect(crossings).toBeLessThan(930); // ≈ 880
  });

  it('looped zones sustain past the buffer length and never finish', () => {
    const gen = new SampleZoneGenerator(oneLayer(sineZone(69, 4800, 44, true)), 0, FS);
    gen.noteOn(69, 1);
    render(gen, 4800 * 3);
    expect(gen.finished).toBe(false);
    const later = render(gen, 256);
    expect(Math.max(...Array.from(later, Math.abs))).toBeGreaterThan(0.1);
  });

  it('unlooped zones finish at end of data and go silent', () => {
    const gen = new SampleZoneGenerator(oneLayer(sineZone(69, 4800, 44)), 0, FS);
    gen.noteOn(69, 1);
    render(gen, 4800 + 64);
    expect(gen.finished).toBe(true);
    render(gen, 64).forEach((v) => expect(v).toBe(0));
  });

  it('picks the nearest zone with lower-tie-break', () => {
    const layers: VelocityLayerData[] = [
      { topVelocity: 1, zones: [constantZone(60, 0.25), constantZone(64, 0.75)] },
    ];
    const gen = new SampleZoneGenerator(layers, 0, FS);
    gen.noteOn(62, 1); // equidistant: must prefer the lower zone (60)
    const out = render(gen, 16);
    expect(out[4]).toBeCloseTo(0.25, 3);
  });

  it('selects velocity layers and crossfades at the boundary', () => {
    const layers: VelocityLayerData[] = [
      { topVelocity: 0.5, zones: [constantZone(60, 0.2)] },
      { topVelocity: 1, zones: [constantZone(60, 0.8)] },
    ];
    const soft = new SampleZoneGenerator(layers, 0, FS);
    soft.noteOn(60, 0.3);
    expect(render(soft, 16)[4]).toBeCloseTo(0.2 * 0.3, 3);

    const hard = new SampleZoneGenerator(layers, 0, FS);
    hard.noteOn(60, 0.9);
    expect(render(hard, 16)[4]).toBeCloseTo(0.8 * 0.9, 3);

    const blended = new SampleZoneGenerator(layers, 0.2, FS);
    blended.noteOn(60, 0.5); // exactly on the boundary -> 50/50 blend
    expect(render(blended, 16)[4]).toBeCloseTo((0.2 * 0.5 + 0.8 * 0.5) * 0.5, 2);
  });

  it('treats a zero-length loop region as a one-shot instead of hanging', () => {
    const zone = { rootMidi: 69, sampleRate: FS, data: new Float32Array(480).fill(0.5), loopStart: 100, loopEnd: 100 };
    const gen = new SampleZoneGenerator([{ topVelocity: 1, zones: [zone] }], 0, FS);
    gen.noteOn(69, 1);
    render(gen, 600); // must return, not hang
    expect(gen.finished).toBe(true);
  });

  it('matches the twin reference (octave-down sine, looped)', () => {
    const gen = new SampleZoneGenerator(oneLayer(sineZone(69, 4800, 44, true)), 0, FS);
    gen.noteOn(57, 1);
    const out = render(gen, 8);
    // console.log(JSON.stringify(Array.from(out.subarray(0, 8))));
    expect(TWIN_REFERENCE).toHaveLength(8);
    TWIN_REFERENCE.forEach((v, i) => expect(out[i]).toBeCloseTo(v, 6));
  });
});
