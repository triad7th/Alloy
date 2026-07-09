// Web platform edge: detuned saw unison through a lowpass, built from
// WebAudio nodes. Semantic twin of AlloyAudio's SupersawVoice.swift; detune
// spread, filter envelope, and amp targets are the shared numeric contract.

import type { MinimalAudioContext, MinimalAudioNode } from './audio-graph.js';
import type { SupersawVoiceSpec } from './instruments.js';
import { midiToFrequency } from './pitch.js';
import { FAST_STOP_S, VOICE_PEAK, type ActiveVoice, type VoicePlayer } from './voice-player.js';

/**
 * Synthwave keys: a detuned sawtooth unison through a lowpass with a decaying
 * filter envelope, into an exponential amp envelope. Mono per voice — width
 * and space come from the master chain's reverb and delay.
 */
export class SupersawPlayer implements VoicePlayer {
  constructor(
    private readonly ctx: MinimalAudioContext,
    private readonly spec: SupersawVoiceSpec,
    private readonly output: MinimalAudioNode,
  ) {}

  start(midi: number, velocity: number, when: number): ActiveVoice {
    const { unison, detuneCents, filter: f, amp } = this.spec;

    const mix = this.ctx.createGain();
    mix.gain.value = 1 / Math.sqrt(unison);
    const oscs = Array.from({ length: unison }, (_, i) => {
      const osc = this.ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.value = midiToFrequency(midi);
      // Spread evenly across ±detuneCents/2 (a lone oscillator sits at 0).
      osc.detune.value = unison > 1 ? -detuneCents / 2 + (i * detuneCents) / (unison - 1) : 0;
      osc.connect(mix);
      return osc;
    });

    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.Q.value = f.q;
    filter.frequency.setValueAtTime(f.baseHz + f.envHz, when);
    filter.frequency.setTargetAtTime(f.baseHz, when, f.decay);
    mix.connect(filter);

    const gain = this.ctx.createGain();
    const peak = VOICE_PEAK * Math.max(0, Math.min(1, velocity));
    gain.gain.setValueAtTime(0, when);
    gain.gain.linearRampToValueAtTime(peak, when + amp.attack);
    gain.gain.setTargetAtTime(peak * amp.sustain, when + amp.attack, amp.decay);
    filter.connect(gain);
    gain.connect(this.output);

    oscs.forEach((osc) => osc.start(when));

    const end = (at: number, fade: number): void => {
      // Exponential fade: time constant fade/3 reaches ~5% by `fade`; stop at 3x
      // the constant-based tail so nothing audibly clicks.
      gain.gain.setTargetAtTime(0, at, fade / 3);
      oscs[0].onended = () => gain.disconnect();
      oscs.forEach((osc) => osc.stop(at + fade * 3));
    };
    return {
      release: (at) => end(at, amp.release),
      stop: (at) => end(at, FAST_STOP_S),
    };
  }
}
