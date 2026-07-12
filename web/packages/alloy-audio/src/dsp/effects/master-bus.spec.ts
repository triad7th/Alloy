import { describe, expect, it } from 'vitest';
import { MasterBus } from './master-bus.js';
import { DEFAULT_MASTER_CONFIG, LIMITER_LOOKAHEAD_SAMPLES } from './effect-types.js';

const FS = 48_000;
const MAX_BLOCK_FRAMES = 4096;

function sine(freq: number, amp: number, frames: number, sampleRate: number, startPhase = 0): Float32Array {
  const out = new Float32Array(frames);
  for (let i = 0; i < frames; i++) {
    out[i] = amp * Math.sin(startPhase + (2 * Math.PI * freq * i) / sampleRate);
  }
  return out;
}

function rms(values: Float32Array, start: number, length: number): number {
  let sumSq = 0;
  for (let i = start; i < start + length; i++) {
    sumSq += values[i] * values[i];
  }
  return Math.sqrt(sumSq / length);
}

/** Runs `bus.process` in <= MAX_BLOCK_FRAMES chunks over the full arrays, in
 * place — mirrors how PatchEngine.renderSegment feeds the master bus (never
 * a single call larger than the engine's own segment cap). */
function processChunked(bus: MasterBus, left: Float32Array, right: Float32Array, frames: number): void {
  for (let offset = 0; offset < frames; offset += MAX_BLOCK_FRAMES) {
    const n = Math.min(MAX_BLOCK_FRAMES, frames - offset);
    bus.process(left.subarray(offset, offset + n), right.subarray(offset, offset + n), n);
  }
}

const TWIN_MASTER_L: number[] = [
  0.2579195499420166, 0.2700578570365906, 0.28198695182800293, 0.29387202858924866, 0.30552127957344055,
  0.3185104727745056, 0.33024680614471436, 0.341719388961792,
];
const TWIN_MASTER_R: number[] = [
  0.4227323532104492, 0.4314018189907074, 0.44081199169158936, 0.4491724967956543, 0.45704570412635803,
  0.464513897895813, 0.47212913632392883, 0.47827354073524475,
];

