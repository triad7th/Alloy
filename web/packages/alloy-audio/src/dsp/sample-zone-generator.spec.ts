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

    // Equal-power blend: on the boundary BOTH gains are sqrt(0.5) = 0.707, not
    // 0.5 -- uncorrelated layers add in power, so linear gains would notch ~3 dB.
    const blended = new SampleZoneGenerator(layers, 0.2, FS);
    blended.noteOn(60, 0.5); // exactly on the boundary -> 50/50 blend
    expect(render(blended, 16)[4]).toBeCloseTo((0.2 * Math.SQRT1_2 + 0.8 * Math.SQRT1_2) * 0.5, 2);
  });

  it('equal-power crossfade never dips below the single-layer level, and converges to it at the window edge', () => {
    // Both zones hold 1.0, so the rendered sample is exactly (gLower + gUpper)
    // once the velocity gain is stripped -- i.e. the test observes the gain law
    // directly. The OLD linear law made that sum 1 everywhere in the window,
    // which for uncorrelated layers is the ~3 dB hole this test guards.
    const layers: VelocityLayerData[] = [
      { topVelocity: 0.5, zones: [constantZone(60, 1)] },
      { topVelocity: 1, zones: [constantZone(60, 1)] },
    ];
    const gainSum = (velocity: number): number => {
      const gen = new SampleZoneGenerator(layers, 0.2, FS);
      gen.noteOn(60, velocity);
      return render(gen, 16)[4] / velocity;
    };

    // Exactly on the boundary: both gains sqrt(0.5), so the sum is sqrt(2).
    expect(gainSum(0.5)).toBeCloseTo(Math.SQRT2, 4);

    // Across the whole window the gains satisfy g^2 + g^2 = 1, so the sum stays
    // within [1, sqrt(2)] and NEVER falls under 1 (the single-layer level).
    for (const velocity of [0.45, 0.475, 0.5, 0.525, 0.549]) {
      const sum = gainSum(velocity);
      expect(sum).toBeGreaterThanOrEqual(1);
      expect(sum).toBeLessThanOrEqual(Math.SQRT2 + 1e-9);
    }

    // Continuity: just outside the window a single clean layer plays at gain 1,
    // and the blend converges DOWN to that as it approaches the edge from inside
    // (the fading gain is sqrt(1-u), so it approaches 0 with a vertical tangent —
    // the convergence is real but slow, hence a monotone check, not a fixed bound).
    expect(gainSum(0.61)).toBeCloseTo(1, 6); // distance 0.11 > crossfade/2 -> no blend
    const approach = [0.55, 0.59, 0.599, 0.5999, 0.59999].map(gainSum);
    for (const sum of approach) expect(sum).toBeGreaterThan(1); // never dips
    for (let i = 1; i < approach.length; i++) {
      expect(approach[i]).toBeLessThan(approach[i - 1]); // strictly converging to 1
    }
    expect(approach[approach.length - 1]).toBeLessThan(1.01);
  });

  it('treats a zero-length loop region as a one-shot instead of hanging', () => {
    const zone = { rootMidi: 69, sampleRate: FS, data: new Float32Array(480).fill(0.5), loopStart: 100, loopEnd: 100 };
    const gen = new SampleZoneGenerator([{ topVelocity: 1, zones: [zone] }], 0, FS);
    gen.noteOn(69, 1);
    render(gen, 600); // must return, not hang
    expect(gen.finished).toBe(true);
  });

  it('setPitchRatio(2) equals playing an octave higher', () => {
    const bent = new SampleZoneGenerator(oneLayer(sineZone(69, 48_000, 440, true)), 0, FS);
    bent.noteOn(60, 1);
    bent.setPitchRatio(2);
    const reference = new SampleZoneGenerator(oneLayer(sineZone(69, 48_000, 440, true)), 0, FS);
    reference.noteOn(72, 1);
    const a = render(bent, 512);
    const b = render(reference, 512);
    for (let i = 0; i < 512; i++) expect(a[i]).toBeCloseTo(b[i], 9);
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
