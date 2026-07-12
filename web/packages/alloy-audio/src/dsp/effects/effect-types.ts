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
 * CONTROL_INTERVAL, scoped to the effects layer.
 * Tick-placement convention: check the tick FIRST in the sample loop
 * (phaser) unless the control computation consumes this sample's state, in
 * which case tick after that state updates (compressor's gain reads the
 * just-updated envelope). Both twins must place it identically. */
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

/** Output-only wet processor fed by a send tap. Unlike EffectUnit (in-place),
 * a send effect READS a pre-scaled send input and WRITES wet output to a
 * separate pair — the dry bus it taps from stays untouched. Non-allocating,
 * must not throw. */
export interface SendEffect {
  process(inL: Float32Array, inR: Float32Array, outL: Float32Array, outR: Float32Array, frames: number): void;
  reset(): void;
}

export interface ReverbParams {
  /** Pre-network predelay, 0..100 ms. */
  predelayMs: number;
  /** Tank feedback / tail length, 0..1 (maps to loop gain 0.70..0.98). */
  decay: number;
  /** HF damping in the feedback path, 0..1 (0 = bright, 1 = dark). */
  damping: number;
  /** Input low-pass bandwidth, 0..1 (1 = full band into the network). */
  bandwidth: number;
  /** Chorus modulation depth of the modulated lines, 0..1. */
  modDepth: number;
  /** Modulation LFO rate, (0, 5] Hz. */
  modRateHz: number;
}

export interface DelayParams {
  mode: 'stereo' | 'pingpong';
  /** Base delay time, (0, 2000] ms. */
  timeMs: number;
  /** Feedback gain, 0..0.95 (< 1 for stability). */
  feedback: number;
  /** HF damping in the feedback path, 0..1. */
  damping: number;
}

export interface LimiterParams {
  /** Output brickwall ceiling in dBFS, -24..0. Output |sample| never exceeds this. */
  ceilingDb: number;
  /** Gain recovery time after a peak, (0, 1000] ms. */
  releaseMs: number;
}

export interface MasterConfig {
  reverb: ReverbParams;
  delay: DelayParams;
  limiter: LimiterParams;
}

/** Fixed lookahead of the master limiter, in samples (~1.3 ms at 48 kHz). The
 * master path delays the whole render by exactly this many samples. */
export const LIMITER_LOOKAHEAD_SAMPLES = 64;

export const DEFAULT_MASTER_CONFIG: MasterConfig = {
  reverb: { predelayMs: 12, decay: 0.72, damping: 0.35, bandwidth: 0.85, modDepth: 0.35, modRateHz: 0.7 },
  delay: { mode: 'pingpong', timeMs: 375, feedback: 0.38, damping: 0.4 },
  limiter: { ceilingDb: -0.3, releaseMs: 120 },
};

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
  if (chorus.mode !== 'chorus' && chorus.mode !== 'ensemble') {
    errors.push(`chorus.mode '${(chorus as { mode: string }).mode}' must be 'chorus' or 'ensemble'`);
  }
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

export function validateReverbParams(p: ReverbParams): string[] {
  const e: string[] = [];
  if (!(p.predelayMs >= 0 && p.predelayMs <= 100)) e.push(`reverb.predelayMs ${p.predelayMs} outside [0, 100]`);
  if (!(p.decay >= 0 && p.decay <= 1)) e.push(`reverb.decay ${p.decay} outside [0, 1]`);
  if (!(p.damping >= 0 && p.damping <= 1)) e.push(`reverb.damping ${p.damping} outside [0, 1]`);
  if (!(p.bandwidth >= 0 && p.bandwidth <= 1)) e.push(`reverb.bandwidth ${p.bandwidth} outside [0, 1]`);
  if (!(p.modDepth >= 0 && p.modDepth <= 1)) e.push(`reverb.modDepth ${p.modDepth} outside [0, 1]`);
  if (!(p.modRateHz > 0 && p.modRateHz <= 5)) e.push(`reverb.modRateHz ${p.modRateHz} outside (0, 5]`);
  return e;
}

export function validateDelayParams(p: DelayParams): string[] {
  const e: string[] = [];
  if (p.mode !== 'stereo' && p.mode !== 'pingpong') e.push(`delay.mode '${(p as { mode: string }).mode}' must be 'stereo' or 'pingpong'`);
  if (!(p.timeMs > 0 && p.timeMs <= 2000)) e.push(`delay.timeMs ${p.timeMs} outside (0, 2000]`);
  if (!(p.feedback >= 0 && p.feedback <= 0.95)) e.push(`delay.feedback ${p.feedback} outside [0, 0.95]`);
  if (!(p.damping >= 0 && p.damping <= 1)) e.push(`delay.damping ${p.damping} outside [0, 1]`);
  return e;
}

export function validateLimiterParams(p: LimiterParams): string[] {
  const e: string[] = [];
  if (!(p.ceilingDb >= -24 && p.ceilingDb <= 0)) e.push(`limiter.ceilingDb ${p.ceilingDb} outside [-24, 0]`);
  if (!(p.releaseMs > 0 && p.releaseMs <= 1000)) e.push(`limiter.releaseMs ${p.releaseMs} outside (0, 1000]`);
  return e;
}

export function validateMasterConfig(c: MasterConfig): string[] {
  return [
    ...validateReverbParams(c.reverb),
    ...validateDelayParams(c.delay),
    ...validateLimiterParams(c.limiter),
  ];
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
