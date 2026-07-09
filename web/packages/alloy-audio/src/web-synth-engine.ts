// Web platform edge: wires an app-supplied instrument catalog to
// SynthEngineCore over a real (or minimal) AudioContext — master chain,
// per-instrument players and sample loaders, and autoplay resume on the
// first gesture. Semantic twin of AlloyAudio's AVSynthEngine.swift.

import type { MinimalAudioContext } from './audio-graph.js';
import type { InstrumentDescriptor, SampledVoiceSpec } from './instruments.js';
import { MasterChain } from './master-chain.js';
import { SampleLoader, type FetchSample } from './sample-loader.js';
import { SampledVoicePlayer } from './sampled-voice-player.js';
import { SupersawPlayer } from './supersaw-player.js';
import type { SynthEngine } from './synth-engine.js';
import { SynthEngineCore } from './synth-engine-core.js';
import type { VoicePlayer } from './voice-player.js';

export class WebSynthEngine implements SynthEngine {
  private readonly master: MasterChain;
  private readonly descriptors = new Map<string, InstrumentDescriptor>();
  private readonly players = new Map<string, VoicePlayer>();
  private readonly loaders = new Map<string, SampleLoader>();
  private readonly core: SynthEngineCore;

  constructor(
    private readonly ctx: MinimalAudioContext,
    instruments: InstrumentDescriptor[],
    defaultInstrumentId?: string,
    private readonly fetchSample?: FetchSample,
  ) {
    this.master = new MasterChain(ctx);
    for (const descriptor of instruments) {
      this.descriptors.set(descriptor.id, descriptor);
    }
    this.core = new SynthEngineCore(
      (id) => this.playerFor(id),
      () => this.ctx.currentTime,
    );
    // Preload at startup: building the default player starts its sample fetches.
    // Default instrument = first in the catalog when none is given.
    const initial = defaultInstrumentId ?? instruments[0]?.id;
    if (initial !== undefined && this.descriptors.has(initial)) {
      this.core.setInstrument(initial);
    }
  }

  noteOn(midi: number, velocity = 1): void {
    this.resumeIfSuspended();
    this.core.noteOn(midi, velocity);
  }

  noteOff(midi: number): void {
    this.core.noteOff(midi);
  }

  setSustain(on: boolean): void {
    this.core.setSustain(on);
  }

  setInstrument(id: string): void {
    if (!this.descriptors.has(id)) {
      // Unknown id (e.g. a stale persisted value): keep the current instrument.
      return;
    }
    this.core.setInstrument(id);
  }

  allNotesOff(): void {
    this.core.allNotesOff();
  }

  /** One player (and master-chain channel) per instrument, built on demand. */
  private playerFor(id: string): VoicePlayer {
    const cached = this.players.get(id);
    if (cached) {
      return cached;
    }
    const descriptor = this.descriptors.get(id);
    if (!descriptor) {
      // setInstrument guards lookups; this is a defensive backstop.
      throw new Error(`Unknown instrument id: ${id}`);
    }
    const output = this.master.channel(descriptor.sends);
    const voice = descriptor.voice;
    const player =
      voice.kind === 'sampled'
        ? new SampledVoicePlayer(this.ctx, voice, output, this.loaderFor(voice))
        : new SupersawPlayer(this.ctx, voice, output);
    this.players.set(id, player);
    return player;
  }

  /** One loader per sample set, shared across instrument switches. */
  private loaderFor(voice: SampledVoiceSpec): SampleLoader {
    let loader = this.loaders.get(voice.sampleBaseUrl);
    if (!loader) {
      loader = new SampleLoader(this.ctx, voice.sampleBaseUrl, voice.sampleMidis, this.fetchSample);
      this.loaders.set(voice.sampleBaseUrl, loader);
    }
    loader.start();
    return loader;
  }

  // Autoplay-enforcing browsers (notably iOS and desktop Safari) start an
  // AudioContext constructed outside a user gesture in the 'suspended' state, and
  // it stays silent until resumed inside a gesture. Every noteOn originates from a
  // real gesture (key press, pointer, or touch), so resume here to guarantee the
  // first note sounds. resume() on a running context is a cheap no-op.
  private resumeIfSuspended(): void {
    if (this.ctx.state === 'suspended') {
      void this.ctx.resume?.();
    }
  }
}
