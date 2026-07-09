// Ported from AllyPiano's web-audio-engine.spec.ts: the same assertions over
// an in-test instrument catalog (AlloyAudio ships none), plus coverage of the
// new default-instrument and unknown-id constructor semantics.
import { describe, it, expect } from 'vitest';
import type { InstrumentDescriptor } from './instruments.js';
import { WebSynthEngine } from './web-synth-engine.js';
import { FakeCtx } from './testing/fake-audio-graph.js';

/** Every minor third from A0 (21) to C8 (108) — 30 recorded zones. */
const GRAND_SAMPLE_MIDIS: readonly number[] = Array.from({ length: 30 }, (_, i) => 21 + i * 3);

const CATALOG: InstrumentDescriptor[] = [
  {
    id: 'grand-piano',
    voice: {
      kind: 'sampled',
      sampleBaseUrl: 'samples/grand-piano',
      sampleMidis: GRAND_SAMPLE_MIDIS,
      release: 0.25,
      fallback: { waveform: 'triangle', attack: 0.005, decay: 0.12, sustain: 0.6, release: 0.25 },
    },
    sends: { reverb: 0.18, delay: 0 },
  },
  {
    id: 'midnight',
    voice: {
      kind: 'supersaw',
      unison: 5,
      detuneCents: 24,
      filter: { baseHz: 900, envHz: 2600, decay: 0.35, q: 0.9 },
      amp: { waveform: 'sawtooth', attack: 0.005, decay: 0.25, sustain: 0.5, release: 0.35 },
    },
    sends: { reverb: 0.3, delay: 0.18 },
  },
];

const neverFetch = () => new Promise<ArrayBuffer>(() => undefined);

function makeEngine(ctx: FakeCtx, fetchSample = neverFetch) {
  return new WebSynthEngine(ctx, CATALOG, undefined, fetchSample);
}

