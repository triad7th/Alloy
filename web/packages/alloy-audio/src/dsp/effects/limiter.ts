// Master lookahead brickwall limiter. A LIMITER_LOOKAHEAD_SAMPLES ring delay
// plus a sliding window-peak guarantees the output never exceeds the ceiling
// with zero overshoot. Stereo-linked (one gain drives both channels).
// Per-sample gain — no control-rate stepping (zipper-safe). Twin: Limiter.swift.

import { LIMITER_LOOKAHEAD_SAMPLES, type EffectUnit, type LimiterParams } from './effect-types.js';

export class Limiter implements EffectUnit {
  private readonly L = LIMITER_LOOKAHEAD_SAMPLES;
  private readonly delayL = new Float32Array(LIMITER_LOOKAHEAD_SAMPLES);
  private readonly delayR = new Float32Array(LIMITER_LOOKAHEAD_SAMPLES);
  private readonly peakBuf = new Float32Array(LIMITER_LOOKAHEAD_SAMPLES);
  private pos = 0;
  private gain = 1;
  private readonly ceiling: number;
  private readonly releaseCoef: number;

  constructor(
    private readonly params: LimiterParams,
    sampleRate: number,
  ) {
    this.ceiling = 10 ** (params.ceilingDb / 20);
    this.releaseCoef = 1 - Math.exp(-1 / ((params.releaseMs / 1000) * sampleRate));
  }

  get latencySamples(): number {
    return this.L;
  }

  reset(): void {
    this.delayL.fill(0);
    this.delayR.fill(0);
    this.peakBuf.fill(0);
    this.pos = 0;
    this.gain = 1;
  }

  process(left: Float32Array, right: Float32Array, frames: number): void {
    const L = this.L;
    for (let i = 0; i < frames; i++) {
      const inL = left[i];
      const inR = right[i];

      // Emit the delayed sample at the current ring slot, then overwrite it.
      const outL = this.delayL[this.pos];
      const outR = this.delayR[this.pos];
      this.delayL[this.pos] = inL;
      this.delayR[this.pos] = inR;
      this.peakBuf[this.pos] = Math.max(Math.abs(inL), Math.abs(inR));

      this.pos++;
      if (this.pos >= L) this.pos = 0;

      // Peak over the whole lookahead window (the peak entered up to L samples
      // ago, so it is already accounted for before it reaches the output).
      let windowPeak = 0;
      for (let k = 0; k < L; k++) {
        const p = this.peakBuf[k];
        if (p > windowPeak) windowPeak = p;
      }
      const target = windowPeak > this.ceiling ? this.ceiling / windowPeak : 1;

      // Instant attack (clamp down immediately), per-sample one-pole release.
      if (target < this.gain) {
        this.gain = target;
      } else {
        this.gain += this.releaseCoef * (target - this.gain);
      }

      left[i] = outL * this.gain;
      right[i] = outR * this.gain;
    }
  }
}
