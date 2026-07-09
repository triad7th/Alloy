// Internal test helper: recording fakes for the MinimalAudio* graph.
// Not exported from the package barrel and excluded from the build.

import type {
  MinimalAudioBuffer,
  MinimalAudioContext,
  MinimalAudioNode,
  MinimalAudioParam,
  MinimalBiquadFilter,
  MinimalBufferSource,
  MinimalConvolver,
  MinimalDelay,
  MinimalDestination,
  MinimalDynamicsCompressor,
  MinimalGain,
  MinimalOscillator,
} from '../audio-graph.js';

/** One scheduled AudioParam call, recorded for envelope assertions. */
export interface ParamEvent {
  type: 'set' | 'linear' | 'target';
  value: number;
  when: number;
  timeConstant?: number;
}

export class FakeParam implements MinimalAudioParam {
  value = 0;
  readonly events: ParamEvent[] = [];
  setValueAtTime(value: number, when: number): void {
    this.value = value;
    this.events.push({ type: 'set', value, when });
  }
  linearRampToValueAtTime(value: number, when: number): void {
    this.value = value;
    this.events.push({ type: 'linear', value, when });
  }
  setTargetAtTime(target: number, when: number, timeConstant: number): void {
    this.value = target;
    this.events.push({ type: 'target', value: target, when, timeConstant });
  }
}

class FakeNode implements MinimalAudioNode {
  readonly connections: (MinimalAudioNode | MinimalDestination)[] = [];
  disconnected = false;
  connect(destination: MinimalAudioNode | MinimalDestination): void {
    this.connections.push(destination);
  }
  disconnect(): void {
    this.disconnected = true;
  }
}

export class FakeGain extends FakeNode implements MinimalGain {
  readonly gain = new FakeParam();
  constructor() {
    super();
    this.gain.value = 1; // real GainNodes default to unity
  }
}

export class FakeOsc extends FakeNode implements MinimalOscillator {
  type: OscillatorType = 'sine';
  readonly frequency = new FakeParam();
  readonly detune = new FakeParam();
  started = false;
  stopped = false;
  stopWhen: number | undefined;
  onended: (() => void) | null = null;
  start(): void {
    this.started = true;
  }
  stop(when?: number): void {
    this.stopped = true;
    this.stopWhen = when;
  }
}

export class FakeBuffer implements MinimalAudioBuffer {
  private readonly channels: Float32Array[];
  constructor(
    readonly numberOfChannels: number,
    readonly length: number,
    readonly sampleRate: number,
  ) {
    this.channels = Array.from({ length: numberOfChannels }, () => new Float32Array(length));
  }
  getChannelData(channel: number): Float32Array {
    return this.channels[channel];
  }
}

export class FakeBufferSource extends FakeNode implements MinimalBufferSource {
  buffer: MinimalAudioBuffer | null = null;
  readonly playbackRate = new FakeParam();
  started = false;
  stopped = false;
  stopWhen: number | undefined;
  onended: (() => void) | null = null;
  constructor() {
    super();
    this.playbackRate.value = 1;
  }
  start(): void {
    this.started = true;
  }
  stop(when?: number): void {
    this.stopped = true;
    this.stopWhen = when;
  }
}

export class FakeFilter extends FakeNode implements MinimalBiquadFilter {
  type: BiquadFilterType = 'lowpass';
  readonly frequency = new FakeParam();
  readonly Q = new FakeParam();
}

export class FakeCompressor extends FakeNode implements MinimalDynamicsCompressor {
  readonly threshold = new FakeParam();
  readonly knee = new FakeParam();
  readonly ratio = new FakeParam();
  readonly attack = new FakeParam();
  readonly release = new FakeParam();
}

export class FakeConvolver extends FakeNode implements MinimalConvolver {
  buffer: MinimalAudioBuffer | null = null;
}

export class FakeDelay extends FakeNode implements MinimalDelay {
  readonly delayTime = new FakeParam();
}

export class FakeCtx implements MinimalAudioContext {
  currentTime = 0;
  sampleRate = 44100;
  destination: MinimalDestination = {};
  state: AudioContextState = 'running';
  resumeCalls = 0;
  readonly oscillators: FakeOsc[] = [];
  readonly gains: FakeGain[] = [];
  readonly bufferSources: FakeBufferSource[] = [];
  readonly filters: FakeFilter[] = [];
  readonly compressors: FakeCompressor[] = [];
  readonly convolvers: FakeConvolver[] = [];
  readonly delays: FakeDelay[] = [];
  /** Override to control decoding in tests (default: 1s stereo silence). */
  decodeImpl: (data: ArrayBuffer) => Promise<MinimalAudioBuffer> = () =>
    Promise.resolve(new FakeBuffer(2, this.sampleRate, this.sampleRate));
  createOscillator(): FakeOsc {
    const o = new FakeOsc();
    this.oscillators.push(o);
    return o;
  }
  createGain(): FakeGain {
    const g = new FakeGain();
    this.gains.push(g);
    return g;
  }
  createBufferSource(): FakeBufferSource {
    const s = new FakeBufferSource();
    this.bufferSources.push(s);
    return s;
  }
  createBiquadFilter(): FakeFilter {
    const f = new FakeFilter();
    this.filters.push(f);
    return f;
  }
  createDynamicsCompressor(): FakeCompressor {
    const c = new FakeCompressor();
    this.compressors.push(c);
    return c;
  }
  createConvolver(): FakeConvolver {
    const c = new FakeConvolver();
    this.convolvers.push(c);
    return c;
  }
  createDelay(): FakeDelay {
    const d = new FakeDelay();
    this.delays.push(d);
    return d;
  }
  createBuffer(numberOfChannels: number, length: number, sampleRate: number): FakeBuffer {
    return new FakeBuffer(numberOfChannels, length, sampleRate);
  }
  decodeAudioData(data: ArrayBuffer): Promise<MinimalAudioBuffer> {
    return this.decodeImpl(data);
  }
  resume(): Promise<void> {
    this.resumeCalls += 1;
    this.state = 'running';
    return Promise.resolve();
  }
}
