// Modulated-delay stereo chorus/ensemble — the identity effect of the
// rompler aesthetic. Sums the incoming stereo pair to mono, writes it into a
// single circular delay buffer, then reads back 2 (chorus) or 3 (ensemble)
// taps whose delay sweeps sinusoidally around BASE_DELAY_MS, spread across
// phase offsets so the taps drift in and out of alignment with each other.
// Twin: StereoChorus.swift.

import { TWO_PI } from '../dsp-types.js';
import type { ChorusParams, EffectUnit } from './effect-types.js';

const BASE_DELAY_MS = 7;
const CHORUS_OFFSETS: readonly number[] = [0, 0.25];
const ENSEMBLE_OFFSETS: readonly number[] = [0, 1 / 3, 2 / 3];
const ENSEMBLE_WEIGHTS_L: readonly number[] = [0.55, 0.3, 0.15];
const ENSEMBLE_WEIGHTS_R: readonly number[] = [0.15, 0.3, 0.55];
const MAX_TAPS = 3;

export class StereoChorus implements EffectUnit {
  private readonly buffer: Float32Array;
  private readonly bufferSize: number;
  private readonly offsets: readonly number[];
  private readonly tapScratch = new Float32Array(MAX_TAPS);
  private writeIndex = 0;
  private phase = 0;

  constructor(
    private readonly params: ChorusParams,
    private readonly sampleRate: number,
  ) {
    this.bufferSize = Math.ceil(((BASE_DELAY_MS + params.depthMs + 2) / 1000) * sampleRate);
    this.buffer = new Float32Array(this.bufferSize);
    this.offsets = params.mode === 'ensemble' ? ENSEMBLE_OFFSETS : CHORUS_OFFSETS;
  }

  reset(): void {
    this.buffer.fill(0);
    this.writeIndex = 0;
    this.phase = 0;
  }

  process(left: Float32Array, right: Float32Array, frames: number): void {
    const { depthMs, mix, mode } = this.params;
    const { buffer, bufferSize, offsets, tapScratch, sampleRate } = this;
    const tapCount = offsets.length;

    for (let i = 0; i < frames; i++) {
      const l = left[i];
      const r = right[i];
      buffer[this.writeIndex] = (l + r) * 0.5;

      for (let t = 0; t < tapCount; t++) {
        const delaySamples =
          ((BASE_DELAY_MS + depthMs * Math.sin(TWO_PI * (this.phase + offsets[t]))) / 1000) * sampleRate;
        const readPos = this.writeIndex - delaySamples;
        const idx0Raw = Math.floor(readPos);
        const frac = readPos - idx0Raw;
        const idx0 = ((idx0Raw % bufferSize) + bufferSize) % bufferSize;
        const idx1 = (idx0 + 1) % bufferSize;
        const s0 = buffer[idx0];
        const s1 = buffer[idx1];
        tapScratch[t] = s0 + (s1 - s0) * frac;
      }

      if (mode === 'ensemble') {
        let wetL = 0;
        let wetR = 0;
        for (let t = 0; t < tapCount; t++) {
          wetL += ENSEMBLE_WEIGHTS_L[t] * tapScratch[t];
          wetR += ENSEMBLE_WEIGHTS_R[t] * tapScratch[t];
        }
        left[i] = l * (1 - mix) + wetL * mix;
        right[i] = r * (1 - mix) + wetR * mix;
      } else {
        left[i] = l * (1 - mix) + tapScratch[0] * mix;
        right[i] = r * (1 - mix) + tapScratch[1] * mix;
      }

      this.writeIndex = (this.writeIndex + 1) % bufferSize;
      this.phase += this.params.rateHz / sampleRate;
      this.phase -= Math.floor(this.phase);
    }
  }
}
