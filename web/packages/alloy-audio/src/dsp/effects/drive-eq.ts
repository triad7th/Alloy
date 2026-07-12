// Drive + 3-band EQ — a tanh saturation stage followed by a static tone
// stack (low shelf / mid peak / high shelf) and an output level trim.
// Order is fixed: drive → low shelf → mid peak → high shelf → level. Every
// gain and filter coefficient is derived from the (static) params once, in
// the constructor — cheap enough to run fully per-sample, no control ticks.
// The mid peak reuses the shared Svf (bandpass, Q 0.707); the shelves are
// one-pole filters (low shelf: input + (gain-1)*lowpass; high shelf: input
// + (gain-1)*(input-lowpass), i.e. the lowpass's high-pass complement).
// Twin: DriveEq.swift.

import { TWO_PI } from '../dsp-types.js';
import { Svf } from '../svf.js';
import type { DriveEqParams, EffectUnit } from './effect-types.js';

/** Shelf/peak center frequencies. */
export const DRIVE_EQ_LOW_HZ = 250;
export const DRIVE_EQ_MID_HZ = 1000;
export const DRIVE_EQ_HIGH_HZ = 3000;
const DRIVE_EQ_MID_Q = 0.707;

export class DriveEq implements EffectUnit {
  private readonly preGain: number;
  private readonly gLow: number;
  private readonly gMid: number;
  private readonly gHigh: number;
  private readonly gLevel: number;
  private readonly lowCoef: number;
  private readonly highCoef: number;
  private lowStateL = 0;
  private lowStateR = 0;
  private highStateL = 0;
  private highStateR = 0;
  private midL: Svf;
  private midR: Svf;

  constructor(
    params: DriveEqParams,
    private readonly sampleRate: number,
  ) {
    this.preGain = 1 + params.drive * 4;
    this.gLow = 10 ** (params.lowDb / 20);
    this.gMid = 10 ** (params.midDb / 20);
    this.gHigh = 10 ** (params.highDb / 20);
    this.gLevel = 10 ** (params.levelDb / 20);
    this.lowCoef = 1 - Math.exp((-TWO_PI * DRIVE_EQ_LOW_HZ) / sampleRate);
    this.highCoef = 1 - Math.exp((-TWO_PI * DRIVE_EQ_HIGH_HZ) / sampleRate);
    this.midL = new Svf('bandpass', sampleRate);
    this.midR = new Svf('bandpass', sampleRate);
    this.midL.setParams(DRIVE_EQ_MID_HZ, DRIVE_EQ_MID_Q);
    this.midR.setParams(DRIVE_EQ_MID_HZ, DRIVE_EQ_MID_Q);
  }

  reset(): void {
    this.lowStateL = 0;
    this.lowStateR = 0;
    this.highStateL = 0;
    this.highStateR = 0;
    // Svf exposes no reset(); a fresh instance is the established way to
    // clear its internal state (same pattern as Voice's per-note TVF).
    this.midL = new Svf('bandpass', this.sampleRate);
    this.midR = new Svf('bandpass', this.sampleRate);
    this.midL.setParams(DRIVE_EQ_MID_HZ, DRIVE_EQ_MID_Q);
    this.midR.setParams(DRIVE_EQ_MID_HZ, DRIVE_EQ_MID_Q);
  }

  process(left: Float32Array, right: Float32Array, frames: number): void {
    const { preGain, gLow, gMid, gHigh, gLevel, lowCoef, highCoef, midL, midR } = this;

    for (let i = 0; i < frames; i++) {
      const sl = Math.tanh(left[i] * preGain);
      this.lowStateL += lowCoef * (sl - this.lowStateL);
      let yl = sl + (gLow - 1) * this.lowStateL;
      yl = yl + (gMid - 1) * midL.process(yl);
      this.highStateL += highCoef * (yl - this.highStateL);
      yl = yl + (gHigh - 1) * (yl - this.highStateL);
      left[i] = yl * gLevel;

      const sr = Math.tanh(right[i] * preGain);
      this.lowStateR += lowCoef * (sr - this.lowStateR);
      let yr = sr + (gLow - 1) * this.lowStateR;
      yr = yr + (gMid - 1) * midR.process(yr);
      this.highStateR += highCoef * (yr - this.highStateR);
      yr = yr + (gHigh - 1) * (yr - this.highStateR);
      right[i] = yr * gLevel;
    }
  }
}
