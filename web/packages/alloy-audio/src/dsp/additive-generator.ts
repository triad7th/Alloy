// Sine partial bank — drawbar organs are literally this (a 9-partial
// preset), and it doubles as a clean pad/bell generator. Sustained kind:
// renders until the voice's TVA (phase 1b) ends the note; noteOff is a
// no-op here. Twin: AdditiveGenerator.swift.

import { TWO_PI, type ToneGenerator } from './dsp-types.js';
import { midiToFrequency } from '../pitch.js';

export interface AdditivePartial {
  /** Frequency ratio relative to the note frequency. */
  ratio: number;
  /** Linear amplitude of this partial. */
  level: number;
}

export class AdditiveGenerator implements ToneGenerator {
  private readonly phases: number[];
  private frequency = 0;
  private pitchRatio = 1;
  private amp = 0;
  private keyed = false;

  constructor(
    private readonly partials: readonly AdditivePartial[],
    private readonly sampleRate: number,
  ) {
    this.phases = partials.map(() => 0);
  }

  /** Sustained kind: never self-finishes; the voice TVA ends the note. */
  get finished(): boolean {
    return false;
  }

  noteOn(midi: number, velocity: number): void {
    this.pitchRatio = 1;
    this.frequency = midiToFrequency(midi);
    this.amp = velocity;
    this.keyed = true;
    this.phases.fill(0);
  }

  noteOff(): void {
    // Intentionally empty: no intrinsic envelope to key up.
  }

  setPitchRatio(ratio: number): void {
    this.pitchRatio = ratio;
  }

  render(out: Float32Array, frames: number): void {
    if (!this.keyed) {
      return;
    }
    for (let n = 0; n < frames; n++) {
      let sample = 0;
      for (let p = 0; p < this.partials.length; p++) {
        sample += Math.sin(TWO_PI * this.phases[p]) * this.partials[p].level;
        this.phases[p] += (this.frequency * this.pitchRatio * this.partials[p].ratio) / this.sampleRate;
        this.phases[p] -= Math.floor(this.phases[p]);
      }
      out[n] += sample * this.amp;
    }
  }
}
