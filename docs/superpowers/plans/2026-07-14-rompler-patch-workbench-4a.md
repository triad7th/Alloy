# Rompler Phase 4a — The Patch Workbench: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A generic `Patch` editor in the web harness so the user can tune the phase-4b factory bank by ear, in seconds per iteration, instead of round-tripping prose feedback through an agent that cannot hear.

**Architecture:** Everything lives in `examples/web-harness/` — a private preview app that is never packed, tagged, or released. Three *pure* modules (a parameter descriptor table, immutable patch edit operations, and a TS/JSON serializer) are unit-tested with a new minimal vitest setup; one Angular component renders the UI entirely from the descriptor table; the existing rompler section hosts it and owns the A/B slots. **No file under `web/packages/` or `swift/` is touched.**

**Tech Stack:** TypeScript, Angular 21 (standalone components, signals), vitest (new to the harness), the existing `@allyworld/alloy-audio` public API (`Patch`, `validatePatch`, `WorkletSynthHost`).

## Global Constraints

- **Zero blast radius.** Do NOT modify anything under `web/packages/` or `swift/`. If a task seems to need a new export from `alloy-audio`, STOP and report — the design has drifted. This is the phase's cleanest property.
- **No Swift twin.** The harness is web-only by design, like `tools/samplepack/`. It is outside the twin contract.
- **Do NOT run any formatter or linter.** The repo has no prettier/eslint/swiftformat config; running one reformats 100+ unrelated files.
- **Never `git add -A` or `git add .`.** The working tree contains unrelated files owned by the repo owner. Stage by explicit path.
- **Port 4205 belongs to the human dev.** If you serve the harness, use your own port: `npx ng serve --port 4210`. Never kill or reuse a server already on 4205.
- **Test hygiene:** every assertion must be able to fail, and every numeric bound must come from the source it mirrors (`validatePatch` / `validateInsert`) or from a stated musical rationale — never invented.
- Conventional commits, imperative subject ≤ 72 chars.

## Facts about the existing code (verified — do not re-derive)

Types from `@allyworld/alloy-audio` (source of truth: `web/packages/alloy-audio/src/dsp/patch.ts` and `dsp/effects/effect-types.ts`):

```ts
interface Patch { schemaVersion: number; meta: PatchMeta; layers: PatchLayer[]; sends: { reverb: number; delay: number }; inserts?: InsertSpec[] }
interface PatchMeta { id: string; name: string; category: 'melodic' | 'kit'; gmProgram?: number }
interface PatchLayer { keyRange: { lowMidi: number; highMidi: number }; velRange: { low: number; high: number }; generator: GeneratorSpec; tvf?: TvfParams; tva: TvaParams; mod?: LfoRouting }
type GeneratorSpec =
  | { kind: 'fm'; fm: { operators: FmOperatorParams[]; algorithm: FmAlgorithm } }
  | { kind: 'additive'; partials: { ratio: number; level: number }[] }
  | { kind: 'va'; va: { shape: 'sine'|'saw'|'pulse'; unison: number; detuneCents: number; pulseWidth?: number }; seed: number }
  | { kind: 'sample'; zoneSetId: string; crossfade: number };
interface FmOperatorParams { ratio: number; level: number; adsr: AdsrParams }
interface FmAlgorithm { routes: { from: number; to: number }[]; carriers: number[]; feedback?: { op: number; amount: number } }
interface AdsrParams { attack: number; decay: number; sustain: number; release: number }
interface TvfParams { mode: 'lowpass'|'bandpass'|'highpass'; cutoffHz: number; q: number; envAmountHz: number; env?: AdsrParams; keyTrack: number; velAmountHz: number }
interface TvaParams { level: number; adsr: AdsrParams; velCurve: number }
interface LfoRouting { lfo: { shape: 'sine'|'triangle'; rateHz: number; delay: number; fadeIn: number }; toPitchCents: number; toCutoffHz: number; toAmpDepth: number }
type InsertSpec =
  | { kind: 'chorus'; chorus: { mode: 'chorus'|'ensemble'; rateHz: number; depthMs: number; mix: number } }
  | { kind: 'tremolo'; tremolo: { rateHz: number; depth: number; spread: number } }
  | { kind: 'phaser'; phaser: { stages: 4|8; rateHz: number; depth: number; feedback: number; mix: number } }
  | { kind: 'rotary'; rotary: { speed: 'slow'|'fast'; depth: number; mix: number } }
  | { kind: 'driveEq'; driveEq: { drive: number; lowDb: number; midDb: number; highDb: number; levelDb: number } }
  | { kind: 'compressor'; compressor: { thresholdDb: number; ratio: number; attackMs: number; releaseMs: number; makeupDb: number } };
const PATCH_SCHEMA_VERSION = 1;
const MAX_INSERTS = 3;
function validatePatch(patch: Patch): string[];  // non-throwing; empty = valid
```

**Hard limits enforced by validation** (the editor must never be able to exceed them):

| thing | legal range | enforced by |
| --- | --- | --- |
| layers | 1..4 | `validatePatch` |
| inserts | 0..3 | `MAX_INSERTS` |
| FM operators | 1..6 | `validateFmGeneratorParams` |
| FM routes | `from > to` | `validateFmGeneratorParams` |
| additive partials | ≥ 1 | `validatePatch` |
| `va.unison` | ≥ 1 | `validatePatch` |
| `va.seed` | uint32 integer | `validatePatch` |
| `tva.level` | > 0 | `validatePatch` |
| `sample.zoneSetId` | non-empty | `validatePatch` |
| `sample.crossfade` | ≥ 0 | `validatePatch` |
| chorus | `rateHz` (0,20]; `depthMs` (0,7]; `mix` [0,1]; `mode` chorus\|ensemble | `validateInsert` |
| tremolo | `rateHz` (0,40]; `depth` [0,1]; `spread` [0,1] | `validateInsert` |
| phaser | `stages` 4\|8; `rateHz` (0,10]; `depth` [0,1]; `feedback` [0,0.9]; `mix` [0,1] | `validateInsert` |
| rotary | `speed` slow\|fast; `depth` [0,1]; `mix` [0,1] | `validateInsert` |
| driveEq | `drive` [0,1]; `lowDb`/`midDb`/`highDb`/`levelDb` [-12,12] | `validateInsert` |
| compressor | `thresholdDb` [-60,0]; `ratio` [1,20]; `attackMs` (0,100]; `releaseMs` (0,1000]; `makeupDb` [0,24] | `validateInsert` |

