import { zoneOffsetMinutes } from './zone-catalog';

export function gmtOffset(date: Date, timeZone: string): string {
  const name =
    new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'longOffset' })
      .formatToParts(date)
      .find((part) => part.type === 'timeZoneName')?.value ?? 'GMT';
  const normalized = name === 'GMT' ? 'GMT+00:00' : name;
  return normalized.replace('-', '−');
}

// Compact UTC offset for the date row's globe badge: sign + hours, appending
// ":mm" only when the zone isn't on a whole hour ("−7", "+9", "+5:30", "+0").
// The globe icon stands in for the "GMT" prefix. U+2212 minus, matching the app.
export function compactOffset(date: Date, timeZone: string): string {
  const min = zoneOffsetMinutes(timeZone, date);
  const sign = min < 0 ? '−' : '+';
  const abs = Math.abs(min);
  const hours = Math.floor(abs / 60);
  const minutes = abs % 60;
  return minutes === 0 ? `${sign}${hours}` : `${sign}${hours}:${String(minutes).padStart(2, '0')}`;
}

// City label derived from an IANA zone id: the last path segment, underscores
// spaced out and uppercased ("America/Los_Angeles" -> "LOS ANGELES"). When
// `abbreviate` is true (a country flag already supplies the locale), collapse a
// multi-word city to its initials, or a single word to its first three letters
// ("LOS ANGELES" -> "LA", "London" -> "LON", "UTC" -> "UTC").
export function zoneCity(timeZone: string, abbreviate: boolean): string {
  // Fixed-offset zones ('+05:30', '−08:00') have no city — the globe offset says it.
  if (/^[+−-]\d/.test(timeZone)) return '';
  const city = (timeZone.split('/').pop() ?? timeZone).replace(/_/g, ' ');
  if (!abbreviate) return city.toUpperCase();
  const words = city.split(/[\s-]+/).filter(Boolean);
  const label = words.length > 1 ? words.map((w) => w[0]).join('') : city.slice(0, 3);
  return label.toUpperCase();
}
