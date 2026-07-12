// Insert-effect infrastructure: the contracts that let the engine hold an
// ordered, per-patch chain of stereo processors after the mono voice bus.
// Twin: EffectTypes.swift.

import { Compressor } from './compressor.js';
import { DriveEq } from './drive-eq.js';
import { Phaser } from './phaser.js';
import { RotarySpeaker } from './rotary-speaker.js';
import { BASE_DELAY_MS, StereoChorus } from './stereo-chorus.js';
import { TremoloAutoPan } from './tremolo-auto-pan.js';

/** Stereo in-place processor. process() must not allocate or throw. */
export interface EffectUnit {
  process(left: Float32Array, right: Float32Array, frames: number): void;
  /** Clear all internal state (delay lines, phases). */
  reset(): void;
}

/** Samples per control-rate tick for effects with expensive (tan/pow)
 * coefficient recomputes — same two-rate philosophy as voice.ts's
 * CONTROL_INTERVAL, scoped to the effects layer. */
export const EFFECT_CONTROL_INTERVAL = 16;

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

export interface PhaserParams {
  /** Allpass stages per channel. */
  stages: 4 | 8;
  /** LFO rate sweeping the shared allpass coefficient. */
  rateHz: number;
  /** LFO excursion, 0..1. */
  depth: number;
  /** 0..0.9 feedback from the chain's last output. */
  feedback: number;
  /** 0..1 wet. */
  mix: number;
}

export interface RotaryParams {
  /** Rotor speed pair, baked per patch (no live-switch path yet). */
  speed: 'slow' | 'fast';
  /** AM/pan excursion, 0..1. */
  depth: number;
  /** 0..1 wet. */
  mix: number;
}

export interface DriveEqParams {
  /** Pre-EQ saturation amount, 0..1 (preGain = 1 + drive * 4). */
  drive: number;
  /** Low-shelf gain in dB, -12..12 (250 Hz). */
  lowDb: number;
  /** Mid-peak gain in dB, -12..12 (1 kHz, Q 0.707). */
  midDb: number;
  /** High-shelf gain in dB, -12..12 (3 kHz). */
  highDb: number;
  /** Output level trim in dB, -12..12. */
  levelDb: number;
}

export interface CompressorParams {
  /** Detector threshold in dB, -60..0. */
  thresholdDb: number;
  /** Compression ratio, 1..20 (1 = no compression). */
  ratio: number;
  /** Detector attack time in ms, (0, 100]. */
  attackMs: number;
  /** Detector release time in ms, (0, 1000]. */
  releaseMs: number;
  /** Makeup gain in dB, 0..24. */
  makeupDb: number;
}

export type InsertSpec =
  | { kind: 'chorus'; chorus: ChorusParams }
  | { kind: 'tremolo'; tremolo: TremoloParams }
  | { kind: 'phaser'; phaser: PhaserParams }
  | { kind: 'rotary'; rotary: RotaryParams }
  | { kind: 'driveEq'; driveEq: DriveEqParams }
  | { kind: 'compressor'; compressor: CompressorParams };

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

function validatePhaserParams(phaser: PhaserParams): string[] {
  const errors: string[] = [];
  if (phaser.stages !== 4 && phaser.stages !== 8) {
    errors.push(`phaser.stages ${phaser.stages} must be 4 or 8`);
  }
  if (!(phaser.rateHz > 0 && phaser.rateHz <= 10)) {
    errors.push(`phaser.rateHz ${phaser.rateHz} outside (0, 10]`);
  }
  if (!(phaser.depth >= 0 && phaser.depth <= 1)) {
    errors.push(`phaser.depth ${phaser.depth} outside [0, 1]`);
  }
  if (!(phaser.feedback >= 0 && phaser.feedback <= 0.9)) {
    errors.push(`phaser.feedback ${phaser.feedback} outside [0, 0.9]`);
  }
  if (!(phaser.mix >= 0 && phaser.mix <= 1)) {
    errors.push(`phaser.mix ${phaser.mix} outside [0, 1]`);
  }
  return errors;
}

function validateRotaryParams(rotary: RotaryParams): string[] {
  const errors: string[] = [];
  if (rotary.speed !== 'slow' && rotary.speed !== 'fast') {
    errors.push(`rotary.speed '${(rotary as { speed: string }).speed}' must be 'slow' or 'fast'`);
  }
  if (!(rotary.depth >= 0 && rotary.depth <= 1)) {
    errors.push(`rotary.depth ${rotary.depth} outside [0, 1]`);
  }
  if (!(rotary.mix >= 0 && rotary.mix <= 1)) {
    errors.push(`rotary.mix ${rotary.mix} outside [0, 1]`);
  }
  return errors;
}

function validateDriveEqParams(driveEq: DriveEqParams): string[] {
  const errors: string[] = [];
  if (!(driveEq.drive >= 0 && driveEq.drive <= 1)) {
    errors.push(`driveEq.drive ${driveEq.drive} outside [0, 1]`);
  }
  if (!(driveEq.lowDb >= -12 && driveEq.lowDb <= 12)) {
    errors.push(`driveEq.lowDb ${driveEq.lowDb} outside [-12, 12]`);
  }
  if (!(driveEq.midDb >= -12 && driveEq.midDb <= 12)) {
    errors.push(`driveEq.midDb ${driveEq.midDb} outside [-12, 12]`);
  }
  if (!(driveEq.highDb >= -12 && driveEq.highDb <= 12)) {
    errors.push(`driveEq.highDb ${driveEq.highDb} outside [-12, 12]`);
  }
  if (!(driveEq.levelDb >= -12 && driveEq.levelDb <= 12)) {
    errors.push(`driveEq.levelDb ${driveEq.levelDb} outside [-12, 12]`);
  }
  return errors;
}

function validateCompressorParams(compressor: CompressorParams): string[] {
  const errors: string[] = [];
  if (!(compressor.thresholdDb >= -60 && compressor.thresholdDb <= 0)) {
    errors.push(`compressor.thresholdDb ${compressor.thresholdDb} outside [-60, 0]`);
  }
  if (!(compressor.ratio >= 1 && compressor.ratio <= 20)) {
    errors.push(`compressor.ratio ${compressor.ratio} outside [1, 20]`);
  }
  if (!(compressor.attackMs > 0 && compressor.attackMs <= 100)) {
    errors.push(`compressor.attackMs ${compressor.attackMs} outside (0, 100]`);
  }
  if (!(compressor.releaseMs > 0 && compressor.releaseMs <= 1000)) {
    errors.push(`compressor.releaseMs ${compressor.releaseMs} outside (0, 1000]`);
  }
  if (!(compressor.makeupDb >= 0 && compressor.makeupDb <= 24)) {
    errors.push(`compressor.makeupDb ${compressor.makeupDb} outside [0, 24]`);
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
    case 'phaser':
      return validatePhaserParams(spec.phaser);
    case 'rotary':
      return validateRotaryParams(spec.rotary);
    case 'driveEq':
      return validateDriveEqParams(spec.driveEq);
    case 'compressor':
      return validateCompressorParams(spec.compressor);
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
    case 'phaser':
      return new Phaser(spec.phaser, sampleRate);
    case 'rotary':
      return new RotarySpeaker(spec.rotary, sampleRate);
    case 'driveEq':
      return new DriveEq(spec.driveEq, sampleRate);
    case 'compressor':
      return new Compressor(spec.compressor, sampleRate);
    default:
      throw new Error(
        `createInsert: unknown insert kind '${(spec as { kind: string }).kind}' (unreachable — validateInsert must reject first)`,
      );
  }
}
