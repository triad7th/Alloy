// Voice: one sounding note of a Patch. Each matching layer runs its own
// generator → TVF → TVA chain with LFO modulation. TVA envelopes run
// per-sample (click-free); the TVF envelope and LFO run at control rate
// (sampleRate / CONTROL_INTERVAL), ticked once per chunk keyed to an
// absolute per-voice sample position so output is identical regardless of
// how render() calls are sized. Twin: Voice.swift.

import { AdditiveGenerator } from './additive-generator.js';
import { AdsrEnvelope } from './adsr-envelope.js';
import type { ToneGenerator } from './dsp-types.js';
import { FmGenerator } from './fm-generator.js';
import { Lfo } from './lfo.js';
import type { GeneratorSpec, Patch, PatchLayer } from './patch.js';
import { SampleZoneGenerator, type VelocityLayerData } from './sample-zone-generator.js';
import { Svf } from './svf.js';
import { VaGenerator } from './va-generator.js';

/** Resolves a patch's sample zoneSetId to concrete zone data (packs in phase 3; fixtures in tests). */
export type ZoneSetProvider = (zoneSetId: string) => readonly VelocityLayerData[] | null;

/** Samples per modulation tick; TVF envelope + LFO run at sampleRate / CONTROL_INTERVAL. */
export const CONTROL_INTERVAL = 16;

/** Release time constant (seconds) for quickRelease (voice steal / allNotesOff). */
const QUICK_RELEASE_TAU = 0.008;

interface LayerUnit {
  readonly layer: PatchLayer;
  readonly generator: ToneGenerator;
  /** Full-rate amplitude envelope (per-sample, click-free). */
  readonly tva: AdsrEnvelope;
  readonly svf: Svf | undefined;
  /** Control-rate filter envelope. */
  readonly tvfEnv: AdsrEnvelope | undefined;
  /** Control-rate modulation LFO. */
  readonly lfo: Lfo | undefined;
  /**
   * layerGain = tva.level * velocityResidual and
   * velocityResidual = velocity <= 0 ? 0 : velocity ** (tva.velCurve - 1) —
   * generators already applied velocity^1; the TVA contributes the
   * perceptual residual so total velocity gain is velocity^velCurve.
   */
  readonly gain: number;
  /** Tremolo gain held since the last control tick. */
  ampMod: number;
  /** Preallocated chunk buffer; zero-filled per chunk (no allocation in render). */
  readonly scratch: Float32Array;
}

export class Voice {
  private units: LayerUnit[] = [];
  private midi = 0;
  private velocity = 0;
  /** Absolute sample position within the note; drives the control tick. */
  private samplePos = 0;

  constructor(
    private readonly patch: Patch,
    private readonly sampleRate: number,
    private readonly zoneSetProvider?: ZoneSetProvider,
  ) {}

  /** True while any layer is alive (TVA active and generator not finished). */
  get active(): boolean {
    return this.units.some((u) => u.tva.isActive && !u.generator.finished);
  }

  /** Selects layers whose key/vel ranges contain the note and builds their units. */
  noteOn(midi: number, velocity: number): void {
    this.midi = midi;
    this.velocity = velocity;
    this.samplePos = 0;
    this.units = [];
    for (const layer of this.patch.layers) {
      if (!(layer.keyRange.lowMidi <= midi && midi <= layer.keyRange.highMidi)) {
        continue;
      }
      if (!(layer.velRange.low <= velocity && velocity <= layer.velRange.high)) {
        continue;
      }
      const generator = this.buildGenerator(layer.generator);
      if (generator === null) {
        continue; // Unresolvable zoneSetId: layer inactive, not an error.
      }
      const tva = new AdsrEnvelope(layer.tva.adsr, this.sampleRate);
      const controlRate = this.sampleRate / CONTROL_INTERVAL;
      const svf = layer.tvf ? new Svf(layer.tvf.mode, this.sampleRate) : undefined;
      const tvfEnv = layer.tvf?.env ? new AdsrEnvelope(layer.tvf.env, controlRate) : undefined;
      const lfo = layer.mod ? new Lfo(layer.mod.lfo, controlRate) : undefined;
      generator.noteOn(midi, velocity);
      tva.noteOn();
      tvfEnv?.noteOn();
      const velocityResidual = velocity <= 0 ? 0 : velocity ** (layer.tva.velCurve - 1);
      this.units.push({
        layer,
        generator,
        tva,
        svf,
        tvfEnv,
        lfo,
        gain: layer.tva.level * velocityResidual,
        ampMod: 1,
        scratch: new Float32Array(CONTROL_INTERVAL),
      });
    }
  }

