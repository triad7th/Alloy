// Patch data model: the wire schema every later phase-1b task builds on.
// Pure data (JSON-serializable) plus non-throwing validation, so hosts can
// check patch data before constructing voices. Twin: Patch.swift.

import { type AdsrParams } from './adsr-envelope.js';
import { type AdditivePartial } from './additive-generator.js';
import { validateFmGeneratorParams, type FmGeneratorParams } from './fm-generator.js';
import { type LfoParams } from './lfo.js';
import { type SvfMode } from './svf.js';
import { type VaParams } from './va-generator.js';

export const PATCH_SCHEMA_VERSION = 1;

export interface PatchMeta {
  id: string;
  name: string;
  category: 'melodic' | 'kit';
  gmProgram?: number;
}

export interface KeyRange {
  lowMidi: number;
  highMidi: number;
}

/** 0..1 inclusive. */
export interface VelRange {
  low: number;
  high: number;
}

export type GeneratorSpec =
  | { kind: 'fm'; fm: FmGeneratorParams }
  | { kind: 'additive'; partials: AdditivePartial[] }
  | { kind: 'va'; va: VaParams; seed: number }
  | { kind: 'sample'; zoneSetId: string; crossfade: number };

export interface TvfParams {
  mode: SvfMode;
  cutoffHz: number;
  q: number;
  /** Extra Hz opened by the filter envelope at full level. */
  envAmountHz: number;
  env?: AdsrParams;
  /** 0 = fixed cutoff; 1 = cutoff doubles per octave above middle C. */
  keyTrack: number;
  /** Extra Hz opened at velocity 1. */
  velAmountHz: number;
}

export interface TvaParams {
  level: number; // linear layer gain
  adsr: AdsrParams;
  /** Perceptual velocity exponent; generators already apply velocity^1. */
  velCurve: number;
}

export interface LfoRouting {
  lfo: LfoParams;
  toPitchCents: number;
  toCutoffHz: number;
  toAmpDepth: number; // 0..1 tremolo depth
}

export interface PatchLayer {
  keyRange: KeyRange;
  velRange: VelRange;
  generator: GeneratorSpec;
  tvf?: TvfParams;
  tva: TvaParams;
  mod?: LfoRouting;
}

export interface Patch {
  schemaVersion: number;
  meta: PatchMeta;
  layers: PatchLayer[]; // 1..4
  sends: { reverb: number; delay: number }; // consumed in phase 2
}

/** Non-throwing validation; empty = safe to construct voices from on both platforms. */
export function validatePatch(patch: Patch): string[] {
  const errors: string[] = [];
  if (patch.schemaVersion !== PATCH_SCHEMA_VERSION) {
    errors.push(`schemaVersion ${patch.schemaVersion} !== ${PATCH_SCHEMA_VERSION}`);
  }
  if (patch.layers.length < 1 || patch.layers.length > 4) {
    errors.push(`layer count ${patch.layers.length} outside 1..4`);
  }
  patch.layers.forEach((layer, i) => {
    const prefix = `layer ${i + 1}: `;
    const { keyRange, velRange, generator, tva } = layer;
    if (!(0 <= keyRange.lowMidi && keyRange.lowMidi <= keyRange.highMidi && keyRange.highMidi <= 127)) {
      errors.push(`${prefix}keyRange ${keyRange.lowMidi}..${keyRange.highMidi} invalid`);
    }
    if (!(0 <= velRange.low && velRange.low <= velRange.high && velRange.high <= 1)) {
      errors.push(`${prefix}velRange ${velRange.low}..${velRange.high} invalid`);
    }
    if (!(tva.level > 0)) {
      errors.push(`${prefix}tva.level ${tva.level} must be > 0`);
    }
    switch (generator.kind) {
      case 'fm':
        for (const e of validateFmGeneratorParams(generator.fm)) {
          errors.push(`${prefix}${e}`);
        }
        break;
      case 'va':
        if (!(generator.va.unison >= 1)) {
          errors.push(`${prefix}va.unison ${generator.va.unison} must be >= 1`);
        }
        if (!Number.isInteger(generator.seed) || generator.seed < 0 || generator.seed > 0xffffffff) {
          errors.push(`${prefix}va seed must be a uint32`);
        }
        break;
      case 'additive':
        if (generator.partials.length < 1) {
          errors.push(`${prefix}additive requires at least one partial`);
        }
        break;
      case 'sample':
        if (generator.zoneSetId.length === 0) {
          errors.push(`${prefix}sample requires a non-empty zoneSetId`);
        }
        if (!(generator.crossfade >= 0)) {
          errors.push(`${prefix}sample.crossfade ${generator.crossfade} must be >= 0`);
        }
        break;
    }
  });
  return errors;
}
