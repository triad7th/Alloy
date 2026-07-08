import { describe, it, expect } from 'vitest';
import {
  instantFromWallClock,
  wallClockInZone,
  inputToWallClock,
  wallClockToInput,
} from './zone-time.js';

describe('zone-time', () => {
  it('instantFromWallClock interprets fields in the given zone', () => {
    // 12:00 in Seoul (+09:00) is 03:00 UTC.
    const seoul = instantFromWallClock(
      { year: 2026, month: 6, day: 25, hour: 12, minute: 0 },
      'Asia/Seoul',
    );
    expect(seoul.toISOString()).toBe('2026-06-25T03:00:00.000Z');
    // 12:00 in LA (PDT -07:00 in June) is 19:00 UTC.
    const la = instantFromWallClock(
      { year: 2026, month: 6, day: 25, hour: 12, minute: 0 },
      'America/Los_Angeles',
    );
    expect(la.toISOString()).toBe('2026-06-25T19:00:00.000Z');
  });

  it('handles a DST spring-forward boundary (New York, 2026-03-08)', () => {
    // After spring-forward, NY is EDT (-04:00); 10:00 EDT = 14:00 UTC.
    const ny = instantFromWallClock(
      { year: 2026, month: 3, day: 8, hour: 10, minute: 0 },
      'America/New_York',
    );
    expect(ny.toISOString()).toBe('2026-03-08T14:00:00.000Z');
  });

  it('wallClockInZone is the inverse of instantFromWallClock', () => {
    const w = { year: 2026, month: 1, day: 1, hour: 23, minute: 30 };
    const inst = instantFromWallClock(w, 'Europe/Paris');
    expect(wallClockInZone(inst, 'Europe/Paris')).toEqual(w);
  });

  it('input string round-trips', () => {
    const w = { year: 2026, month: 6, day: 25, hour: 9, minute: 5 };
    expect(inputToWallClock(wallClockToInput(w))).toEqual(w);
    expect(wallClockToInput(w)).toBe('2026-06-25T09:05');
    expect(inputToWallClock('')).toBeNull();
    expect(inputToWallClock('garbage')).toBeNull();
  });
});
