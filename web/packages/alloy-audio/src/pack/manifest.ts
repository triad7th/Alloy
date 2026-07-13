// Pack manifest: the shared contract between the offline samplepack pipeline
// and the runtime PackLoader. Pure data (JSON), non-throwing validation.
// zoneSets[zoneSetId] keys are what patches reference; tiers differ in file
// contents, not zoneSetIds. Twin: PackManifest.swift.

export const PACK_SCHEMA_VERSION = 1;

export type PackTier = 'tiny' | 'standard' | 'hq';

export interface ZoneSpec {
  /** Original pitch of the recording, MIDI note. */
  rootMidi: number;
  /** Relative .m4a path within the pack directory. */
  file: string;
  /** Loop region [loopStart, loopEnd) in samples; omit for one-shots. */
  loopStart?: number;
  loopEnd?: number;
  /** Linear gain applied to the decoded PCM at load. */
  gain: number;
  /** Fine-tune added to the effective root at load (positive raises the
   *  effective root, i.e. plays the sample lower). Correction for recordings
   *  slightly off pitch. */
  tuneCents: number;
}

export interface LayerSpec {
  /** Inclusive upper velocity bound, 0..1; layers sorted ascending. */
  topVelocity: number;
  zones: ZoneSpec[];
}

export interface ZoneSetSpec {
  layers: LayerSpec[];
}

export interface CreditEntry {
  source: string;
  license: string;
  url?: string;
}

export interface PackManifest {
  schemaVersion: number;
  id: string;
  tier: PackTier;
  /** Sample rate the decoded zones assume. */
  sampleRate: number;
  format: 'm4a';
  zoneSets: Record<string, ZoneSetSpec>;
  credits: CreditEntry[];
}

/** Non-throwing; empty = safe to load. */
export function validateManifest(m: PackManifest): string[] {
  const e: string[] = [];
  if (m.schemaVersion !== PACK_SCHEMA_VERSION) {
    e.push(`schemaVersion ${m.schemaVersion} !== ${PACK_SCHEMA_VERSION}`);
  }
  if (m.id.length === 0) e.push('id must be non-empty');
  if (m.tier !== 'tiny' && m.tier !== 'standard' && m.tier !== 'hq') {
    e.push(`tier '${(m as { tier: string }).tier}' must be tiny|standard|hq`);
  }
  if (!(m.sampleRate > 0)) e.push(`sampleRate ${m.sampleRate} must be > 0`);
  if (m.format !== 'm4a') e.push(`format '${(m as { format: string }).format}' must be 'm4a'`);
  const zoneSetIds = Object.keys(m.zoneSets);
  if (zoneSetIds.length === 0) e.push('at least one zoneSet required');
  for (const id of zoneSetIds) {
    const prefix = `zoneSet '${id}': `;
    const { layers } = m.zoneSets[id];
    if (layers.length === 0) e.push(`${prefix}at least one layer required`);
    let prevTop = -Infinity;
    layers.forEach((layer, li) => {
      const lp = `${prefix}layer ${li + 1}: `;
      if (!(layer.topVelocity > 0 && layer.topVelocity <= 1)) {
        e.push(`${lp}topVelocity ${layer.topVelocity} outside (0, 1]`);
      }
      if (layer.topVelocity <= prevTop) e.push(`${lp}topVelocity ${layer.topVelocity} not strictly ascending`);
      prevTop = layer.topVelocity;
      if (layer.zones.length === 0) e.push(`${lp}at least one zone required`);
      layer.zones.forEach((z, zi) => {
        const zp = `${lp}zone ${zi + 1}: `;
        if (!(z.rootMidi >= 0 && z.rootMidi <= 127)) e.push(`${zp}rootMidi ${z.rootMidi} outside [0, 127]`);
        if (z.file.length === 0) e.push(`${zp}file must be non-empty`);
        if (!(z.gain > 0)) e.push(`${zp}gain ${z.gain} must be > 0`);
        const hasStart = z.loopStart !== undefined;
        const hasEnd = z.loopEnd !== undefined;
        if (hasStart !== hasEnd) e.push(`${zp}loopStart/loopEnd must both be set or both omitted`);
        if (hasStart && hasEnd && !(z.loopStart! >= 0 && z.loopStart! < z.loopEnd!)) {
          e.push(`${zp}loop ${z.loopStart}..${z.loopEnd} invalid`);
        }
      });
    });
  }
  return e;
}
