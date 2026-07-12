// Insert-effect infrastructure: the contracts that let the engine hold an
// ordered, per-patch chain of stereo processors after the mono voice bus.
// Twin: EffectTypes.swift.

import { BASE_DELAY_MS, StereoChorus } from './stereo-chorus.js';
import { TremoloAutoPan } from './tremolo-auto-pan.js';

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
  if (!(chorus.depthMs > 0 && chorus.depthMs <= BASE_DELAY_MS)) {
    errors.push(`chorus.depthMs ${chorus.depthMs} outside (0, ${BASE_DELAY_MS}] (base delay; a larger depth makes the swept delay negative — acausal)`);
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

/**
 * Non-throwing; empty = constructible on both platforms. An unknown `kind`
 * (e.g. a future insert type from a newer build talking to an older bundle)
 * must reject through this return path rather than throw — a throw here
 * would propagate out of WorkletHostCore.render and kill the worklet
 * processor instead of producing a patchRejected reply. Swift is
 * structurally immune: InsertSpec's Codable decode fails first on an
 * unrecognized `kind`, so there is no equivalent runtime value to validate
 * (see docs/mirroring.md).
 */
export function validateInsert(spec: InsertSpec): string[] {
  switch (spec.kind) {
    case 'chorus':
      return validateChorusParams(spec.chorus);
    case 'tremolo':
      return validateTremoloParams(spec.tremolo);
    default:
      return [`unknown insert kind '${(spec as { kind: string }).kind}'`];
  }
}

/**
 * Factory used by the engine at setPatch time. Construction only ever runs
 * after validateInsert has rejected unknown kinds, so the default arm here
 * is unreachable in practice; it throws (rather than silently no-opping) so
 * a caller that skips validation fails loudly instead of dropping an insert.
 */
export function createInsert(spec: InsertSpec, sampleRate: number): EffectUnit {
  switch (spec.kind) {
    case 'chorus':
      return new StereoChorus(spec.chorus, sampleRate);
    case 'tremolo':
      return new TremoloAutoPan(spec.tremolo, sampleRate);
    default:
      throw new Error(
        `createInsert: unknown insert kind '${(spec as { kind: string }).kind}' (unreachable — validateInsert must reject first)`,
      );
  }
}