describe('WebSynthEngine', () => {
  it('starts an oscillator tuned to the note on noteOn', () => {
    const ctx = new FakeCtx();
    const engine = makeEngine(ctx);
    engine.noteOn(69); // A4 = 440 Hz
    expect(ctx.oscillators).toHaveLength(1);
    expect(ctx.oscillators[0].started).toBe(true);
    expect(ctx.oscillators[0].frequency.value).toBeCloseTo(440, 3);
  });

  it('plays the triangle stopgap for grand piano until samples load', () => {
    const ctx = new FakeCtx();
    const engine = makeEngine(ctx); // network never resolves
    engine.noteOn(60);
    expect(ctx.bufferSources).toHaveLength(0);
    expect(ctx.oscillators).toHaveLength(1);
    expect(ctx.oscillators[0].type).toBe('triangle');
  });

  it('starts preloading the default instrument samples at construction', () => {
    const ctx = new FakeCtx();
    const urls: string[] = [];
    new WebSynthEngine(ctx, CATALOG, undefined, (url) => {
      urls.push(url);
      return new Promise(() => undefined);
    });
    expect(urls).toHaveLength(30);
    expect(urls[0]).toBe('samples/grand-piano/021.mp3');
    expect(urls.at(-1)).toBe('samples/grand-piano/108.mp3');
  });

  it('defaults to the first catalog entry when no defaultInstrumentId is given', () => {
    const ctx = new FakeCtx();
    const engine = makeEngine(ctx);
    engine.noteOn(60);
    expect(ctx.oscillators[0].type).toBe('triangle'); // grand-piano fallback, not supersaw
  });

  it('honours an explicit defaultInstrumentId', () => {
    const ctx = new FakeCtx();
    const urls: string[] = [];
    const engine = new WebSynthEngine(ctx, CATALOG, 'midnight', (url) => {
      urls.push(url);
      return new Promise(() => undefined);
    });
    engine.noteOn(64);
    expect(urls).toHaveLength(0); // the sampled player was never built
    expect(ctx.oscillators).toHaveLength(5);
    expect(ctx.oscillators.every((o) => o.type === 'sawtooth')).toBe(true);
  });

  it('plays sampled notes once zones decode', async () => {
    const ctx = new FakeCtx();
    const engine = makeEngine(ctx, () => Promise.resolve(new ArrayBuffer(8)));
    await Promise.resolve();
    await Promise.resolve(); // fetch then decode settle
    engine.noteOn(60);
    expect(ctx.bufferSources).toHaveLength(1);
    expect(ctx.bufferSources[0].playbackRate.value).toBeCloseTo(1, 6); // 60 is a zone
  });

  it('switches midnight to the supersaw voice', () => {
    const ctx = new FakeCtx();
    const engine = makeEngine(ctx);
    engine.setInstrument('midnight');
    engine.noteOn(64);
    expect(ctx.oscillators).toHaveLength(5);
    expect(ctx.oscillators.every((o) => o.type === 'sawtooth')).toBe(true);
  });

  it('keeps the current instrument when setInstrument gets an unknown id', () => {
    const ctx = new FakeCtx();
    const engine = makeEngine(ctx);
    engine.setInstrument('does-not-exist');
    engine.noteOn(60);
    expect(ctx.oscillators).toHaveLength(1);
    expect(ctx.oscillators[0].type).toBe('triangle'); // still the grand-piano fallback
  });

  it('resumes a suspended AudioContext on noteOn (autoplay unlock on first gesture)', () => {
    const ctx = new FakeCtx();
    ctx.state = 'suspended'; // autoplay-enforcing browsers start here
    const engine = makeEngine(ctx);
    engine.noteOn(60);
    expect(ctx.resumeCalls).toBe(1);
    expect(ctx.state).toBe('running');
  });

  it('does not call resume when the context is already running', () => {
    const ctx = new FakeCtx();
    const engine = makeEngine(ctx);
    engine.noteOn(60);
    expect(ctx.resumeCalls).toBe(0);
  });

  it('does not start a second voice for an already-held note', () => {
    const ctx = new FakeCtx();
    const engine = makeEngine(ctx);
    engine.noteOn(60);
    engine.noteOn(60);
    expect(ctx.oscillators).toHaveLength(1);
  });

  it('stops the voice on noteOff when sustain is off', () => {
    const ctx = new FakeCtx();
    const engine = makeEngine(ctx);
    engine.noteOn(60);
    engine.noteOff(60);
    ctx.oscillators[0].onended?.();
    expect(ctx.oscillators[0].stopped).toBe(true);
  });

  it('holds notes while sustain is on and releases them when it turns off', () => {
    const ctx = new FakeCtx();
    const engine = makeEngine(ctx);
    engine.setSustain(true);
    engine.noteOn(60);
    engine.noteOff(60);
    expect(ctx.oscillators[0].stopped).toBe(false); // still held by pedal
    engine.setSustain(false);
    ctx.oscillators[0].onended?.();
    expect(ctx.oscillators[0].stopped).toBe(true);
  });

  it('keeps a re-pressed note sounding after the pedal lifts', () => {
    const ctx = new FakeCtx();
    const engine = makeEngine(ctx);
    engine.setSustain(true);
    engine.noteOn(60); // press
    engine.noteOff(60); // release -> latched by the pedal
    engine.noteOn(60); // re-press and keep holding it
    engine.setSustain(false); // pedal up: must NOT release a physically held key
    ctx.oscillators[0].onended?.();
    expect(ctx.oscillators[0].stopped).toBe(false);
  });

  it('allNotesOff fast-stops every active voice', () => {
    const ctx = new FakeCtx();
    const engine = makeEngine(ctx);
    engine.noteOn(60);
    engine.noteOn(64);
    engine.allNotesOff();
    ctx.oscillators.forEach((o) => o.onended?.());
    expect(ctx.oscillators.every((o) => o.stopped)).toBe(true);
    // Fast fade (0.03 s), not the instrument's 0.25 s release.
    expect(ctx.oscillators.every((o) => (o.stopWhen ?? 0) <= 0.05)).toBe(true);
  });
});
