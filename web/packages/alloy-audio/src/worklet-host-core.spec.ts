import { describe, expect, it } from 'vitest';
import { type AdsrParams } from './dsp/adsr-envelope.js';
import type { InsertSpec } from './dsp/effects/effect-types.js';
import { PATCH_SCHEMA_VERSION, type Patch, type PatchLayer } from './dsp/patch.js';
import { renderPatch } from './dsp/patch-engine.js';
import {
  GOLDEN_EVENTS,
  GOLDEN_FRAMES,
  GOLDEN_FS,
  GOLDEN_ZONES,
  PATCH_FM,
  PATCH_ORGAN,
  PATCH_SAMPLE,
  goldenZoneSetProvider,
} from './dsp/testing/golden-patches.js';
import {
  MAX_COMMANDS_PER_BLOCK,
  WorkletHostCore,
  type WireZoneLayer,
  type WorkletOutMessage,
} from './worklet-host-core.js';

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
    meta: { id: 'test.worklet-host-core', name: 'Worklet Host Core Test', category: 'melodic' },
    layers,
    sends: { reverb: 0, delay: 0 },
  };
}

function maxAbs(samples: ArrayLike<number>, from: number, to: number): number {
  let peak = 0;
  for (let i = from; i < to; i++) {
    peak = Math.max(peak, Math.abs(samples[i]));
  }
  return peak;
}

/** Stereo render helper; these patches are insert-free so L === R and the
 * scheduling assertions read the left channel. */
function render(core: WorkletHostCore, frames: number, postReply: (reply: WorkletOutMessage) => void = () => {}): Float32Array {
  const left = new Float32Array(frames);
  const right = new Float32Array(frames);
  core.render(left, right, frames, postReply);
  return left;
}

