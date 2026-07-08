import { describe, expect, it } from 'vitest';
import { compactOffset, gmtOffset, zoneCity } from './zone-format.js';

// 2026-06-11T03:09:05.270Z = 8:09:05 PM June 10 in Los Angeles (PDT), 12:09 PM in Seoul.
const date = new Date('2026-06-11T03:09:05.270Z');

describe('gmtOffset', () => {
  it('renders negative offsets with a minus sign (U+2212)', () => {
    expect(gmtOffset(date, 'America/Los_Angeles')).toBe('GMT−07:00');
  });

  it('renders UTC as +00:00', () => {
    expect(gmtOffset(date, 'UTC')).toBe('GMT+00:00');
  });

  it('renders positive offsets', () => {
    expect(gmtOffset(date, 'Asia/Seoul')).toBe('GMT+09:00');
  });
});

describe('compactOffset', () => {
  it('drops the GMT prefix, leading zero, and whole-hour minutes', () => {
    expect(compactOffset(date, 'America/Los_Angeles')).toBe('−7');
  });

  it('renders UTC as +0', () => {
    expect(compactOffset(date, 'UTC')).toBe('+0');
  });

  it('renders positive whole-hour offsets with a plus sign', () => {
    expect(compactOffset(date, 'Asia/Seoul')).toBe('+9');
  });

  it('keeps the minutes for sub-hour offsets', () => {
    expect(compactOffset(date, 'Asia/Kolkata')).toBe('+5:30');
  });

  it('keeps the minutes for negative sub-hour offsets', () => {
    expect(compactOffset(date, 'America/St_Johns')).toBe('−2:30');
  });
});

describe('zoneCity', () => {
  it('uppercases the city segment with spaces for underscores', () => {
    expect(zoneCity('America/Los_Angeles', false)).toBe('LOS ANGELES');
  });

  it('abbreviates a multi-word city to its initials when a flag is shown', () => {
    expect(zoneCity('America/Los_Angeles', true)).toBe('LA');
    expect(zoneCity('America/New_York', true)).toBe('NY');
  });

  it('abbreviates a single-word city to its first three letters', () => {
    expect(zoneCity('Europe/London', true)).toBe('LON');
    expect(zoneCity('Asia/Seoul', true)).toBe('SEO');
  });

  it('uses the deepest path segment for nested zones', () => {
    expect(zoneCity('America/Argentina/Buenos_Aires', false)).toBe('BUENOS AIRES');
    expect(zoneCity('America/Argentina/Buenos_Aires', true)).toBe('BA');
  });

  it('handles UTC with or without abbreviation', () => {
    expect(zoneCity('UTC', false)).toBe('UTC');
    expect(zoneCity('UTC', true)).toBe('UTC');
  });

  it('returns no city for fixed-offset zones (the globe offset conveys them)', () => {
    expect(zoneCity('-08:00', true)).toBe('');
    expect(zoneCity('+05:30', false)).toBe('');
  });
});
