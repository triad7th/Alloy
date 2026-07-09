// The subset of the Web Audio API the engine uses — the deliberate WebAudio
// seam. Kept tiny so it is easy to mock in tests. Documented asymmetry: the
// Swift AlloyAudio twin synthesizes by hand; the alignment contract is
// MinimalAudioParam ↔ ParamRamp (the same three scheduling primitives).

export interface MinimalAudioParam {
  value: number;
  setValueAtTime(value: number, when: number): void;
  linearRampToValueAtTime(value: number, when: number): void;
  setTargetAtTime(target: number, when: number, timeConstant: number): void;
}

export type MinimalDestination = object;

export interface MinimalAudioNode {
  connect(destination: MinimalAudioNode | MinimalDestination): void;
  disconnect(): void;
}

export interface MinimalGain extends MinimalAudioNode {
  readonly gain: MinimalAudioParam;
}

export interface MinimalOscillator extends MinimalAudioNode {
  type: OscillatorType;
  readonly frequency: MinimalAudioParam;
  readonly detune: MinimalAudioParam;
  start(when?: number): void;
  stop(when?: number): void;
  onended: (() => void) | null;
}

export interface MinimalAudioBuffer {
  readonly sampleRate: number;
  readonly length: number;
  readonly numberOfChannels: number;
  getChannelData(channel: number): Float32Array;
}

export interface MinimalBufferSource extends MinimalAudioNode {
  buffer: MinimalAudioBuffer | null;
  readonly playbackRate: MinimalAudioParam;
  start(when?: number): void;
  stop(when?: number): void;
  onended: (() => void) | null;
}

export interface MinimalBiquadFilter extends MinimalAudioNode {
  type: BiquadFilterType;
  readonly frequency: MinimalAudioParam;
  readonly Q: MinimalAudioParam;
}

export interface MinimalDynamicsCompressor extends MinimalAudioNode {
  readonly threshold: MinimalAudioParam;
  readonly knee: MinimalAudioParam;
  readonly ratio: MinimalAudioParam;
  readonly attack: MinimalAudioParam;
  readonly release: MinimalAudioParam;
}

export interface MinimalConvolver extends MinimalAudioNode {
  buffer: MinimalAudioBuffer | null;
}

export interface MinimalDelay extends MinimalAudioNode {
  readonly delayTime: MinimalAudioParam;
}

export interface MinimalAudioContext {
  readonly currentTime: number;
  readonly sampleRate: number;
  readonly destination: MinimalDestination;
  // Present on the real Web Audio API; optional so tiny mocks need not provide it.
  // Used to resume a context that autoplay-enforcing browsers start 'suspended'.
  readonly state?: AudioContextState;
  createOscillator(): MinimalOscillator;
  createGain(): MinimalGain;
  createBufferSource(): MinimalBufferSource;
  createBiquadFilter(): MinimalBiquadFilter;
  createDynamicsCompressor(): MinimalDynamicsCompressor;
  createConvolver(): MinimalConvolver;
  createDelay(maxDelayTime?: number): MinimalDelay;
  createBuffer(numberOfChannels: number, length: number, sampleRate: number): MinimalAudioBuffer;
  decodeAudioData(data: ArrayBuffer): Promise<MinimalAudioBuffer>;
  resume?(): Promise<void>;
}
