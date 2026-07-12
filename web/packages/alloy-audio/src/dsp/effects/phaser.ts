// Multi-stage allpass phaser — per channel, a chain of `stages` first-order
// allpass filters sharing one swept coefficient, plus feedback from the
// chain's last output. The coefficient (tan/pow-heavy) is recomputed only
// once per EFFECT_CONTROL_INTERVAL samples (control rate); the allpass
// chain itself runs every sample (full rate) — same two-rate philosophy as
// the voice's TVF/LFO (see voice.ts CONTROL_INTERVAL). Twin: Phaser.swift.

import { TWO_PI } from '../dsp-types.js';
import { EFFECT_CONTROL_INTERVAL, type EffectUnit, type PhaserParams } from './effect-types.js';

/** Sweep range for the shared allpass coefficient's underlying cutoff. */
export const PHASER_F_MIN = 200;
export const PHASER_F_MAX = 2200;

const OFFSET_L = 0;
const OFFSET_R = 0.25;

export class Phaser implements EffectUnit {
  private readonly zL: Float64Array;
  private readonly zR: Float64Array;
  private lastOutL = 0;
  private lastOutR = 0;
  private phase = 0;
  private sampleCounter = 0;
  private coefL = 0;
  private coefR = 0;

  constructor(
    private readonly params: PhaserParams,
    private readonly sampleRate: number,
  ) {
    this.zL = new Float64Array(params.stages);
    this.zR = new Float64Array(params.stages);
    this.updateCoefficients();
  }

  reset(): void {
    this.zL.fill(0);
    this.zR.fill(0);
    this.lastOutL = 0;
    this.lastOutR = 0;
    this.phase = 0;
    this.sampleCounter = 0;
    this.updateCoefficients();
  }

  process(left: Float32Array, right: Float32Array, frames: number): void {
    const { stages, feedback, mix } = this.params;
    const { zL, zR } = this;

    for (let i = 0; i < frames; i++) {
      if (this.sampleCounter % EFFECT_CONTROL_INTERVAL === 0) {
        this.updateCoefficients();
      }

      const l = left[i];
      const r = right[i];

      let xl = l + this.lastOutL * feedback;
      for (let s = 0; s < stages; s++) {
        const y = -this.coefL * xl + zL[s];
        zL[s] = xl + this.coefL * y;
        xl = y;
      }
      this.lastOutL = xl;

      let xr = r + this.lastOutR * feedback;
      for (let s = 0; s < stages; s++) {
        const y = -this.coefR * xr + zR[s];
        zR[s] = xr + this.coefR * y;
        xr = y;
      }
      this.lastOutR = xr;

      left[i] = l * (1 - mix) + xl * mix;
      right[i] = r * (1 - mix) + xr * mix;

      this.phase += this.params.rateHz / this.sampleRate;
      this.phase -= Math.floor(this.phase);
      this.sampleCounter++;
    }
  }

  private updateCoefficients(): void {
    const { depth } = this.params;

    const sweepL = 0.5 + 0.5 * depth * Math.sin(TWO_PI * (this.phase + OFFSET_L));
    const fL = PHASER_F_MIN * (PHASER_F_MAX / PHASER_F_MIN) ** sweepL;
    const tL = Math.tan((Math.PI * fL) / this.sampleRate);
    this.coefL = (tL - 1) / (tL + 1);

    const sweepR = 0.5 + 0.5 * depth * Math.sin(TWO_PI * (this.phase + OFFSET_R));
    const fR = PHASER_F_MIN * (PHASER_F_MAX / PHASER_F_MIN) ** sweepR;
    const tR = Math.tan((Math.PI * fR) / this.sampleRate);
    this.coefR = (tR - 1) / (tR + 1);
  }
}
