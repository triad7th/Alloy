// Insert-effect infrastructure: the contracts that let the engine hold an
// ordered, per-patch chain of stereo processors after the mono voice bus.
// Twin: EffectTypes.swift.

import { StereoChorus } from './stereo-chorus.js';

/** Stereo in-place processor. process() must not allocate or throw. */
export interface EffectUnit {
  process(left: Float32Array, right: Float32Array, frames: number): void;
  /** Clear all internal state (delay lines, phases). */
  reset(): void;
}

export interface ChorusParams {
  mode: 'chorus' | 'ensemble';
  /** LFO rate. */
  rateHz: number;
  /** Peak delay deviation. */
  depthMs: number;
  /** 0..1 wet. */
  mix: number;
}

export interface TremoloParams {
  rateHz: number;
  depth: number;
  /** 0 = tremolo .. 1 = auto-pan. */
  spread: number;
}

export type InsertSpec =
  | { kind: 'chorus'; chorus: ChorusParams }
  | { kind: 'tremolo'; tremolo: TremoloParams };

export const MAX_INSERTS = 3;

function validateChorusParams(chorus: ChorusParams): string[] {
  const errors: string[] = [];
  if (!(chorus.rateHz > 0 && chorus.rateHz <= 20)) {
    errors.push(`chorus.rateHz ${chorus.rateHz} outside (0, 20]`);
  }
  if (!(chorus.depthMs > 0 && chorus.depthMs <= 20)) {
    errors.push(`chorus.depthMs ${chorus.depthMs} outside (0, 20]`);
  }
  if (!(chorus.mix >= 0 && chorus.mix <= 1)) {
    errors.push(`chorus.mix ${chorus.mix} outside [0, 1]`);
  }
  return errors;
}

function validateTremoloParams(tremolo: TremoloParams): string[] {
  const errors: string[] = [];
  if (!(tremolo.rateHz > 0 && tremolo.rateHz <= 40)) {
    errors.push(`tremolo.rateHz ${tremolo.rateHz} outside (0, 40]`);
  }
  if (!(tremolo.depth >= 0 && tremolo.depth <= 1)) {
    errors.push(`tremolo.depth ${tremolo.depth} outside [0, 1]`);
  }
  if (!(tremolo.spread >= 0 && tremolo.spread <= 1)) {
    errors.push(`tremolo.spread ${tremolo.spread} outside [0, 1]`);
  }
  return errors;
}

/** Non-throwing; empty = constructible on both platforms. */
export function validateInsert(spec: InsertSpec): string[] {
  switch (spec.kind) {
    case 'chorus':
      return validateChorusParams(spec.chorus);
    case 'tremolo':
      return validateTremoloParams(spec.tremolo);
  }
}

/** Factory used by the engine at setPatch time. */
export function createInsert(spec: InsertSpec, sampleRate: number): EffectUnit {
  switch (spec.kind) {
    case 'chorus':
      return new StereoChorus(spec.chorus, sampleRate);
    case 'tremolo':
      // TremoloAutoPan lands in Task 2. createInsert is only reachable
      // through validated patches, and no patch can carry a tremolo insert
      // until Task 3 wires inserts into the schema, so this arm is
      // unreachable in practice for the whole of Task 1.
      throw new Error('tremolo lands in task 2');
  }
}