**Not validated by the library** (so the descriptor table's ranges here are *musical* choices, and the plan states the rationale): `sends.reverb`/`sends.delay` (use [0,1] — they are wet-send fractions), all ADSR fields (use attack/decay/release [0,10] s, sustain [0,1]), `tvf.cutoffHz` (use [20,20000], log taper), `tvf.q` (use [0.5,20]), `tvf.envAmountHz`/`velAmountHz` (use [0,20000]), `tvf.keyTrack` ([0,2]), `tva.velCurve` ([0.1,4]), `mod.*` (`rateHz` (0,20], `delay`/`fadeIn` [0,5] s, `toPitchCents` [-1200,1200], `toCutoffHz` [-10000,10000], `toAmpDepth` [0,1]), FM `ratio` ([0.25,32]) and `level` ([0,10]), FM `feedback.amount` ([0,2]), additive `ratio` ([0.25,32]) / `level` ([0,2]), `va.detuneCents` ([0,100]), `va.pulseWidth` ([0.05,0.95]), key/velocity ranges (midi [0,127], vel [0,1]).

**Engine behavior the UI must respect:** `PatchEngine.setPatch` **throws** on an invalid patch, and a `Voice` captures its generator/TVF/TVA params at `noteOn` — so a knob turn is inaudible on a sustaining note. Inserts and sends *do* apply live. Hence: validate before sending, and re-strike the last note after every edit.

**Module resolution:** `examples/web-harness/tsconfig.json` maps `@allyworld/alloy-audio` → `../../web/packages/alloy-audio/src/index.ts` (source, not dist). The new vitest config must alias the same way.

## File Structure

| File | Responsibility |
| --- | --- |
| `examples/web-harness/vitest.config.ts` | **Create.** Node-environment vitest, alias `@allyworld/alloy-audio` → the package source, include only `src/app/rompler/**/*.spec.ts`. |
| `examples/web-harness/package.json` | **Modify.** Add `vitest` devDependency + a `test` script. |
| `examples/web-harness/src/app/rompler/patch-edit.ts` | **Create.** Pure immutable ops on a `Patch`: path get/set, layer & insert & operator & partial add/remove/move, generator/insert kind templates, `voiceCost`. |
| `examples/web-harness/src/app/rompler/patch-schema.ts` | **Create.** The parameter descriptor table + `describePatch()`, which expands it into absolute paths for a concrete patch. |
| `examples/web-harness/src/app/rompler/patch-serialize.ts` | **Create.** `toTypeScript` / `toJson` / `fromJson`. |
| `examples/web-harness/src/app/rompler/patch-editor.component.ts` | **Create.** The UI, rendered entirely from `describePatch()` + bespoke structural controls. |
| `examples/web-harness/src/app/sections/rompler-section.component.ts` | **Modify.** Host the editor; own the A/B slots, apply + re-strike, export/import, localStorage. |

---

### Task 1: Vitest setup + patch path get/set

**Files:**
- Create: `examples/web-harness/vitest.config.ts`
- Modify: `examples/web-harness/package.json`
- Create: `examples/web-harness/src/app/rompler/patch-edit.ts`
- Test: `examples/web-harness/src/app/rompler/patch-edit.spec.ts`

**Interfaces:**
- Consumes: `Patch`, `validatePatch`, `PATCH_SCHEMA_VERSION` from `@allyworld/alloy-audio`.
- Produces:
  ```ts
  export function getAt(patch: Patch, path: string): unknown;
  export function setAt(patch: Patch, path: string, value: unknown): Patch;  // immutable
  export const REFERENCE_PATCH: Patch;  // fully-populated: every optional field present
  ```
  `path` is dot-delimited with numeric array indices, e.g. `layers.0.tvf.cutoffHz`, `inserts.1.chorus.mix`, `sends.reverb`, `layers.0.generator.fm.operators.2.adsr.attack`.

- [ ] **Step 1: Add the vitest devDependency**

```bash
cd examples/web-harness && npm install -D vitest@^3.0.0
```

Expected: `package.json` gains `"vitest": "^3.0.0"` under `devDependencies`; `package-lock.json` updates.

- [ ] **Step 2: Add the test script to `examples/web-harness/package.json`**

In the `"scripts"` block, alongside the existing `ng` / `start` / `build` entries, add:

```json
    "test": "vitest run",
```

- [ ] **Step 3: Create `examples/web-harness/vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

// The harness's tsconfig maps @allyworld/* to package SOURCE (not dist); vitest
// must resolve the same way or the pure modules would test against a stale build.
export default defineConfig({
  resolve: {
    alias: {
      '@allyworld/alloy-audio': fileURLToPath(
        new URL('../../web/packages/alloy-audio/src/index.ts', import.meta.url),
      ),
    },
  },
  test: {
    environment: 'node',
    // Only the PURE modules are tested. Angular components stay untested here,
    // as they were before this phase.
    include: ['src/app/rompler/**/*.spec.ts'],
  },
});
```

- [ ] **Step 4: Write the failing test**

Create `examples/web-harness/src/app/rompler/patch-edit.spec.ts`:

```ts
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
```

- [ ] **Step 5: Run it and watch it fail**

```bash
cd examples/web-harness && npx vitest run
```

Expected: FAIL — `Failed to resolve import "./patch-edit.js"`.

If instead it fails with a *browser-global* error (e.g. `AudioContext is not defined`) while importing `@allyworld/alloy-audio`, the package barrel pulls a browser API in at module scope. Fallback: point the vitest alias at `../../web/packages/alloy-audio/src/dsp/patch.ts` instead and import the types from there. Report which path you took.

- [ ] **Step 6: Implement `examples/web-harness/src/app/rompler/patch-edit.ts`**

```ts
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
```

- [ ] **Step 7: Run the tests**

```bash
cd examples/web-harness && npx vitest run
```

Expected: PASS — all tests in `patch-edit.spec.ts` green.

- [ ] **Step 8: Commit**

```bash
git add examples/web-harness/vitest.config.ts examples/web-harness/package.json examples/web-harness/package-lock.json examples/web-harness/src/app/rompler/patch-edit.ts examples/web-harness/src/app/rompler/patch-edit.spec.ts
git commit -m "test(harness): add vitest and immutable patch path get/set"
```

---

### Task 2: Structural patch edits — layers, inserts, operators, partials, kind templates

**Files:**
- Modify: `examples/web-harness/src/app/rompler/patch-edit.ts`
- Test: `examples/web-harness/src/app/rompler/patch-edit.spec.ts`

**Interfaces:**
- Consumes: `getAt`, `setAt`, `REFERENCE_PATCH`, `MAX_LAYERS`, `MAX_INSERTS` (Task 1).
- Produces:
  ```ts
  export type GeneratorKind = 'fm' | 'additive' | 'va' | 'sample';
  export type InsertKind = 'chorus' | 'tremolo' | 'phaser' | 'rotary' | 'driveEq' | 'compressor';
  export const GENERATOR_KINDS: readonly GeneratorKind[];
  export const INSERT_KINDS: readonly InsertKind[];
  export function defaultGenerator(kind: GeneratorKind): GeneratorSpec;
  export function defaultInsert(kind: InsertKind): InsertSpec;
  export function addLayer(patch: Patch): Patch;
  export function removeLayer(patch: Patch, index: number): Patch;
  export function moveLayer(patch: Patch, from: number, to: number): Patch;
  export function setGeneratorKind(patch: Patch, layerIndex: number, kind: GeneratorKind): Patch;
  export function addInsert(patch: Patch, kind: InsertKind): Patch;
  export function removeInsert(patch: Patch, index: number): Patch;
  export function moveInsert(patch: Patch, from: number, to: number): Patch;
  export function setInsertKind(patch: Patch, index: number, kind: InsertKind): Patch;
  export function addOperator(patch: Patch, layerIndex: number): Patch;
  export function removeOperator(patch: Patch, layerIndex: number, opIndex: number): Patch;
  export function addPartial(patch: Patch, layerIndex: number): Patch;
  export function removePartial(patch: Patch, layerIndex: number, partialIndex: number): Patch;
  export function voiceCost(patch: Patch): number;
  export const BENCHMARK_VOICE_COST = 3;
  ```
  **Every one of these returns a patch `validatePatch` accepts, or returns the input unchanged when the operation would breach a limit.** That invariant is the task's whole point.

- [ ] **Step 1: Write the failing tests**

First, the existing import from `@allyworld/alloy-audio` at the top of
`patch-edit.spec.ts` only pulls in `validatePatch`. The tests below use `Patch` as
a type, so widen it:

```ts
import { validatePatch, type Patch } from '@allyworld/alloy-audio';
```

Then append to `examples/web-harness/src/app/rompler/patch-edit.spec.ts`:

```ts
import {
  GENERATOR_KINDS,
  INSERT_KINDS,
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

/** A one-layer, no-insert patch to grow from. */
const MINIMAL: Patch = {
  ...REFERENCE_PATCH,
  layers: [REFERENCE_PATCH.layers[0]],
  inserts: [],
};

describe('kind templates', () => {
  it.each(GENERATOR_KINDS)('defaultGenerator(%s) yields a patch the library accepts', (kind) => {
    const next = setGeneratorKind(MINIMAL, 0, kind);
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

  it('defaultInsert returns a spec whose payload key matches its kind', () => {
    for (const kind of INSERT_KINDS) {
      const spec = defaultInsert(kind) as unknown as Record<string, unknown>;
      expect(spec['kind']).toBe(kind);
      expect(spec[kind]).toBeDefined();
    }
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
    expect(BENCHMARK_VOICE_COST).toBe(3);
  });

  it('counts FM operators, additive partials, VA unison voices, and 1 per sample layer', () => {
    // REFERENCE_PATCH: fm(3 ops) + additive(3 partials) + va(unison 3) + sample(1)
    expect(voiceCost(REFERENCE_PATCH)).toBe(3 + 3 + 3 + 1);
  });
});
```

- [ ] **Step 2: Run and watch it fail**

```bash
cd examples/web-harness && npx vitest run
```

Expected: FAIL — `"addLayer" is not exported`.

- [ ] **Step 3: Implement — append to `examples/web-harness/src/app/rompler/patch-edit.ts`**

Add `GeneratorSpec`, `PatchLayer` to the type import from `@allyworld/alloy-audio`, then append:

```ts
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
```

- [ ] **Step 4: Run the tests**

```bash
cd examples/web-harness && npx vitest run
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add examples/web-harness/src/app/rompler/patch-edit.ts examples/web-harness/src/app/rompler/patch-edit.spec.ts
git commit -m "feat(harness): add structural patch edits and kind templates"
```

---

### Task 3: The parameter descriptor table

**Files:**
- Create: `examples/web-harness/src/app/rompler/patch-schema.ts`
- Test: `examples/web-harness/src/app/rompler/patch-schema.spec.ts`

**Interfaces:**
- Consumes: `REFERENCE_PATCH`, `getAt`, `setAt`, `GENERATOR_KINDS`, `INSERT_KINDS` (Tasks 1–2).
- Produces:
  ```ts
  export interface ParamDescriptor {
    path: string;          // ABSOLUTE path into a Patch, e.g. 'layers.0.tvf.cutoffHz'
    label: string;
    kind: 'number' | 'enum' | 'text';
    min?: number; max?: number; step?: number; unit?: string; log?: boolean;
    options?: readonly (string | number)[];   // for kind: 'enum'
  }
  export interface ParamGroup { title: string; params: ParamDescriptor[] }
  export function describePatch(patch: Patch): ParamGroup[];
  export const STRUCTURAL_PATHS: readonly string[];
  ```
  `describePatch` expands the table against a **concrete** patch — one group per layer section, per operator, per partial, per insert — so the UI never has to know the schema.

**Why ranges live here and not in the library:** `validatePatch` enforces what is *legal*; this table declares what is *musical*. The library has no use for the latter, and adding it would create a public, twinned API surface for a private tool's benefit.

- [ ] **Step 1: Write the failing test**

Create `examples/web-harness/src/app/rompler/patch-schema.spec.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { validatePatch, type Patch } from '@allyworld/alloy-audio';
import { REFERENCE_PATCH, getAt, setAt, GENERATOR_KINDS, INSERT_KINDS, setGeneratorKind, addInsert, setInsertKind } from './patch-edit.js';
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

  it('covers every insert kind', () => {
    for (const kind of INSERT_KINDS) {
      const patch = setInsertKind(REFERENCE_PATCH, 0, kind);
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
    for (const p of allParams(REFERENCE_PATCH)) {
      if (p.kind !== 'number' || p.min === undefined) continue;
      const patch = setAt(REFERENCE_PATCH, p.path, p.min);
      expect(validatePatch(patch), `${p.path} at min ${p.min}`).toEqual([]);
    }
  });

  it('every numeric descriptor, pinned to its max, still yields a valid patch', () => {
    for (const p of allParams(REFERENCE_PATCH)) {
      if (p.kind !== 'number' || p.max === undefined) continue;
      const patch = setAt(REFERENCE_PATCH, p.path, p.max);
      expect(validatePatch(patch), `${p.path} at max ${p.max}`).toEqual([]);
    }
  });

  it('every enum descriptor, set to each of its options, yields a valid patch', () => {
    for (const p of allParams(REFERENCE_PATCH)) {
      if (p.kind !== 'enum' || !p.options) continue;
      for (const option of p.options) {
        const patch = setAt(REFERENCE_PATCH, p.path, option);
        expect(validatePatch(patch), `${p.path} = ${String(option)}`).toEqual([]);
      }
    }
  });

  it('every numeric descriptor declares BOTH bounds — a half-open slider is a bug', () => {
    const halfOpen = allParams(REFERENCE_PATCH).filter(
      (p) => p.kind === 'number' && (p.min === undefined || p.max === undefined),
    );
    expect(halfOpen.map((p) => p.path)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run and watch it fail**

```bash
cd examples/web-harness && npx vitest run patch-schema
```

Expected: FAIL — cannot resolve `./patch-schema.js`.

- [ ] **Step 3: Implement `examples/web-harness/src/app/rompler/patch-schema.ts`**

```ts
// The parameter descriptor table. This is what the editor UI renders — it knows
// nothing about the Patch schema beyond what describePatch() hands it.
//
// RANGES HERE ARE MUSICAL, NOT LEGAL. validatePatch enforces what is legal (a
// route's `from` must exceed its `to`); this table declares what is useful to
// turn a knob through. Where the library DOES impose a bound, this table must
// stay inside it — patch-schema.spec.ts's bounds-safety tests enforce that, and
// they are the reason the editor cannot build a patch the engine would throw on.
import type { Patch } from '@allyworld/alloy-audio';

export interface ParamDescriptor {
  /** Absolute path into a Patch, e.g. 'layers.0.tvf.cutoffHz'. */
  path: string;
  label: string;
  kind: 'number' | 'enum' | 'text';
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  /** Render with a logarithmic taper (frequencies). */
  log?: boolean;
  options?: readonly (string | number)[];
}

export interface ParamGroup {
  title: string;
  params: ParamDescriptor[];
}

/** Leaf paths with bespoke structural UI rather than a generic control — the
 *  editor handles them with dedicated widgets (kind pickers, a route matrix, a
 *  carrier checkbox row). Regexes, matched against a full leaf path.
 *  Anything NOT listed here MUST have a descriptor: patch-schema.spec.ts fails
 *  otherwise, which is what stops this table going stale as the schema grows. */
export const STRUCTURAL_PATHS: readonly string[] = [
  '^schemaVersion$',
  '^meta\\.', // id / name / category / gmProgram — a header form, not knobs
  '\\.generator\\.kind$',
  '\\.generator\\.seed$', // VA PRNG seed: an identity, not a knob
  '\\.algorithm\\.routes\\.', // the FM route matrix
  '\\.algorithm\\.carriers\\.', // the FM carrier row
  '^inserts\\.\\d+\\.kind$',
];

const num = (
  path: string,
  label: string,
  min: number,
  max: number,
  step: number,
  extra: Partial<ParamDescriptor> = {},
): ParamDescriptor => ({ path, label, kind: 'number', min, max, step, ...extra });

const enumOf = (path: string, label: string, options: readonly (string | number)[]): ParamDescriptor => ({
  path,
  label,
  kind: 'enum',
  options,
});

/** ADSR is the same four fields everywhere it appears (operator, TVF, TVA). */
function adsrParams(base: string): ParamDescriptor[] {
  return [
    num(`${base}.attack`, 'Attack', 0, 10, 0.001, { unit: 's' }),
    num(`${base}.decay`, 'Decay', 0, 10, 0.001, { unit: 's' }),
    num(`${base}.sustain`, 'Sustain', 0, 1, 0.01),
    num(`${base}.release`, 'Release', 0, 10, 0.001, { unit: 's' }),
  ];
}

function generatorGroups(patch: Patch, li: number): ParamGroup[] {
  const layer = patch.layers[li];
  const g = layer.generator;
  const base = `layers.${li}.generator`;

  switch (g.kind) {
    case 'fm': {
      const groups: ParamGroup[] = g.fm.operators.map((_, oi) => ({
        title: `Operator ${oi + 1}`,
        params: [
          // Ratio's ceiling is musical: 32 x a top-octave fundamental is far past
          // Nyquist, but phase 3c's adaptive oversampling now renders it cleanly.
          num(`${base}.fm.operators.${oi}.ratio`, 'Ratio', 0.25, 32, 0.01),
          num(`${base}.fm.operators.${oi}.level`, 'Level', 0, 10, 0.01),
          ...adsrParams(`${base}.fm.operators.${oi}.adsr`),
        ],
      }));
      if (g.fm.algorithm.feedback) {
        groups.push({
          title: 'Feedback',
          params: [
            num(`${base}.fm.algorithm.feedback.op`, 'Operator', 0, g.fm.operators.length - 1, 1),
            num(`${base}.fm.algorithm.feedback.amount`, 'Amount', 0, 2, 0.01, { unit: 'cyc' }),
          ],
        });
      }
      return groups;
    }
    case 'additive':
      return [
        {
          title: 'Partials',
          params: g.partials.flatMap((_, pi) => [
            num(`${base}.partials.${pi}.ratio`, `${pi + 1}: Ratio`, 0.25, 32, 0.01),
            num(`${base}.partials.${pi}.level`, `${pi + 1}: Level`, 0, 2, 0.01),
          ]),
        },
      ];
    case 'va': {
      const params = [
        enumOf(`${base}.va.shape`, 'Shape', ['sine', 'saw', 'pulse']),
        num(`${base}.va.unison`, 'Unison', 1, 8, 1),
        num(`${base}.va.detuneCents`, 'Detune', 0, 100, 0.1, { unit: '¢' }),
      ];
      if (g.va.pulseWidth !== undefined) {
        params.push(num(`${base}.va.pulseWidth`, 'Pulse width', 0.05, 0.95, 0.01));
      }
      return [{ title: 'Virtual analog', params }];
    }
    case 'sample':
      return [
        {
          title: 'Sample',
          params: [
            { path: `${base}.zoneSetId`, label: 'Zone set', kind: 'text' },
            num(`${base}.crossfade`, 'Crossfade', 0, 1, 0.01),
          ],
        },
      ];
  }
}

function insertGroup(patch: Patch, ii: number): ParamGroup {
  const insert = (patch.inserts ?? [])[ii];
  const base = `inserts.${ii}`;
  // Every bound below mirrors validateInsert in dsp/effects/effect-types.ts.
  switch (insert.kind) {
    case 'chorus':
      return {
        title: `Insert ${ii + 1}: Chorus`,
        params: [
          enumOf(`${base}.chorus.mode`, 'Mode', ['chorus', 'ensemble']),
          num(`${base}.chorus.rateHz`, 'Rate', 0.01, 20, 0.01, { unit: 'Hz' }),
          // depthMs must stay within BASE_DELAY_MS (7): a larger depth makes the
          // swept delay negative, i.e. acausal, and validateInsert rejects it.
          num(`${base}.chorus.depthMs`, 'Depth', 0.1, 7, 0.1, { unit: 'ms' }),
          num(`${base}.chorus.mix`, 'Mix', 0, 1, 0.01),
        ],
      };
    case 'tremolo':
      return {
        title: `Insert ${ii + 1}: Tremolo`,
        params: [
          num(`${base}.tremolo.rateHz`, 'Rate', 0.01, 40, 0.01, { unit: 'Hz' }),
          num(`${base}.tremolo.depth`, 'Depth', 0, 1, 0.01),
          num(`${base}.tremolo.spread`, 'Auto-pan', 0, 1, 0.01),
        ],
      };
    case 'phaser':
      return {
        title: `Insert ${ii + 1}: Phaser`,
        params: [
          enumOf(`${base}.phaser.stages`, 'Stages', [4, 8]),
          num(`${base}.phaser.rateHz`, 'Rate', 0.01, 10, 0.01, { unit: 'Hz' }),
          num(`${base}.phaser.depth`, 'Depth', 0, 1, 0.01),
          num(`${base}.phaser.feedback`, 'Feedback', 0, 0.9, 0.01),
          num(`${base}.phaser.mix`, 'Mix', 0, 1, 0.01),
        ],
      };
    case 'rotary':
      return {
        title: `Insert ${ii + 1}: Rotary`,
        params: [
          enumOf(`${base}.rotary.speed`, 'Speed', ['slow', 'fast']),
          num(`${base}.rotary.depth`, 'Depth', 0, 1, 0.01),
          num(`${base}.rotary.mix`, 'Mix', 0, 1, 0.01),
        ],
      };
    case 'driveEq':
      return {
        title: `Insert ${ii + 1}: Drive EQ`,
        params: [
          num(`${base}.driveEq.drive`, 'Drive', 0, 1, 0.01),
          num(`${base}.driveEq.lowDb`, 'Low', -12, 12, 0.1, { unit: 'dB' }),
          num(`${base}.driveEq.midDb`, 'Mid', -12, 12, 0.1, { unit: 'dB' }),
          num(`${base}.driveEq.highDb`, 'High', -12, 12, 0.1, { unit: 'dB' }),
          num(`${base}.driveEq.levelDb`, 'Level', -12, 12, 0.1, { unit: 'dB' }),
        ],
      };
    case 'compressor':
      return {
        title: `Insert ${ii + 1}: Compressor`,
        params: [
          num(`${base}.compressor.thresholdDb`, 'Threshold', -60, 0, 0.1, { unit: 'dB' }),
          num(`${base}.compressor.ratio`, 'Ratio', 1, 20, 0.1),
          num(`${base}.compressor.attackMs`, 'Attack', 0.1, 100, 0.1, { unit: 'ms' }),
          num(`${base}.compressor.releaseMs`, 'Release', 1, 1000, 1, { unit: 'ms' }),
          num(`${base}.compressor.makeupDb`, 'Makeup', 0, 24, 0.1, { unit: 'dB' }),
        ],
      };
  }
}

/** Expands the table against a CONCRETE patch: one set of groups per layer, per
 *  operator, per partial, per insert. The UI renders exactly what comes back. */
export function describePatch(patch: Patch): ParamGroup[] {
  const groups: ParamGroup[] = [];

  patch.layers.forEach((layer, li) => {
    groups.push({
      title: `Layer ${li + 1}: Range`,
      params: [
        num(`layers.${li}.keyRange.lowMidi`, 'Key low', 0, 127, 1),
        num(`layers.${li}.keyRange.highMidi`, 'Key high', 0, 127, 1),
        num(`layers.${li}.velRange.low`, 'Vel low', 0, 1, 0.01),
        num(`layers.${li}.velRange.high`, 'Vel high', 0, 1, 0.01),
      ],
    });

    groups.push(...generatorGroups(patch, li));

    if (layer.tvf) {
      const tvf = [
        enumOf(`layers.${li}.tvf.mode`, 'Mode', ['lowpass', 'bandpass', 'highpass']),
        num(`layers.${li}.tvf.cutoffHz`, 'Cutoff', 20, 20000, 1, { unit: 'Hz', log: true }),
        num(`layers.${li}.tvf.q`, 'Resonance', 0.5, 20, 0.01),
        num(`layers.${li}.tvf.envAmountHz`, 'Env amount', 0, 20000, 1, { unit: 'Hz' }),
        num(`layers.${li}.tvf.keyTrack`, 'Key track', 0, 2, 0.01),
        num(`layers.${li}.tvf.velAmountHz`, 'Vel amount', 0, 20000, 1, { unit: 'Hz' }),
      ];
      if (layer.tvf.env) tvf.push(...adsrParams(`layers.${li}.tvf.env`));
      groups.push({ title: `Layer ${li + 1}: Filter`, params: tvf });
    }

    groups.push({
      title: `Layer ${li + 1}: Amp`,
      params: [
        // tva.level must stay > 0 (validatePatch); 0.01 is the smallest audible step.
        num(`layers.${li}.tva.level`, 'Level', 0.01, 2, 0.01),
        num(`layers.${li}.tva.velCurve`, 'Vel curve', 0.1, 4, 0.05),
        ...adsrParams(`layers.${li}.tva.adsr`),
      ],
    });

    if (layer.mod) {
      groups.push({
        title: `Layer ${li + 1}: LFO`,
        params: [
          enumOf(`layers.${li}.mod.lfo.shape`, 'Shape', ['sine', 'triangle']),
          num(`layers.${li}.mod.lfo.rateHz`, 'Rate', 0.01, 20, 0.01, { unit: 'Hz' }),
          num(`layers.${li}.mod.lfo.delay`, 'Delay', 0, 5, 0.01, { unit: 's' }),
          num(`layers.${li}.mod.lfo.fadeIn`, 'Fade in', 0, 5, 0.01, { unit: 's' }),
          // Pitch depth feeds phase 3c's K-selection: a deep vibrato makes the FM
          // generator oversample, which is correct and costs CPU. See the 3c spec.
          num(`layers.${li}.mod.toPitchCents`, 'To pitch', -1200, 1200, 1, { unit: '¢' }),
          num(`layers.${li}.mod.toCutoffHz`, 'To cutoff', -10000, 10000, 1, { unit: 'Hz' }),
          num(`layers.${li}.mod.toAmpDepth`, 'To amp', 0, 1, 0.01),
        ],
      });
    }
  });

  (patch.inserts ?? []).forEach((_, ii) => groups.push(insertGroup(patch, ii)));

  groups.push({
    title: 'Sends',
    params: [
      num('sends.reverb', 'Reverb', 0, 1, 0.01),
      num('sends.delay', 'Delay', 0, 1, 0.01),
    ],
  });

  return groups;
}
```

- [ ] **Step 4: Run the tests**

```bash
cd examples/web-harness && npx vitest run
```

Expected: PASS — including the coverage test, which proves no leaf of a fully-populated patch is silently uneditable.

If the coverage test fails, **do not add a regex to `STRUCTURAL_PATHS` to silence it** — that is exactly the failure mode the test exists to prevent. Add the missing descriptor. Only add a structural pattern if the field genuinely needs bespoke UI, and say so in the report.

- [ ] **Step 5: Commit**

```bash
git add examples/web-harness/src/app/rompler/patch-schema.ts examples/web-harness/src/app/rompler/patch-schema.spec.ts
git commit -m "feat(harness): add the patch parameter descriptor table"
```

---

### Task 4: Serialization — the bridge to phase 4b

**Files:**
- Create: `examples/web-harness/src/app/rompler/patch-serialize.ts`
- Test: `examples/web-harness/src/app/rompler/patch-serialize.spec.ts`

**Interfaces:**
- Consumes: `REFERENCE_PATCH`, `setGeneratorKind`, `setInsertKind`, `GENERATOR_KINDS`, `INSERT_KINDS` (Tasks 1–2).
- Produces:
  ```ts
  export function toTypeScriptLiteral(patch: Patch): string;                 // just the object literal
  export function toTypeScript(patch: Patch, constName: string): string;     // a full `export const ...` statement
  export function toJson(patch: Patch): string;
  export function fromJson(text: string): { patch: Patch } | { errors: string[] };
  ```

**Why this task is load-bearing:** phase 4b's factory bank is authored *by pasting this output*. A lossy exporter means the shipped bank silently differs from the sound the user approved. The round-trip test is the guarantee.

- [ ] **Step 1: Write the failing test**

Create `examples/web-harness/src/app/rompler/patch-serialize.spec.ts`:

```ts
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
```

- [ ] **Step 2: Run and watch it fail**

```bash
cd examples/web-harness && npx vitest run patch-serialize
```

Expected: FAIL — cannot resolve `./patch-serialize.js`.

- [ ] **Step 3: Implement `examples/web-harness/src/app/rompler/patch-serialize.ts`**

```ts
// Export a tuned patch out of the workbench and back in.
//
// toTypeScript() IS the bridge to phase 4b: the factory bank is authored by
// pasting this output into factory-bank.ts. If the emitter is lossy, the bank
// silently differs from the sound the user approved — which is why
// patch-serialize.spec.ts evaluates every emitted literal back and compares it
// to the original, for every generator and insert kind.
import { validatePatch, type Patch } from '@allyworld/alloy-audio';

const INDENT = '  ';

/** JS identifiers can be bare keys; anything else must be quoted. */
function formatKey(key: string): string {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(key) ? key : JSON.stringify(key);
}

function formatValue(value: unknown, depth: number): string {
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (value === null) return 'null';

  const pad = INDENT.repeat(depth + 1);
  const closePad = INDENT.repeat(depth);

  if (Array.isArray(value)) {
    if (value.length === 0) return '[]';
    const items = value.map((item) => `${pad}${formatValue(item, depth + 1)},`);
    return `[\n${items.join('\n')}\n${closePad}]`;
  }

  // Drop undefined-valued keys: an optional field that is absent must stay
  // absent, not become `tvf: undefined` (which is not even valid in a literal
  // the way the engine expects, and would not deep-equal the original).
  const entries = Object.entries(value as Record<string, unknown>).filter(([, v]) => v !== undefined);
  if (entries.length === 0) return '{}';
  const lines = entries.map(([k, v]) => `${pad}${formatKey(k)}: ${formatValue(v, depth + 1)},`);
  return `{\n${lines.join('\n')}\n${closePad}}`;
}

/** The bare object literal — valid TypeScript AND valid JavaScript. */
export function toTypeScriptLiteral(patch: Patch): string {
  return formatValue(patch, 0);
}

/** A paste-ready `export const <name>: Patch = { ... };` for 4b's factory bank. */
export function toTypeScript(patch: Patch, constName: string): string {
  return `export const ${constName}: Patch = ${toTypeScriptLiteral(patch)};\n`;
}

export function toJson(patch: Patch): string {
  return JSON.stringify(patch, null, 2);
}

/** Never throws: bad input is a user typo, not a crash. */
export function fromJson(text: string): { patch: Patch } | { errors: string[] } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    return { errors: [`not valid JSON: ${(error as Error).message}`] };
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { errors: ['not a patch object'] };
  }
  const errors = validatePatch(parsed as Patch);
  if (errors.length > 0) return { errors };
  return { patch: parsed as Patch };
}
```

- [ ] **Step 4: Run the tests**

```bash
cd examples/web-harness && npx vitest run
```

Expected: PASS — all three spec files green.

- [ ] **Step 5: Commit**

```bash
git add examples/web-harness/src/app/rompler/patch-serialize.ts examples/web-harness/src/app/rompler/patch-serialize.spec.ts
git commit -m "feat(harness): emit and parse patches for the 4b factory bank"
```

---

### Task 5: The editor component

**Files:**
- Create: `examples/web-harness/src/app/rompler/patch-editor.component.ts`

**Interfaces:**
- Consumes: everything from `patch-edit.ts` and `patch-schema.ts`.
- Produces:
  ```ts
  @Component({ selector: 'app-patch-editor', standalone: true, ... })
  export class PatchEditorComponent {
    readonly patch = input.required<Patch>();
    readonly errors = input<readonly string[]>([]);
    readonly patchChange = output<Patch>();   // emits the NEXT patch on every edit
  }
  ```
  The component is **stateless** with respect to the patch: it renders `patch()` and emits a new one. All state (A/B slots, persistence, the host) lives in the section (Task 6). That is what keeps the A/B slots from aliasing.

**Not unit-tested** — the harness's components never have been, and the logic worth testing already lives in the three pure modules. Verify by serving the harness.

- [ ] **Step 1: Implement the component**

Create `examples/web-harness/src/app/rompler/patch-editor.component.ts`:

```ts
import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import type { Patch } from '@allyworld/alloy-audio';
import {
  BENCHMARK_VOICE_COST,
  GENERATOR_KINDS,
  INSERT_KINDS,
  MAX_INSERTS,
  MAX_LAYERS,
  addInsert,
  addLayer,
  addOperator,
  addPartial,
  getAt,
  moveInsert,
  removeInsert,
  removeLayer,
  removeOperator,
  removePartial,
  setAt,
  setGeneratorKind,
  setInsertKind,
  voiceCost,
  type GeneratorKind,
  type InsertKind,
} from './patch-edit.js';
import { describePatch, type ParamDescriptor } from './patch-schema.js';

