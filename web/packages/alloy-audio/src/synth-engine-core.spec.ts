// Twin of AlloyAudio's SynthEngineCoreTests (ported from AllyPiano's
// PianoEngineCoreTests): the polyphony/sustain state machine over fake players.
import { describe, it, expect } from 'vitest';
import { SynthEngineCore } from './synth-engine-core.js';
import type { ActiveVoice, VoicePlayer } from './voice-player.js';

class FakeHandle implements ActiveVoice {
  releasedAt: number | null = null;
  stoppedAt: number | null = null;
  release(when: number): void {
    this.releasedAt = when;
  }
  stop(when: number): void {
    this.stoppedAt = when;
  }
}

class FakePlayer implements VoicePlayer {
  readonly started: { midi: number; velocity: number; when: number }[] = [];
  readonly handles: FakeHandle[] = [];
  start(midi: number, velocity: number, when: number): ActiveVoice {
    this.started.push({ midi, velocity, when });
    const handle = new FakeHandle();
    this.handles.push(handle);
    return handle;
  }
}

function makeCore() {
  const players: Record<string, FakePlayer> = { grand: new FakePlayer(), midnight: new FakePlayer() };
  const requests: string[] = [];
  const clock = { now: 0 };
  const core = new SynthEngineCore((id) => {
    requests.push(id);
    return players[id];
  }, () => clock.now);
  core.setInstrument('grand');
  return { core, players, requests, clock };
}

describe('SynthEngineCore', () => {
  it('requests a player from playerFor on setInstrument', () => {
    const { requests } = makeCore();
    expect(requests).toEqual(['grand']);
  });

  it('is silent before any instrument is selected', () => {
    const players = { grand: new FakePlayer() };
    const core = new SynthEngineCore((id) => players[id as 'grand'], () => 0);
    core.noteOn(60); // no setInstrument yet: must be a no-op, not a crash
    expect(players.grand.started).toHaveLength(0);
  });

  it('noteOn starts a voice at now() with the given velocity', () => {
    const { core, players, clock } = makeCore();
    clock.now = 1.5;
    core.noteOn(60, 0.8);
    expect(players['grand'].started).toEqual([{ midi: 60, velocity: 0.8, when: 1.5 }]);
  });

  it('noteOn defaults velocity to 1', () => {
    const { core, players } = makeCore();
    core.noteOn(60);
    expect(players['grand'].started[0].velocity).toBe(1);
  });

  it('repeated noteOn does not re-strike', () => {
    const { core, players } = makeCore();
    core.noteOn(60);
    core.noteOn(60);
    expect(players['grand'].started).toHaveLength(1);
  });

  it('noteOff releases the voice at now()', () => {
    const { core, players, clock } = makeCore();
    core.noteOn(60);
    clock.now = 2;
    core.noteOff(60);
    expect(players['grand'].handles[0].releasedAt).toBe(2);
  });

  it('noteOff for an unknown midi is a no-op', () => {
    const { core, players } = makeCore();
    core.noteOff(99); // must not crash or start anything
    expect(players['grand'].started).toHaveLength(0);
  });

  it('sustain latches noteOff until pedal up', () => {
    const { core, players, clock } = makeCore();
    core.setSustain(true);
    core.noteOn(60);
    core.noteOff(60);
    const handle = players['grand'].handles[0];
    expect(handle.releasedAt).toBeNull(); // latched, not released
    clock.now = 3;
    core.setSustain(false);
    expect(handle.releasedAt).toBe(3);
  });

  it('pedal up keeps keys that are still physically down', () => {
    const { core, players } = makeCore();
    core.setSustain(true);
    core.noteOn(60); // still held
    core.noteOn(64);
    core.noteOff(64); // latched by pedal
    core.setSustain(false);
    const grand = players['grand'];
    expect(grand.handles[0].releasedAt).toBeNull(); // 60 survives: key down
    expect(grand.handles[1].releasedAt).not.toBeNull(); // 64 releases
  });

  it('a re-pressed key survives pedal up', () => {
    // The retrigger fix: noteOff under pedal latches; a new noteOn on the
    // same key re-asserts the physical hold, so pedal-up must NOT release.
    const { core, players } = makeCore();
    core.setSustain(true);
    core.noteOn(60);
    core.noteOff(60); // heldByPedal
    core.noteOn(60); // re-pressed: heldByKey, pedal latch cleared
    core.setSustain(false);
    expect(players['grand'].handles[0].releasedAt).toBeNull();
  });

  it('setInstrument routes new notes only', () => {
    const { core, players } = makeCore();
    core.noteOn(60);
    core.setInstrument('midnight');
    core.noteOn(64);
    expect(players['grand'].started).toHaveLength(1);
    expect(players['midnight'].started).toHaveLength(1);
    // The old note still releases through its own handle.
    core.noteOff(60);
    expect(players['grand'].handles[0].releasedAt).not.toBeNull();
  });

  it('allNotesOff stops everything and clears state', () => {
    const { core, players, clock } = makeCore();
    core.setSustain(true);
    core.noteOn(60);
    core.noteOn(64);
    core.noteOff(64); // pedal-latched
    clock.now = 5;
    core.allNotesOff();
    const grand = players['grand'];
    expect(grand.handles[0].stoppedAt).toBe(5);
    expect(grand.handles[1].stoppedAt).toBe(5);
    // Cleared: the same key can strike fresh.
    core.noteOn(60);
    expect(grand.started).toHaveLength(3);
  });
});
