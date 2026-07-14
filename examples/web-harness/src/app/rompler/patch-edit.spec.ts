import { describe, it, expect } from 'vitest';
import { validatePatch, type Patch } from '@allyworld/alloy-audio';
import { getAt, setAt, REFERENCE_PATCH } from './patch-edit.js';
import {
  GENERATOR_KINDS,
  INSERT_KINDS,
  MAX_LAYERS,
  DEFAULT_ZONE_SET_ID,
  addInsert,
  addLayer,
  addOperator,
  addPartial,
  defaultGenerator,
  defaultInsert,
  moveInsert,
  moveLayer,
  removeInsert,
  removeLayer,
  removeOperator,
  removePartial,
  setGeneratorKind,
  setInsertKind,
  voiceCost,
  BENCHMARK_VOICE_COST,
  type GeneratorKind,
  type InsertKind,
} from './patch-edit.js';

describe('REFERENCE_PATCH', () => {
  // Guards the whole suite: if the harness cannot even import the library in a
  // node environment, every later test is meaningless.
  it('is a valid patch the library accepts', () => {
    expect(validatePatch(REFERENCE_PATCH)).toEqual([]);
  });

  it('populates every optional field, so coverage tests can see them', () => {
    expect(REFERENCE_PATCH.layers.length).toBe(4);
    expect(REFERENCE_PATCH.inserts).toHaveLength(3);
    // One layer per generator kind.
    expect(REFERENCE_PATCH.layers.map((l) => l.generator.kind)).toEqual(['fm', 'additive', 'va', 'sample']);
    for (const layer of REFERENCE_PATCH.layers) {
      expect(layer.tvf).toBeDefined();
      expect(layer.mod).toBeDefined();
    }
    expect(REFERENCE_PATCH.layers[0].tvf!.env).toBeDefined();
    expect(REFERENCE_PATCH.meta.gmProgram).toBeDefined();
  });
});

describe('getAt', () => {
  it('reads a nested scalar', () => {
    expect(getAt(REFERENCE_PATCH, 'sends.reverb')).toBe(REFERENCE_PATCH.sends.reverb);
  });

  it('indexes through arrays', () => {
    expect(getAt(REFERENCE_PATCH, 'layers.0.tva.adsr.attack')).toBe(REFERENCE_PATCH.layers[0].tva.adsr.attack);
  });

  it('reaches into an FM operator', () => {
    // Narrow on the discriminant rather than casting: a cast would keep compiling
    // if layer 0 ever stopped being the FM layer, and the test would then compare
    // undefined to undefined and pass while asserting nothing.
    const generator = REFERENCE_PATCH.layers[0].generator;
    if (generator.kind !== 'fm') throw new Error('layer 0 of REFERENCE_PATCH must be the FM layer');
    const expected = generator.fm.operators[1].ratio;
    expect(getAt(REFERENCE_PATCH, 'layers.0.generator.fm.operators.1.ratio')).toBe(expected);
  });

  it('returns undefined for a path that does not exist', () => {
    expect(getAt(REFERENCE_PATCH, 'layers.0.nope.deeper')).toBeUndefined();
  });
});

describe('setAt', () => {
  it('writes a nested scalar', () => {
    const next = setAt(REFERENCE_PATCH, 'sends.reverb', 0.42);
    expect(next.sends.reverb).toBe(0.42);
  });

  it('writes through an array index', () => {
    const next = setAt(REFERENCE_PATCH, 'layers.2.tva.level', 0.33);
    expect(next.layers[2].tva.level).toBe(0.33);
  });

  it('DOES NOT MUTATE the input — the A/B slots depend on this', () => {
    const before = structuredClone(REFERENCE_PATCH);
    setAt(REFERENCE_PATCH, 'sends.reverb', 0.99);
    expect(REFERENCE_PATCH).toEqual(before);
  });

  it('shares untouched subtrees but replaces the touched spine', () => {
    const next = setAt(REFERENCE_PATCH, 'layers.0.tva.level', 0.5);
    expect(next).not.toBe(REFERENCE_PATCH);
    expect(next.layers[0]).not.toBe(REFERENCE_PATCH.layers[0]);
    expect(next.layers[1]).toBe(REFERENCE_PATCH.layers[1]); // untouched sibling shared
  });

  it('round-trips: set then get returns what was set', () => {
    const next = setAt(REFERENCE_PATCH, 'layers.0.generator.fm.operators.2.adsr.decay', 1.75);
    expect(getAt(next, 'layers.0.generator.fm.operators.2.adsr.decay')).toBe(1.75);
  });

  it('still yields a patch the library accepts', () => {
    const next = setAt(REFERENCE_PATCH, 'layers.1.tva.level', 0.8);
    expect(validatePatch(next)).toEqual([]);
  });
});

