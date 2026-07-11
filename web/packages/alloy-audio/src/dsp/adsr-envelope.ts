// Exponential-segment ADSR: one-pole approach toward a target per stage —
// the classic analog RC shape (and the reason it never clicks). Twin:
// AdsrEnvelope.swift.

import { SILENCE_FLOOR } from './dsp-types.js';

export interface AdsrParams {
  /** Seconds for the attack stage to reach full level from silence. */
  attack: number;
  /** One-pole time constant (seconds) of the fall toward sustain. */
  decay: number;
  /** Level held while the key is down, 0..1. */
  sustain: number;
  /** One-pole time constant (seconds) of the fall toward silence. */
  release: number;
}

const ATTACK_OVERSHOOT = 1.3;
// A one-pole aiming at 1.3 crosses 1.0 after ln(1.3/0.3) time constants;
// dividing the requested attack time by this makes the stage complete in
// ≈ `attack` seconds.
const ATTACK_TAU_FACTOR = Math.log(ATTACK_OVERSHOOT / (ATTACK_OVERSHOOT - 1));

type Stage = 'idle' | 'attack' | 'decay' | 'release';

export class AdsrEnvelope {
  private stage: Stage = 'idle';
  private level = 0;
  private readonly attackCoef: number;
  private readonly decayCoef: number;
  private readonly baseReleaseCoef: number;
  private releaseCoef: number;

  constructor(
    private readonly params: AdsrParams,
    private readonly sampleRate: number,
  ) {
    this.attackCoef = onePoleCoef(params.attack / ATTACK_TAU_FACTOR, sampleRate);
    this.decayCoef = onePoleCoef(params.decay, sampleRate);
    this.baseReleaseCoef = onePoleCoef(params.release, sampleRate);
    this.releaseCoef = this.baseReleaseCoef;
  }

  get isActive(): boolean {
    return this.stage !== 'idle';
  }

  /** Also un-stickies a prior fastRelease: the next release uses params.release again. */
  noteOn(): void {
    this.stage = 'attack';
    this.releaseCoef = this.baseReleaseCoef;
  }

  noteOff(): void {
    if (this.stage !== 'idle') {
      this.stage = 'release';
    }
  }

  /** Enter release with an overriding time constant (voice steal / allNotesOff). */
  fastRelease(tau: number): void {
    this.releaseCoef = onePoleCoef(tau, this.sampleRate);
    this.noteOff();
  }

  nextSample(): number {
    switch (this.stage) {
      case 'idle':
        return 0;
      case 'attack':
        this.level += this.attackCoef * (ATTACK_OVERSHOOT - this.level);
        if (this.level >= 1) {
          this.level = 1;
          this.stage = 'decay';
        }
        return this.level;
      case 'decay':
        this.level += this.decayCoef * (this.params.sustain - this.level);
        return this.level;
      case 'release':
        this.level += this.releaseCoef * (0 - this.level);
        if (this.level <= SILENCE_FLOOR) {
          this.level = 0;
          this.stage = 'idle';
        }
        return this.level;
    }
  }
}

/** Coefficient for `level += coef * (target - level)` with time constant `tau` seconds. */
function onePoleCoef(tau: number, sampleRate: number): number {
  return 1 - Math.exp(-1 / (Math.max(tau, 1e-4) * sampleRate));
}
