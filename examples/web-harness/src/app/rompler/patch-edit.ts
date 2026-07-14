// Pure, immutable edit operations over a Patch. No Angular, no DOM — this is
// the module the patch editor's UI is a thin shell over, and the only part of
// the workbench that is unit-tested.
import {
  MAX_INSERTS,
  PATCH_SCHEMA_VERSION,
  type InsertSpec,
  type Patch,
} from '@allyworld/alloy-audio';

/** A fully-populated patch: every optional field present, one layer per
 *  generator kind, one insert per kind that fits. The descriptor-coverage and
 *  bounds-safety tests walk THIS, so anything it omits is untested. */
export const REFERENCE_PATCH: Patch = {
  schemaVersion: PATCH_SCHEMA_VERSION,
  meta: { id: 'reference', name: 'Reference', category: 'melodic', gmProgram: 4 },
  sends: { reverb: 0.2, delay: 0.1 },
  layers: [
    {
      keyRange: { lowMidi: 0, highMidi: 127 },
      velRange: { low: 0, high: 1 },
      generator: {
        kind: 'fm',
        fm: {
          operators: [
            { ratio: 1, level: 1, adsr: { attack: 0.002, decay: 1.3, sustain: 0.16, release: 0.3 } },
            { ratio: 1, level: 0.55, adsr: { attack: 0.001, decay: 0.5, sustain: 0.1, release: 0.2 } },
            { ratio: 14, level: 0.3, adsr: { attack: 0.001, decay: 0.06, sustain: 0, release: 0.1 } },
          ],
          algorithm: {
            routes: [
              { from: 1, to: 0 },
              { from: 2, to: 0 },
            ],
            carriers: [0],
            feedback: { op: 1, amount: 0.1 },
          },
        },
      },
      tvf: {
        mode: 'lowpass',
        cutoffHz: 6000,
        q: 0.7,
        envAmountHz: 2000,
        env: { attack: 0.01, decay: 0.4, sustain: 0.3, release: 0.2 },
        keyTrack: 0.3,
        velAmountHz: 3000,
      },
      tva: { level: 0.5, adsr: { attack: 0.001, decay: 1.2, sustain: 0.2, release: 0.3 }, velCurve: 1.8 },
      mod: {
        lfo: { shape: 'sine', rateHz: 5, delay: 0.2, fadeIn: 0.3 },
        toPitchCents: 5,
        toCutoffHz: 200,
        toAmpDepth: 0.1,
      },
    },
    {
      keyRange: { lowMidi: 0, highMidi: 127 },
      velRange: { low: 0, high: 1 },
      generator: {
        kind: 'additive',
        partials: [
          { ratio: 1, level: 0.8 },
          { ratio: 2, level: 0.4 },
          { ratio: 3, level: 0.2 },
        ],
      },
      tvf: { mode: 'lowpass', cutoffHz: 8000, q: 0.7, envAmountHz: 0, keyTrack: 0, velAmountHz: 0 },
      tva: { level: 0.4, adsr: { attack: 0.005, decay: 0.1, sustain: 1, release: 0.1 }, velCurve: 1 },
      mod: {
        lfo: { shape: 'triangle', rateHz: 6, delay: 0, fadeIn: 0 },
        toPitchCents: 0,
        toCutoffHz: 0,
        toAmpDepth: 0.2,
      },
    },
    {
      keyRange: { lowMidi: 0, highMidi: 127 },
      velRange: { low: 0, high: 1 },
      generator: {
        kind: 'va',
        va: { shape: 'saw', unison: 3, detuneCents: 12, pulseWidth: 0.5 },
        seed: 12345,
      },
      tvf: { mode: 'lowpass', cutoffHz: 3000, q: 1.2, envAmountHz: 4000, keyTrack: 0.5, velAmountHz: 1000 },
      tva: { level: 0.3, adsr: { attack: 0.4, decay: 0.5, sustain: 0.8, release: 0.6 }, velCurve: 1.2 },
      mod: {
        lfo: { shape: 'sine', rateHz: 0.3, delay: 0, fadeIn: 1 },
        toPitchCents: 0,
        toCutoffHz: 800,
        toAmpDepth: 0,
      },
    },
    {
      keyRange: { lowMidi: 0, highMidi: 127 },
      velRange: { low: 0, high: 1 },
      generator: { kind: 'sample', zoneSetId: 'reference-zones', crossfade: 0 },
      tvf: { mode: 'lowpass', cutoffHz: 12000, q: 0.7, envAmountHz: 0, keyTrack: 0.3, velAmountHz: 6000 },
      tva: { level: 0.5, adsr: { attack: 0.001, decay: 0.1, sustain: 1, release: 0.25 }, velCurve: 1.8 },
      mod: {
        lfo: { shape: 'sine', rateHz: 4, delay: 0.5, fadeIn: 0.5 },
        toPitchCents: 3,
        toCutoffHz: 0,
        toAmpDepth: 0,
      },
    },
  ],
  inserts: [
    { kind: 'chorus', chorus: { mode: 'ensemble', rateHz: 0.6, depthMs: 3, mix: 0.35 } },
    { kind: 'driveEq', driveEq: { drive: 0.2, lowDb: 1, midDb: 0, highDb: 2, levelDb: 0 } },
    { kind: 'compressor', compressor: { thresholdDb: -18, ratio: 3, attackMs: 8, releaseMs: 120, makeupDb: 3 } },
  ],
};

/** Reads a dot-delimited path; numeric segments index arrays.
 *  Returns undefined rather than throwing on a missing path — the UI asks for
 *  paths that may not exist on the current generator kind. */
export function getAt(patch: Patch, path: string): unknown {
  let node: unknown = patch;
  for (const key of path.split('.')) {
    if (node === null || typeof node !== 'object') return undefined;
    node = (node as Record<string, unknown>)[key];
  }
  return node;
}

/** Immutably writes `value` at `path`, cloning only the spine down to it.
 *  Untouched subtrees are SHARED by reference — the A/B slots hold two patches
 *  at once and must never alias each other's edits. */
export function setAt(patch: Patch, path: string, value: unknown): Patch {
  const keys = path.split('.');

  function write(node: unknown, depth: number): unknown {
    if (depth === keys.length) return value;
    const key = keys[depth];
    if (Array.isArray(node)) {
      const index = Number(key);
      const copy = node.slice();
      copy[index] = write(node[index], depth + 1);
      return copy;
    }
    const obj = node as Record<string, unknown>;
    return { ...obj, [key]: write(obj[key], depth + 1) };
  }

  return write(patch, 0) as Patch;
}

export const MAX_LAYERS = 4;
export { MAX_INSERTS };
export type { InsertSpec };
