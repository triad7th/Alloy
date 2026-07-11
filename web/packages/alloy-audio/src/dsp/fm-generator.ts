// Phase-modulation operator stack (DX-style "FM"). Modulators must sit at
// higher indices than the operators they modulate, so a single high-to-low
// evaluation pass per sample resolves every route without topology sorting.
// Twin: FmGenerator.swift.

import { AdsrEnvelope, type AdsrParams } from './adsr-envelope.js';
import { TWO_PI, type ToneGenerator } from './dsp-types.js';
import { midiToFrequency } from '../pitch.js';

export interface FmOperatorParams {
  /** Frequency ratio relative to the note frequency. */
  ratio: number;
  /** Carrier: output amplitude. Modulator: phase-mod depth in cycles. */
  level: number;
  adsr: AdsrParams;
}

export interface FmAlgorithm {
  /** Modulation routes; `from` must be greater than `to`. */
  routes: ReadonlyArray<{ from: number; to: number }>;
  /** Operator indices summed into the output. */
  carriers: readonly number[];
  /** Optional single-operator self phase-mod, depth in cycles. */
  feedback?: { op: number; amount: number };
}

export interface FmGeneratorParams {
  operators: readonly FmOperatorParams[];
  algorithm: FmAlgorithm;
}

/** Non-throwing validation: empty array = constructible on both platforms. */
export function validateFmGeneratorParams(params: FmGeneratorParams): string[] {
  const errors: string[] = [];
  const opCount = params.operators.length;
  if (opCount < 1 || opCount > 6) {
    errors.push(`operator count ${opCount} outside 1..6`);
  }
  for (const route of params.algorithm.routes) {
    if (route.from <= route.to || route.from >= opCount || route.to < 0) {
      errors.push(`route ${route.from}->${route.to} must flow from a higher to a lower operator index`);
    }
  }
  for (const carrier of params.algorithm.carriers) {
    if (carrier < 0 || carrier >= opCount) {
      errors.push(`carrier index ${carrier} out of range`);
    }
  }
  if (params.algorithm.carriers.length === 0) {
    errors.push('at least one carrier required');
  }
  const feedback = params.algorithm.feedback;
  if (feedback && (feedback.op < 0 || feedback.op >= opCount)) {
    errors.push(`feedback.op ${feedback.op} out of range`);
  }
  return errors;
}

export class FmGenerator implements ToneGenerator {
  private readonly envelopes: AdsrEnvelope[];
  private readonly phases: number[];
  private readonly outputs: number[];
  private frequency = 0;
  private pitchRatio = 1;
  private amp = 0;
  private keyed = false;

  constructor(
    private readonly params: FmGeneratorParams,
    private readonly sampleRate: number,
  ) {
    const errors = validateFmGeneratorParams(params);
    if (errors.length > 0) {
      throw new Error(errors.join('; '));
    }
    this.envelopes = params.operators.map((op) => new AdsrEnvelope(op.adsr, sampleRate));
    this.phases = params.operators.map(() => 0);
    this.outputs = params.operators.map(() => 0);
  }

  get finished(): boolean {
    return this.keyed && this.params.algorithm.carriers.every((c) => !this.envelopes[c].isActive);
  }

  noteOn(midi: number, velocity: number): void {
    this.keyed = true;
    this.pitchRatio = 1;
    this.frequency = midiToFrequency(midi);
    this.amp = velocity;
    this.phases.fill(0);
    this.outputs.fill(0);
    for (const env of this.envelopes) {
      env.noteOn();
    }
  }

  noteOff(): void {
    for (const env of this.envelopes) {
      env.noteOff();
    }
  }

  setPitchRatio(ratio: number): void {
    this.pitchRatio = ratio;
  }

  render(out: Float32Array, frames: number): void {
    const { operators, algorithm } = this.params;
    const carrierScale = this.amp / algorithm.carriers.length;
    for (let n = 0; n < frames; n++) {
      if (this.finished) {
        return;
      }
      for (let i = operators.length - 1; i >= 0; i--) {
        let mod = 0;
        for (const route of algorithm.routes) {
          if (route.to === i) {
            mod += this.outputs[route.from];
          }
        }
        const feedback = algorithm.feedback;
        if (feedback && feedback.op === i) {
          mod += this.outputs[i] * feedback.amount;
        }
        const env = this.envelopes[i].nextSample();
        this.outputs[i] = Math.sin(TWO_PI * (this.phases[i] + mod)) * env * operators[i].level;
        this.phases[i] += (this.frequency * this.pitchRatio * operators[i].ratio) / this.sampleRate;
        this.phases[i] -= Math.floor(this.phases[i]);
      }
      let sample = 0;
      for (const c of algorithm.carriers) {
        sample += this.outputs[c];
      }
      out[n] += sample * carrierScale;
    }
  }
}
