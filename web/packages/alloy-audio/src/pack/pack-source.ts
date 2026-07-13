// Byte-origin + decode seams for pack loading. Both keep WebAudio/network at
// the host edge (injected), so the loader's logic stays testable offline.
// Twin: PackSource.swift + SampleDecoder.swift.

import { validateManifest, type PackManifest } from './manifest.js';

export type EncodedBytes = Uint8Array;

/** Mono PCM decoded from one .m4a. */
export interface DecodedPcm {
  sampleRate: number;
  data: Float32Array;
}

/** Decodes encoded (.m4a) bytes to mono PCM. Host-injected. */
export interface SampleDecoder {
  decode(bytes: EncodedBytes): Promise<DecodedPcm>;
}

/** Byte origin for a pack: manifest + per-zone encoded bytes. */
export interface PackSource {
  fetchManifest(): Promise<PackManifest>;
  fetchZone(file: string): Promise<EncodedBytes>;
}

/** Minimal fetch surface (inject globalThis.fetch or a test double). */
export type FetchFn = (url: string) => Promise<{
  json(): Promise<unknown>;
  arrayBuffer(): Promise<ArrayBuffer>;
}>;

/** Pack fetched from a base URL/path: `${base}/manifest.json`, `${base}/<file>`. */
export class BasePathPackSource implements PackSource {
  constructor(
    private readonly base: string,
    private readonly fetchFn: FetchFn,
  ) {}

  async fetchManifest(): Promise<PackManifest> {
    const res = await this.fetchFn(`${this.base}/manifest.json`);
    const manifest = (await res.json()) as PackManifest;
    const errors = validateManifest(manifest);
    if (errors.length > 0) throw new Error(`invalid manifest: ${errors.join('; ')}`);
    return manifest;
  }

  async fetchZone(file: string): Promise<EncodedBytes> {
    const res = await this.fetchFn(`${this.base}/${file}`);
    return new Uint8Array(await res.arrayBuffer());
  }
}

/** Minimal decode context (inject an AudioContext or a test double). */
export interface MinimalDecodeContext {
  decodeAudioData(data: ArrayBuffer): Promise<{
    sampleRate: number;
    numberOfChannels: number;
    getChannelData(channel: number): Float32Array;
  }>;
}

/** SampleDecoder backed by a WebAudio-like context; downmixes to mono. */
export class WebAudioDecoder implements SampleDecoder {
  constructor(private readonly ctx: MinimalDecodeContext) {}

  async decode(bytes: EncodedBytes): Promise<DecodedPcm> {
    const copy = bytes.slice();
    const buffer = await this.ctx.decodeAudioData(copy.buffer);
    const channels = buffer.numberOfChannels;
    const frames = buffer.getChannelData(0).length;
    const data = new Float32Array(frames);
    for (let c = 0; c < channels; c++) {
      const ch = buffer.getChannelData(c);
      for (let i = 0; i < frames; i++) data[i] += ch[i] / channels;
    }
    return { sampleRate: buffer.sampleRate, data };
  }
}
