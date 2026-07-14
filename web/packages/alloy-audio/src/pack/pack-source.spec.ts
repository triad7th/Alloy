import { describe, expect, it } from 'vitest';
import { PACK_SCHEMA_VERSION, type PackManifest } from './manifest.js';
import { BasePathPackSource, WebAudioDecoder, type FetchFn, type MinimalDecodeContext } from './pack-source.js';

function goodManifest(): PackManifest {
  return {
    schemaVersion: PACK_SCHEMA_VERSION,
    id: 'grand-piano',
    tier: 'standard',
    sampleRate: 48000,
    format: 'm4a',
    zoneSets: {
      piano: {
        layers: [{ topVelocity: 1, zones: [{ rootMidi: 60, file: 'c4.m4a', gain: 1, tuneCents: 0 }] }],
      },
    },
    credits: [],
  };
}

describe('BasePathPackSource', () => {
  it('fetchManifest requests `${base}/manifest.json` and returns the parsed manifest', async () => {
    const requested: string[] = [];
    const manifest = goodManifest();
    const fetchFn: FetchFn = async (url) => {
      requested.push(url);
      return { json: async () => manifest, arrayBuffer: async () => new ArrayBuffer(0) };
    };
    const source = new BasePathPackSource('packs/piano', fetchFn);

    const result = await source.fetchManifest();

    expect(requested).toEqual(['packs/piano/manifest.json']);
    expect(result).toEqual(manifest);
  });

  it('fetchManifest throws on an invalid manifest', async () => {
    const badManifest = { ...goodManifest(), tier: 'ultra' } as unknown as PackManifest;
    const fetchFn: FetchFn = async () => ({
      json: async () => badManifest,
      arrayBuffer: async () => new ArrayBuffer(0),
    });
    const source = new BasePathPackSource('packs/piano', fetchFn);

    await expect(source.fetchManifest()).rejects.toThrow(/invalid manifest/);
  });

  it('fetchZone requests `${base}/<file>` and returns the bytes as a Uint8Array', async () => {
    const requested: string[] = [];
    const bytes = new Uint8Array([1, 2, 3, 4]);
    const fetchFn: FetchFn = async (url) => {
      requested.push(url);
      return { json: async () => ({}), arrayBuffer: async () => bytes.buffer };
    };
    const source = new BasePathPackSource('packs/piano', fetchFn);

    const result = await source.fetchZone('c4.m4a');

    expect(requested).toEqual(['packs/piano/c4.m4a']);
    expect(result).toBeInstanceOf(Uint8Array);
    expect(Array.from(result)).toEqual([1, 2, 3, 4]);
  });

  it('fetchZone percent-encodes a sharp in the filename (an unencoded # is a URL fragment)', async () => {
    // The real piano pack names 14 of its 30 roots with a sharp: `D#4v12.m4a`.
    // Unencoded, the browser cuts the URL at `#` and requests `packs/piano/D`,
    // a static host answers with its index page, and the decoder fails on HTML.
    const requested: string[] = [];
    const fetchFn: FetchFn = async (url) => {
      requested.push(url);
      return { json: async () => ({}), arrayBuffer: async () => new Uint8Array([9]).buffer };
    };
    const source = new BasePathPackSource('packs/piano', fetchFn);

    await source.fetchZone('D#4v12.m4a');

    expect(requested).toEqual(['packs/piano/D%234v12.m4a']);
  });

  it('fetchZone keeps `/` intact so a pack can nest zones in subdirectories', async () => {
    const requested: string[] = [];
    const fetchFn: FetchFn = async (url) => {
      requested.push(url);
      return { json: async () => ({}), arrayBuffer: async () => new Uint8Array([9]).buffer };
    };
    const source = new BasePathPackSource('packs/piano', fetchFn);

    await source.fetchZone('layer3/D#4v12.m4a');

    expect(requested).toEqual(['packs/piano/layer3/D%234v12.m4a']);
  });
});

describe('WebAudioDecoder', () => {
  it('downmixes to the per-sample average across channels and preserves sampleRate', async () => {
    const left = new Float32Array([1, 0.5, -1, 0]);
    const right = new Float32Array([0, 0.5, -1, 1]);
    const ctx: MinimalDecodeContext = {
      decodeAudioData: async () => ({
        sampleRate: 44100,
        numberOfChannels: 2,
        getChannelData: (channel: number) => (channel === 0 ? left : right),
      }),
    };
    const decoder = new WebAudioDecoder(ctx);

    const result = await decoder.decode(new Uint8Array([0, 1, 2, 3]));

    expect(result.sampleRate).toBe(44100);
    expect(Array.from(result.data)).toEqual([0.5, 0.5, -1, 0.5]);
  });
});