/** A one-layer, no-insert patch to grow from. */
const MINIMAL: Patch = {
  ...REFERENCE_PATCH,
  layers: [REFERENCE_PATCH.layers[0]],
  inserts: [],
};

describe('kind templates', () => {
  it.each(GENERATOR_KINDS)('defaultGenerator(%s) yields a patch the library accepts', (kind) => {
    // MINIMAL's layer 0 is already FM, so switching straight to 'fm' would
    // short-circuit to identity and never exercise defaultGenerator('fm') at
    // all. Start from a non-FM base so every kind in the table is a real switch.
    const base = setGeneratorKind(MINIMAL, 0, 'va');
    const next = setGeneratorKind(base, 0, kind);
    expect(next.layers[0].generator.kind).toBe(kind);
    expect(validatePatch(next)).toEqual([]);
  });

  it.each(INSERT_KINDS)('defaultInsert(%s) yields a patch the library accepts', (kind) => {
    const next = addInsert(MINIMAL, kind);
    expect(next.inserts![0].kind).toBe(kind);
    expect(validatePatch(next)).toEqual([]);
  });

  it('a default generator is audible, not an empty shell', () => {
    const fm = defaultGenerator('fm');
    if (fm.kind !== 'fm') throw new Error('unreachable');
    expect(fm.fm.operators.length).toBeGreaterThanOrEqual(1);
    expect(fm.fm.algorithm.carriers.length).toBeGreaterThanOrEqual(1);
    const add = defaultGenerator('additive');
    if (add.kind !== 'additive') throw new Error('unreachable');
    expect(add.partials.length).toBeGreaterThanOrEqual(1);
  });

  it('defaultGenerator(sample) points at a zone set the harness actually registers', () => {
    // The harness bakes DEFAULT_ZONE_SET_ID at startup; any other id resolves
    // to an inactive (silent) layer that still validates cleanly. Pinning this
    // makes a future rename of the harness's zone set break loudly here.
    const sample = defaultGenerator('sample');
    if (sample.kind !== 'sample') throw new Error('unreachable');
    expect(sample.zoneSetId).toBe(DEFAULT_ZONE_SET_ID);
  });

  it('defaultInsert returns a spec whose payload key matches its kind', () => {
    for (const kind of INSERT_KINDS) {
      const spec = defaultInsert(kind) as unknown as Record<string, unknown>;
      expect(spec['kind']).toBe(kind);
      expect(spec[kind]).toBeDefined();
    }
  });

  it('setGeneratorKind with an out-of-range layer index is a safe no-op (was: threw)', () => {
    const p = setGeneratorKind(REFERENCE_PATCH, 9, 'va');
    expect(p).toBe(REFERENCE_PATCH); // identity: rejected, not thrown
    expect(validatePatch(p)).toEqual([]);
  });
});

