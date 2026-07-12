// Stereo-linked feed-forward compressor — a single max(|L|, |R|) detector
// drives both channels identically (link), so a loud transient on one
// channel ducks both together instead of skewing the stereo image. The
// detector's one-pole attack/release smoothing runs every sample (full
// rate); the log/pow-heavy gain computation runs once per
// EFFECT_CONTROL_INTERVAL samples (control rate) and is held constant
// across the tick — same two-rate philosophy as the phaser's swept
// coefficient (see phaser.ts). Twin: Compressor.swift.

import { EFFECT_CONTROL_INTERVAL, type CompressorParams, type EffectUnit } from './effect-types.js';

export class Compressor implements EffectUnit {
  private env = 0;
  private gain: number;
  private sampleCounter = 0;
  private readonly attackCoef: number;
  private readonly releaseCoef: number;

  constructor(
    private readonly params: CompressorParams,
    sampleRate: number,
  ) {
    this.attackCoef = 1 - Math.exp(-1 / ((params.attackMs / 1000) * sampleRate));
    this.releaseCoef = 1 - Math.exp(-1 / ((params.releaseMs / 1000) * sampleRate));
    this.gain = 10 ** (params.makeupDb / 20);
  }

  reset(): void {
    this.env = 0;
    this.gain = 10 ** (this.params.makeupDb / 20);
    this.sampleCounter = 0;
  }

  process(left: Float32Array, right: Float32Array, frames: number): void {
    const { thresholdDb, ratio, makeupDb } = this.params;

    for (let i = 0; i < frames; i++) {
      const l = left[i];
      const r = right[i];

      const d = Math.max(Math.abs(l), Math.abs(r));
      this.env += (d > this.env ? this.attackCoef : this.releaseCoef) * (d - this.env);

      if (this.sampleCounter % EFFECT_CONTROL_INTERVAL === 0) {
        const envDb = 20 * Math.log10(Math.max(this.env, 1e-6));
        const over = Math.max(0, envDb - thresholdDb);
        const reductionDb = over * (1 - 1 / ratio);
        this.gain = 10 ** ((makeupDb - reductionDb) / 20);
      }

      left[i] = l * this.gain;
      right[i] = r * this.gain;

      this.sampleCounter++;
    }
  }
}
