// Modulation LFO with delay + fade-in gate (vibrato that arrives late is
// the single most "played by a human" trick in the rompler book).
// Twin: Lfo.swift.

import { TWO_PI } from './dsp-types.js';

export type LfoShape = 'sine' | 'triangle';

export interface LfoParams {
  shape: LfoShape;
  rateHz: number;
  /** Seconds of silence before the LFO starts. */
  delay: number;
  /** Seconds to ramp depth 0 → 1 once started. */
  fadeIn: number;
}

export class Lfo {
  private phase = 0;
  private elapsed = 0;

  constructor(
    private readonly params: LfoParams,
    private readonly sampleRate: number,
  ) {}

  /** Next value in [−1, 1], gated by the delay/fade-in window. */
  nextSample(): number {
    const delaySamples = this.params.delay * this.sampleRate;
    const fadeSamples = this.params.fadeIn * this.sampleRate;
    const since = this.elapsed - delaySamples;
    this.elapsed += 1;
    if (since < 0) {
      return 0;
    }
    const gate = fadeSamples <= 0 ? 1 : Math.min(1, since / fadeSamples);
    const raw = this.params.shape === 'sine' ? Math.sin(TWO_PI * this.phase) : triangle(this.phase);
    this.phase += this.params.rateHz / this.sampleRate;
    this.phase -= Math.floor(this.phase);
    return raw * gate;
  }
}

/** Sine-aligned triangle: 0 → +1 → −1 → 0 across one cycle. */
function triangle(p: number): number {
  if (p < 0.25) {
    return 4 * p;
  }
  if (p < 0.75) {
    return 2 - 4 * p;
  }
  return 4 * p - 4;
}
