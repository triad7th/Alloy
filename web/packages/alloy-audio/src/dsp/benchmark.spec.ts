// Indicative CPU-envelope guard for the full render path (64 voices, all
// inserts + master reverb/delay/limiter). The spec's target is "< 25% of one
// mid-tier phone core"; this dev machine is not a phone, so the hard
// assertion is a LOOSE realtime bound (< 1.0, i.e. faster than realtime at
// all) that will never flake in CI. The actual realtime ratio and its
// implied "% of one core" are logged for a human to read against the 25%
// target. Twin: swift/Tests/AlloyAudioTests/BenchmarkTests.swift.

import { describe, expect, it } from 'vitest';
import { PatchEngine } from './patch-engine.js';
import { PATCH_FM } from './testing/golden-patches.js';

const FS = 48_000;
const SECONDS = 4;
const BLOCK = 128;
const VOICES = 64;

describe('64-voice render benchmark', () => {
  it('renders 64 voices with full FX faster than realtime (indicative CPU guard)', () => {
    const patch = { ...PATCH_FM, sends: { reverb: 0.3, delay: 0.25 } }; // full master path active
    const engine = new PatchEngine(FS, { masterConfig: undefined });
    engine.setPatch(patch);
    for (let v = 0; v < VOICES; v++) {
      engine.schedule({ frame: 0, kind: 'noteOn', midi: 36 + v, velocity: 0.8 });
    }
    const total = FS * SECONDS;
    const left = new Float32Array(BLOCK);
    const right = new Float32Array(BLOCK);
    const t0 = performance.now();
    for (let off = 0; off < total; off += BLOCK) {
      left.fill(0);
      right.fill(0);
      engine.process(left, right, Math.min(BLOCK, total - off));
    }
    const elapsedMs = performance.now() - t0;
    const audioMs = SECONDS * 1000;
    const ratio = elapsedMs / audioMs;
    // eslint-disable-next-line no-console
    console.log(
      `64-voice full-FX: ${elapsedMs.toFixed(1)} ms to render ${audioMs} ms audio ` +
        `= ${(ratio * 100).toFixed(1)}% of realtime on this machine (target < 25% of one mid-tier phone core)`,
    );
    expect(engine.activeVoiceCount).toBeGreaterThan(0); // voices actually ran
    expect(ratio).toBeLessThan(1.0); // faster than realtime — loose, flake-proof
  });

  it('a decaying reverb tail into silence does not stall (denormal-flush assessment)', () => {
    const patch = { ...PATCH_FM, sends: { reverb: 0.6, delay: 0.4 } };
    const engine = new PatchEngine(FS);
    engine.setPatch(patch);
    engine.schedule({ frame: 0, kind: 'noteOn', midi: 60, velocity: 1 });
    engine.schedule({ frame: 2400, kind: 'noteOff', midi: 60 });
    const total = FS * 8; // long tail decaying toward zero
    const left = new Float32Array(BLOCK);
    const right = new Float32Array(BLOCK);
    const t0 = performance.now();
    for (let off = 0; off < total; off += BLOCK) {
      left.fill(0);
      right.fill(0);
      engine.process(left, right, Math.min(BLOCK, total - off));
    }
    const ratio = (performance.now() - t0) / (8 * 1000);
    // eslint-disable-next-line no-console
    console.log(`reverb-tail denormal check: ${(ratio * 100).toFixed(1)}% of realtime (should not spike as the tail decays)`);
    expect(ratio).toBeLessThan(1.0);
  });
});
