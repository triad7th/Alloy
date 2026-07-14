import { describe, it, expect } from 'vitest';
import { validatePatch, type Patch } from '@allyworld/alloy-audio';
import { REFERENCE_PATCH, getAt, setAt, GENERATOR_KINDS, INSERT_KINDS, setGeneratorKind, addInsert } from './patch-edit.js';
import { describePatch, STRUCTURAL_PATHS, type ParamDescriptor } from './patch-schema.js';

function allParams(patch: Patch): ParamDescriptor[] {
  return describePatch(patch).flatMap((g) => g.params);
}

/** Every leaf path in a patch object (scalars only; arrays are walked by index). */
function leafPaths(node: unknown, prefix = ''): string[] {
  if (node === null || typeof node !== 'object') return prefix ? [prefix] : [];
  if (Array.isArray(node)) {
    return node.flatMap((child, i) => leafPaths(child, `${prefix}.${i}`));
  }
  return Object.entries(node as Record<string, unknown>).flatMap(([key, child]) =>
    leafPaths(child, prefix ? `${prefix}.${key}` : key),
  );
}

function isStructural(path: string): boolean {
  return STRUCTURAL_PATHS.some((pattern) => new RegExp(pattern).test(path));
}

// REFERENCE_PATCH can hold only MAX_INSERTS (3) of the 6 insert kinds, and one
// generator kind per layer. Walking it alone leaves tremolo/phaser/rotary — and
// any field only they carry — untested by coverage AND bounds. This set puts
// every generator kind and every insert kind into slot 0 of some patch, so the
// leaf-level loops below see them all. addInsert grows an empty MINIMAL rather
// than replacing a reference insert, so no kind is masked by another.
const MINIMAL_ONE_INSERT: Patch = { ...REFERENCE_PATCH, inserts: [] };
const COVERAGE_PATCHES: Patch[] = [
  REFERENCE_PATCH,
  ...GENERATOR_KINDS.map((kind) => setGeneratorKind(REFERENCE_PATCH, 0, kind)),
  ...INSERT_KINDS.map((kind) => addInsert(MINIMAL_ONE_INSERT, kind)),
];

function everyParam(patches: Patch[]): { patch: Patch; param: ParamDescriptor }[] {
  return patches.flatMap((patch) => allParams(patch).map((param) => ({ patch, param })));
}

describe('descriptor coverage', () => {
  // THE test that stops the editor going quietly stale. If someone adds a field
  // to the Patch schema and no descriptor for it, this fails — rather than the
  // field being silently uneditable forever.
  it('every leaf of a fully-populated patch is either editable or explicitly structural', () => {
    const covered = new Set(allParams(REFERENCE_PATCH).map((p) => p.path));
    const uncovered = leafPaths(REFERENCE_PATCH).filter((p) => !covered.has(p) && !isStructural(p));
    expect(uncovered).toEqual([]);
  });

  it('every descriptor points at a path that actually exists on the patch', () => {
    const dangling = allParams(REFERENCE_PATCH).filter((p) => getAt(REFERENCE_PATCH, p.path) === undefined);
    expect(dangling.map((p) => p.path)).toEqual([]);
  });

  it('covers every generator kind, not just the ones the reference happens to use', () => {
    for (const kind of GENERATOR_KINDS) {
      const patch = setGeneratorKind(REFERENCE_PATCH, 0, kind);
      const params = allParams(patch).filter((p) => p.path.startsWith('layers.0.generator'));
      expect(params.length, `generator kind '${kind}' has no editable params`).toBeGreaterThan(0);
      for (const p of params) {
        expect(getAt(patch, p.path), `${kind}: dangling ${p.path}`).toBeDefined();
      }
    }
  });

  it('covers every insert kind, including the three the reference patch cannot hold', () => {
    for (const kind of INSERT_KINDS) {
      const patch = addInsert(MINIMAL_ONE_INSERT, kind);
      const params = allParams(patch).filter((p) => p.path.startsWith('inserts.0.'));
      expect(params.length, `insert kind '${kind}' has no editable params`).toBeGreaterThan(0);
      for (const p of params) {
        expect(getAt(patch, p.path), `${kind}: dangling ${p.path}`).toBeDefined();
      }
    }
  });
});

describe('bounds safety', () => {
  // The editor must be INCAPABLE of building a patch the engine would reject —
  // PatchEngine.setPatch THROWS on an invalid patch.
  it('every numeric descriptor, pinned to its min, still yields a valid patch', () => {
    for (const { patch, param } of everyParam(COVERAGE_PATCHES)) {
      if (param.kind !== 'number' || param.min === undefined) continue;
      const next = setAt(patch, param.path, param.min);
      expect(validatePatch(next), `${param.path} at min ${param.min}`).toEqual([]);
    }
  });

  it('every numeric descriptor, pinned to its max, still yields a valid patch', () => {
    for (const { patch, param } of everyParam(COVERAGE_PATCHES)) {
      if (param.kind !== 'number' || param.max === undefined) continue;
      const next = setAt(patch, param.path, param.max);
      expect(validatePatch(next), `${param.path} at max ${param.max}`).toEqual([]);
    }
  });

  it('every enum descriptor, set to each of its options, yields a valid patch', () => {
    for (const { patch, param } of everyParam(COVERAGE_PATCHES)) {
      if (param.kind !== 'enum' || !param.options) continue;
      for (const option of param.options) {
        const next = setAt(patch, param.path, option);
        expect(validatePatch(next), `${param.path} = ${String(option)}`).toEqual([]);
      }
    }
  });

  it('every numeric descriptor declares BOTH bounds — a half-open slider is a bug', () => {
    const halfOpen = everyParam(COVERAGE_PATCHES)
      .map(({ param }) => param)
      .filter((p) => p.kind === 'number' && (p.min === undefined || p.max === undefined));
    expect(halfOpen.map((p) => p.path)).toEqual([]);
  });
});
