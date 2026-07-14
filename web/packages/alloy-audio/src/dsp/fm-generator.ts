// Phase-modulation operator stack (DX-style "FM"). Modulators must sit at
// higher indices than the operators they modulate, so a single high-to-low
// evaluation pass per sample resolves every route without topology sorting.
// Twin: FmGenerator.swift.

import { AdsrEnvelope, type AdsrParams } from './adsr-envelope.js';
import { TWO_PI, type ToneGenerator } from './dsp-types.js';
import { FmDecimator, chooseOversampling, maxPitchModRatio } from './fm-oversampling.js';
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
  /** Highest ratio in the stack — hoisted out of noteOn (which is on the
   *  note-event path and should stay cheap). */
  private readonly maxRatio: number;
  /** Worst-case upward pitch bend the owning layer's LFO can reach; 1 when the
   *  patch has no pitch modulation. Folded into the K choice at noteOn. */
  private readonly maxPitchRatio: number;
  /** Oversampling factor for the current note; 1 = the original code path.
   *  Named `oversamplingFactor` because the public getter takes `oversampling`. */
  private oversamplingFactor = 1;
  private readonly decimator = new FmDecimator();
  /** Envelope level per operator for the current OUTPUT sample. */
  private readonly envLevels: number[];

  /** `pitchModCents` is the owning layer's LFO pitch-route depth
   *  (`PatchLayer.mod.toPitchCents`), 0 when there is none. It is part of the
   *  patch, known at noteOn, and it is what stops an LFO from bending a K=1
   *  voice's modulator past Nyquist mid-note. */
  constructor(
    private readonly params: FmGeneratorParams,
    private readonly sampleRate: number,
    pitchModCents = 0,
  ) {
    const errors = validateFmGeneratorParams(params);
    if (errors.length > 0) {
      throw new Error(errors.join('; '));
    }
    this.envelopes = params.operators.map((op) => new AdsrEnvelope(op.adsr, sampleRate));
    this.phases = params.operators.map(() => 0);
    this.outputs = params.operators.map(() => 0);
    this.maxRatio = Math.max(...params.operators.map((op) => op.ratio));
    this.maxPitchRatio = maxPitchModRatio(pitchModCents);
    this.envLevels = params.operators.map(() => 0);
  }

  get finished(): boolean {
    return this.keyed && this.params.algorithm.carriers.every((c) => !this.envelopes[c].isActive);
  }

  /** Oversampling factor chosen for the current note (1 or FM_OVERSAMPLING). */
  get oversampling(): number {
    return this.oversamplingFactor;
  }

  noteOn(midi: number, velocity: number): void {
    this.keyed = true;
    this.pitchRatio = 1;
    this.frequency = midiToFrequency(midi);
    this.amp = velocity;
    // Decide the oversampling factor ONCE per note, from the highest frequency
    // anywhere in the stack UNDER THE PATCH'S WORST-CASE PITCH MODULATION.
    // setPitchRatio deliberately does not re-decide it mid-note (that would
    // glitch), so the LFO's peak upward bend has to be priced in here — else a
    // deep vibrato route sweeps a K=1 voice's modulator past Nyquist and the
    // aliasing this phase exists to kill comes back, periodically.
    this.oversamplingFactor = chooseOversampling(
      this.frequency * this.maxRatio * this.maxPitchRatio,
      this.sampleRate,
    );
    this.decimator.reset();
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
    const os = this.oversamplingFactor;
    // The rate the operator loop actually runs at. At os === 1 this is exactly
    // this.sampleRate (x1 is bit-exact), so the phase increment below is the
    // same expression, evaluated in the same order, as the pre-oversampling
    // code — which is why the goldens do not move.
    const osSampleRate = this.sampleRate * os;
    for (let n = 0; n < frames; n++) {
      if (this.finished) {
        return;
      }
      // Envelopes advance ONCE per output sample and are held across the K
      // sub-samples. They are slow control signals (<= 83 us of hold at K=4), so
      // this is inaudible — and it is the other half of what makes the os === 1
      // path bit-identical to the pre-oversampling code. Do NOT "tidy" this back
      // inside the operator loop.
      for (let i = 0; i < operators.length; i++) {
        this.envLevels[i] = this.envelopes[i].nextSample();
      }
      let sample = 0;
      for (let k = 0; k < os; k++) {
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
          this.outputs[i] = Math.sin(TWO_PI * (this.phases[i] + mod)) * this.envLevels[i] * operators[i].level;
          this.phases[i] += (this.frequency * this.pitchRatio * operators[i].ratio) / osSampleRate;
          this.phases[i] -= Math.floor(this.phases[i]);
        }
        let sum = 0;
        for (const c of algorithm.carriers) {
          sum += this.outputs[c];
        }
        if (os === 1) {
          sample = sum;
        } else {
          this.decimator.push(sum);
          if (k === os - 1) {
            sample = this.decimator.output();
          }
        }
      }
      out[n] += sample * carrierScale;
    }
  }
}