describe('WorkletHostCore', () => {
  // 1. setPatch then noteOn then render: non-silent output.
  it('renders non-silent output after setPatch + noteOn', () => {
    const core = new WorkletHostCore(FS, 0);
    const replies: WorkletOutMessage[] = [];
    core.onMessage({ type: 'setPatch', patch: makePatch() });
    core.onMessage({ type: 'noteOn', midi: 60, velocity: 1 });
    const out = render(core, 256, (reply) => replies.push(reply));
    expect(replies).toHaveLength(0);
    expect(maxAbs(out, 0, 256)).toBeGreaterThan(0);
  });

  // 2. Invalid patch: postReply receives patchRejected with the validatePatch
  // errors; engine keeps rendering silence; a later valid setPatch recovers.
  it('rejects an invalid patch via postReply, renders silence, then recovers on a later valid setPatch', () => {
    const core = new WorkletHostCore(FS, 0);
    const replies: WorkletOutMessage[] = [];
    core.onMessage({ type: 'setPatch', patch: makePatch([]) }); // 0 layers: invalid
    core.onMessage({ type: 'noteOn', midi: 60, velocity: 1 });
    const rejected = render(core, 256, (reply) => replies.push(reply));
    expect(replies).toHaveLength(1);
    expect(replies[0]).toEqual({ type: 'patchRejected', errors: expect.arrayContaining([expect.stringContaining('layer count')]) });
    expect(maxAbs(rejected, 0, 256)).toBe(0);

    core.onMessage({ type: 'setPatch', patch: makePatch() });
    core.onMessage({ type: 'noteOn', midi: 60, velocity: 1 });
    const recovered = render(core, 256, (reply) => replies.push(reply));
    expect(maxAbs(recovered, 0, 256)).toBeGreaterThan(0);
  });

  // 2b. Unknown insert kind: a future/newer-build patch payload must reject
  // through the normal patchRejected reply, not throw and kill the render
  // call (which would take down the whole worklet processor).
  it('rejects a patch with an unknown insert kind via postReply instead of throwing', () => {
    const core = new WorkletHostCore(FS, 0);
    const replies: WorkletOutMessage[] = [];
    const unknownInsert = { kind: 'phaser' } as unknown as InsertSpec;
    core.onMessage({ type: 'setPatch', patch: { ...makePatch(), inserts: [unknownInsert] } });
    core.onMessage({ type: 'noteOn', midi: 60, velocity: 1 });
    let out = new Float32Array(0);
    expect(() => {
      out = render(core, 256, (reply) => replies.push(reply));
    }).not.toThrow();
    expect(replies).toHaveLength(1);
    expect(replies[0]).toEqual({
      type: 'patchRejected',
      errors: expect.arrayContaining([expect.stringContaining("unknown insert kind 'phaser'")]),
    });
    expect(maxAbs(out, 0, 256)).toBe(0);
  });

  // 3. Frame anchoring: core anchored at 1000; noteOn atFrame 1100 -> first
  // 100 rendered frames exactly 0, sound starts at offset 100.
  it('maps context frames to engine frames using the construction anchor', () => {
    const core = new WorkletHostCore(FS, 1000);
    core.onMessage({ type: 'setPatch', patch: makePatch() });
    core.onMessage({ type: 'noteOn', midi: 60, velocity: 1, atFrame: 1100 });
    const out = render(core, 256);
    for (let i = 0; i < 100; i++) {
      expect(out[i]).toBe(0);
    }
    expect(maxAbs(out, 100, 108)).toBeGreaterThan(0);
  });

  // 4. Past atFrame (500 < anchor 1000) fires immediately.
  it('fires a past atFrame immediately instead of dropping or throwing', () => {
    const core = new WorkletHostCore(FS, 1000);
    core.onMessage({ type: 'setPatch', patch: makePatch() });
    core.onMessage({ type: 'noteOn', midi: 60, velocity: 1, atFrame: 500 });
    const out = render(core, 256);
    expect(maxAbs(out, 0, 8)).toBeGreaterThan(0);
  });

  // 5. Zone set: setZoneSet with a WireZone built from the golden sine
  // recipe + the golden sample patch, driven through the wire protocol in
  // 128-frame blocks, must match renderPatch exactly on both channels
  // (same flagship pattern as case 7, extended to the setZoneSet path).
  // A second core with no setZoneSet for 'golden.sine' renders silence
  // without error (progressive-loading, not an error path).
  it('resolves setZoneSet through the engine and matches renderPatch exactly on both channels', () => {
    const layers: WireZoneLayer[] = GOLDEN_ZONES.map((layer) => ({
      topVelocity: layer.topVelocity,
      zones: layer.zones.map((zone) => ({
        rootMidi: zone.rootMidi,
        sampleRate: zone.sampleRate,
        samples: zone.data as Float32Array,
        loopStart: zone.loopStart,
        loopEnd: zone.loopEnd,
      })),
    }));

    const expected = renderPatch(PATCH_SAMPLE, GOLDEN_EVENTS, GOLDEN_FRAMES, GOLDEN_FS, goldenZoneSetProvider);

    const core = new WorkletHostCore(GOLDEN_FS, 0);
    core.onMessage({ type: 'setZoneSet', id: 'golden.sine', layers });
    core.onMessage({ type: 'setPatch', patch: PATCH_SAMPLE });
    for (const event of GOLDEN_EVENTS) {
      switch (event.kind) {
        case 'noteOn':
          core.onMessage({ type: 'noteOn', midi: event.midi, velocity: event.velocity, atFrame: event.frame });
          break;
        case 'noteOff':
          core.onMessage({ type: 'noteOff', midi: event.midi, atFrame: event.frame });
          break;
        case 'allNotesOff':
          core.onMessage({ type: 'allNotesOff', atFrame: event.frame });
          break;
      }
    }

    const actualLeft = new Float32Array(GOLDEN_FRAMES);
    const actualRight = new Float32Array(GOLDEN_FRAMES);
    for (let offset = 0; offset < GOLDEN_FRAMES; offset += 128) {
      const n = Math.min(128, GOLDEN_FRAMES - offset);
      const blockLeft = new Float32Array(n);
      const blockRight = new Float32Array(n);
      core.render(blockLeft, blockRight, n, () => {
        throw new Error('unexpected patchRejected during setZoneSet flagship render');
      });
      actualLeft.set(blockLeft, offset);
      actualRight.set(blockRight, offset);
    }

    for (const [channel, actual, wanted] of [
      ['left', actualLeft, expected.left],
      ['right', actualRight, expected.right],
    ] as const) {
      let mismatchIndex = -1;
      for (let i = 0; i < GOLDEN_FRAMES; i++) {
        if (actual[i] !== wanted[i]) {
          mismatchIndex = i;
          break;
        }
      }
      expect(
        mismatchIndex,
        mismatchIndex === -1
          ? 'no mismatch'
          : `${channel} mismatch at frame ${mismatchIndex}: actual=${actual[mismatchIndex]} expected=${wanted[mismatchIndex]}`,
      ).toBe(-1);
    }
  });

  it('silently produces no sound for an unknown zone set', () => {
    // No setZoneSet for 'golden.sine' on this core: unresolved zoneSetId is
    // progressive-loading silence, not an error.
    const unresolvedCore = new WorkletHostCore(FS, 0);
    unresolvedCore.onMessage({ type: 'setPatch', patch: PATCH_SAMPLE });
    unresolvedCore.onMessage({ type: 'noteOn', midi: 60, velocity: 1 });
    let silent = new Float32Array(0);
    expect(() => {
      silent = render(unresolvedCore, 1024);
    }).not.toThrow();
    expect(maxAbs(silent, 0, 1024)).toBe(0);
  });

  // 6. Drain bound: queue MAX_COMMANDS_PER_BLOCK + 1 noteOn messages ->
  // render drains exactly MAX_COMMANDS_PER_BLOCK per call, leftovers carry.
  it('drains at most MAX_COMMANDS_PER_BLOCK queued messages per render', () => {
    const core = new WorkletHostCore(FS, 0, { maxVoices: MAX_COMMANDS_PER_BLOCK + 10 });
    core.onMessage({ type: 'setPatch', patch: makePatch() });
    for (let i = 0; i < MAX_COMMANDS_PER_BLOCK + 1; i++) {
      core.onMessage({ type: 'noteOn', midi: i, velocity: 1 });
    }
    // 1 setPatch + (MAX_COMMANDS_PER_BLOCK + 1) noteOns queued.
    const totalQueued = MAX_COMMANDS_PER_BLOCK + 2;
    expect(core.pendingMessageCount).toBe(totalQueued);
    render(core, 128);
    expect(core.pendingMessageCount).toBe(totalQueued - MAX_COMMANDS_PER_BLOCK);
    render(core, 128);
    expect(core.pendingMessageCount).toBe(0);
  });

  // 7. FLAGSHIP equality: driving a core through the wire protocol must
  // equal renderPatch bit-exactly, block for block.
  describe.each<[string, Patch]>([
    ['fm', PATCH_FM],
    ['organ', PATCH_ORGAN],
  ])('flagship equality: %s', (_name, patch) => {
    it('matches renderPatch exactly on both channels when driven in 128-frame blocks over the wire protocol', () => {
      const expected = renderPatch(patch, GOLDEN_EVENTS, GOLDEN_FRAMES, GOLDEN_FS);

      const core = new WorkletHostCore(GOLDEN_FS, 0);
      core.onMessage({ type: 'setPatch', patch });
      for (const event of GOLDEN_EVENTS) {
        switch (event.kind) {
          case 'noteOn':
            core.onMessage({ type: 'noteOn', midi: event.midi, velocity: event.velocity, atFrame: event.frame });
            break;
          case 'noteOff':
            core.onMessage({ type: 'noteOff', midi: event.midi, atFrame: event.frame });
            break;
          case 'allNotesOff':
            core.onMessage({ type: 'allNotesOff', atFrame: event.frame });
            break;
        }
      }

      const actualLeft = new Float32Array(GOLDEN_FRAMES);
      const actualRight = new Float32Array(GOLDEN_FRAMES);
      for (let offset = 0; offset < GOLDEN_FRAMES; offset += 128) {
        const n = Math.min(128, GOLDEN_FRAMES - offset);
        const blockLeft = new Float32Array(n); // zero-filled, as worklet buffers arrive
        const blockRight = new Float32Array(n);
        core.render(blockLeft, blockRight, n, () => {
          throw new Error('unexpected patchRejected during flagship render');
        });
        actualLeft.set(blockLeft, offset);
        actualRight.set(blockRight, offset);
      }

      for (const [channel, actual, wanted] of [
        ['left', actualLeft, expected.left],
        ['right', actualRight, expected.right],
      ] as const) {
        let mismatchIndex = -1;
        for (let i = 0; i < GOLDEN_FRAMES; i++) {
          if (actual[i] !== wanted[i]) {
            mismatchIndex = i;
            break;
          }
        }
        expect(
          mismatchIndex,
          mismatchIndex === -1
            ? 'no mismatch'
            : `${channel} mismatch at frame ${mismatchIndex}: actual=${actual[mismatchIndex]} expected=${wanted[mismatchIndex]}`,
        ).toBe(-1);
      }
    });
  });
});
