import { describe, it, expect } from 'vitest';
import { validatePatch } from '@allyworld/alloy-audio';
import { getAt, setAt, REFERENCE_PATCH } from './patch-edit.js';

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
    const expected = (REFERENCE_PATCH.layers[0].generator as { fm: { operators: { ratio: number }[] } }).fm.operators[1].ratio;
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
