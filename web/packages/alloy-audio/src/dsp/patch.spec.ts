import { describe, expect, it } from 'vitest';
import { validatePatch, PATCH_SCHEMA_VERSION, type Patch } from './patch.js';
import { FIXTURE_PATCH_JSON } from './testing/fixtures.js';

describe('Patch', () => {
  it('fixture parses and validates clean', () => {
    const patch = JSON.parse(FIXTURE_PATCH_JSON) as Patch;
    expect(patch.schemaVersion).toBe(PATCH_SCHEMA_VERSION);
    expect(patch.layers).toHaveLength(2);
    expect(validatePatch(patch)).toEqual([]);
  });

  it('rejects wrong schema version, empty layers, and >4 layers', () => {
    const base = JSON.parse(FIXTURE_PATCH_JSON) as Patch;
    expect(validatePatch({ ...base, schemaVersion: 2 })).not.toEqual([]);
    expect(validatePatch({ ...base, layers: [] })).not.toEqual([]);
    expect(
      validatePatch({
        ...base,
        layers: [base.layers[0], base.layers[0], base.layers[0], base.layers[0], base.layers[0]],
      }),
    ).not.toEqual([]);
  });

  it('surfaces nested FM errors with a layer prefix', () => {
    const base = JSON.parse(FIXTURE_PATCH_JSON) as Patch;
    const broken = structuredClone(base);
    (
      broken.layers[1].generator as { kind: 'fm'; fm: { algorithm: { carriers: number[] } } }
    ).fm.algorithm.carriers = [9];
    const errors = validatePatch(broken);
    expect(errors.some((e) => e.startsWith('layer 2:'))).toBe(true);
  });

  it('rejects bad ranges and generator specifics', () => {
    const base = JSON.parse(FIXTURE_PATCH_JSON) as Patch;
    const badKeys = structuredClone(base);
    badKeys.layers[0].keyRange = { lowMidi: 80, highMidi: 40 };
    expect(validatePatch(badKeys)).not.toEqual([]);
    const badVa = structuredClone(base);
    (badVa.layers[0].generator as { kind: 'va'; va: { unison: number } }).va.unison = 0;
    expect(validatePatch(badVa)).not.toEqual([]);
  });
});
