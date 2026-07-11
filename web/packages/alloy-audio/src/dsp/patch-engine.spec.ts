import { describe, expect, it } from 'vitest';
import { type AdsrParams } from './adsr-envelope.js';
import { PATCH_SCHEMA_VERSION, type Patch, type PatchLayer } from './patch.js';
import { PatchEngine, renderPatch, type EngineEvent } from './patch-engine.js';
import { FIXTURE_PATCH_JSON } from './testing/fixtures.js';

const FS = 48_000;

const FULL_KEY = { lowMidi: 0, highMidi: 127 };
const FULL_VEL = { low: 0, high: 1 };
/** Fast attack so scheduled notes become audible within a few samples. */
const ADSR: AdsrParams = { attack: 0.001, decay: 0.2, sustain: 0.7, release: 0.03 };

function additiveLayer(): PatchLayer {
  return {
    keyRange: FULL_KEY,
    velRange: FULL_VEL,
    generator: { kind: 'additive', partials: [{ ratio: 1, level: 1 }] },
    tva: { level: 0.8, adsr: ADSR, velCurve: 1 },
  };
}

function makePatch(layers: PatchLayer[] = [additiveLayer()]): Patch {
  return {
    schemaVersion: PATCH_SCHEMA_VERSION,
    meta: { id: 'test.engine', name: 'Engine Test', category: 'melodic' },
    layers,
    sends: { reverb: 0, delay: 0 },
  };
}

function process(engine: PatchEngine, frames: number): Float32Array {
  const out = new Float32Array(frames);
  engine.process(out, frames);
  return out;
}

/** Renders totalFrames in fixed-size blocks, returning the concatenated buffer. */
function processBlocks(engine: PatchEngine, totalFrames: number, block: number): Float32Array {
  const out = new Float32Array(totalFrames);
  for (let offset = 0; offset < totalFrames; offset += block) {
    const n = Math.min(block, totalFrames - offset);
    engine.process(out.subarray(offset, offset + n), n);
  }
  return out;
}

function maxAbs(samples: ArrayLike<number>, from: number, to: number): number {
  let peak = 0;
  for (let i = from; i < to; i++) {
    peak = Math.max(peak, Math.abs(samples[i]));
  }
  return peak;
}

/** Shared fixture-patch event list for the renderPatch tests. */
const RENDER_EVENTS: readonly EngineEvent[] = [
  { frame: 0, kind: 'noteOn', midi: 60, velocity: 0.8 },
  { frame: 480, kind: 'noteOn', midi: 64, velocity: 0.6 },
  { frame: 2400, kind: 'noteOff', midi: 60 },
  { frame: 4000, kind: 'allNotesOff' },
];