/** Renders a Patch entirely from describePatch(). It knows nothing about the
 *  patch schema — add a field to the descriptor table and it appears here. */
@Component({
  selector: 'app-patch-editor',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="editor">
      <header class="editor__bar">
        <span class="editor__cost" [class.editor__cost--heavy]="cost() > BENCHMARK_VOICE_COST">
          Voice cost {{ cost() }} &mdash; the CPU-benchmarked patch is {{ BENCHMARK_VOICE_COST }}
        </span>
      </header>

      @if (errors().length > 0) {
        <ul class="editor__errors">
          @for (error of errors(); track error) {
            <li>{{ error }}</li>
          }
        </ul>
      }

      <div class="editor__structure">
        <button type="button" [disabled]="patch().layers.length >= MAX_LAYERS" (click)="onAddLayer()">
          + Layer
        </button>
        @for (layer of patch().layers; track $index) {
          <span class="editor__chip">
            L{{ $index + 1 }}
            <select
              [value]="layer.generator.kind"
              (change)="onGeneratorKind($index, $any($event.target).value)"
            >
              @for (kind of GENERATOR_KINDS; track kind) {
                <option [value]="kind">{{ kind }}</option>
              }
            </select>
            @if (layer.generator.kind === 'fm') {
              <button type="button" (click)="onAddOperator($index)">+op</button>
              <button type="button" (click)="onRemoveOperator($index)">-op</button>
            }
            @if (layer.generator.kind === 'additive') {
              <button type="button" (click)="onAddPartial($index)">+partial</button>
              <button type="button" (click)="onRemovePartial($index)">-partial</button>
            }
            <button type="button" [disabled]="patch().layers.length <= 1" (click)="onRemoveLayer($index)">
              &times;
            </button>
          </span>
        }
      </div>

      <div class="editor__structure">
        <select #insertKind>
          @for (kind of INSERT_KINDS; track kind) {
            <option [value]="kind">{{ kind }}</option>
          }
        </select>
        <button
          type="button"
          [disabled]="(patch().inserts?.length ?? 0) >= MAX_INSERTS"
          (click)="onAddInsert($any(insertKind).value)"
        >
          + Insert
        </button>
        @for (insert of patch().inserts ?? []; track $index) {
          <span class="editor__chip">
            <select [value]="insert.kind" (change)="onInsertKind($index, $any($event.target).value)">
              @for (kind of INSERT_KINDS; track kind) {
                <option [value]="kind">{{ kind }}</option>
              }
            </select>
            <button type="button" [disabled]="$index === 0" (click)="onMoveInsert($index, $index - 1)">
              &uarr;
            </button>
            <button type="button" (click)="onRemoveInsert($index)">&times;</button>
          </span>
        }
      </div>

      @for (group of groups(); track group.title) {
        <section class="editor__group">
          <h4>{{ group.title }}</h4>
          @for (param of group.params; track param.path) {
            <label class="editor__param">
              <span class="editor__label">{{ param.label }}</span>
              @if (param.kind === 'number') {
                <input
                  type="range"
                  [min]="param.min ?? 0"
                  [max]="param.max ?? 1"
                  [step]="param.step ?? 0.01"
                  [value]="numberAt(param)"
                  (input)="onNumber(param, $any($event.target).value)"
                />
                <span class="editor__value">{{ numberAt(param) }}{{ param.unit ?? '' }}</span>
              } @else if (param.kind === 'enum') {
                <select [value]="valueAt(param)" (change)="onEnum(param, $any($event.target).value)">
                  @for (option of param.options ?? []; track option) {
                    <option [value]="option">{{ option }}</option>
                  }
                </select>
              } @else {
                <input
                  type="text"
                  [value]="valueAt(param)"
                  (change)="onText(param, $any($event.target).value)"
                />
              }
            </label>
          }
        </section>
      }
    </div>
  `,
  styles: `
    .editor { display: flex; flex-direction: column; gap: 0.75rem; }
    .editor__bar { display: flex; justify-content: space-between; font-size: 0.8rem; opacity: 0.8; }
    .editor__cost--heavy { color: #d08a30; font-weight: 600; }
    .editor__errors { color: #d05050; font-size: 0.8rem; margin: 0; padding-left: 1rem; }
    .editor__structure { display: flex; flex-wrap: wrap; gap: 0.4rem; align-items: center; }
    .editor__chip { display: inline-flex; align-items: center; gap: 0.25rem; padding: 0.15rem 0.4rem;
      border: 1px solid currentColor; border-radius: 4px; font-size: 0.75rem; opacity: 0.9; }
    .editor__group { display: grid; grid-template-columns: repeat(auto-fill, minmax(15rem, 1fr)); gap: 0.35rem; }
    .editor__group h4 { grid-column: 1 / -1; margin: 0.5rem 0 0; font-size: 0.8rem; text-transform: uppercase; opacity: 0.7; }
    .editor__param { display: grid; grid-template-columns: 6rem 1fr 4rem; align-items: center; gap: 0.4rem; font-size: 0.75rem; }
    .editor__value { text-align: right; font-variant-numeric: tabular-nums; opacity: 0.7; }
  `,
})
export class PatchEditorComponent {
  readonly patch = input.required<Patch>();
  readonly errors = input<readonly string[]>([]);
  readonly patchChange = output<Patch>();

  protected readonly GENERATOR_KINDS = GENERATOR_KINDS;
  protected readonly INSERT_KINDS = INSERT_KINDS;
  protected readonly MAX_LAYERS = MAX_LAYERS;
  protected readonly MAX_INSERTS = MAX_INSERTS;
  protected readonly BENCHMARK_VOICE_COST = BENCHMARK_VOICE_COST;

  protected readonly groups = computed(() => describePatch(this.patch()));
  protected readonly cost = computed(() => voiceCost(this.patch()));

  protected valueAt(param: ParamDescriptor): string {
    return String(getAt(this.patch(), param.path) ?? '');
  }

  protected numberAt(param: ParamDescriptor): number {
    return Number(getAt(this.patch(), param.path) ?? 0);
  }

  protected onNumber(param: ParamDescriptor, raw: string): void {
    this.patchChange.emit(setAt(this.patch(), param.path, Number(raw)));
  }

  protected onEnum(param: ParamDescriptor, raw: string): void {
    // Enum options are strings or numbers (phaser.stages is 4 | 8); a <select>
    // hands back a string either way, so restore the option's original type.
    const option = (param.options ?? []).find((o) => String(o) === raw) ?? raw;
    this.patchChange.emit(setAt(this.patch(), param.path, option));
  }

  protected onText(param: ParamDescriptor, raw: string): void {
    this.patchChange.emit(setAt(this.patch(), param.path, raw));
  }

  protected onAddLayer(): void {
    this.patchChange.emit(addLayer(this.patch()));
  }

  protected onRemoveLayer(index: number): void {
    this.patchChange.emit(removeLayer(this.patch(), index));
  }

  protected onGeneratorKind(index: number, kind: string): void {
    this.patchChange.emit(setGeneratorKind(this.patch(), index, kind as GeneratorKind));
  }

  protected onAddOperator(index: number): void {
    this.patchChange.emit(addOperator(this.patch(), index));
  }

  protected onRemoveOperator(index: number): void {
    const generator = this.patch().layers[index].generator;
    if (generator.kind !== 'fm') return;
    this.patchChange.emit(removeOperator(this.patch(), index, generator.fm.operators.length - 1));
  }

  protected onAddPartial(index: number): void {
    this.patchChange.emit(addPartial(this.patch(), index));
  }

  protected onRemovePartial(index: number): void {
    const generator = this.patch().layers[index].generator;
    if (generator.kind !== 'additive') return;
    this.patchChange.emit(removePartial(this.patch(), index, generator.partials.length - 1));
  }

  protected onAddInsert(kind: string): void {
    this.patchChange.emit(addInsert(this.patch(), kind as InsertKind));
  }

  protected onRemoveInsert(index: number): void {
    this.patchChange.emit(removeInsert(this.patch(), index));
  }

  protected onMoveInsert(from: number, to: number): void {
    this.patchChange.emit(moveInsert(this.patch(), from, to));
  }

  protected onInsertKind(index: number, kind: string): void {
    this.patchChange.emit(setInsertKind(this.patch(), index, kind as InsertKind));
  }
}
```

- [ ] **Step 2: Verify it compiles**

```bash
cd examples/web-harness && npx ng build
```

Expected: build succeeds. (The component is not yet rendered anywhere — Task 6 wires it in. A build error here is a type error to fix now.)

- [ ] **Step 3: Commit**

```bash
git add examples/web-harness/src/app/rompler/patch-editor.component.ts
git commit -m "feat(harness): add the descriptor-driven patch editor component"
```

---

### Task 6: Wire the editor into the rompler section — A/B slots, re-strike, export

**Files:**
- Modify: `examples/web-harness/src/app/sections/rompler-section.component.ts`

**Interfaces:**
- Consumes: `PatchEditorComponent` (Task 5), `toTypeScript` / `toJson` / `fromJson` (Task 4), the existing `WorkletSynthHost` wiring and `PATCH_CATALOG` already in this file.

**The three mechanics, all landing here:**

1. **Apply + re-strike.** On every `patchChange`: run `validatePatch`. If it returns errors, show them in the editor and **do not call `host.setPatch()`** — `PatchEngine.setPatch` *throws* on an invalid patch. If valid, `host.setPatch(next)` and, when re-strike is on, replay the last-played note. A `Voice` captures its generator/TVF/TVA params at `noteOn`, so a knob turn is inaudible on a sustaining note; inserts and sends *do* apply live.
2. **A/B slots.** Two independent patches. `setAt` shares untouched subtrees but never mutates, so the slots cannot alias each other.
3. **Export/import + persistence.** Copy as TS (for 4b), copy as JSON, paste to import, localStorage autosave, revert to catalog.

- [ ] **Step 1: Add the editor's state to the component class**

In `examples/web-harness/src/app/sections/rompler-section.component.ts`, add these imports:

```ts
import { PatchEditorComponent } from '../rompler/patch-editor.component.js';
import { fromJson, toJson, toTypeScript } from '../rompler/patch-serialize.js';
import { validatePatch } from '@allyworld/alloy-audio';
```

Add `PatchEditorComponent` to the component's `imports` array.

Add to the class body (alongside the existing signals):

```ts
  /** Two independent slots. setAt() never mutates, so A and B cannot alias. */
  protected readonly slotA = signal<Patch>(this.currentEntry().patch);
  protected readonly slotB = signal<Patch>(this.currentEntry().patch);
  protected readonly activeSlot = signal<'A' | 'B'>('A');
  protected readonly editorErrors = signal<readonly string[]>([]);
  /** A knob turn is inaudible on a sustaining note — voices capture their
   *  generator/TVF/TVA params at noteOn. So replay the last note on every edit. */
  protected readonly reStrike = signal(true);
  protected readonly exportNotice = signal('');
  private lastNote = 60;

  protected readonly editedPatch = computed(() =>
    this.activeSlot() === 'A' ? this.slotA() : this.slotB(),
  );

  private readonly storageKey = computed(() => `alloy.workbench.${this.patchId()}`);
```

- [ ] **Step 2: Implement apply + re-strike**

```ts
  protected onPatchChange(next: Patch): void {
    (this.activeSlot() === 'A' ? this.slotA : this.slotB).set(next);

    // PatchEngine.setPatch THROWS on an invalid patch. Surface the errors and
    // keep the last good patch sounding rather than tearing down the audio.
    const errors = validatePatch(next);
    this.editorErrors.set(errors);
    if (errors.length > 0) return;

    this.host?.setPatch(next);
    localStorage.setItem(this.storageKey(), toJson(next));
    if (this.reStrike()) this.strikeLastNote();
  }

  private strikeLastNote(): void {
    const midi = this.lastNote;
    void this.ensureHost().then((host) => {
      host?.noteOff(midi);
      host?.noteOn(midi, this.currentEntry().velocity);
    });
  }

  protected swapSlot(): void {
    this.activeSlot.update((slot) => (slot === 'A' ? 'B' : 'A'));
    const patch = this.editedPatch();
    this.editorErrors.set(validatePatch(patch));
    this.host?.setPatch(patch);
    if (this.reStrike()) this.strikeLastNote();
  }

  protected copyActiveToOther(): void {
    const patch = this.editedPatch();
    (this.activeSlot() === 'A' ? this.slotB : this.slotA).set(patch);
  }

  protected revertToCatalog(): void {
    const patch = this.currentEntry().patch;
    (this.activeSlot() === 'A' ? this.slotA : this.slotB).set(patch);
    localStorage.removeItem(this.storageKey());
    this.editorErrors.set([]);
    this.host?.setPatch(patch);
  }
```

Then, in the **existing** `noteOn(midi)` method, record the note so re-strike has something to replay. Add as its first statement:

```ts
    this.lastNote = midi;
```

And in the **existing** `setPatch(id)` method (which switches catalog entry), reset both slots and load any saved edit — add after the existing body:

```ts
    const saved = localStorage.getItem(this.storageKey());
    const restored = saved ? fromJson(saved) : null;
    const patch = restored && 'patch' in restored ? restored.patch : this.currentEntry().patch;
    this.slotA.set(patch);
    this.slotB.set(this.currentEntry().patch);
    this.activeSlot.set('A');
    this.editorErrors.set([]);
    this.host?.setPatch(patch);
```

- [ ] **Step 3: Implement export and import**

```ts
  protected async copyAsTs(): Promise<void> {
    // This is the bridge to phase 4b: the factory bank is authored by pasting
    // this output into factory-bank.ts.
    const name = this.currentEntry().patch.meta.id.replace(/[^A-Za-z0-9]+/g, '_').toUpperCase();
    await navigator.clipboard.writeText(toTypeScript(this.editedPatch(), name));
    this.exportNotice.set('Copied as TypeScript');
  }

  protected async copyAsJson(): Promise<void> {
    await navigator.clipboard.writeText(toJson(this.editedPatch()));
    this.exportNotice.set('Copied as JSON');
  }

  protected async pasteFromJson(): Promise<void> {
    const text = await navigator.clipboard.readText();
    const result = fromJson(text);
    if ('errors' in result) {
      this.editorErrors.set(result.errors);
      this.exportNotice.set('Paste rejected');
      return;
    }
    this.exportNotice.set('Imported from JSON');
    this.onPatchChange(result.patch);
  }
```

- [ ] **Step 4: Add the editor to the template**

In the component's `template`, after the existing patch-selector markup, add:

```html
        <div class="rompler__workbench">
          <div class="rompler__slots">
            <button type="button" (click)="swapSlot()">Slot {{ activeSlot() }} — compare</button>
            <button type="button" (click)="copyActiveToOther()">
              Copy {{ activeSlot() }} &rarr; {{ activeSlot() === 'A' ? 'B' : 'A' }}
            </button>
            <label>
              <input type="checkbox" [checked]="reStrike()" (change)="reStrike.set($any($event.target).checked)" />
              Re-strike on edit
            </label>
            <button type="button" (click)="copyAsTs()">Copy as TS</button>
            <button type="button" (click)="copyAsJson()">Copy as JSON</button>
            <button type="button" (click)="pasteFromJson()">Paste JSON</button>
            <button type="button" (click)="revertToCatalog()">Revert</button>
            <span class="rompler__notice">{{ exportNotice() }}</span>
          </div>

          <app-patch-editor
            [patch]="editedPatch()"
            [errors]="editorErrors()"
            (patchChange)="onPatchChange($event)"
          />
        </div>
```

Add to the component's `styles`:

```css
    .rompler__workbench { display: flex; flex-direction: column; gap: 0.6rem; margin-top: 1rem; }
    .rompler__slots { display: flex; flex-wrap: wrap; gap: 0.4rem; align-items: center; font-size: 0.75rem; }
    .rompler__notice { opacity: 0.6; }
```

- [ ] **Step 5: Build, then verify by ear**

```bash
cd examples/web-harness && npx ng build
```

Expected: build succeeds.

Then serve on **your own port — 4205 belongs to the human dev**:

```bash
cd examples/web-harness && npx ng serve --port 4210
```

Manually verify, and report what you observed:
1. Play a note, drag an FM operator's **ratio** — the note re-strikes and the timbre changes.
2. Hold a note (mouse down) and drag **Sends → Reverb** — it changes *without* a re-strike (sends are live).
3. Set **Layer 1 → Amp → Level** to its minimum — the patch stays valid, no error list appears, audio keeps running.
4. Add layers to 4 — the **+ Layer** button disables. Add inserts to 3 — **+ Insert** disables.
5. Switch a layer's generator kind through all four — each is audible, none throws.
6. Click **Copy as TS**, paste it somewhere — it is a complete `export const ...: Patch = {...};`.
7. Switch catalog patch and back — your edit is restored from localStorage. Click **Revert** — it returns to the catalog patch.

- [ ] **Step 6: Record the workbench in the twin contract**

`docs/mirroring.md` is binding for every change, and it must say why this code has
no Swift twin — otherwise a future contributor reads the asymmetry as an
oversight and "fixes" it. There is already a precedent section for deliberately
web-only code (`zone-time`, `MasterChain`, the `tools/samplepack/` pipeline);
follow its wording and placement.

Add an entry stating: the phase-4a patch workbench
(`examples/web-harness/src/app/rompler/`) is **deliberately web-only** and outside
the twin contract. It is a private authoring tool for the phase-4b factory bank,
lives in a harness that is never packed, tagged, or released, and consumes only the
existing public `alloy-audio` API (`Patch`, `validatePatch`, `WorkletSynthHost`).
It adds **no** library surface and requires **no** Swift twin. Do not "fix" this
asymmetry by porting it.

- [ ] **Step 7: Commit**

```bash
git add examples/web-harness/src/app/sections/rompler-section.component.ts docs/mirroring.md
git commit -m "feat(harness): wire the patch editor with A/B slots and re-strike"
```

---

## Done when

- `cd examples/web-harness && npx vitest run` is green: descriptor coverage, bounds safety, and the export round-trip all pass.
- `npx ng build` succeeds.
- The manual checks in Task 6 Step 5 all hold.
- **Nothing under `web/packages/` or `swift/` has changed.** Verify with `git diff --stat main -- web swift` — it must be empty.

Phase 4b then authors the factory bank with this tool, and re-points the 64-voice benchmark at the most expensive patch in the shipped bank.
