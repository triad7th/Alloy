// Web platform edge: sample playback voice built from WebAudio buffer
// sources. Semantic twin of AlloyAudio's SampledVoice.swift; the playback
// rate math and release shaping are the shared numeric contract.

import type { MinimalAudioContext, MinimalAudioNode } from './audio-graph.js';
import type { SampledVoiceSpec } from './instruments.js';
import type { SampleLoader } from './sample-loader.js';
import { SynthVoicePlayer } from './synth-voice-player.js';
import { FAST_STOP_S, type ActiveVoice, type VoicePlayer } from './voice-player.js';

/**
 * Sampled voice: nearest loaded zone, pitch-shifted by playback rate.
 * The recording carries its own attack and natural decay; only the key-up
 * release is shaped here. Until the loader has any zone (or forever, if
 * offline), notes transparently use the spec's fallback synth.
 */
export class SampledVoicePlayer implements VoicePlayer {
  private readonly fallback: SynthVoicePlayer;

  constructor(
    private readonly ctx: MinimalAudioContext,
    private readonly spec: SampledVoiceSpec,
    private readonly output: MinimalAudioNode,
    private readonly loader: SampleLoader,
  ) {
    this.fallback = new SynthVoicePlayer(ctx, spec.fallback, output);
  }

  start(midi: number, velocity: number, when: number): ActiveVoice {
    const zone = this.loader.nearestLoaded(midi);
    if (!zone) {
      return this.fallback.start(midi, velocity, when);
    }

    const source = this.ctx.createBufferSource();
    source.buffer = zone.buffer;
    source.playbackRate.value = 2 ** ((midi - zone.midi) / 12);

    const gain = this.ctx.createGain();
    gain.gain.value = Math.max(0, Math.min(1, velocity));
    source.connect(gain);
    gain.connect(this.output);
    source.onended = () => gain.disconnect();
    source.start(when);

    const end = (at: number, fade: number): void => {
      gain.gain.setTargetAtTime(0, at, fade / 3);
      source.stop(at + fade * 3);
    };
    return {
      release: (at) => end(at, this.spec.release),
      stop: (at) => end(at, FAST_STOP_S),
    };
  }
}