describe('PatchEngine', () => {
  // 1. Transport: fresh engine frame === 0; process(256) twice → frame === 512.
  it('starts the transport at frame 0 and advances by frames rendered', () => {
    const engine = new PatchEngine(FS);
    expect(engine.frame).toBe(0);
    expect(engine.activeVoiceCount).toBe(0);
    process(engine, 256);
    process(engine, 256);
    expect(engine.frame).toBe(512);
    // Blocks are capped by the preallocated segment scratch.
    expect(() => engine.process(new Float32Array(4097), 4097)).toThrow();
  });

  // 2. Sample-accurate scheduling: noteOn at frame 100 → out[0..99] all exactly 0,
  //    out[100] onward nonzero within 8 samples (attack 0.001).
  it('applies a scheduled noteOn at its exact sample offset', () => {
    const engine = new PatchEngine(FS);
    engine.setPatch(makePatch());
    engine.schedule({ frame: 100, kind: 'noteOn', midi: 60, velocity: 1 });
    const out = process(engine, 256);
    for (let i = 0; i < 100; i++) {
      expect(out[i]).toBe(0);
    }
    expect(maxAbs(out, 100, 108)).toBeGreaterThan(0);
  });

  // 3. Same-frame order: noteOn(60)@0 and noteOff(60)@0 scheduled in that order →
  //    the note keys up immediately. The click-free TVA releases from level 0
  //    (noteOn never resets level), so the keyed-up voice is exactly silent and
  //    reaped; the schedule-order proof is the reversed schedule, where the
  //    noteOff finds no sounding voice and the note sustains.
  it('applies same-frame events in schedule order', () => {
    const keyed = new PatchEngine(FS);
    keyed.setPatch(makePatch());
    keyed.schedule({ frame: 0, kind: 'noteOn', midi: 60, velocity: 1 });
    keyed.schedule({ frame: 0, kind: 'noteOff', midi: 60 });
    const silent = processBlocks(keyed, 24_000, 128); // 0.5 s
    expect(keyed.activeVoiceCount).toBe(0);
    expect(maxAbs(silent, 0, 24_000)).toBe(0);
    const reversed = new PatchEngine(FS);
    reversed.setPatch(makePatch());
    reversed.schedule({ frame: 0, kind: 'noteOff', midi: 60 });
    reversed.schedule({ frame: 0, kind: 'noteOn', midi: 60, velocity: 1 });
    const loud = processBlocks(reversed, 24_000, 128);
    expect(reversed.activeVoiceCount).toBe(1);
    expect(maxAbs(loud, 0, 24_000)).toBeGreaterThan(0.1);
  });

  // 4. Restrike: noteOn(60)@0, noteOn(60)@4800 → at frame 4805 activeVoiceCount === 2
  //    (old voice releasing + new voice), by 4800 + quickRelease tau * 15 → 1.
  it('restrikes the same midi by quick-releasing the old voice', () => {
    const engine = new PatchEngine(FS);
    engine.setPatch(makePatch());
    engine.schedule({ frame: 0, kind: 'noteOn', midi: 60, velocity: 1 });
    engine.schedule({ frame: 4800, kind: 'noteOn', midi: 60, velocity: 1 });
    process(engine, 2400);
    process(engine, 2400);
    process(engine, 5);
    expect(engine.frame).toBe(4805);
    expect(engine.activeVoiceCount).toBe(2);
    process(engine, 2880); // 15 quickRelease taus (0.008 s each) past the restrike…
    process(engine, 2880);
    expect(engine.activeVoiceCount).toBe(1);
  });

  // 5. Polyphony + steal: maxVoices 4; five noteOns at frames 0,10,20,30,40
  //    (midis 60..64) → activeVoiceCount never exceeds 4; the stolen voice is
  //    midi 60 (earliest start): noteOffs for 61..64 must drain the pool to 0 —
  //    if any other midi had been stolen, 60 would sustain forever.
  it('caps polyphony and steals the earliest-started voice', () => {
    const engine = new PatchEngine(FS, { maxVoices: 4 });
    engine.setPatch(makePatch());
    for (let i = 0; i < 5; i++) {
      engine.schedule({ frame: i * 10, kind: 'noteOn', midi: 60 + i, velocity: 1 });
    }
    for (let i = 1; i < 5; i++) {
      engine.schedule({ frame: 2400, kind: 'noteOff', midi: 60 + i });
    }
    let maxCount = 0;
    const step = (frames: number): void => {
      process(engine, frames);
      maxCount = Math.max(maxCount, engine.activeVoiceCount);
    };
    for (let k = 0; k < 5; k++) {
      step(10);
    }
    expect(engine.activeVoiceCount).toBe(4);
    step(2350);
    for (let k = 0; k < 9; k++) {
      step(2400); // release 0.03 s dies well inside 0.45 s
    }
    expect(maxCount).toBeLessThanOrEqual(4);
    expect(engine.activeVoiceCount).toBe(0);
  });

  // 5b. maxVoices clamp: a caller-supplied 0 (or negative) is clamped to 1,
  //     never to "unlimited" or to a pool that can't hold a single voice.
  it('clamps maxVoices to at least 1', () => {
    const engine = new PatchEngine(FS, { maxVoices: 0 });
    engine.setPatch(makePatch());
    engine.schedule({ frame: 0, kind: 'noteOn', midi: 60, velocity: 1 });
    process(engine, 10);
    expect(engine.activeVoiceCount).toBe(1);
  });

  // 6. allNotesOff: three notes, allNotesOff@2400, render 0.15 s more
  //    (quickRelease tau 8 ms → 18 tau) → activeVoiceCount === 0.
  it('allNotesOff quick-releases every voice', () => {
    const engine = new PatchEngine(FS);
    engine.setPatch(makePatch());
    for (const midi of [60, 64, 67]) {
      engine.schedule({ frame: 0, kind: 'noteOn', midi, velocity: 1 });
    }
    engine.schedule({ frame: 2400, kind: 'allNotesOff' });
    process(engine, 2400);
    expect(engine.activeVoiceCount).toBe(3);
    process(engine, 3600);
    process(engine, 3600);
    expect(engine.activeVoiceCount).toBe(0);
  });

  // 7. setPatch rejects invalid; the engine still renders with the old patch.
  it('rejects an invalid patch and keeps rendering with the old one', () => {
    const engine = new PatchEngine(FS);
    engine.setPatch(makePatch());
    expect(() => engine.setPatch(makePatch([]))).toThrow(/layer count 0 outside 1\.\.4/);
    engine.schedule({ frame: 0, kind: 'noteOn', midi: 60, velocity: 1 });
    const out = process(engine, 256);
    expect(engine.activeVoiceCount).toBe(1);
    expect(maxAbs(out, 0, 256)).toBeGreaterThan(0);
  });

  // 8. renderPatch determinism: two calls with identical args → byte-identical buffers.
  it('renderPatch is deterministic across repeat renders', () => {
    const patch = JSON.parse(FIXTURE_PATCH_JSON) as Patch;
    const a = renderPatch(patch, RENDER_EVENTS, 4800, FS);
    const b = renderPatch(patch, RENDER_EVENTS, 4800, FS);
    expect(a.length).toBe(4800);
    expect(maxAbs(a, 0, 4800)).toBeGreaterThan(0);
    for (let i = 0; i < 4800; i++) {
      expect(b[i]).toBe(a[i]);
    }
  });

  // 9. renderPatch (128-frame blocks) equals a manual 48-frame process loop exactly
  //    (chunk determinism is pinned by the Voice tests).
  it('renderPatch matches a manual engine loop at a different block size', () => {
    const patch = JSON.parse(FIXTURE_PATCH_JSON) as Patch;
    const harness = renderPatch(patch, RENDER_EVENTS, 4800, FS);
    const engine = new PatchEngine(FS);
    engine.setPatch(patch);
    for (const event of RENDER_EVENTS) {
      engine.schedule(event);
    }
    const manual = processBlocks(engine, 4800, 48);
    for (let i = 0; i < 4800; i++) {
      expect(manual[i]).toBe(harness[i]);
    }
  });
});
