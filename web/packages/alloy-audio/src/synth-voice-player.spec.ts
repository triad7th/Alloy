import { describe, it, expect } from 'vitest';
import { SynthVoicePlayer } from './synth-voice-player.js';
import { FakeCtx, FakeGain } from './testing/fake-audio-graph.js';

const CONFIG = {
  waveform: 'triangle',
  attack: 0.005,
  decay: 0.12,
  sustain: 0.6,
  release: 0.25,
} as const;

describe('SynthVoicePlayer', () => {
  it('starts a tuned oscillator through a gain into the given output', () => {
    const ctx = new FakeCtx();
    const output = new FakeGain();
    const player = new SynthVoicePlayer(ctx, CONFIG, output);
    player.start(69, 1, 0); // A4 = 440 Hz
    expect(ctx.oscillators).toHaveLength(1);
    expect(ctx.oscillators[0].type).toBe('triangle');
    expect(ctx.oscillators[0].frequency.value).toBeCloseTo(440, 3);
    expect(ctx.oscillators[0].started).toBe(true);
    expect(ctx.gains[0].connections).toContain(output);
  });

  it('shapes the attack/decay envelope and scales the peak by velocity', () => {
    const ctx = new FakeCtx();
    const player = new SynthVoicePlayer(ctx, CONFIG, new FakeGain());
    player.start(60, 0.5, 1);
    const events = ctx.gains[0].gain.events;
    expect(events[0]).toEqual({ type: 'set', value: 0, when: 1 });
    expect(events[1]).toEqual({ type: 'linear', value: 0.15, when: 1.005 }); // 0.3 * 0.5
    expect(events[2].value).toBeCloseTo(0.15 * 0.6, 6); // sustain level
  });

  it('release ramps the gain to zero and stops the oscillator at the ramp end', () => {
    const ctx = new FakeCtx();
    const player = new SynthVoicePlayer(ctx, CONFIG, new FakeGain());
    const voice = player.start(60, 1, 0);
    voice.release(2);
    const last = ctx.gains[0].gain.events.at(-1)!;
    expect(last).toEqual({ type: 'linear', value: 0, when: 2.25 });
    expect(ctx.oscillators[0].stopped).toBe(true);
    expect(ctx.oscillators[0].stopWhen).toBeCloseTo(2.25, 6);
    ctx.oscillators[0].onended?.();
    expect(ctx.gains[0].disconnected).toBe(true);
  });

  it('stop is a fast fade, not the full release', () => {
    const ctx = new FakeCtx();
    const player = new SynthVoicePlayer(ctx, CONFIG, new FakeGain());
    const voice = player.start(60, 1, 0);
    voice.stop(2);
    expect(ctx.oscillators[0].stopWhen).toBeCloseTo(2.03, 6);
  });
});
