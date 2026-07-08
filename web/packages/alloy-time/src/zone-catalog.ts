
export interface TimeZoneOption {
  id: string;
  label: string;
  offset: number; // minutes east of UTC, for sorting
}

// Curated zones for the rare runtime without Intl.supportedValuesOf.
const FALLBACK_TIME_ZONES = [
  'UTC',
  'America/Los_Angeles',
  'America/New_York',
  'Europe/London',
  'Europe/Paris',
  'Asia/Seoul',
  'Asia/Tokyo',
  'Australia/Sydney',
];

export function buildTimeZones(localZone: string): string[] {
  const base =
    typeof Intl.supportedValuesOf === 'function'
      ? Intl.supportedValuesOf('timeZone')
      : FALLBACK_TIME_ZONES;
  return base.includes(localZone) ? base : [localZone, ...base];
}

// Current UTC offset (minutes east of UTC) for a zone, parsed from Intl longOffset.
export function zoneOffsetMinutes(timeZone: string, at: Date): number {
  const name =
    new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'longOffset' })
      .formatToParts(at)
      .find((p) => p.type === 'timeZoneName')?.value ?? 'GMT';
  const m = /GMT([+-])(\d{2}):(\d{2})/.exec(name);
  if (!m) return 0; // bare "GMT" === UTC
  return (m[1] === '-' ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3]));
}

// "+09:00" / "−07:00" (U+2212 minus, matching the rest of the app).
export function formatOffset(min: number): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  const sign = min < 0 ? '−' : '+';
  const abs = Math.abs(min);
  return `${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
}

// Picker options: each zone labelled with its current GMT offset, sorted by
// offset then zone name.
export function buildTimeZoneOptions(localZone: string, at: Date): TimeZoneOption[] {
  return buildTimeZones(localZone)
    .map((id) => {
      const offset = zoneOffsetMinutes(id, at);
      return { id, offset, label: `${id}  ${formatOffset(offset)}` };
    })
    .sort((a, b) => a.offset - b.offset || a.id.localeCompare(b.id));
}

// Fixed-offset "special" zones for the picker: UTC plus every 30-minute GMT
// offset from −12:00 to +14:00. Ids are ASCII offset strings ('+05:30',
// '-08:00') which Intl.DateTimeFormat accepts as time zones; labels use U+2212
// for the minus to match the rest of the app.
export function buildSpecialZones(): TimeZoneOption[] {
  const zones: TimeZoneOption[] = [{ id: 'UTC', label: 'UTC', offset: 0 }];
  for (let min = -720; min <= 840; min += 30) {
    if (min === 0) continue; // UTC already covers +00:00
    const sign = min < 0 ? '-' : '+';
    const abs = Math.abs(min);
    const hh = String(Math.floor(abs / 60)).padStart(2, '0');
    const mm = String(abs % 60).padStart(2, '0');
    const display = min < 0 ? '−' : '+';
    zones.push({ id: `${sign}${hh}:${mm}`, label: `GMT${display}${hh}:${mm}`, offset: min });
  }
  return zones.sort((a, b) => a.offset - b.offset);
}
