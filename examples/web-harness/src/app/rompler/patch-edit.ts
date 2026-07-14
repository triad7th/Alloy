// Pure, immutable edit operations over a Patch. No Angular, no DOM — this is
// the module the patch editor's UI is a thin shell over, and the only part of
// the workbench that is unit-tested.
import {
  MAX_INSERTS,
  PATCH_SCHEMA_VERSION,
  type GeneratorSpec,
  type InsertSpec,
  type Patch,
  type PatchLayer,
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

export type GeneratorKind = 'fm' | 'additive' | 'va' | 'sample';
export type InsertKind = 'chorus' | 'tremolo' | 'phaser' | 'rotary' | 'driveEq' | 'compressor';

export const GENERATOR_KINDS: readonly GeneratorKind[] = ['fm', 'additive', 'va', 'sample'];
export const INSERT_KINDS: readonly InsertKind[] = [
  'chorus',
  'tremolo',
  'phaser',
  'rotary',
  'driveEq',
  'compressor',
];

const DEFAULT_ADSR = { attack: 0.005, decay: 0.5, sustain: 0.7, release: 0.3 };

/** A starting point per kind that is VALID and AUDIBLE — never an empty shell.
 *  Switching kind in the UI must always leave something you can hear. */
export function defaultGenerator(kind: GeneratorKind): GeneratorSpec {
  switch (kind) {
    case 'fm':
      return {
        kind: 'fm',
        fm: {
          operators: [
            { ratio: 1, level: 1, adsr: { ...DEFAULT_ADSR } },
            { ratio: 2, level: 0.4, adsr: { ...DEFAULT_ADSR } },
          ],
          algorithm: { routes: [{ from: 1, to: 0 }], carriers: [0] },
        },
      };
    case 'additive':
      return {
        kind: 'additive',
        partials: [
          { ratio: 1, level: 1 },
          { ratio: 2, level: 0.5 },
        ],
      };
    case 'va':
      return { kind: 'va', va: { shape: 'saw', unison: 1, detuneCents: 0, pulseWidth: 0.5 }, seed: 1 };
    case 'sample':
      return { kind: 'sample', zoneSetId: 'zones', crossfade: 0 };
  }
}

export function defaultInsert(kind: InsertKind): InsertSpec {
  switch (kind) {
    case 'chorus':
      return { kind: 'chorus', chorus: { mode: 'chorus', rateHz: 0.6, depthMs: 3, mix: 0.35 } };
    case 'tremolo':
      return { kind: 'tremolo', tremolo: { rateHz: 5, depth: 0.4, spread: 0 } };
    case 'phaser':
      return { kind: 'phaser', phaser: { stages: 4, rateHz: 0.5, depth: 0.6, feedback: 0.3, mix: 0.5 } };
    case 'rotary':
      return { kind: 'rotary', rotary: { speed: 'slow', depth: 0.6, mix: 0.5 } };
    case 'driveEq':
      return { kind: 'driveEq', driveEq: { drive: 0.2, lowDb: 0, midDb: 0, highDb: 0, levelDb: 0 } };
    case 'compressor':
      return {
        kind: 'compressor',
        compressor: { thresholdDb: -18, ratio: 3, attackMs: 8, releaseMs: 120, makeupDb: 3 },
      };
  }
}

const DEFAULT_LAYER: PatchLayer = {
  keyRange: { lowMidi: 0, highMidi: 127 },
  velRange: { low: 0, high: 1 },
  generator: defaultGenerator('fm'),
  tvf: { mode: 'lowpass', cutoffHz: 8000, q: 0.7, envAmountHz: 0, keyTrack: 0, velAmountHz: 0 },
  tva: { level: 0.5, adsr: { ...DEFAULT_ADSR }, velCurve: 1 },
};

function withLayers(patch: Patch, layers: PatchLayer[]): Patch {
  return { ...patch, layers };
}

function withInserts(patch: Patch, inserts: InsertSpec[]): Patch {
  return { ...patch, inserts };
}

function move<T>(items: readonly T[], from: number, to: number): T[] {
  const copy = items.slice();
  const [item] = copy.splice(from, 1);
  copy.splice(to, 0, item);
  return copy;
}

export function addLayer(patch: Patch): Patch {
  if (patch.layers.length >= MAX_LAYERS) return patch;
  return withLayers(patch, [...patch.layers, structuredClone(DEFAULT_LAYER)]);
}

export function removeLayer(patch: Patch, index: number): Patch {
  if (patch.layers.length <= 1) return patch;
  return withLayers(patch, patch.layers.filter((_, i) => i !== index));
}

export function moveLayer(patch: Patch, from: number, to: number): Patch {
  if (from === to) return patch;
  return withLayers(patch, move(patch.layers, from, to));
}

export function setGeneratorKind(patch: Patch, layerIndex: number, kind: GeneratorKind): Patch {
  if (patch.layers[layerIndex].generator.kind === kind) return patch;
  return setAt(patch, `layers.${layerIndex}.generator`, defaultGenerator(kind));
}

export function addInsert(patch: Patch, kind: InsertKind): Patch {
  const inserts = patch.inserts ?? [];
  if (inserts.length >= MAX_INSERTS) return patch;
  return withInserts(patch, [...inserts, defaultInsert(kind)]);
}

export function removeInsert(patch: Patch, index: number): Patch {
  const inserts = patch.inserts ?? [];
  return withInserts(patch, inserts.filter((_, i) => i !== index));
}

export function moveInsert(patch: Patch, from: number, to: number): Patch {
  const inserts = patch.inserts ?? [];
  if (from === to) return patch;
  return withInserts(patch, move(inserts, from, to));
}

export function setInsertKind(patch: Patch, index: number, kind: InsertKind): Patch {
  const inserts = patch.inserts ?? [];
  if (inserts[index]?.kind === kind) return patch;
  return withInserts(
    patch,
    inserts.map((insert, i) => (i === index ? defaultInsert(kind) : insert)),
  );
}

/** The FM operator count is bounded 1..6 by validateFmGeneratorParams. */
const MAX_OPERATORS = 6;

function fmOf(patch: Patch, layerIndex: number) {
  const generator = patch.layers[layerIndex]?.generator;
  return generator?.kind === 'fm' ? generator.fm : null;
}

export function addOperator(patch: Patch, layerIndex: number): Patch {
  const fm = fmOf(patch, layerIndex);
  if (!fm || fm.operators.length >= MAX_OPERATORS) return patch;
  const index = fm.operators.length;
  const operators = [...fm.operators, { ratio: 1, level: 0.3, adsr: { ...DEFAULT_ADSR } }];
  // Routes require from > to, and `index` is the highest index there is — so a
  // route into operator 0 is always legal. Without it the new operator would be
  // neither carrier nor modulator, i.e. silent and confusing.
  const algorithm = { ...fm.algorithm, routes: [...fm.algorithm.routes, { from: index, to: 0 }] };
  return setAt(patch, `layers.${layerIndex}.generator.fm`, { operators, algorithm });
}

export function removeOperator(patch: Patch, layerIndex: number, opIndex: number): Patch {
  const fm = fmOf(patch, layerIndex);
  if (!fm || fm.operators.length <= 1) return patch;

  const operators = fm.operators.filter((_, i) => i !== opIndex);
  // Every index above the removed one shifts down by one. Anything REFERRING to
  // the removed operator is dropped, not remapped — a route to a dead operator
  // is meaningless, and silently repointing it would invent a patch the user
  // never authored.
  const shift = (i: number) => (i > opIndex ? i - 1 : i);
  const routes = fm.algorithm.routes
    .filter((r) => r.from !== opIndex && r.to !== opIndex)
    .map((r) => ({ from: shift(r.from), to: shift(r.to) }));
  let carriers = fm.algorithm.carriers.filter((c) => c !== opIndex).map(shift);
  // A patch with no carrier renders silence. Fall back to operator 0.
  if (carriers.length === 0) carriers = [0];
  const feedback =
    fm.algorithm.feedback && fm.algorithm.feedback.op !== opIndex
      ? { ...fm.algorithm.feedback, op: shift(fm.algorithm.feedback.op) }
      : undefined;

  const algorithm = feedback ? { routes, carriers, feedback } : { routes, carriers };
  return setAt(patch, `layers.${layerIndex}.generator.fm`, { operators, algorithm });
}

export function addPartial(patch: Patch, layerIndex: number): Patch {
  const generator = patch.layers[layerIndex]?.generator;
  if (generator?.kind !== 'additive') return patch;
  const next = generator.partials.length + 1;
  return setAt(patch, `layers.${layerIndex}.generator.partials`, [
    ...generator.partials,
    { ratio: next, level: 0.2 },
  ]);
}

export function removePartial(patch: Patch, layerIndex: number, partialIndex: number): Patch {
  const generator = patch.layers[layerIndex]?.generator;
  if (generator?.kind !== 'additive' || generator.partials.length <= 1) return patch;
  return setAt(
    patch,
    `layers.${layerIndex}.generator.partials`,
    generator.partials.filter((_, i) => i !== partialIndex),
  );
}

/** Oscillators summed per voice. A PROXY for CPU cost, not a prediction.
 *  Shown against BENCHMARK_VOICE_COST so the user can see a patch drifting
 *  heavier than the one the <25%-of-a-core budget was measured on. */
export function voiceCost(patch: Patch): number {
  return patch.layers.reduce((sum, layer) => {
    const g = layer.generator;
    switch (g.kind) {
      case 'fm':
        return sum + g.fm.operators.length;
      case 'additive':
        return sum + g.partials.length;
      case 'va':
        return sum + g.va.unison;
      case 'sample':
        return sum + 1;
    }
  }, 0);
}

/** The 64-voice full-FX Swift release benchmark renders a 1-layer, 3-operator
 *  FM patch and measures 21.9% of one core against a hard <25% budget. */
export const BENCHMARK_VOICE_COST = 3;
