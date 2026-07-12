import { describe, expect, it } from 'vitest';
import { validatePatch, PATCH_SCHEMA_VERSION, type Patch } from './patch.js';
import type { InsertSpec } from './effects/effect-types.js';
import { FIXTURE_INSERTS_PATCH_JSON, FIXTURE_PATCH_JSON } from './testing/fixtures.js';

// Wire-contract pin shared verbatim with PatchTests.swift: a va generator
// may omit pulseWidth (TS type is optional; Swift decodes it as 0.5).
const NO_PULSE_WIDTH_PATCH_JSON = `{
  "schemaVersion": 1,
  "meta": { "id": "test.nopw", "name": "No Pulse Width", "category": "melodic" },
  "layers": [
    {
      "keyRange": { "lowMidi": 0, "highMidi": 127 },
      "velRange": { "low": 0, "high": 1 },
      "generator": { "kind": "va", "va": { "shape": "saw", "unison": 2, "detuneCents": 12 }, "seed": 3 },
      "tva": { "level": 0.7, "adsr": { "attack": 0.01, "decay": 0.2, "sustain": 0.6, "release": 0.2 }, "velCurve": 1 }
    }
  ],
  "sends": { "reverb": 0, "delay": 0 }
}`;

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

  it('accepts a va generator that omits pulseWidth', () => {
    const patch = JSON.parse(NO_PULSE_WIDTH_PATCH_JSON) as Patch;
    expect(validatePatch(patch)).toEqual([]);
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

  it('keeps validating the 1b fixture, which has no inserts field', () => {
    // Backward-compat pin: `inserts` is optional and schemaVersion stays 1,
    // so every pre-2a patch JSON must keep validating verbatim.
    const patch = JSON.parse(FIXTURE_PATCH_JSON) as Patch;
    expect(patch.inserts).toBeUndefined();
    expect(validatePatch(patch)).toEqual([]);
  });

  it('rejects more than MAX_INSERTS inserts', () => {
    const base = JSON.parse(FIXTURE_PATCH_JSON) as Patch;
    const chorus: InsertSpec = { kind: 'chorus', chorus: { mode: 'chorus', rateHz: 1, depthMs: 3, mix: 0.5 } };
    const errors = validatePatch({ ...base, inserts: [chorus, chorus, chorus, chorus] });
    expect(errors).toContain('too many inserts (4 > 3)');
  });

  it('prefixes insert validation errors with their 1-based index', () => {
    const base = JSON.parse(FIXTURE_PATCH_JSON) as Patch;
    const bad: InsertSpec = { kind: 'chorus', chorus: { mode: 'chorus', rateHz: 0, depthMs: 25, mix: 1.5 } };
    const errors = validatePatch({ ...base, inserts: [bad] });
    expect(errors.length).toBeGreaterThanOrEqual(3);
    expect(errors.every((e) => e.startsWith('insert 1: '))).toBe(true);
  });

  it('rejects an unknown insert kind instead of throwing', () => {
    // A runtime patch payload can carry an insert kind newer than this
    // build knows about (e.g. a future 'flanger' from a newer bundle). That
    // must surface as a validation error, not throw out of validatePatch's
    // for-of loop and up through WorkletHostCore.render — see
    // worklet-host-core.spec.ts for the end-to-end non-throw pin, and
    // PatchTests.swift for the structurally-different Swift twin (Codable
    // decode rejects unknown kinds before validation ever runs).
    const base = JSON.parse(FIXTURE_PATCH_JSON) as Patch;
    const unknownInsert = { kind: 'flanger' } as unknown as InsertSpec;
    let errors: string[] = [];
    expect(() => {
      errors = validatePatch({ ...base, inserts: [unknownInsert] });
    }).not.toThrow();
    expect(errors).toContain("insert 1: unknown insert kind 'flanger'");
  });

  it('inserts fixture parses, validates clean, and round-trips', () => {
    const patch = JSON.parse(FIXTURE_INSERTS_PATCH_JSON) as Patch;
    expect(validatePatch(patch)).toEqual([]);
    expect(patch.inserts).toHaveLength(2);
    expect(patch.inserts?.[0]).toEqual({ kind: 'chorus', chorus: { mode: 'ensemble', rateHz: 0.9, depthMs: 2.5, mix: 0.4 } });
    expect(patch.inserts?.[1]).toEqual({ kind: 'tremolo', tremolo: { rateHz: 5.5, depth: 0.6, spread: 1 } });
    const reparsed = JSON.parse(JSON.stringify(patch)) as Patch;
    expect(validatePatch(reparsed)).toEqual([]);
    expect(reparsed.inserts).toEqual(patch.inserts);
  });

  it('rejects a va seed that is negative or non-integer', () => {
    const base = JSON.parse(FIXTURE_PATCH_JSON) as Patch;
    const negativeSeed = structuredClone(base);
    (negativeSeed.layers[0].generator as { kind: 'va'; seed: number }).seed = -1;
    const negativeErrors = validatePatch(negativeSeed);
    expect(negativeErrors.some((e) => e === 'layer 1: va seed must be a uint32')).toBe(true);

    const fractionalSeed = structuredClone(base);
    (fractionalSeed.layers[0].generator as { kind: 'va'; seed: number }).seed = 1.5;
    const fractionalErrors = validatePatch(fractionalSeed);
    expect(fractionalErrors.some((e) => e === 'layer 1: va seed must be a uint32')).toBe(true);
  });
});