describe('layers', () => {
  it('adds up to 4 and then refuses', () => {
    let p = MINIMAL;
    for (let i = 0; i < 3; i++) p = addLayer(p);
    expect(p.layers).toHaveLength(4);
    expect(validatePatch(p)).toEqual([]);
    const refused = addLayer(p);
    expect(refused).toBe(p); // identity: no-op returns the same object
  });

  it('removes down to 1 and then refuses', () => {
    let p = REFERENCE_PATCH;
    for (let i = 0; i < 3; i++) p = removeLayer(p, 0);
    expect(p.layers).toHaveLength(1);
    const refused = removeLayer(p, 0);
    expect(refused).toBe(p);
  });

  it('removes the layer actually named', () => {
    const p = removeLayer(REFERENCE_PATCH, 1); // the additive one
    expect(p.layers.map((l) => l.generator.kind)).toEqual(['fm', 'va', 'sample']);
  });

  it('moves a layer without losing one', () => {
    const p = moveLayer(REFERENCE_PATCH, 0, 2);
    expect(p.layers.map((l) => l.generator.kind)).toEqual(['additive', 'va', 'fm', 'sample']);
    expect(validatePatch(p)).toEqual([]);
  });

  it('pins MAX_LAYERS to validatePatch, not a hand-typed number', () => {
    // Hand-build (not via addLayer, which would just re-hit the module's own
    // limit and make this vacuous) — but sized off MAX_LAYERS itself, so a
    // drift in the constant fails this test instead of silently passing.
    const atLimit: Patch = {
      ...REFERENCE_PATCH,
      layers: Array.from(
        { length: MAX_LAYERS },
        (_, i) => REFERENCE_PATCH.layers[i % REFERENCE_PATCH.layers.length],
      ),
    };
    expect(atLimit.layers).toHaveLength(MAX_LAYERS);
    expect(validatePatch(atLimit)).toEqual([]);

    const overLimit: Patch = { ...REFERENCE_PATCH, layers: [...atLimit.layers, REFERENCE_PATCH.layers[0]] };
    expect(overLimit.layers).toHaveLength(MAX_LAYERS + 1);
    expect(validatePatch(overLimit)).not.toEqual([]);
  });

  it('moveLayer with an out-of-range from index is a safe no-op (was: corrupts the patch)', () => {
    const p = moveLayer(REFERENCE_PATCH, 7, 0);
    expect(p).toBe(REFERENCE_PATCH); // identity: rejected, not silently corrupted
    expect(validatePatch(p)).toEqual([]);
  });

  it('moveLayer with a negative to index is a safe no-op (was: silently wrong reorder)', () => {
    const p = moveLayer(REFERENCE_PATCH, 0, -1);
    expect(p).toBe(REFERENCE_PATCH);
    expect(validatePatch(p)).toEqual([]);
  });
});

describe('inserts', () => {
  it('adds up to MAX_INSERTS and then refuses', () => {
    let p = MINIMAL;
    p = addInsert(p, 'chorus');
    p = addInsert(p, 'phaser');
    p = addInsert(p, 'rotary');
    expect(p.inserts).toHaveLength(3);
    expect(validatePatch(p)).toEqual([]);
    expect(addInsert(p, 'tremolo')).toBe(p);
  });

  it('reorders inserts — the chain order is audible, so this must be exact', () => {
    const p = moveInsert(REFERENCE_PATCH, 2, 0);
    expect(p.inserts!.map((i) => i.kind)).toEqual(['compressor', 'chorus', 'driveEq']);
  });

  it('removes the insert actually named', () => {
    const p = removeInsert(REFERENCE_PATCH, 1);
    expect(p.inserts!.map((i) => i.kind)).toEqual(['chorus', 'compressor']);
  });

  it('switches an insert kind in place, preserving position', () => {
    const p = setInsertKind(REFERENCE_PATCH, 1, 'rotary');
    expect(p.inserts!.map((i) => i.kind)).toEqual(['chorus', 'rotary', 'compressor']);
    expect(validatePatch(p)).toEqual([]);
  });

  it('moveInsert with an out-of-range from index is a safe no-op (was: corrupts the patch)', () => {
    const p = moveInsert(REFERENCE_PATCH, 9, 0);
    expect(p).toBe(REFERENCE_PATCH); // identity: rejected, not silently corrupted
    expect(validatePatch(p)).toEqual([]);
  });
});

