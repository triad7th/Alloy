// Web platform edge: progressive fetch + decode of sample zones. Semantic
// twin of AlloyAudio's SampleSource/zone store on the Swift side; the shared
// contract is the naming convention (zero-padded-MIDI mp3) and the
// nearest-zone lookup with its lower-zone tie-break.

import type { MinimalAudioBuffer, MinimalAudioContext } from './audio-graph.js';

export type FetchSample = (url: string) => Promise<ArrayBuffer>;

/** '060.mp3' — sample assets are named by zero-padded MIDI number. */
export function sampleFileName(midi: number): string {
  return `${String(midi).padStart(3, '0')}.mp3`;
}

const defaultFetch: FetchSample = async (url) => {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} for ${url}`);
  }
  return response.arrayBuffer();
};

/**
 * Progressively fetches and decodes one instrument's sample zones. Each zone
 * becomes playable the moment it decodes; failures are skipped silently (the
 * caller keeps using its synth fallback or the nearest zone that did load).
 */
export class SampleLoader {
  private readonly buffers = new Map<number, MinimalAudioBuffer>();
  private started = false;

  constructor(
    private readonly ctx: MinimalAudioContext,
    private readonly baseUrl: string,
    private readonly midis: readonly number[],
    private readonly fetchSample: FetchSample = defaultFetch,
  ) {}

  /** Kick off all fetches (idempotent). Decode happens per-file as data lands. */
  start(): void {
    if (this.started) {
      return;
    }
    this.started = true;
    for (const midi of this.midis) {
      void this.load(midi);
    }
  }

  get loadedCount(): number {
    return this.buffers.size;
  }

  /** Nearest loaded zone to `midi` (ties prefer the lower zone), or null. */
  nearestLoaded(midi: number): { midi: number; buffer: MinimalAudioBuffer } | null {
    let best: number | null = null;
    for (const zone of this.buffers.keys()) {
      if (
        best === null ||
        Math.abs(zone - midi) < Math.abs(best - midi) ||
        (Math.abs(zone - midi) === Math.abs(best - midi) && zone < best)
      ) {
        best = zone;
      }
    }
    return best === null ? null : { midi: best, buffer: this.buffers.get(best)! };
  }

  private async load(midi: number): Promise<void> {
    try {
      const data = await this.fetchSample(`${this.baseUrl}/${sampleFileName(midi)}`);
      const buffer = await this.ctx.decodeAudioData(data);
      this.buffers.set(midi, buffer);
    } catch {
      /* skip this zone; playback uses the nearest zone that did load */
    }
  }
}
