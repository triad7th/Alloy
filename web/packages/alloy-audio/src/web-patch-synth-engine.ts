import { validatePatch, type Patch } from './dsp/patch.js';
import type { PackLoader } from './pack/pack-loader.js';
import { PatchSynthEngine } from './patch-synth-engine.js';
import type { SynthEngine } from './synth-engine.js';
import { WorkletSynthHost, type MinimalWorkletContext, type MinimalWorkletNode } from './worklet-synth-host.js';

/** Raw AudioContext satisfies this seam. Tests may supply createWorkletNode. */
export interface MinimalPatchAudioContext {
  readonly sampleRate: number;
  readonly currentTime: number;
  readonly state: string;
  readonly destination: unknown;
  readonly audioWorklet: { addModule(url: string): Promise<void> };
  resume(): Promise<void>;
  createWorkletNode?: MinimalWorkletContext['createWorkletNode'];
}

/** Owns one worklet graph; the caller retains ownership of the AudioContext. */
export class WebPatchSynthEngine implements SynthEngine {
  private readonly core: PatchSynthEngine;
  private disposed = false;

  private constructor(private readonly context: MinimalPatchAudioContext, private readonly host: WorkletSynthHost, defaultVelocity: number) {
    this.core = new PatchSynthEngine(host, defaultVelocity);
  }

  /** Consumes the loader's PCM buffers by transferring them to the worklet. */
  static async create(context: MinimalPatchAudioContext, patch: Patch, loader: PackLoader, zoneSetIds: readonly string[], moduleUrl: string, defaultVelocity = 1): Promise<WebPatchSynthEngine> {
    const errors = validatePatch(patch);
    if (errors.length) throw new Error(errors.join('; '));
    const host = await WorkletSynthHost.create({
      sampleRate: context.sampleRate,
      get currentTime() { return context.currentTime; },
      destination: context.destination,
      audioWorklet: context.audioWorklet,
      createWorkletNode: (name, options) => {
        if (context.createWorkletNode) return context.createWorkletNode(name, options);
        // The only browser-global construction. Keep DOM types out of the public seam.
        const Node = (globalThis as unknown as { AudioWorkletNode: new (context: MinimalPatchAudioContext, name: string, options: unknown) => MinimalWorkletNode }).AudioWorkletNode;
        return new Node(context, name, { ...options, outputChannelCount: [2] });
      },
    }, moduleUrl);
    try {
      await loader.load();
      for (const id of zoneSetIds) {
        const layers = loader.provide(id);
        if (!layers) throw new Error(`Missing zone set: ${id}`);
        host.setZoneSet(id, layers.map(layer => ({
          topVelocity: layer.topVelocity,
          zones: layer.zones.map(({ data, ...zone }) => ({ ...zone, samples: data })),
        })));
      }
      host.setPatch(patch);
      return new WebPatchSynthEngine(context, host, defaultVelocity);
    } catch (error) {
      host.dispose();
      throw error;
    }
  }

  noteOn(midi: number, velocity?: number): void {
    if (this.disposed) return;
    // Call resume in the gesture stack, before any promise continuation.
    if (this.context.state !== 'running') void this.context.resume().catch(() => {});
    this.core.noteOn(midi, velocity);
  }
  noteOff(midi: number): void { if (!this.disposed) this.core.noteOff(midi); }
  setSustain(on: boolean): void { if (!this.disposed) this.core.setSustain(on); }
  setInstrument(_id: string): void {}
  allNotesOff(): void { if (!this.disposed) this.core.allNotesOff(); }
  dispose(): void {
    if (this.disposed) return;
    this.allNotesOff();
    this.disposed = true;
    this.host.dispose();
  }
}