describe('FM operators', () => {
  it('adds up to 6 and then refuses', () => {
    let p = MINIMAL; // 3 operators
    p = addOperator(p, 0);
    p = addOperator(p, 0);
    p = addOperator(p, 0);
    const fm = p.layers[0].generator;
    if (fm.kind !== 'fm') throw new Error('unreachable');
    expect(fm.fm.operators).toHaveLength(6);
    expect(validatePatch(p)).toEqual([]);
    expect(addOperator(p, 0)).toBe(p);
  });

  it('a newly added operator modulates something rather than being dead', () => {
    const p = addOperator(MINIMAL, 0);
    const gen = p.layers[0].generator;
    if (gen.kind !== 'fm') throw new Error('unreachable');
    const newIndex = gen.fm.operators.length - 1;
    const isCarrier = gen.fm.algorithm.carriers.includes(newIndex);
    const isModulator = gen.fm.algorithm.routes.some((r) => r.from === newIndex);
    expect(isCarrier || isModulator).toBe(true);
  });

  it('REMOVING an operator reindexes routes and carriers — this is where it gets subtle', () => {
    // MINIMAL: ops [0,1,2], routes 1->0 and 2->0, carriers [0], feedback op 1.
    // Remove op 1: op 2 becomes op 1. The 1->0 route dies with its operator;
    // the 2->0 route must survive as 1->0. Feedback on op 1 dies with it.
    const p = removeOperator(MINIMAL, 0, 1);
    const gen = p.layers[0].generator;
    if (gen.kind !== 'fm') throw new Error('unreachable');
    expect(gen.fm.operators).toHaveLength(2);
    expect(gen.fm.operators[1].ratio).toBe(14); // the old op 2 survived, reindexed
    expect(gen.fm.algorithm.routes).toEqual([{ from: 1, to: 0 }]);
    expect(gen.fm.algorithm.carriers).toEqual([0]);
    expect(gen.fm.algorithm.feedback).toBeUndefined();
    expect(validatePatch(p)).toEqual([]);
  });

  it('removing the CARRIER leaves a valid patch with a carrier', () => {
    const p = removeOperator(MINIMAL, 0, 0);
    const gen = p.layers[0].generator;
    if (gen.kind !== 'fm') throw new Error('unreachable');
    expect(gen.fm.algorithm.carriers.length).toBeGreaterThanOrEqual(1);
    expect(validatePatch(p)).toEqual([]);
  });

  it('refuses to remove the last operator', () => {
    let p = removeOperator(MINIMAL, 0, 0);
    p = removeOperator(p, 0, 0);
    const gen = p.layers[0].generator;
    if (gen.kind !== 'fm') throw new Error('unreachable');
    expect(gen.fm.operators).toHaveLength(1);
    expect(removeOperator(p, 0, 0)).toBe(p);
  });
});

describe('additive partials', () => {
  it('adds a partial and keeps the patch valid', () => {
    const p = addPartial(REFERENCE_PATCH, 1);
    const gen = p.layers[1].generator;
    if (gen.kind !== 'additive') throw new Error('unreachable');
    expect(gen.partials).toHaveLength(4);
    expect(validatePatch(p)).toEqual([]);
  });

  it('removes down to 1 and then refuses', () => {
    let p = removePartial(REFERENCE_PATCH, 1, 0);
    p = removePartial(p, 1, 0);
    const gen = p.layers[1].generator;
    if (gen.kind !== 'additive') throw new Error('unreachable');
    expect(gen.partials).toHaveLength(1);
    expect(removePartial(p, 1, 0)).toBe(p);
  });
});

describe('voiceCost', () => {
  // The 64-voice full-FX Swift release benchmark measures 21.9% of one core
  // against a HARD <25% budget, rendering a 1-layer 3-operator FM patch. This
  // number is the user's early warning that a patch is drifting heavier than
  // the thing the budget was measured on. It is a PROXY, not a prediction.
  it('is the benchmark figure for the benchmark-shaped patch', () => {
    const benchmarkShaped: Patch = { ...MINIMAL };
    expect(voiceCost(benchmarkShaped)).toBe(BENCHMARK_VOICE_COST);
  });

  it('counts FM operators, additive partials, VA unison voices, and 1 per sample layer', () => {
    // REFERENCE_PATCH: fm(3 ops) + additive(3 partials) + va(unison 3) + sample(1)
    expect(voiceCost(REFERENCE_PATCH)).toBe(3 + 3 + 3 + 1);
  });
});
