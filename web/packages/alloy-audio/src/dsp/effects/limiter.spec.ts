import { describe, expect, it } from 'vitest';
import { DEFAULT_MASTER_CONFIG, LIMITER_LOOKAHEAD_SAMPLES, type LimiterParams } from './effect-types.js';
import { Limiter } from './limiter.js';

const FS = 48_000;
const L = LIMITER_LOOKAHEAD_SAMPLES;

const TWIN_REFERENCE_L: number[] = [
  0.08990523964166641, 0.08122097700834274, 0.0722651332616806, 0.06306732445955276, 0.05365801230072975,
  0.044068340212106705, 0.034330081194639206, 0.024475498124957085,
];
const TWIN_REFERENCE_R: number[] = [
  0.044952619820833206, 0.04061048850417137, 0.0361325666308403, 0.03153366222977638, 0.026829006150364876,
  0.022034170106053352, 0.017165040597319603, 0.012237749062478542,
];

function sine(freq: number, amp: number, frames: number, sampleRate: number, startPhase = 0): Float32Array {
  const out = new Float32Array(frames);
  for (let i = 0; i < frames; i++) {
    out[i] = amp * Math.sin(startPhase + (2 * Math.PI * freq * i) / sampleRate);
  }
  return out;
}

/** Hot-then-settling amplitude-modulated sine: continuous phase, amplitude
 * `hotAmp` for the first `hotFrames`, `quietAmp` after. */
function hotThenSettling(freq: number, hotAmp: number, hotFrames: number, quietAmp: number, frames: number, sampleRate: number): Float32Array {
  const out = new Float32Array(frames);
  for (let i = 0; i < frames; i++) {
    const amp = i < hotFrames ? hotAmp : quietAmp;
    out[i] = amp * Math.sin((2 * Math.PI * freq * i) / sampleRate);
  }
  return out;
}

