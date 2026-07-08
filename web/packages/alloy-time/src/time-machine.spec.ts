import { describe, expect, it } from 'vitest';
import { TimeMachine, TimeMachineStorage } from './time-machine.js';

class MemoryStorage implements TimeMachineStorage {
  readonly map = new Map<string, string>();
  getItem(k: string) { return this.map.get(k) ?? null; }
  setItem(k: string, v: string) { this.map.set(k, v); }
  removeItem(k: string) { this.map.delete(k); }
}

const LOCAL = 'America/Los_Angeles';
const INSTANT = new Date(1768480496000); // 2026-01-15T12:34:56Z — twin fixture

describe('TimeMachine', () => {
  it('is live by default', () => {
    const tm = new TimeMachine({ localZone: LOCAL });
    const real = new Date(1700000000000);
    expect(tm.mock).toBeNull();
    expect(tm.isMocked).toBe(false);
    expect(tm.now(real)).toBe(real);
    expect(tm.timeZone()).toBe(LOCAL);
  });

  it('freezes at the mock instant and clears back to live', () => {
    const tm = new TimeMachine({ localZone: LOCAL });
    tm.setMock(INSTANT);
    expect(tm.now(new Date())).toEqual(INSTANT);
    expect(tm.isMocked).toBe(true);
    tm.clearMock();
    expect(tm.mock).toBeNull();
    expect(tm.isMocked).toBe(false);
  });

  it('overrides the zone; selecting the local zone means live', () => {
    const tm = new TimeMachine({ localZone: LOCAL });
    tm.setTimeZone('Asia/Seoul');
    expect(tm.timeZone()).toBe('Asia/Seoul');
    expect(tm.isMocked).toBe(true);
    tm.setTimeZone(LOCAL); // local ⇒ not a mock
    expect(tm.mockTimeZone).toBeNull();
    expect(tm.isMocked).toBe(false);
  });

  it('persists and restores mock + zone under the namespace', () => {
    const storage = new MemoryStorage();
    const a = new TimeMachine({ localZone: LOCAL, storage, namespace: 'allyclock' });
    a.setMock(INSTANT);
    a.setTimeZone('Asia/Seoul');
    expect(storage.map.get('allyclock.clock.mock')).toBe(INSTANT.toISOString());
    expect(storage.map.get('allyclock.clock.tz')).toBe('Asia/Seoul');
    const b = new TimeMachine({ localZone: LOCAL, storage, namespace: 'allyclock' });
    expect(b.mock).toEqual(INSTANT);
    expect(b.mockTimeZone).toBe('Asia/Seoul');
    a.clearMock();
    a.clearTimeZone();
    expect(storage.map.size).toBe(0);
  });

  it('ignores invalid persisted values', () => {
    const storage = new MemoryStorage();
    storage.map.set('ally.clock.mock', 'not-a-date');
    storage.map.set('ally.clock.tz', 'Not/A_Zone');
    const tm = new TimeMachine({ localZone: LOCAL, storage });
    expect(tm.mock).toBeNull();
    expect(tm.mockTimeZone).toBeNull();
  });

  it('survives a throwing storage (private browsing)', () => {
    const broken: TimeMachineStorage = {
      getItem() { throw new Error('nope'); },
      setItem() { throw new Error('nope'); },
      removeItem() { throw new Error('nope'); },
    };
    const tm = new TimeMachine({ localZone: LOCAL, storage: broken });
    tm.setMock(INSTANT); // must not throw; in-memory value still applies
    expect(tm.now(new Date())).toEqual(INSTANT);
  });
});
