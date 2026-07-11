import { describe, expect, it } from 'vitest';
import { AdsrEnvelope } from './adsr-envelope.js';

const FS = 48_000;
const PARAMS = { attack: 0.01, decay: 0.1, sustain: 0.5, release: 0.05 };

const TWIN_REFERENCE: number[] = [0.003965269774198532, 0.007918444462120533, 0.011859561316668987, 0.01578865759074688, 0.019705768674612045, 0.023610930889844894, 0.02750418335199356, 0.03138555958867073];

function renderSamples(env: AdsrEnvelope, n: number): number[] {
  return Array.from({ length: n }, () => env.nextSample());
}

describe('AdsrEnvelope', () => {
  it('is silent and inactive before noteOn', () => {
    const env = new AdsrEnvelope(PARAMS, FS);
    expect(env.isActive).toBe(false);
    expect(env.nextSample()).toBe(0);
  });

  it('rises monotonically to 1 within ~2x attack time', () => {
    const env = new AdsrEnvelope(PARAMS, FS);
    env.noteOn();
    const out = renderSamples(env, Math.round(2 * PARAMS.attack * FS));
    // Check monotonic rise during attack phase (until peak is reached)
    for (let i = 1; i < out.length; i++) {
      expect(out[i]).toBeGreaterThanOrEqual(out[i - 1] - 1e-12);
      if (out[i] >= 1) break;  // Stop checking after peak; decay phase is allowed to drop
    }
    expect(Math.max(...out)).toBe(1);
  });

  it('decays toward sustain after the peak', () => {
    const env = new AdsrEnvelope(PARAMS, FS);
    env.noteOn();
    renderSamples(env, Math.round((PARAMS.attack + 6 * PARAMS.decay) * FS));
    const settled = env.nextSample();
    expect(settled).toBeGreaterThan(PARAMS.sustain * 0.98);
    expect(settled).toBeLessThan(PARAMS.sustain * 1.02);
  });

  it('releases to silence and goes inactive after noteOff', () => {
    const env = new AdsrEnvelope(PARAMS, FS);
    env.noteOn();
    renderSamples(env, Math.round(0.2 * FS));
    env.noteOff();
    renderSamples(env, Math.round(15 * PARAMS.release * FS));
    expect(env.isActive).toBe(false);
    expect(env.nextSample()).toBe(0);
  });

  it('fastRelease overrides the release time constant', () => {
    const env = new AdsrEnvelope(PARAMS, FS);
    env.noteOn();
    renderSamples(env, Math.round(0.2 * FS));
    env.fastRelease(0.002);
    renderSamples(env, Math.round(0.05 * FS)); // 25 tau of the fast release
    expect(env.isActive).toBe(false);
  });

  it('matches the twin reference (first 8 samples of attack)', () => {
    const env = new AdsrEnvelope(PARAMS, FS);
    env.noteOn();
    const out = new Float32Array(8);
    for (let i = 0; i < 8; i++) out[i] = env.nextSample();
    // console.log(JSON.stringify(Array.from(out.subarray(0, 8))));
    expect(TWIN_REFERENCE).toHaveLength(8);
    TWIN_REFERENCE.forEach((v, i) => expect(out[i]).toBeCloseTo(v, 6));
  });
});
