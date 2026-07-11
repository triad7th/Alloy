// WorkletSynthHost: main-thread wrapper around an AudioWorkletNode running
// AlloyPatchProcessor (src/worklet/alloy-patch-processor.ts). Speaks the
// WorkletHostCore wire protocol (worklet-host-core.ts) over postMessage;
// owns no DSP of its own — this is the platform edge, not the engine.
// Semantic twin (not literal): swift/Sources/AlloyAudio/PatchEngineHost.swift
// (Task 3) — frame domains differ (context frames here vs. engine frames
// there) and patch rejection surfaces differ (port reply -> callback here vs.
// a direct callback there); see docs/mirroring.md for the full asymmetry
// ledger.

import type { Patch } from './dsp/patch.js';
import { WORKLET_PROCESSOR_NAME, type WireZoneLayer, type WorkletInMessage, type WorkletOutMessage } from './worklet-host-core.js';

/** The worklet-facing subset of AudioContext/AudioWorkletNode — the test seam. */
export interface MinimalWorkletPort {
  postMessage(message: unknown, transfer?: Transferable[]): void;
  onmessage: ((event: { data: unknown }) => void) | null;
}

export interface MinimalWorkletNode {
  readonly port: MinimalWorkletPort;
  connect(destination: unknown): void;
  disconnect(): void;
}

export interface MinimalWorkletContext {
  readonly sampleRate: number;
  readonly currentTime: number;
  audioWorklet: { addModule(url: string): Promise<void> };
  createWorkletNode(name: string, options: { processorOptions?: unknown }): MinimalWorkletNode; // real impl wraps `new AudioWorkletNode(ctx, name, opts)`
  destination: unknown;
}

export class WorkletSynthHost {
  /** Fired when a queued setPatch fails validatePatch on the render thread. */
  onPatchRejected: ((errors: string[]) => void) | null = null;

  private constructor(
    private readonly ctx: MinimalWorkletContext,
    private readonly node: MinimalWorkletNode,
  ) {
    this.node.port.onmessage = (event) => this.handleReply(event.data as WorkletOutMessage);
  }

  /**
   * addModule(moduleUrl) then construct + connect the node. The app owns the
   * module URL. IMPORTANT: the worklet module's import graph spans the whole
   * package dist/ (worklet/ -> ../worklet-host-core.js -> ./dsp/*.js), so the
   * ENTIRE dist/ tree must be served with its layout preserved — e.g. an
   * angular.json asset glob over the package's dist/, with moduleUrl pointing
   * at <assets>/worklet/alloy-patch-processor.js. Copying only dist/worklet/
   * breaks addModule() with a 404 on the relative imports.
   */
  static async create(ctx: MinimalWorkletContext, moduleUrl: string, options?: { maxVoices?: number }): Promise<WorkletSynthHost> {
    await ctx.audioWorklet.addModule(moduleUrl);
    const node = ctx.createWorkletNode(WORKLET_PROCESSOR_NAME, { processorOptions: options });
    node.connect(ctx.destination);
    return new WorkletSynthHost(ctx, node);
  }

  setPatch(patch: Patch): void {
    this.post({ type: 'setPatch', patch });
  }

  /** Transfers each zone's underlying ArrayBuffer (once per buffer, even if shared across zones). */
  setZoneSet(id: string, layers: WireZoneLayer[]): void {
    const buffers = new Set<ArrayBuffer>();
    for (const layer of layers) {
      for (const zone of layer.zones) {
        buffers.add(zone.samples.buffer as ArrayBuffer);
      }
    }
    this.post({ type: 'setZoneSet', id, layers }, [...buffers]);
  }

  /** when: AudioContext seconds (ctx.currentTime domain); undefined = now. */
  noteOn(midi: number, velocity: number, when?: number): void {
    this.post({ type: 'noteOn', midi, velocity, atFrame: this.toAtFrame(when) });
  }

  noteOff(midi: number, when?: number): void {
    this.post({ type: 'noteOff', midi, atFrame: this.toAtFrame(when) });
  }

  allNotesOff(): void {
    this.post({ type: 'allNotesOff' });
  }

  /** disconnect + clear onmessage. */
  dispose(): void {
    this.node.disconnect();
    this.node.port.onmessage = null;
  }

  /** AudioContext seconds -> absolute context frames; undefined stays undefined (immediate). */
  private toAtFrame(when: number | undefined): number | undefined {
    return when === undefined ? undefined : Math.round(when * this.ctx.sampleRate);
  }

  private post(message: WorkletInMessage, transfer?: Transferable[]): void {
    this.node.port.postMessage(message, transfer);
  }

  private handleReply(message: WorkletOutMessage): void {
    if (message.type === 'patchRejected') {
      this.onPatchRejected?.(message.errors);
    }
  }
}
