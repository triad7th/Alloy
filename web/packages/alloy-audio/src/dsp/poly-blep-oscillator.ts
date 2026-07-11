// Band-limited oscillator via polyBLEP edge correction: each waveform
// discontinuity is replaced by a 2-sample polynomial band-limited step.
// Sine needs no correction. Twin: PolyBlepOscillator.swift.

import { TWO_PI } from './dsp-types.js';

export type OscShape = 'sine' | 'saw' | 'pulse';

export class PolyBlepOscillator {
  private phase: number;
  private increment = 0;

  constructor(
    private readonly shape: OscShape,
    private readonly sampleRate: number,
    initialPhase = 0,
    private readonly pulseWidth = 0.5,
  ) {
    this.phase = wrap(initialPhase);
  }

  setFrequency(hz: number): void {
    this.increment = hz / this.sampleRate;
  }

  nextSample(): number {
    const t = this.phase;
    const dt = this.increment;
    let value: number;
    switch (this.shape) {
      case 'sine':
        value = Math.sin(TWO_PI * t);
        break;
      case 'saw':
        value = 2 * t - 1 - polyBlep(t, dt);
        break;
      case 'pulse': {
        const w = this.pulseWidth;
        value = (t < w ? 1 : -1) + polyBlep(t, dt) - polyBlep(wrap(t - w), dt);
        break;
      }
    }
    this.phase = wrap(t + dt);
    return value;
  }
}

function wrap(p: number): number {
  return p - Math.floor(p);
}

/** 2-sample polynomial band-limited step centered on the phase reset. */
function polyBlep(t: number, dt: number): number {
  if (dt <= 0) {
    return 0;
  }
  if (t < dt) {
    const x = t / dt;
    return x + x - x * x - 1;
  }
  if (t > 1 - dt) {
    const x = (t - 1) / dt;
    return x * x + x + x + 1;
  }
  return 0;
}
