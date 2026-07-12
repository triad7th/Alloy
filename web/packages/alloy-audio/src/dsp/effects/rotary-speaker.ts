// Rotary speaker (simplified crossed AM) — the mono sum runs through a
// one-pole crossover at 800 Hz; the high band ("horn") and low band ("drum")
// each get opposed-pan amplitude modulation at their own rotor rate.
// "Polished over realistic": AM + pan only, no doppler. Unity-center gains
// (1 ± depth·sin — at depth 0 each channel carries the full band sum m,
// matching the engine's unity mono→stereo convention; gains swing 0..2).
// Speed is baked per patch (no live-switch path yet). Cheap enough to run
// fully per-sample — no control ticks. Twin: RotarySpeaker.swift.

import { TWO_PI } from '../dsp-types.js';
import type { EffectUnit, RotaryParams } from './effect-types.js';

/** Rotor rates in Hz per speed setting. */
export const ROTARY_HORN_RATE_FAST = 6.6;
export const ROTARY_DRUM_RATE_FAST = 5.7;
export const ROTARY_HORN_RATE_SLOW = 0.8;
export const ROTARY_DRUM_RATE_SLOW = 0.7;

/** Horn/drum crossover frequency. */
export const ROTARY_CROSSOVER_HZ = 800;

export class RotarySpeaker implements EffectUnit {
  private readonly crossoverCoef: number;
  private readonly hornRate: number;
  private readonly drumRate: number;
  private lowState = 0;
  private hornPhase = 0;
  private drumPhase = 0;

  constructor(
    private readonly params: RotaryParams,
    private readonly sampleRate: number,
  ) {
    this.crossoverCoef = 1 - Math.exp((-TWO_PI * ROTARY_CROSSOVER_HZ) / sampleRate);
    this.hornRate = params.speed === 'fast' ? ROTARY_HORN_RATE_FAST : ROTARY_HORN_RATE_SLOW;
    this.drumRate = params.speed === 'fast' ? ROTARY_DRUM_RATE_FAST : ROTARY_DRUM_RATE_SLOW;
  }

  reset(): void {
    this.lowState = 0;
    this.hornPhase = 0;
    this.drumPhase = 0;
  }

  process(left: Float32Array, right: Float32Array, frames: number): void {
    const { depth, mix } = this.params;

    for (let i = 0; i < frames; i++) {
      const l = left[i];
      const r = right[i];

      const m = (l + r) / 2;
      this.lowState += this.crossoverCoef * (m - this.lowState);
      const low = this.lowState;
      const high = m - low;

      const hornL = 1 + depth * Math.sin(TWO_PI * this.hornPhase);
      const hornR = 1 + depth * Math.sin(TWO_PI * this.hornPhase + Math.PI);
      const drumL = 1 + depth * Math.sin(TWO_PI * this.drumPhase);
      const drumR = 1 + depth * Math.sin(TWO_PI * this.drumPhase + Math.PI);

      const wetL = high * hornL + low * drumL;
      const wetR = high * hornR + low * drumR;

      left[i] = l * (1 - mix) + wetL * mix;
      right[i] = r * (1 - mix) + wetR * mix;

      this.hornPhase += this.hornRate / this.sampleRate;
      this.hornPhase -= Math.floor(this.hornPhase);
      this.drumPhase += this.drumRate / this.sampleRate;
      this.drumPhase -= Math.floor(this.drumPhase);
    }
  }
}
