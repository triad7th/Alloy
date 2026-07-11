// WorkletHostCore: pure (browserless) web host logic for the rompler
// AudioWorkletProcessor. Owns the message queue, frame anchoring, and zone
// deserialization around a PatchEngine; the AudioWorkletProcessor shell
// (Task 2, src/worklet/) is a thin, logic-free wrapper over this class so
// everything here is plain-vitest-testable. Semantic twin (not literal):
// swift/Sources/AlloyAudio/PatchCommandQueue.swift + PatchEngineHost.swift
// (Task 3) — frame domains differ (context frames here vs. engine frames
// there) and patch rejection surfaces differ (port reply vs. callback); see
// docs/mirroring.md for the full asymmetry ledger.

import { validatePatch, type Patch } from './dsp/patch.js';
import { PatchEngine, type EngineEvent } from './dsp/patch-engine.js';
import type { SampleZoneData, VelocityLayerData } from './dsp/sample-zone-generator.js';

/** Zone data as it crosses the message port (buffers are transferred). */
export interface WireZone {
  rootMidi: number;
  sampleRate: number;
  samples: Float32Array;
  loopStart?: number;
  loopEnd?: number;
}

export interface WireZoneLayer {
  topVelocity: number;
  zones: WireZone[];
}

/**
 * All frames are ABSOLUTE CONTEXT frames (AudioWorkletGlobalScope.currentFrame
 * timebase), not engine frames. Omitted atFrame = immediate.
 */
export type WorkletInMessage =
  | { type: 'setPatch'; patch: Patch }
  | { type: 'setZoneSet'; id: string; layers: WireZoneLayer[] }
  | { type: 'noteOn'; midi: number; velocity: number; atFrame?: number }
  | { type: 'noteOff'; midi: number; atFrame?: number }
  | { type: 'allNotesOff'; atFrame?: number };

export type WorkletOutMessage = { type: 'patchRejected'; errors: string[] };

export const WORKLET_PROCESSOR_NAME = 'alloy-patch-engine';

/** Per-render drain bound; leftovers stay queued in order across renders. */
export const MAX_COMMANDS_PER_BLOCK = 512;

function toSampleZoneData(zone: WireZone): SampleZoneData {
  const data: SampleZoneData = {
    rootMidi: zone.rootMidi,
    sampleRate: zone.sampleRate,
    data: zone.samples,
  };
  if (zone.loopStart !== undefined) {
    data.loopStart = zone.loopStart;
  }
  if (zone.loopEnd !== undefined) {
    data.loopEnd = zone.loopEnd;
  }
  return data;
}

function toVelocityLayerData(layer: WireZoneLayer): VelocityLayerData {
  return { topVelocity: layer.topVelocity, zones: layer.zones.map(toSampleZoneData) };
}

export class WorkletHostCore {
  private readonly engine: PatchEngine;
  private readonly zoneSets = new Map<string, VelocityLayerData[]>();
  private readonly queue: WorkletInMessage[] = [];

  /** anchorFrame: the context frame at which engine frame 0 occurs (processor construction). */
  constructor(
    sampleRate: number,
    private readonly anchorFrame: number,
    options?: { maxVoices?: number },
  ) {
    this.engine = new PatchEngine(sampleRate, {
      maxVoices: options?.maxVoices,
      zoneSetProvider: (id) => this.zoneSets.get(id) ?? null,
    });
  }

  /** Messages queued but not yet applied to the engine. */
  get pendingMessageCount(): number {
    return this.queue.length;
  }

  /** Queue a message; applied (bounded) at the start of the next render. Never throws. */
  onMessage(message: WorkletInMessage): void {
    this.queue.push(message);
  }

  /**
   * Drain <= MAX_COMMANDS_PER_BLOCK queued messages, then engine.process into
   * left/right (ADDS; caller passes the pre-zeroed worklet buffers). postReply
   * collects any patchRejected replies. `frames` must be <= 4096 (the
   * engine's block cap); the worklet shell's fixed 128-frame quantum always
   * satisfies this — unlike the Apple host, this core does not slice.
   */
  render(left: Float32Array, right: Float32Array, frames: number, postReply: (reply: WorkletOutMessage) => void): void {
    this.drain(postReply);
    this.engine.process(left, right, frames);
  }

  private drain(postReply: (reply: WorkletOutMessage) => void): void {
    const count = Math.min(this.queue.length, MAX_COMMANDS_PER_BLOCK);
    for (let i = 0; i < count; i++) {
      this.apply(this.queue[i], postReply);
    }
    if (count > 0) {
      this.queue.splice(0, count);
    }
  }

  private apply(message: WorkletInMessage, postReply: (reply: WorkletOutMessage) => void): void {
    switch (message.type) {
      case 'setPatch': {
        const errors = validatePatch(message.patch);
        if (errors.length > 0) {
          postReply({ type: 'patchRejected', errors });
          break;
        }
        this.engine.setPatch(message.patch);
        break;
      }
      case 'setZoneSet':
        this.zoneSets.set(message.id, message.layers.map(toVelocityLayerData));
        break;
      case 'noteOn':
        this.schedule({ frame: this.engineFrame(message.atFrame), kind: 'noteOn', midi: message.midi, velocity: message.velocity });
        break;
      case 'noteOff':
        this.schedule({ frame: this.engineFrame(message.atFrame), kind: 'noteOff', midi: message.midi });
        break;
      case 'allNotesOff':
        this.schedule({ frame: this.engineFrame(message.atFrame), kind: 'allNotesOff' });
        break;
    }
  }

  private schedule(event: EngineEvent): void {
    this.engine.schedule(event);
  }

  /** Context frame -> engine frame; a past atFrame maps to a negative/zero
   * engine frame, which PatchEngine.process treats as due immediately. */
  private engineFrame(atFrame: number | undefined): number {
    return atFrame === undefined ? 0 : atFrame - this.anchorFrame;
  }
}
