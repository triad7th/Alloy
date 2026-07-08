import { zoneOffsetMinutes } from './zone-catalog';

export interface WallClock {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number;
  minute: number;
}

// Instant → the wall-clock read off a clock in `zone` (minute precision, h23).
export function wallClockInZone(instant: Date, zone: string): WallClock {
  const parts = new Intl.DateTimeFormat('en-US', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    timeZone: zone,
  }).formatToParts(instant);
  const get = (t: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((p) => p.type === t)?.value ?? '0');
  return {
    year: get('year'),
    month: get('month'),
    day: get('day'),
    hour: get('hour'),
    minute: get('minute'),
  };
}

// Wall-clock + zone → the absolute instant (2-pass; single DST re-evaluation).
export function instantFromWallClock(w: WallClock, zone: string): Date {
  const guess = Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute);
  const off = zoneOffsetMinutes(zone, new Date(guess));
  let inst = guess - off * 60000;
  const off2 = zoneOffsetMinutes(zone, new Date(inst));
  if (off2 !== off) inst = guess - off2 * 60000;
  return new Date(inst);
}

const pad = (n: number) => String(n).padStart(2, '0');

// WallClock → "YYYY-MM-DDTHH:mm" for <input type="datetime-local">.
export function wallClockToInput(w: WallClock): string {
  return `${w.year}-${pad(w.month)}-${pad(w.day)}T${pad(w.hour)}:${pad(w.minute)}`;
}

// "YYYY-MM-DDTHH:mm" → WallClock, or null if malformed.
export function inputToWallClock(value: string): WallClock | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!m) return null;
  return {
    year: Number(m[1]),
    month: Number(m[2]),
    day: Number(m[3]),
    hour: Number(m[4]),
    minute: Number(m[5]),
  };
}
