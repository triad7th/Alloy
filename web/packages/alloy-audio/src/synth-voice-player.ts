// Web platform edge: single-oscillator ADSR voice built from WebAudio nodes.
// Semantic twin of AlloyAudio's SynthVoice.swift (hand-rolled DSP on Apple);
// the envelope targets are the shared numeric contract.

import type { MinimalAudioContext, MinimalAudioNode, MinimalDestination } from './audio-graph.js';
import type { SynthVoiceConfig } from './instruments.js';
import { midiToFrequency } from './pitch.js';
import { FAST_STOP_S, VOICE_PEAK, type ActiveVoice, type VoicePlayer } from './voice-player.js';

export class SynthVoicePlayer implements VoicePlayer {
  constructor(
    private readonly ctx: MinimalAudioContext,
    private readonly config: SynthVoiceConfig,
    private readonly output: MinimalAudioNode | MinimalDestination,
  ) {}

  start(midi: number, velocity: number, when: number): ActiveVoice {
    const cfg = this.config;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = cfg.waveform;
    osc.frequency.value = midiToFrequency(midi);
    osc.connect(gain);
    gain.connect(this.output);

    const peak = VOICE_PEAK * Math.max(0, Math.min(1, velocity));
    gain.gain.setValueAtTime(0, when);
    gain.gain.linearRampToValueAtTime(peak, when + cfg.attack);
    gain.gain.linearRampToValueAtTime(peak * cfg.sustain, when + cfg.attack + cfg.decay);
    osc.start(when);

    const end = (at: number, fade: number): void => {
      gain.gain.setValueAtTime(gain.gain.value, at);
      gain.gain.linearRampToValueAtTime(0, at + fade);
      osc.onended = () => gain.disconnect();
      osc.stop(at + fade);
    };
    return {
      release: (at) => end(at, cfg.release),
      stop: (at) => end(at, FAST_STOP_S),
    };
  }
}
