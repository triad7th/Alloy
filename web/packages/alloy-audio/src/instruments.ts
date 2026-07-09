// Voice spec types and the instrument descriptor apps use to describe their
// catalogs. The catalog itself stays app-side: ids are opaque strings and
// AlloyAudio ships no instruments. Web-canonical twin of AlloyAudio's
// Instruments.swift.

export interface SynthVoiceConfig {
  waveform: OscillatorType;
  attack: number; // seconds
  decay: number; // seconds
  sustain: number; // 0..1 level after decay
  release: number; // seconds
}

export interface SupersawVoiceSpec {
  kind: 'supersaw';
  /** Number of detuned saw oscillators per note. */
  unison: number;
  /** Total detune spread in cents (oscillators spaced evenly across ±detuneCents/2). */
  detuneCents: number;
  filter: {
    /** Lowpass cutoff floor in Hz. */
    baseHz: number;
    /** Extra cutoff opened by the filter envelope at note-on, in Hz. */
    envHz: number;
    /** Filter-envelope decay time constant in seconds. */
    decay: number;
    q: number;
  };
  /** Amp envelope; waveform is ignored (always sawtooth). */
  amp: SynthVoiceConfig;
}

export interface SampledVoiceSpec {
  kind: 'sampled';
  /** Static asset directory, relative to the app root. */
  sampleBaseUrl: string;
  /** MIDI notes that have a recorded file (file name = zero-padded midi + '.mp3'). */
  sampleMidis: readonly number[];
  /** Key-up gain release in seconds. */
  release: number;
  /** Stopgap synth used until sample zones decode (and forever if offline). */
  fallback: SynthVoiceConfig;
}

export type VoiceSpec = SampledVoiceSpec | SupersawVoiceSpec;

/** Per-instrument send levels into the master effect buses (0..1). */
export interface VoiceSends {
  reverb: number;
  delay: number;
}

/** One playable instrument: an opaque id, a voice recipe, and its bus sends. */
export interface InstrumentDescriptor {
  id: string;
  voice: VoiceSpec;
  sends: VoiceSends;
}
