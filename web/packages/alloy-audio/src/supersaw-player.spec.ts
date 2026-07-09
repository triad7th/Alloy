import { describe, it, expect } from 'vitest';
import type { SupersawVoiceSpec } from './instruments.js';
import { SupersawPlayer } from './supersaw-player.js';
import { FakeCtx, FakeGain } from './testing/fake-audio-graph.js';

const SPEC: SupersawVoiceSpec = {
  kind: 'supersaw',
  unison: 5,
  detuneCents: 24,
  filter: { baseHz: 900, envHz: 2600, decay: 0.35, q: 0.9 },
  amp: { waveform: 'sawtooth', attack: 0.005, decay: 0.25, sustain: 0.5, release: 0.35 },
};

describe('SupersawPlayer', () => {
  it('starts a unison of detuned saws evenly spread across the detune range', () => {
    const ctx = new FakeCtx();
    const player = new SupersawPlayer(ctx, SPEC, new FakeGain());
    player.start(69, 1, 0);
    expect(ctx.oscillators).toHaveLength(5);
    expect(ctx.oscillators.every((o) => o.type === 'sawtooth')).toBe(true);
    expect(ctx.oscillators.every((o) => Math.abs(o.frequency.value - 440) < 0.001)).toBe(true);
    expect(ctx.oscillators.map((o) => o.detune.value)).toEqual([-12, -6, 0, 6, 12]);
  });

  it('routes oscs -> unison mix -> lowpass -> amp -> output with equal-power mix', () => {
    const ctx = new FakeCtx();
    const output = new FakeGain();
    const player = new SupersawPlayer(ctx, SPEC, output);
    player.start(60, 1, 0);
    const [mix, amp] = ctx.gains;
    const filter = ctx.filters[0];
    expect(mix.gain.value).toBeCloseTo(1 / Math.sqrt(5), 6);
    expect(ctx.oscillators.every((o) => o.connections.includes(mix))).toBe(true);
    expect(mix.connections).toContain(filter);
    expect(filter.type).toBe('lowpass');
    expect(filter.Q.value).toBeCloseTo(0.9, 6);
    expect(filter.connections).toContain(amp);
    expect(amp.connections).toContain(output);
  });

  it('opens the filter at note-on and decays it toward the floor', () => {
    const ctx = new FakeCtx();
    new SupersawPlayer(ctx, SPEC, new FakeGain()).start(60, 1, 1);
    const events = ctx.filters[0].frequency.events;
    expect(events[0]).toEqual({ type: 'set', value: 3500, when: 1 }); // 900 + 2600
    expect(events[1]).toEqual({ type: 'target', value: 900, when: 1, timeConstant: 0.35 });
  });

  it('shapes the amp envelope with an exponential decay to sustain', () => {
    const ctx = new FakeCtx();
    new SupersawPlayer(ctx, SPEC, new FakeGain()).start(60, 0.5, 1);
    const events = ctx.gains[1].gain.events; // gains[0] = mix, gains[1] = amp
    expect(events[0]).toEqual({ type: 'set', value: 0, when: 1 });
    expect(events[1]).toEqual({ type: 'linear', value: 0.15, when: 1.005 }); // VOICE_PEAK * 0.5
    expect(events[2]).toEqual({ type: 'target', value: 0.075, when: 1.005, timeConstant: 0.25 });
  });

  it('release fades exponentially and stops every oscillator past the tail', () => {
    const ctx = new FakeCtx();
    const voice = new SupersawPlayer(ctx, SPEC, new FakeGain()).start(60, 1, 0);
    voice.release(2);
    const last = ctx.gains[1].gain.events.at(-1)!;
    expect(last).toEqual({ type: 'target', value: 0, when: 2, timeConstant: 0.35 / 3 });
    expect(ctx.oscillators.every((o) => o.stopped)).toBe(true);
    expect(ctx.oscillators.every((o) => Math.abs((o.stopWhen ?? 0) - 3.05) < 0.001)).toBe(true); // 2 + 3*0.35
    ctx.oscillators[0].onended?.();
    expect(ctx.gains[1].disconnected).toBe(true);
  });

  it('stop is a fast fade', () => {
    const ctx = new FakeCtx();
    const voice = new SupersawPlayer(ctx, SPEC, new FakeGain()).start(60, 1, 0);
    voice.stop(2);
    expect(ctx.oscillators.every((o) => Math.abs((o.stopWhen ?? 0) - 2.09) < 0.001)).toBe(true); // 2 + 3*FAST_STOP_S
  });
});
