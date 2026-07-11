import { describe, expect, it } from 'vitest';
import { AdditiveGenerator } from './additive-generator.js';
import { AdsrEnvelope, type AdsrParams } from './adsr-envelope.js';
import { PATCH_SCHEMA_VERSION, type Patch, type PatchLayer } from './patch.js';
import { FIXTURE_PATCH_JSON } from './testing/fixtures.js';
import { CONTROL_INTERVAL, Voice, type ZoneSetProvider } from './voice.js';

const FS = 48_000;

const TWIN_REFERENCE: number[] = [
  -0.00000528768669028068, -0.00004836813241126947, -0.00027252416475676, -0.0008509701583534479,
  -0.0019434844143688679, -0.003815143136307597, -0.006873433478176594, -0.011534090153872967,
];

const FULL_KEY = { lowMidi: 0, highMidi: 127 };
const FULL_VEL = { low: 0, high: 1 };
const ADSR: AdsrParams = { attack: 0.005, decay: 0.2, sustain: 0.7, release: 0.2 };

function makePatch(layers: PatchLayer[]): Patch {
  return {
    schemaVersion: PATCH_SCHEMA_VERSION,
    meta: { id: 'test.voice', name: 'Voice Test', category: 'melodic' },
    layers,
    sends: { reverb: 0, delay: 0 },
  };
}

function render(voice: Voice, frames: number): Float32Array {
  const out = new Float32Array(frames);
  voice.render(out, frames);
  return out;
}

function rms(samples: ArrayLike<number>, from: number, to: number): number {
  let sum = 0;
  for (let i = from; i < to; i++) {
    sum += samples[i] * samples[i];
  }
  return Math.sqrt(sum / (to - from));
}

