// Progressive pack loader: fetch + decode a pack into SampleZoneData, and BE a
// stateful ZoneSetProvider (null until a zone set finishes decoding). The
// engine's existing null-handling (voice.ts: unresolvable zoneSetId => layer
// inactive) turns this into progressive delivery + synth fallback for free.
// Twin: PackLoader.swift.

import type { SampleZoneData, VelocityLayerData } from '../dsp/sample-zone-generator.js';
import type { ZoneSpec } from './manifest.js';
import type { PackSource, SampleDecoder } from './pack-source.js';

export class PackLoader {
  private readonly zoneSets = new Map<string, VelocityLayerData[]>();

  constructor(
    private readonly source: PackSource,
    private readonly decoder: SampleDecoder,
  ) {}

  /** Fetch the manifest, then fetch + decode each zone set; publish each zone
   *  set into the resolver map as it completes (progressive). */
  async load(): Promise<void> {
    const manifest = await this.source.fetchManifest();
    for (const [zoneSetId, spec] of Object.entries(manifest.zoneSets)) {
      const layers: VelocityLayerData[] = [];
      for (const layer of spec.layers) {
        const zones: SampleZoneData[] = [];
        for (const z of layer.zones) {
          const bytes = await this.source.fetchZone(z.file);
          const pcm = await this.decoder.decode(bytes);
          zones.push(buildZone(z, pcm.sampleRate, pcm.data));
        }
        layers.push({ topVelocity: layer.topVelocity, zones });
      }
      this.zoneSets.set(zoneSetId, layers);
    }
  }

  /** ZoneSetProvider: null until the zone set has decoded, then its layers. */
  provide = (zoneSetId: string): readonly VelocityLayerData[] | null => this.zoneSets.get(zoneSetId) ?? null;
}

/** Fold gain into the PCM and tuneCents into a fractional root; produce the
 *  runtime SampleZoneData without touching SampleZoneGenerator. */
export function buildZone(spec: ZoneSpec, sampleRate: number, pcm: Float32Array): SampleZoneData {
  const data = new Float32Array(pcm.length);
  for (let i = 0; i < pcm.length; i++) data[i] = pcm[i] * spec.gain;
  return {
    rootMidi: spec.rootMidi + spec.tuneCents / 100,
    sampleRate,
    data,
    ...(spec.loopStart !== undefined && spec.loopEnd !== undefined
      ? { loopStart: spec.loopStart, loopEnd: spec.loopEnd }
      : {}),
  };
}
