import { describe, it, expect } from 'vitest';
import { validatePatch, type Patch } from '@allyworld/alloy-audio';
import {
  REFERENCE_PATCH,
  GENERATOR_KINDS,
  INSERT_KINDS,
  setGeneratorKind,
  setInsertKind,
} from './patch-edit.js';
import { fromJson, toJson, toTypeScript, toTypeScriptLiteral } from './patch-serialize.js';

/** Evaluate an emitted TS object literal back into a real object. The literal is
 *  plain data — no types, no imports — so it is also a valid JS expression. */
function evalLiteral(literal: string): unknown {
  return new Function(`return (${literal});`)();
}

/** Every generator kind x every insert kind, so no branch of the emitter is untested. */
function variants(): Patch[] {
  const out: Patch[] = [REFERENCE_PATCH];
  for (const kind of GENERATOR_KINDS) out.push(setGeneratorKind(REFERENCE_PATCH, 0, kind));
  for (const kind of INSERT_KINDS) out.push(setInsertKind(REFERENCE_PATCH, 0, kind));
  return out;
}

describe('JSON round-trip', () => {
  it('survives export -> import unchanged, for every kind', () => {
    for (const patch of variants()) {
      const parsed = fromJson(toJson(patch));
      expect('patch' in parsed).toBe(true);
      expect((parsed as { patch: Patch }).patch).toEqual(patch);
    }
  });

  it('reports errors instead of throwing on malformed JSON', () => {
    const result = fromJson('{ not json');
    expect('errors' in result).toBe(true);
  });

  it('reports errors instead of throwing on JSON that is not a valid patch', () => {
    const result = fromJson(JSON.stringify({ schemaVersion: 1, layers: [] }));
    expect('errors' in result).toBe(true);
    expect((result as { errors: string[] }).errors.length).toBeGreaterThan(0);
  });
});

describe('TypeScript emission', () => {
  it('emits a literal that evaluates BACK to the same patch — 4b is pasted from this', () => {
    for (const patch of variants()) {
      expect(evalLiteral(toTypeScriptLiteral(patch))).toEqual(patch);
    }
  });

  it('the emitted patch is still one the library accepts', () => {
    for (const patch of variants()) {
      expect(validatePatch(evalLiteral(toTypeScriptLiteral(patch)) as Patch)).toEqual([]);
    }
  });

  it('does not emit undefined for absent optional fields', () => {
    const noTvf: Patch = {
      ...REFERENCE_PATCH,
      layers: [{ ...REFERENCE_PATCH.layers[0], tvf: undefined, mod: undefined }],
    };
    const literal = toTypeScriptLiteral(noTvf);
    expect(literal).not.toContain('undefined');
    expect(evalLiteral(literal)).toEqual({ ...noTvf, layers: [{ ...noTvf.layers[0] }] });
  });

  it('wraps the literal in a named, typed export', () => {
    const src = toTypeScript(REFERENCE_PATCH, 'EP_TINE');
    expect(src.startsWith('export const EP_TINE: Patch = {')).toBe(true);
    expect(src.trimEnd().endsWith('};')).toBe(true);
  });
});
