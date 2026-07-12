// Tempo-syncable stereo / ping-pong delay send unit with damped feedback.
// 100% wet; fed by the delay send tap. Twin: Delay.swift.

import { type DelayParams, type SendEffect } from './effect-types.js';

export class Delay implements SendEffect {
  private readonly bufL: Float32Array;
  private readonly bufR: Float32Array;
  private readonly size: number;
  private pos = 0;
  private readonly delaySamples: number;
  private lpL = 0;
  private lpR = 0;
  private readonly fb: number;
  private readonly dampCoef: number;
  private readonly pingpong: boolean;

  constructor(
    private readonly params: DelayParams,
    sampleRate: number,
  ) {
    this.delaySamples = Math.max(1, Math.round((params.timeMs / 1000) * sampleRate));
    this.size = this.delaySamples + 1;
    this.bufL = new Float32Array(this.size);
    this.bufR = new Float32Array(this.size);
    this.fb = params.feedback;
    this.dampCoef = params.damping;
    this.pingpong = params.mode === 'pingpong';
  }

  reset(): void {
    this.bufL.fill(0);
    this.bufR.fill(0);
    this.pos = 0;
    this.lpL = 0;
    this.lpR = 0;
  }

  process(inL: Float32Array, inR: Float32Array, outL: Float32Array, outR: Float32Array, frames: number): void {
    for (let n = 0; n < frames; n++) {
      let rp = this.pos - this.delaySamples;
      if (rp < 0) rp += this.size;
      const dl = this.bufL[rp];
      const dr = this.bufR[rp];

      // Damped feedback (one-pole LPF on the delayed signal).
      this.lpL += this.dampCoef * (dl - this.lpL);
      this.lpR += this.dampCoef * (dr - this.lpR);

      // Feedback routing: ping-pong crosses channels.
      const fbL = this.pingpong ? this.lpR : this.lpL;
      const fbR = this.pingpong ? this.lpL : this.lpR;

      let wl = inL[n] + this.fb * fbL;
      let wr = inR[n] + this.fb * fbR;
      if (Math.abs(wl) < 1e-20) wl = 0;
      if (Math.abs(wr) < 1e-20) wr = 0;
      this.bufL[this.pos] = wl;
      this.bufR[this.pos] = wr;

      this.pos++;
      if (this.pos >= this.size) this.pos = 0;

      // 100% wet output = the delayed taps.
      outL[n] = dl;
      outR[n] = dr;
    }
  }
}
