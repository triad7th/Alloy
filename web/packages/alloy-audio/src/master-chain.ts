// Web platform edge: the shared output/effects graph built from WebAudio
// nodes. Semantic twin of the effects section of AlloyAudio's
// AVSynthEngine.swift (dry/reverb/delay sends into a limiter).

import type { MinimalAudioBuffer, MinimalAudioContext, MinimalAudioNode } from './audio-graph.js';
import type { VoiceSends } from './instruments.js';

const REVERB_SECONDS = 1.4;
const DELAY_SECONDS = 0.26;
const DELAY_FEEDBACK = 0.25;

/**
 * Shared output chain: per-voice channel -> dry bus -> limiter -> speakers,
 * with reverb (generated-IR convolver) and feedback-delay send buses that
 * also return into the limiter. The limiter is a hard-tuned compressor so
 * stacked sustained notes cannot clip.
 */
export class MasterChain {
  private readonly dry: MinimalAudioNode;
  private readonly reverbIn: MinimalAudioNode;
  private readonly delayIn: MinimalAudioNode;

  constructor(private readonly ctx: MinimalAudioContext) {
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -6;
    limiter.knee.value = 4;
    limiter.ratio.value = 20;
    limiter.attack.value = 0.002;
    limiter.release.value = 0.15;
    limiter.connect(ctx.destination);

    const dry = ctx.createGain();
    dry.connect(limiter);
    this.dry = dry;

    const convolver = ctx.createConvolver();
    convolver.buffer = generateImpulseResponse(ctx, REVERB_SECONDS);
    convolver.connect(limiter);
    this.reverbIn = convolver;

    const delay = ctx.createDelay(1);
    delay.delayTime.value = DELAY_SECONDS;
    const feedback = ctx.createGain();
    feedback.gain.value = DELAY_FEEDBACK;
    delay.connect(feedback);
    feedback.connect(delay);
    delay.connect(limiter);
    this.delayIn = delay;
  }

  /**
   * Create the mixer input for one instrument: a gain feeding the dry bus,
   * plus send taps into the reverb/delay buses at the given levels.
   */
  channel(sends: VoiceSends): MinimalAudioNode {
    const input = this.ctx.createGain();
    input.connect(this.dry);
    if (sends.reverb > 0) {
      const tap = this.ctx.createGain();
      tap.gain.value = sends.reverb;
      input.connect(tap);
      tap.connect(this.reverbIn);
    }
    if (sends.delay > 0) {
      const tap = this.ctx.createGain();
      tap.gain.value = sends.delay;
      input.connect(tap);
      tap.connect(this.delayIn);
    }
    return input;
  }
}

/** Exponentially decaying stereo noise burst — a zero-asset room impulse. */
export function generateImpulseResponse(
  ctx: MinimalAudioContext,
  seconds: number,
): MinimalAudioBuffer {
  const length = Math.round(seconds * ctx.sampleRate);
  const buffer = ctx.createBuffer(2, length, ctx.sampleRate);
  for (let channel = 0; channel < 2; channel++) {
    const data = buffer.getChannelData(channel);
    for (let i = 0; i < length; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.exp((-5 * i) / length);
    }
  }
  return buffer;
}