  /** Key-up: every layer's TVA + TVF envelopes and generator get noteOff. */
  noteOff(): void {
    for (const unit of this.units) {
      unit.tva.noteOff();
      unit.tvfEnv?.noteOff();
      unit.generator.noteOff();
    }
  }

  /** Steal / allNotesOff: fast TVA release plus key-up everywhere. */
  quickRelease(): void {
    for (const unit of this.units) {
      unit.tva.fastRelease(QUICK_RELEASE_TAU);
      unit.tvfEnv?.noteOff();
      unit.generator.noteOff();
    }
  }

  /** ADDS into out. Returns false once every layer is silent (voice reapable). */
  render(out: Float32Array, frames: number): boolean {
    let n = 0;
    while (n < frames) {
      const posInChunk = this.samplePos % CONTROL_INTERVAL;
      const chunkLen = Math.min(CONTROL_INTERVAL - posInChunk, frames - n);
      const tick = posInChunk === 0;
      for (const unit of this.units) {
        if (!unit.tva.isActive || unit.generator.finished) {
          continue;
        }
        if (tick) {
          this.tickModulation(unit);
        }
        const { scratch } = unit;
        scratch.fill(0, 0, chunkLen);
        unit.generator.render(scratch, chunkLen);
        for (let i = 0; i < chunkLen; i++) {
          const shaped = unit.svf ? unit.svf.process(scratch[i]) : scratch[i];
          out[n + i] += shaped * unit.tva.nextSample() * unit.gain * unit.ampMod;
        }
      }
      this.samplePos += chunkLen;
      n += chunkLen;
    }
    return this.active;
  }

  /** One control tick: advance LFO + TVF envelope, refresh pitch/cutoff/amp modulation. */
  private tickModulation(unit: LayerUnit): void {
    const { tvf, mod } = unit.layer;
    const lfoVal = unit.lfo ? unit.lfo.nextSample() : 0;
    const tvfEnvVal = unit.tvfEnv ? unit.tvfEnv.nextSample() : 0;
    if (mod && mod.toPitchCents !== 0) {
      unit.generator.setPitchRatio(2 ** ((mod.toPitchCents * lfoVal) / 1200));
    }
    if (tvf && unit.svf) {
      const cutoff =
        tvf.cutoffHz * 2 ** ((tvf.keyTrack * (this.midi - 60)) / 12) +
        tvf.envAmountHz * tvfEnvVal +
        tvf.velAmountHz * this.velocity +
        (mod?.toCutoffHz ?? 0) * lfoVal;
      unit.svf.setParams(cutoff, tvf.q); // Svf clamps internally.
    }
    unit.ampMod = 1 - (mod?.toAmpDepth ?? 0) * (0.5 + 0.5 * lfoVal);
  }

  /**
   * Builds the layer's generator; null marks the layer inactive (an
   * unresolvable sample zoneSetId or missing provider is progressive-loading
   * silence, not an error).
   */
  private buildGenerator(spec: GeneratorSpec): ToneGenerator | null {
    switch (spec.kind) {
      case 'fm':
        return new FmGenerator(spec.fm, this.sampleRate);
      case 'additive':
        return new AdditiveGenerator(spec.partials, this.sampleRate);
      case 'va':
        return new VaGenerator(spec.va, this.sampleRate, spec.seed);
      case 'sample': {
        const zones = this.zoneSetProvider?.(spec.zoneSetId) ?? null;
        if (zones === null || zones.length === 0) {
          return null;
        }
        return new SampleZoneGenerator(zones, spec.crossfade, this.sampleRate);
      }
    }
  }
}