describe('Voice', () => {
  it('exports the control interval used by the modulation tick', () => {
    expect(CONTROL_INTERVAL).toBe(16);
  });

  // 1. Layer selection: two layers with disjoint key ranges; noteOn(40) sounds only layer A.
  it('sounds only the layer whose key range contains the note', () => {
    const layerA: PatchLayer = {
      keyRange: { lowMidi: 0, highMidi: 59 },
      velRange: FULL_VEL,
      generator: { kind: 'additive', partials: [{ ratio: 1, level: 1 }] },
      tva: { level: 0.8, adsr: ADSR, velCurve: 1 },
    };
    const layerB: PatchLayer = {
      keyRange: { lowMidi: 60, highMidi: 127 },
      velRange: FULL_VEL,
      generator: { kind: 'additive', partials: [{ ratio: 2, level: 1 }] },
      tva: { level: 0.8, adsr: ADSR, velCurve: 1 },
    };
    const voice = new Voice(makePatch([layerA, layerB]), FS);
    voice.noteOn(40, 1);
    const out = render(voice, 64);
    // Hand-built equivalent of layer A: bare generator * per-sample TVA * level.
    const gen = new AdditiveGenerator([{ ratio: 1, level: 1 }], FS);
    const env = new AdsrEnvelope(ADSR, FS);
    gen.noteOn(40, 1);
    env.noteOn();
    const scratch = new Float32Array(64);
    gen.render(scratch, 64);
    for (let i = 0; i < 64; i++) {
      expect(out[i]).toBeCloseTo(scratch[i] * env.nextSample() * 0.8, 6);
    }
  });

  // 2. Velocity residual: velCurve 2 at velocity 0.5 is exactly velocity^(2-1) = 0.5x the velCurve-1 render.
  it('applies the perceptual velocity residual velocity^(velCurve - 1)', () => {
    const layerWithCurve = (velCurve: number): PatchLayer => ({
      keyRange: FULL_KEY,
      velRange: FULL_VEL,
      generator: { kind: 'additive', partials: [{ ratio: 1, level: 1 }] },
      tva: { level: 0.8, adsr: ADSR, velCurve },
    });
    const curved = new Voice(makePatch([layerWithCurve(2)]), FS);
    const linear = new Voice(makePatch([layerWithCurve(1)]), FS);
    curved.noteOn(60, 0.5);
    linear.noteOn(60, 0.5);
    const a = render(curved, 256);
    const b = render(linear, 256);
    let compared = 0;
    for (let i = 0; i < 256; i++) {
      if (Math.abs(b[i]) > 1e-6) {
        expect(Math.abs(a[i] / b[i] - 0.5)).toBeLessThan(1e-9);
        compared += 1;
      }
    }
    expect(compared).toBeGreaterThan(100);
  });

  // 3. Vel-range gating: a note below the layer's velocity window matches zero layers.
  it('is immediately inactive when the velocity misses every layer window', () => {
    const layer: PatchLayer = {
      keyRange: FULL_KEY,
      velRange: { low: 0.6, high: 1 },
      generator: { kind: 'additive', partials: [{ ratio: 1, level: 1 }] },
      tva: { level: 0.8, adsr: ADSR, velCurve: 1 },
    };
    const voice = new Voice(makePatch([layer]), FS);
    voice.noteOn(60, 0.3);
    expect(voice.active).toBe(false);
    const out = new Float32Array(128);
    expect(voice.render(out, 128)).toBe(false);
    for (let i = 0; i < 128; i++) {
      expect(out[i]).toBe(0);
    }
  });

  // 4. TVF darkens: lowpass 300 Hz on a saw well above cutoff loses most of its energy.
  it('darkens the layer through the TVF lowpass', () => {
    const saw = (tvf: PatchLayer['tvf']): PatchLayer => ({
      keyRange: FULL_KEY,
      velRange: FULL_VEL,
      generator: {
        kind: 'va',
        va: { shape: 'saw', unison: 1, detuneCents: 0, pulseWidth: 0.5 },
        seed: 1,
      },
      tvf,
      tva: { level: 0.8, adsr: ADSR, velCurve: 1 },
    });
    const filtered = new Voice(
      makePatch([
        saw({ mode: 'lowpass', cutoffHz: 300, q: 0.707, envAmountHz: 0, keyTrack: 0, velAmountHz: 0 }),
      ]),
      FS,
    );
    const unfiltered = new Voice(makePatch([saw(undefined)]), FS);
    filtered.noteOn(72, 1);
    unfiltered.noteOn(72, 1);
    const f = render(filtered, 4800);
    const u = render(unfiltered, 4800);
    expect(rms(f, 2400, 4800)).toBeLessThan(0.4 * rms(u, 2400, 4800));
  });

  // 5. noteOff → release → inactive; a dead voice renders nothing and returns false.
  it('goes inactive after the release and then adds nothing', () => {
    const layer: PatchLayer = {
      keyRange: FULL_KEY,
      velRange: FULL_VEL,
      generator: { kind: 'additive', partials: [{ ratio: 1, level: 1 }] },
      tva: { level: 0.8, adsr: { attack: 0.005, decay: 0.1, sustain: 0.5, release: 0.03 }, velCurve: 1 },
    };
    const voice = new Voice(makePatch([layer]), FS);
    voice.noteOn(60, 1);
    render(voice, 4800); // 0.1 s
    expect(voice.active).toBe(true);
    voice.noteOff();
    render(voice, 24_000); // 0.5 s ≫ release tail
    expect(voice.active).toBe(false);
    const out = new Float32Array(64);
    expect(voice.render(out, 64)).toBe(false);
    for (let i = 0; i < 64; i++) {
      expect(out[i]).toBe(0);
    }
  });

  // 6. quickRelease reaps fast (0.008 s time constant vs the layer's 0.03 s release).
  it('quickRelease reaps the voice fast', () => {
    const layer: PatchLayer = {
      keyRange: FULL_KEY,
      velRange: FULL_VEL,
      generator: { kind: 'additive', partials: [{ ratio: 1, level: 1 }] },
      tva: { level: 0.8, adsr: { attack: 0.005, decay: 0.1, sustain: 0.5, release: 0.03 }, velCurve: 1 },
    };
    // Stolen right at noteOn: reapable within 0.05 s.
    const stolen = new Voice(makePatch([layer]), FS);
    stolen.noteOn(60, 1);
    stolen.quickRelease();
    render(stolen, 2400); // 0.05 s
    expect(stolen.active).toBe(false);
    // Stolen while sounding: the 0.008 s tau clears SILENCE_FLOOR within 0.1 s,
    // where the normal 0.03 s release would still be audible.
    const sounding = new Voice(makePatch([layer]), FS);
    sounding.noteOn(60, 1);
    render(sounding, 4800); // 0.1 s
    sounding.quickRelease();
    render(sounding, 4800); // 0.1 s
    expect(sounding.active).toBe(false);
    const released = new Voice(makePatch([layer]), FS);
    released.noteOn(60, 1);
    render(released, 4800);
    released.noteOff();
    render(released, 4800);
    expect(released.active).toBe(true);
  });

  // 7. Unresolvable zoneSetId: progressive-loading semantics — silent, inactive, no throw.
  it('treats an unresolvable zoneSetId as an inactive layer, not an error', () => {
    const layer: PatchLayer = {
      keyRange: FULL_KEY,
      velRange: FULL_VEL,
      generator: { kind: 'sample', zoneSetId: 'missing.pack', crossfade: 0 },
      tva: { level: 0.8, adsr: ADSR, velCurve: 1 },
    };
    const noProvider = new Voice(makePatch([layer]), FS);
    expect(() => noProvider.noteOn(60, 1)).not.toThrow();
    expect(noProvider.active).toBe(false);
    const out = new Float32Array(64);
    expect(noProvider.render(out, 64)).toBe(false);
    for (let i = 0; i < 64; i++) {
      expect(out[i]).toBe(0);
    }
    const nullProvider: ZoneSetProvider = () => null;
    const unresolved = new Voice(makePatch([layer]), FS, nullProvider);
    expect(() => unresolved.noteOn(60, 1)).not.toThrow();
    expect(unresolved.active).toBe(false);
  });

  // 8. Chunk determinism: samplePos-based ticking makes output independent of render() call sizes.
  it('renders identically regardless of render() call sizes', () => {
    const layer: PatchLayer = {
      keyRange: FULL_KEY,
      velRange: FULL_VEL,
      generator: {
        kind: 'va',
        va: { shape: 'saw', unison: 2, detuneCents: 10, pulseWidth: 0.5 },
        seed: 5,
      },
      tvf: {
        mode: 'lowpass',
        cutoffHz: 800,
        q: 0.9,
        envAmountHz: 1500,
        env: { attack: 0.01, decay: 0.1, sustain: 0.3, release: 0.1 },
        keyTrack: 0.3,
        velAmountHz: 500,
      },
      tva: { level: 0.8, adsr: ADSR, velCurve: 1.5 },
      mod: {
        lfo: { shape: 'sine', rateHz: 50, delay: 0, fadeIn: 0 },
        toPitchCents: 25,
        toCutoffHz: 400,
        toAmpDepth: 0.4,
      },
    };
    const patch = makePatch([layer]);
    const one = new Voice(patch, FS);
    one.noteOn(60, 0.7);
    const whole = render(one, 64);
    // Four aligned 16-frame calls.
    const four = new Voice(patch, FS);
    four.noteOn(60, 0.7);
    for (let k = 0; k < 4; k++) {
      const out16 = render(four, 16);
      for (let i = 0; i < 16; i++) {
        expect(out16[i]).toBe(whole[k * 16 + i]);
      }
    }
    // Two calls that straddle chunk boundaries (24 + 40).
    const split = new Voice(patch, FS);
    split.noteOn(60, 0.7);
    const first = render(split, 24);
    const second = render(split, 40);
    for (let i = 0; i < 24; i++) {
      expect(first[i]).toBe(whole[i]);
    }
    for (let i = 0; i < 40; i++) {
      expect(second[i]).toBe(whole[24 + i]);
    }
  });

  // 10. Block-size invariance across a mid-chunk generator finish: a layer
  //     unlooped one-shot sample zone self-finishes at sample 100, mid-way
  //     through the CONTROL_INTERVAL chunk covering samples 96..112. With a
  //     TVF on that layer, the SVF ring must get exactly one full chunk's
  //     worth of processing (the latch only updates at tick boundaries), so
  //     splitting render() calls at a non-tick-aligned point inside that
  //     window (104) must not change a single sample versus one big call.
  it('renders identically across a mid-chunk generator finish regardless of render() call sizes', () => {
    const oneShotProvider: ZoneSetProvider = (id) => {
      if (id !== 'oneshot') return null;
      const length = 100;
      const data = new Float32Array(length);
      for (let i = 0; i < length; i++) {
        data[i] = Math.sin((2 * Math.PI * 6 * i) / length);
      }
      return [{ topVelocity: 1, zones: [{ rootMidi: 69, sampleRate: FS, data }] }];
    };
    const sampleLayer: PatchLayer = {
      keyRange: FULL_KEY,
      velRange: FULL_VEL,
      generator: { kind: 'sample', zoneSetId: 'oneshot', crossfade: 0 },
      tvf: { mode: 'lowpass', cutoffHz: 800, q: 2, envAmountHz: 0, keyTrack: 0, velAmountHz: 0 },
      tva: { level: 0.8, adsr: ADSR, velCurve: 1 },
    };
    const sustainedLayer: PatchLayer = {
      keyRange: FULL_KEY,
      velRange: FULL_VEL,
      generator: { kind: 'additive', partials: [{ ratio: 1, level: 1 }] },
      tva: { level: 0.5, adsr: ADSR, velCurve: 1 },
    };
    const patch = makePatch([sampleLayer, sustainedLayer]);

    const whole = new Voice(patch, FS, oneShotProvider);
    whole.noteOn(69, 1);
    const wholeOut = render(whole, 160);

    // Split at 104: strictly inside the 96..112 tick chunk and past the
    // generator's self-finish at 100 — exactly the case the latch fixes.
    const split = new Voice(patch, FS, oneShotProvider);
    split.noteOn(69, 1);
    const part1 = render(split, 104);
    const part2 = render(split, 56);
    for (let i = 0; i < 104; i++) {
      expect(part1[i]).toBe(wholeOut[i]);
    }
    for (let i = 0; i < 56; i++) {
      expect(part2[i]).toBe(wholeOut[104 + i]);
    }
  });

  // 9. Twin reference: fixture patch, noteOn(60, 0.8), first 8 samples.
  it('matches the twin reference (fixture patch, noteOn 60 at velocity 0.8)', () => {
    const patch = JSON.parse(FIXTURE_PATCH_JSON) as Patch;
    const voice = new Voice(patch, FS);
    voice.noteOn(60, 0.8);
    const out = render(voice, 8);
    expect(TWIN_REFERENCE).toHaveLength(8);
    TWIN_REFERENCE.forEach((v, i) => expect(out[i]).toBeCloseTo(v, 6));
  });
});
