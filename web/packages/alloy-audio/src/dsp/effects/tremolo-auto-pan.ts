// Tremolo/auto-pan — an amplitude LFO applied independently to L and R,
// with the R phase offset by `spread` half-turns. spread 0 keeps both
// channels in phase (classic tremolo); spread 1 puts them a half-cycle
// apart (hard auto-pan, L and R gains swap peaks/troughs).
// Twin: TremoloAutoPan.swift.

import { TWO_PI } from '../dsp-types.js';
import type { EffectUnit, TremoloParams } from './effect-types.js';

export class TremoloAutoPan implements EffectUnit {
  private phase = 0;

  constructor(
    private readonly params: TremoloParams,
    private readonly sampleRate: number,
  ) {}

  reset(): void {
    this.phase = 0;
  }

  process(left: Float32Array, right: Float32Array, frames: number): void {
    const { rateHz, depth, spread } = this.params;

    for (let i = 0; i < frames; i++) {
      const gainL = 1 - depth * (0.5 + 0.5 * Math.sin(TWO_PI * this.phase));
      const gainR = 1 - depth * (0.5 + 0.5 * Math.sin(TWO_PI * this.phase + Math.PI * spread));
      left[i] = left[i] * gainL;
      right[i] = right[i] * gainR;

      this.phase += rateHz / this.sampleRate;
      this.phase -= Math.floor(this.phase);
    }
  }
}
