// Sample playback with zones, velocity layers, loops, and Catmull-Rom
// cubic interpolation. Loop crossfades are baked into pack assets by the
// content pipeline (phase 3); at runtime a loop is a plain wrap. noteOff
// is a no-op: unlooped content rings out, the voice TVA owns key-up.
// Twin: SampleZoneGenerator.swift.

import type { ToneGenerator } from './dsp-types.js';
import { midiToFrequency } from '../pitch.js';

export interface SampleZoneData {
  rootMidi: number;
  sampleRate: number;
  /** Mono in phase 1a; stereo arrives with the pack pipeline. */
  data: Float32Array;
  /** Loop region [loopStart, loopEnd) in samples; omit for one-shots. */
  loopStart?: number;
  loopEnd?: number;
}

export interface VelocityLayerData {
  /** Inclusive upper bound of this layer's velocity range, 0..1. Sorted ascending. */
  topVelocity: number;
  zones: readonly SampleZoneData[];
}

interface ZoneRead {
  zone: SampleZoneData;
  gain: number;
  pos: number;
  rate: number;
  ended: boolean;
}

export class SampleZoneGenerator implements ToneGenerator {
  private reads: ZoneRead[] = [];

  constructor(
    private readonly layers: readonly VelocityLayerData[],
    private readonly crossfade: number,
    private readonly sampleRate: number,
  ) {}

  get finished(): boolean {
    return this.reads.length > 0 && this.reads.every((r) => r.ended);
  }

  noteOn(midi: number, velocity: number): void {
    this.reads = this.pickLayers(velocity).map(({ layer, gain }) => {
      const zone = nearestZone(layer.zones, midi);
      return {
        zone,
        gain: gain * velocity,
        pos: 0,
        rate:
          (midiToFrequency(midi) / midiToFrequency(zone.rootMidi)) *
          (zone.sampleRate / this.sampleRate),
        ended: false,
      };
    });
  }

  noteOff(): void {
    // Intentionally empty: unlooped content rings out; the TVA owns key-up.
  }

  render(out: Float32Array, frames: number): void {
    for (const read of this.reads) {
      if (read.ended) {
        continue;
      }
      const { data } = read.zone;
      const loop =
        read.zone.loopStart !== undefined &&
        read.zone.loopEnd !== undefined &&
        read.zone.loopEnd > read.zone.loopStart;
      for (let n = 0; n < frames; n++) {
        if (loop) {
          const loopStart = read.zone.loopStart!;
          const loopEnd = read.zone.loopEnd!;
          while (read.pos >= loopEnd) {
            read.pos -= loopEnd - loopStart;
          }
        } else if (read.pos >= data.length) {
          read.ended = true;
          break;
        }
        out[n] += cubicRead(read.zone, read.pos, loop) * read.gain;
        read.pos += read.rate;
      }
    }
  }

  /**
   * One or two layers with linear crossfade gains summing to 1. The
   * crossfade window straddles each boundary symmetrically: a velocity
   * within crossfade/2 of a boundary blends the layers on either side
   * (exactly on the boundary -> 50/50). Both directions must be checked
   * because findIndex lands an on-boundary velocity in the LOWER layer.
   */
  private pickLayers(velocity: number): Array<{ layer: VelocityLayerData; gain: number }> {
    const idx = this.layers.findIndex((l) => l.topVelocity >= velocity);
    const primary = idx === -1 ? this.layers.length - 1 : idx;
    if (this.crossfade > 0) {
      if (primary > 0) {
        const boundary = this.layers[primary - 1].topVelocity;
        const distance = velocity - boundary;
        if (distance >= 0 && distance < this.crossfade / 2) {
          const upperGain = 0.5 + distance / this.crossfade;
          return [
            { layer: this.layers[primary], gain: upperGain },
            { layer: this.layers[primary - 1], gain: 1 - upperGain },
          ];
        }
      }
      if (primary < this.layers.length - 1) {
        const boundary = this.layers[primary].topVelocity;
        const distance = boundary - velocity;
        if (distance >= 0 && distance < this.crossfade / 2) {
          const lowerGain = 0.5 + distance / this.crossfade;
          return [
            { layer: this.layers[primary], gain: lowerGain },
            { layer: this.layers[primary + 1], gain: 1 - lowerGain },
          ];
        }
      }
    }
    return [{ layer: this.layers[primary], gain: 1 }];
  }
}

/** Nearest zone by rootMidi; ties prefer the lower zone (mirrors SampleLoader). */
function nearestZone(zones: readonly SampleZoneData[], midi: number): SampleZoneData {
  let best = zones[0];
  for (const zone of zones) {
    const d = Math.abs(zone.rootMidi - midi);
    const bestD = Math.abs(best.rootMidi - midi);
    if (d < bestD || (d === bestD && zone.rootMidi < best.rootMidi)) {
      best = zone;
    }
  }
  return best;
}

/** Catmull-Rom 4-point read at fractional position `pos`. */
function cubicRead(zone: SampleZoneData, pos: number, loop: boolean): number {
  const data = zone.data;
  const i = Math.floor(pos);
  const f = pos - i;
  const at = (k: number): number => {
    let idx = i + k;
    if (loop) {
      const loopStart = zone.loopStart!;
      const loopEnd = zone.loopEnd!;
      while (idx >= loopEnd) {
        idx -= loopEnd - loopStart;
      }
    }
    if (idx < 0 || idx >= data.length) {
      return 0;
    }
    return data[idx];
  };
  const x0 = at(-1);
  const x1 = at(0);
  const x2 = at(1);
  const x3 = at(2);
  return (
    x1 +
    0.5 * f * (x2 - x0 + f * (2 * x0 - 5 * x1 + 4 * x2 - x3 + f * (3 * (x1 - x2) + x3 - x0)))
  );
}
