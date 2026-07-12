// Master send + limiter bus. Snapshots the (post-insert) dry stereo bus,
// taps it into the shared reverb and delay by the current patch's send
// levels, sums both wets back onto the dry, then brickwall-limits. In place,
// non-allocating. Adds limiter.latencySamples of latency to the whole render.
// Twin: MasterBus.swift.

import { Delay } from './delay.js';
import { Limiter } from './limiter.js';
import { Reverb } from './reverb.js';
import { type MasterConfig } from './effect-types.js';

const MAX_BLOCK_FRAMES = 4096;

export class MasterBus {
  private readonly reverb: Reverb;
  private readonly delay: Delay;
  private readonly limiter: Limiter;
  private sendReverb = 0;
  private sendDelay = 0;
  /** Dry snapshot at process() entry — both sends tap this, not the wet bus. */
  private readonly dryL = new Float32Array(MAX_BLOCK_FRAMES);
  private readonly dryR = new Float32Array(MAX_BLOCK_FRAMES);
  /** Pre-scaled send input. */
  private readonly sendL = new Float32Array(MAX_BLOCK_FRAMES);
  private readonly sendR = new Float32Array(MAX_BLOCK_FRAMES);
  /** Wet output of whichever send unit is running (reused sequentially). */
  private readonly wetL = new Float32Array(MAX_BLOCK_FRAMES);
  private readonly wetR = new Float32Array(MAX_BLOCK_FRAMES);

  constructor(config: MasterConfig, sampleRate: number) {
    this.reverb = new Reverb(config.reverb, sampleRate);
    this.delay = new Delay(config.delay, sampleRate);
    this.limiter = new Limiter(config.limiter, sampleRate);
  }

  get latencySamples(): number {
    return this.limiter.latencySamples;
  }

  setSends(reverb: number, delay: number): void {
    this.sendReverb = reverb;
    this.sendDelay = delay;
  }

  reset(): void {
    this.reverb.reset();
    this.delay.reset();
    this.limiter.reset();
    this.dryL.fill(0);
    this.dryR.fill(0);
    this.sendL.fill(0);
    this.sendR.fill(0);
    this.wetL.fill(0);
    this.wetR.fill(0);
  }

  process(left: Float32Array, right: Float32Array, frames: number): void {
    // Snapshot the dry bus; both send taps read from this snapshot.
    for (let i = 0; i < frames; i++) {
      this.dryL[i] = left[i];
      this.dryR[i] = right[i];
    }

    // Reverb send: dry * sendReverb -> reverb -> add wet. The reverb always
    // runs so its tail keeps ringing after the send level drops; the send
    // level scales only its input.
    for (let i = 0; i < frames; i++) {
      this.sendL[i] = this.dryL[i] * this.sendReverb;
      this.sendR[i] = this.dryR[i] * this.sendReverb;
    }
    this.reverb.process(this.sendL, this.sendR, this.wetL, this.wetR, frames);
    for (let i = 0; i < frames; i++) {
      left[i] += this.wetL[i];
      right[i] += this.wetR[i];
    }

    // Delay send: dry * sendDelay -> delay -> add wet (taps the SAME dry
    // snapshot, so it never echoes the reverb wet just added).
    for (let i = 0; i < frames; i++) {
      this.sendL[i] = this.dryL[i] * this.sendDelay;
      this.sendR[i] = this.dryR[i] * this.sendDelay;
    }
    this.delay.process(this.sendL, this.sendR, this.wetL, this.wetR, frames);
    for (let i = 0; i < frames; i++) {
      left[i] += this.wetL[i];
      right[i] += this.wetR[i];
    }

    // Master brickwall, last.
    this.limiter.process(left, right, frames);
  }
}