describe('Limiter', () => {
  it('latency: an impulse at inL[0]=1 emerges at outL[L], delayed by exactly L samples', () => {
    const params: LimiterParams = { ceilingDb: 0, releaseMs: 50 };
    const limiter = new Limiter(params, FS);
    const frames = L + 4;
    const left = new Float32Array(frames);
    const right = new Float32Array(frames);
    left[0] = 1;

    limiter.process(left, right, frames);

    for (let i = 0; i < L; i++) {
      expect(left[i]).toBe(0);
    }
    expect(left[L]).toBeCloseTo(1, 6);
    for (let i = L + 1; i < frames; i++) {
      expect(left[i]).toBe(0);
    }
  });

  it('brickwall / hot chain: a signal peaking at 10.0 (phaser feedback 0.9 -> ~10x, stacked +12dB shelves) never exceeds the ceiling anywhere, including the very first peak', () => {
    const params: LimiterParams = { ceilingDb: -0.3, releaseMs: 120 };
    const limiter = new Limiter(params, FS);
    const ceiling = 10 ** (params.ceilingDb / 20);
    const frames = 4800;
    // cos() so the very first sample (i=0) is already at the full 10.0 peak —
    // the hardest case for the lookahead to catch.
    const left = new Float32Array(frames);
    const right = new Float32Array(frames);
    for (let i = 0; i < frames; i++) {
      left[i] = 10 * Math.cos((2 * Math.PI * 440 * i) / FS);
      right[i] = 10 * Math.cos((2 * Math.PI * 440 * i) / FS + 0.2);
    }

    limiter.process(left, right, frames);

    for (let i = 0; i < frames; i++) {
      expect(Math.abs(left[i])).toBeLessThanOrEqual(ceiling + 1e-6);
      expect(Math.abs(right[i])).toBeLessThanOrEqual(ceiling + 1e-6);
    }
  });

  it('below-ceiling input passes through at unity gain (within 1e-6) once past the L-sample delay', () => {
    const params: LimiterParams = { ceilingDb: -0.3, releaseMs: 120 };
    const limiter = new Limiter(params, FS);
    const ceiling = 10 ** (params.ceilingDb / 20);
    const amp = 10 ** (-12 / 20);
    expect(amp).toBeLessThan(ceiling);
    const frames = 4800;
    const left = sine(440, amp, frames, FS);
    const right = sine(440, amp, frames, FS, 0.5);
    const originalLeft = left.slice();
    const originalRight = right.slice();

    limiter.process(left, right, frames);

    for (let i = L; i < frames; i++) {
      expect(left[i]).toBeCloseTo(originalLeft[i - L], 6);
      expect(right[i]).toBeCloseTo(originalRight[i - L], 6);
    }
  });

  it('stereo link: a loud L with a quiet R applies the same gain factor to both channels', () => {
    const params: LimiterParams = { ceilingDb: -6, releaseMs: 80 };
    const limiter = new Limiter(params, FS);
    const frames = 4800;
    const left = sine(440, 0.9, frames, FS);
    const right = sine(440, 0.05, frames, FS);
    const originalLeft = left.slice();
    const originalRight = right.slice();

    limiter.process(left, right, frames);

    let checked = 0;
    for (let i = L + 200; i < frames; i++) {
      const inL = originalLeft[i - L];
      const inR = originalRight[i - L];
      if (Math.abs(inL) > 0.05 && Math.abs(inR) > 0.001) {
        const gainL = left[i] / inL;
        const gainR = right[i] / inR;
        expect(Math.abs(gainL - gainR)).toBeLessThanOrEqual(1e-6);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(0);
  });

  it('release: after a loud burst ends, gain recovers toward unity within ~5x releaseMs on the following quiet passage', () => {
    // Single process() call over burst+quiet so the L-sample output delay
    // stays trivial to reason about: output[i + L] is the (possibly gained)
    // version of input[i], for every i, regardless of which "phase" i falls
    // in — no separate calls whose flush periods mix burst tail into a
    // window nominally indexed against the quiet signal.
    const params: LimiterParams = { ceilingDb: -6, releaseMs: 80 };
    const limiter = new Limiter(params, FS);
    const burstFrames = 9600;
    const quietFrames = 20_000;
    const totalFrames = burstFrames + quietFrames;
    const quietAmp = 10 ** (-40 / 20);
    const left = new Float32Array(totalFrames);
    const right = new Float32Array(totalFrames);
    for (let i = 0; i < totalFrames; i++) {
      const amp = i < burstFrames ? 0.9 : quietAmp;
      const v = amp * Math.sin((2 * Math.PI * 440 * i) / FS);
      left[i] = v;
      right[i] = v;
    }
    const original = left.slice();
    limiter.process(left, right, totalFrames);

    function peakRatio(inputStart: number, length: number): number {
      let peakOut = 0;
      let peakIn = 0;
      for (let i = inputStart; i < inputStart + length; i++) {
        peakOut = Math.max(peakOut, Math.abs(left[i + L]));
        peakIn = Math.max(peakIn, Math.abs(original[i]));
      }
      return peakOut / peakIn;
    }

    // Right at the burst/quiet boundary: still heavily limited (gain << 1).
    const earlyRatio = peakRatio(burstFrames, 50);
    // 5 x releaseMs (80ms) = 400ms = 19,200 frames into the quiet passage:
    // gain has recovered to unity.
    const lateRatio = peakRatio(burstFrames + 19_200 - 50, 100);
    expect(earlyRatio).toBeLessThan(0.9);
    expect(lateRatio).toBeGreaterThan(0.99);
  });

  it('per-sample smoothing (zipper guard): during release on a constant quiet signal, consecutive output samples change smoothly', () => {
    // DC (constant) levels on both sides of the transition: the only way an
    // output sample can differ from its predecessor deep inside either
    // constant region is a change in gain, not the waveform's own slope —
    // isolating exactly what per-sample release smoothness means.
    const params: LimiterParams = { ceilingDb: -6, releaseMs: 80 };
    const limiter = new Limiter(params, FS);
    const burstFrames = 4800;
    const quietFrames = 2000;
    const totalFrames = burstFrames + quietFrames;
    const left = new Float32Array(totalFrames);
    const right = new Float32Array(totalFrames);
    left.fill(0.9, 0, burstFrames);
    right.fill(0.9, 0, burstFrames);
    left.fill(0.05, burstFrames, totalFrames);
    right.fill(0.05, burstFrames, totalFrames);

    limiter.process(left, right, totalFrames);

    // Output index burstFrames + L is the single legitimate discontinuity
    // (the delayed input itself steps from 0.9 to 0.05 there). Everything
    // strictly after that is constant-input territory where gain is still
    // releasing toward unity — exactly the window the zipper guard targets.
    const windowStart = burstFrames + L + 1;
    const windowEnd = totalFrames - 1;
    let maxStep = 0;
    for (let i = windowStart; i < windowEnd; i++) {
      maxStep = Math.max(maxStep, Math.abs(left[i] - left[i - 1]));
    }
    // A control-rate (16-sample) stepped implementation would produce jumps
    // on the order of the full gain delta every 16 samples; per-sample
    // one-pole release keeps consecutive steps far smaller than that.
    expect(maxStep).toBeLessThan(0.001);
  });

  it('determinism: same input processed twice (fresh instances) produces identical output', () => {
    const params: LimiterParams = { ceilingDb: -1, releaseMs: 100 };
    const frames = 3000;
    const left = hotThenSettling(440, 4, 500, 0.3, frames, FS);
    const right = hotThenSettling(440, 4, 500, 0.3, frames, FS);

    const limiterA = new Limiter(params, FS);
    const leftA = left.slice();
    const rightA = right.slice();
    limiterA.process(leftA, rightA, frames);

    const limiterB = new Limiter(params, FS);
    const leftB = left.slice();
    const rightB = right.slice();
    limiterB.process(leftB, rightB, frames);

    for (let i = 0; i < frames; i++) {
      expect(leftB[i]).toBe(leftA[i]);
      expect(rightB[i]).toBe(rightA[i]);
    }
  });

  it('reset() restores initial state exactly', () => {
    const params: LimiterParams = { ceilingDb: -1, releaseMs: 100 };
    const limiter = new Limiter(params, FS);
    const frames = 3000;
    const left = hotThenSettling(440, 4, 500, 0.3, frames, FS);
    const right = hotThenSettling(440, 4, 500, 0.3, frames, FS);

    const leftA = left.slice();
    const rightA = right.slice();
    limiter.process(leftA, rightA, frames);

    limiter.reset();

    const leftB = left.slice();
    const rightB = right.slice();
    limiter.process(leftB, rightB, frames);

    for (let i = 0; i < frames; i++) {
      expect(leftB[i]).toBe(leftA[i]);
      expect(rightB[i]).toBe(rightA[i]);
    }
  });

  it('latencySamples getter returns LIMITER_LOOKAHEAD_SAMPLES', () => {
    const limiter = new Limiter({ ceilingDb: -0.3, releaseMs: 120 }, FS);
    expect(limiter.latencySamples).toBe(LIMITER_LOOKAHEAD_SAMPLES);
  });

  it('matches the twin reference (DEFAULT_MASTER_CONFIG.limiter, hot-then-settling input)', () => {
    const params = DEFAULT_MASTER_CONFIG.limiter;
    const limiter = new Limiter(params, FS);
    const warmupFrames = 4800;
    const captureFrames = 8;
    const totalFrames = warmupFrames + captureFrames;
    const left = hotThenSettling(440, 5, 1000, 0.3, totalFrames, FS);
    const right = hotThenSettling(440, 2.5, 1000, 0.15, totalFrames, FS);
    limiter.process(left, right, totalFrames);
    const outLeft = left.subarray(warmupFrames, warmupFrames + captureFrames);
    const outRight = right.subarray(warmupFrames, warmupFrames + captureFrames);
    // console.log(JSON.stringify(Array.from(outLeft)));
    // console.log(JSON.stringify(Array.from(outRight)));
    expect(TWIN_REFERENCE_L).toHaveLength(8);
    expect(TWIN_REFERENCE_R).toHaveLength(8);
    TWIN_REFERENCE_L.forEach((v, i) => expect(outLeft[i]).toBeCloseTo(v, 6));
    TWIN_REFERENCE_R.forEach((v, i) => expect(outRight[i]).toBeCloseTo(v, 6));
  });
});