describe('MasterBus', () => {
  it('sends = 0: output equals the input delayed by latencySamples (dry + limiter only, within 1e-6)', () => {
    const bus = new MasterBus(DEFAULT_MASTER_CONFIG, FS);
    bus.setSends(0, 0);
    const ceiling = 10 ** (DEFAULT_MASTER_CONFIG.limiter.ceilingDb / 20);
    const amp = 10 ** (-12 / 20);
    expect(amp).toBeLessThan(ceiling);
    const frames = 4000;
    const left = sine(440, amp, frames, FS);
    const right = sine(440, amp, frames, FS, 0.5);
    const originalLeft = left.slice();
    const originalRight = right.slice();

    bus.process(left, right, frames);

    for (let i = bus.latencySamples; i < frames; i++) {
      expect(left[i]).toBeCloseTo(originalLeft[i - bus.latencySamples], 6);
      expect(right[i]).toBeCloseTo(originalRight[i - bus.latencySamples], 6);
    }
  });

  it('reverb send adds a decaying tail beyond the direct (dry) sample', () => {
    const bus = new MasterBus(DEFAULT_MASTER_CONFIG, FS);
    bus.setSends(0.3, 0);
    const frames = 20_000;
    const left = new Float32Array(frames);
    const right = new Float32Array(frames);
    left[0] = 1;
    right[0] = 1;

    processChunked(bus, left, right, frames);

    // The direct dry impulse alone would only ever be nonzero at
    // output[latencySamples]; any energy well past that must come from the
    // reverb's ringing tail (sendDelay is 0, so the delay contributes none).
    const tailRms = rms(left, bus.latencySamples + 2000, 2000);
    expect(tailRms).toBeGreaterThan(1e-4);
  });

  it('delay send adds an echo near delayTime + latencySamples', () => {
    const bus = new MasterBus(DEFAULT_MASTER_CONFIG, FS);
    bus.setSends(0, 0.3);
    const delaySamples = Math.round((DEFAULT_MASTER_CONFIG.delay.timeMs / 1000) * FS);
    const frames = delaySamples + 200;
    const left = new Float32Array(frames);
    const right = new Float32Array(frames);
    left[0] = 1;
    right[0] = 1;

    processChunked(bus, left, right, frames);

    const echoIndex = delaySamples + bus.latencySamples;
    // The undamped direct tap of the delay's first echo: dry * sendDelay.
    expect(Math.abs(left[echoIndex])).toBeGreaterThan(0.05);
    // Well before the echo (past the direct dry sample, before the delay
    // line has anything to emit), the bus is silent.
    expect(Math.abs(left[echoIndex - 100])).toBeLessThan(1e-6);
  });

  it('limiter still brickwalls with sends = 0.5/0.5 and a hot input', () => {
    const bus = new MasterBus(DEFAULT_MASTER_CONFIG, FS);
    bus.setSends(0.5, 0.5);
    const ceiling = 10 ** (DEFAULT_MASTER_CONFIG.limiter.ceilingDb / 20);
    const frames = 4000;
    const left = new Float32Array(frames);
    const right = new Float32Array(frames);
    for (let i = 0; i < frames; i++) {
      left[i] = 10 * Math.cos((2 * Math.PI * 440 * i) / FS);
      right[i] = 10 * Math.cos((2 * Math.PI * 440 * i) / FS + 0.2);
    }

    bus.process(left, right, frames);

    for (let i = 0; i < frames; i++) {
      expect(Math.abs(left[i])).toBeLessThanOrEqual(ceiling + 1e-6);
      expect(Math.abs(right[i])).toBeLessThanOrEqual(ceiling + 1e-6);
    }
  });

  it('determinism: two fresh instances, same input and sends, bit-identical output', () => {
    const frames = 4000;
    const inL = sine(330, 0.4, frames, FS);
    const inR = sine(330, 0.4, frames, FS, 0.3);
    const a = new MasterBus(DEFAULT_MASTER_CONFIG, FS);
    const b = new MasterBus(DEFAULT_MASTER_CONFIG, FS);
    a.setSends(0.3, 0.25);
    b.setSends(0.3, 0.25);
    const leftA = inL.slice();
    const rightA = inR.slice();
    const leftB = inL.slice();
    const rightB = inR.slice();
    a.process(leftA, rightA, frames);
    b.process(leftB, rightB, frames);
    for (let i = 0; i < frames; i++) {
      expect(leftB[i]).toBe(leftA[i]);
      expect(rightB[i]).toBe(rightA[i]);
    }
  });

  it('reset() restores initial state exactly', () => {
    const bus = new MasterBus(DEFAULT_MASTER_CONFIG, FS);
    bus.setSends(0.3, 0.25);
    const frames = 4000;
    const input = sine(330, 0.4, frames, FS);

    const leftA = input.slice();
    const rightA = input.slice();
    bus.process(leftA, rightA, frames);

    bus.reset();

    const leftB = input.slice();
    const rightB = input.slice();
    bus.process(leftB, rightB, frames);

    for (let i = 0; i < frames; i++) {
      expect(leftB[i]).toBe(leftA[i]);
      expect(rightB[i]).toBe(rightA[i]);
    }
  });

  it('matches the twin reference (DEFAULT_MASTER_CONFIG, sends 0.3/0.25, 220 Hz sine warmup)', () => {
    const bus = new MasterBus(DEFAULT_MASTER_CONFIG, FS);
    bus.setSends(0.3, 0.25);
    const warmupFrames = 4000;
    const captureFrames = 8;
    const totalFrames = warmupFrames + captureFrames;
    const left = sine(220, 0.5, totalFrames, FS);
    const right = sine(220, 0.5, totalFrames, FS, 0.4);

    bus.process(left, right, totalFrames);

    const capturedL = left.subarray(warmupFrames, warmupFrames + captureFrames);
    const capturedR = right.subarray(warmupFrames, warmupFrames + captureFrames);
    // console.log(JSON.stringify(Array.from(capturedL)));
    // console.log(JSON.stringify(Array.from(capturedR)));
    expect(TWIN_MASTER_L).toHaveLength(8);
    expect(TWIN_MASTER_R).toHaveLength(8);
    TWIN_MASTER_L.forEach((v, i) => expect(capturedL[i]).toBeCloseTo(v, 6));
    TWIN_MASTER_R.forEach((v, i) => expect(capturedR[i]).toBeCloseTo(v, 6));
  });
});
