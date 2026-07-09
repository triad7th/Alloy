import { describe, it, expect } from 'vitest';
import { MasterChain, generateImpulseResponse } from './master-chain.js';
import { FakeCtx } from './testing/fake-audio-graph.js';

describe('MasterChain', () => {
  it('routes dry bus and both send returns into a limiter into the destination', () => {
    const ctx = new FakeCtx();
    new MasterChain(ctx);
    expect(ctx.compressors).toHaveLength(1);
    const limiter = ctx.compressors[0];
    expect(limiter.connections).toContain(ctx.destination);
    expect(limiter.threshold.value).toBe(-6);
    expect(limiter.knee.value).toBe(4);
    expect(limiter.ratio.value).toBe(20);
    expect(limiter.attack.value).toBeCloseTo(0.002, 6);
    expect(limiter.release.value).toBeCloseTo(0.15, 6);
    // Reverb: convolver holds a generated IR and feeds the limiter.
    expect(ctx.convolvers).toHaveLength(1);
    expect(ctx.convolvers[0].buffer).not.toBeNull();
    expect(ctx.convolvers[0].connections).toContain(limiter);
    // Delay: 0.26s, feedback 0.25 looped back into the delay, out to the limiter.
    expect(ctx.delays).toHaveLength(1);
    expect(ctx.delays[0].delayTime.value).toBeCloseTo(0.26, 6);
    expect(ctx.delays[0].connections).toContain(limiter);
    const feedback = ctx.gains.find(
      (g) => g.connections.includes(ctx.delays[0]) && g.gain.value === 0.25,
    );
    expect(feedback).toBeDefined();
    expect(ctx.delays[0].connections).toContain(feedback);
  });

  it('channel() wires a voice input to dry plus sends at the spec levels', () => {
    const ctx = new FakeCtx();
    const chain = new MasterChain(ctx);
    const gainsBefore = ctx.gains.length;
    const input = chain.channel({ reverb: 0.3, delay: 0.18 });
    const created = ctx.gains.slice(gainsBefore);
    expect(created.map((g) => g.gain.value)).toContain(0.3);
    expect(created.map((g) => g.gain.value)).toContain(0.18);
    expect(created[0]).toBe(input); // the channel input gain itself
  });

  it('channel() with zero sends creates no send taps', () => {
    const ctx = new FakeCtx();
    const chain = new MasterChain(ctx);
    const gainsBefore = ctx.gains.length;
    chain.channel({ reverb: 0, delay: 0 });
    expect(ctx.gains.length).toBe(gainsBefore + 1); // just the channel input
  });

  it('generates a decaying stereo impulse response', () => {
    const ctx = new FakeCtx();
    const ir = generateImpulseResponse(ctx, 1.4);
    expect(ir.numberOfChannels).toBe(2);
    expect(ir.length).toBe(Math.round(1.4 * ctx.sampleRate));
    const data = ir.getChannelData(0);
    const rms = (from: number, to: number) => {
      let sum = 0;
      for (let i = from; i < to; i++) sum += data[i] * data[i];
      return Math.sqrt(sum / (to - from));
    };
    const tenth = Math.floor(data.length / 10);
    expect(rms(0, tenth)).toBeGreaterThan(rms(data.length - tenth, data.length) * 5);
  });
});
