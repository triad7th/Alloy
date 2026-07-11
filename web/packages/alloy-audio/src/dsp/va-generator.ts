// Virtual-analog unison stack: N polyBLEP oscillators spread evenly across
// ±detuneCents/2, phases seeded from DspPrng so renders are deterministic.
// Absorbs the legacy supersaw (phase 1b migrates it here). Sustained kind:
// the voice TVA ends the note. Twin: VaGenerator.swift.

import { DspPrng } from './prng.js';
import { PolyBlepOscillator, type OscShape } from './poly-blep-oscillator.js';
import type { ToneGenerator } from './dsp-types.js';
import { midiToFrequency } from '../pitch.js';

export interface VaParams {
  shape: OscShape;
  /** Number of stacked oscillators, >= 1. */
  unison: number;
  /** Total detune spread in cents across the stack. */
  detuneCents: number;
  pulseWidth?: number;
}

export class VaGenerator implements ToneGenerator {
  private readonly oscillators: PolyBlepOscillator[];
  private readonly gainNorm: number;
  private baseFrequencies: number[];
  private pitchRatio = 1;
  private amp = 0;
  private keyed = false;

  constructor(
    private readonly params: VaParams,
    sampleRate: number,
    seed = 1,
  ) {
    const prng = new DspPrng(seed);
    this.oscillators = Array.from(
      { length: Math.max(1, params.unison) },
      () => new PolyBlepOscillator(params.shape, sampleRate, prng.next(), params.pulseWidth ?? 0.5),
    );
    this.gainNorm = 1 / Math.sqrt(this.oscillators.length);
    this.baseFrequencies = this.oscillators.map(() => 0);
  }

  /** Sustained kind: never self-finishes; the voice TVA ends the note. */
  get finished(): boolean {
    return false;
  }

  noteOn(midi: number, velocity: number): void {
    const base = midiToFrequency(midi);
    const count = this.oscillators.length;
    this.baseFrequencies = this.oscillators.map((_, i) => {
      const cents =
        count === 1 ? 0 : -this.params.detuneCents / 2 + (this.params.detuneCents * i) / (count - 1);
      return base * 2 ** (cents / 1200);
    });
    this.pitchRatio = 1;
    this.applyPitch();
    this.amp = velocity;
    this.keyed = true;
  }

  noteOff(): void {
    // Intentionally empty: no intrinsic envelope to key up.
  }

  setPitchRatio(ratio: number): void {
    this.pitchRatio = ratio;
    this.applyPitch();
  }

  private applyPitch(): void {
    this.oscillators.forEach((osc, i) => {
      osc.setFrequency(this.baseFrequencies[i] * this.pitchRatio);
    });
  }

  render(out: Float32Array, frames: number): void {
    if (!this.keyed) {
      return;
    }
    for (let n = 0; n < frames; n++) {
      let sample = 0;
      for (const osc of this.oscillators) {
        sample += osc.nextSample();
      }
      out[n] += sample * this.gainNorm * this.amp;
    }
  }
}
