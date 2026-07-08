import { describe, it, expect } from 'vitest';
import { buildTimeZoneOptions, formatOffset, zoneOffsetMinutes } from './zone-catalog';

describe('zone-catalog', () => {
  it('formatOffset uses the U+2212 minus for negative offsets', () => {
    expect(formatOffset(540)).toBe('+09:00');
    expect(formatOffset(-420)).toBe('−07:00'); // U+2212, not ASCII -
  });

  it('zoneOffsetMinutes returns minutes east of UTC', () => {
    const at = new Date('2026-06-25T00:00:00Z');
    expect(zoneOffsetMinutes('UTC', at)).toBe(0);
    expect(zoneOffsetMinutes('Asia/Seoul', at)).toBe(540);
  });

  it('buildTimeZoneOptions labels "id  ±hh:mm" and sorts by offset then id', () => {
    const opts = buildTimeZoneOptions('UTC', new Date('2026-06-25T00:00:00Z'));
    expect(opts.length).toBeGreaterThan(0);
    const seoul = opts.find((o) => o.id === 'Asia/Seoul')!;
    expect(seoul.label).toBe('Asia/Seoul  +09:00');
    for (let i = 1; i < opts.length; i++) {
      expect(opts[i - 1].offset).toBeLessThanOrEqual(opts[i].offset);
    }
  });
});
