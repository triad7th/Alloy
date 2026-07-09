import { describe, it, expect } from 'vitest';
import { SampleLoader, sampleFileName } from './sample-loader.js';
import { FakeBuffer, FakeCtx } from './testing/fake-audio-graph.js';

/** fetch stub: resolves URLs on demand, records requests. */
function fetchController() {
  const pending = new Map<string, { resolve(): void; reject(): void }>();
  const requested: string[] = [];
  const fetchSample = (url: string) =>
    new Promise<ArrayBuffer>((resolve, reject) => {
      requested.push(url);
      pending.set(url, {
        resolve: () => resolve(new ArrayBuffer(8)),
        reject: () => reject(new Error('404')),
      });
    });
  return { fetchSample, pending, requested };
}

describe('SampleLoader', () => {
  it('names sample files by zero-padded midi number', () => {
    expect(sampleFileName(21)).toBe('021.mp3');
    expect(sampleFileName(108)).toBe('108.mp3');
  });

  it('fetches every zone once on start and exposes zones as they decode', async () => {
    const ctx = new FakeCtx();
    const { fetchSample, pending, requested } = fetchController();
    const loader = new SampleLoader(ctx, 'samples/grand-piano', [60, 63, 66], fetchSample);
    expect(loader.nearestLoaded(60)).toBeNull();
    loader.start();
    loader.start(); // idempotent
    expect(requested).toEqual([
      'samples/grand-piano/060.mp3',
      'samples/grand-piano/063.mp3',
      'samples/grand-piano/066.mp3',
    ]);
    pending.get('samples/grand-piano/063.mp3')!.resolve();
    await Promise.resolve(); // let fetch settle
    await Promise.resolve(); // let decode settle
    expect(loader.loadedCount).toBe(1);
    expect(loader.nearestLoaded(60)!.midi).toBe(63); // only loaded zone wins
  });

  it('picks the nearest loaded zone, preferring the lower zone on ties', async () => {
    const ctx = new FakeCtx();
    const { fetchSample, pending } = fetchController();
    const loader = new SampleLoader(ctx, 'base', [60, 66], fetchSample);
    loader.start();
    pending.get('base/060.mp3')!.resolve();
    pending.get('base/066.mp3')!.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(loader.nearestLoaded(61)!.midi).toBe(60);
    expect(loader.nearestLoaded(65)!.midi).toBe(66);
    expect(loader.nearestLoaded(63)!.midi).toBe(60); // tie -> lower
  });

  it('skips zones that fail to fetch or decode', async () => {
    const ctx = new FakeCtx();
    ctx.decodeImpl = (data) =>
      data.byteLength === 0
        ? Promise.reject(new Error('bad data'))
        : Promise.resolve(new FakeBuffer(2, 10, ctx.sampleRate));
    const { fetchSample, pending } = fetchController();
    const loader = new SampleLoader(ctx, 'base', [60, 63], fetchSample);
    loader.start();
    pending.get('base/060.mp3')!.reject();
    pending.get('base/063.mp3')!.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(loader.loadedCount).toBe(1);
    expect(loader.nearestLoaded(60)!.midi).toBe(63);
  });
});
