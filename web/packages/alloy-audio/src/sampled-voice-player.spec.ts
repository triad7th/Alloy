import { describe, it, expect } from 'vitest';
import type { SampledVoiceSpec } from './instruments.js';
import { SampleLoader } from './sample-loader.js';
import { SampledVoicePlayer } from './sampled-voice-player.js';
import { FakeCtx, FakeGain } from './testing/fake-audio-graph.js';

const SPEC: SampledVoiceSpec = {
  kind: 'sampled',
  sampleBaseUrl: 'samples/grand-piano',
  sampleMidis: [57, 60, 63],
  release: 0.25,
  fallback: { waveform: 'triangle', attack: 0.005, decay: 0.12, sustain: 0.6, release: 0.25 },
};

/** Loader with all three of SPEC's zones already decoded. */
async function loadedLoader(ctx: FakeCtx) {
  const loader = new SampleLoader(ctx, SPEC.sampleBaseUrl, SPEC.sampleMidis, () =>
    Promise.resolve(new ArrayBuffer(8)),
  );
  loader.start();
  await Promise.resolve();
  await Promise.resolve();
  expect(loader.loadedCount).toBe(3);
  return loader;
}

describe('SampledVoicePlayer', () => {
  it('falls back to the stopgap synth while no zone is loaded', () => {
    const ctx = new FakeCtx();
    const loader = new SampleLoader(
      ctx,
      SPEC.sampleBaseUrl,
      SPEC.sampleMidis,
      () => new Promise(() => undefined), // never resolves
    );
    loader.start();
    const player = new SampledVoicePlayer(ctx, SPEC, new FakeGain(), loader);
    player.start(60, 1, 0);
    expect(ctx.bufferSources).toHaveLength(0);
    expect(ctx.oscillators).toHaveLength(1); // triangle stopgap
    expect(ctx.oscillators[0].type).toBe('triangle');
  });

  it('plays the exact zone at unity rate and pitch-shifts between zones', async () => {
    const ctx = new FakeCtx();
    const loader = await loadedLoader(ctx);
    const output = new FakeGain();
    const player = new SampledVoicePlayer(ctx, SPEC, output, loader);
    player.start(60, 1, 0);
    expect(ctx.oscillators).toHaveLength(0);
    expect(ctx.bufferSources[0].playbackRate.value).toBeCloseTo(1, 6);
    expect(ctx.bufferSources[0].started).toBe(true);
    player.start(62, 1, 0); // nearest zone 63, one semitone down
    expect(ctx.bufferSources[1].playbackRate.value).toBeCloseTo(2 ** (-1 / 12), 6);
    // source -> voice gain -> output
    const gain = ctx.gains.at(-1)!;
    expect(ctx.bufferSources[1].connections).toContain(gain);
    expect(gain.connections).toContain(output);
  });

  it('scales the voice gain by velocity', async () => {
    const ctx = new FakeCtx();
    const loader = await loadedLoader(ctx);
    new SampledVoicePlayer(ctx, SPEC, new FakeGain(), loader).start(60, 0.5, 0);
    expect(ctx.gains.at(-1)!.gain.value).toBeCloseTo(0.5, 6);
  });

  it('release fades the gain and stops the source past the release tail', async () => {
    const ctx = new FakeCtx();
    const loader = await loadedLoader(ctx);
    const voice = new SampledVoicePlayer(ctx, SPEC, new FakeGain(), loader).start(60, 1, 0);
    voice.release(2);
    const gain = ctx.gains.at(-1)!;
    const last = gain.gain.events.at(-1)!;
    expect(last).toEqual({ type: 'target', value: 0, when: 2, timeConstant: 0.25 / 3 });
    expect(ctx.bufferSources[0].stopWhen).toBeCloseTo(2.75, 6); // 2 + 3*0.25
    ctx.bufferSources[0].onended?.();
    expect(gain.disconnected).toBe(true);
  });

  it('stop is a fast fade', async () => {
    const ctx = new FakeCtx();
    const loader = await loadedLoader(ctx);
    const voice = new SampledVoicePlayer(ctx, SPEC, new FakeGain(), loader).start(60, 1, 0);
    voice.stop(2);
    expect(ctx.bufferSources[0].stopWhen).toBeCloseTo(2.09, 6); // 2 + 3*FAST_STOP_S
  });
});
