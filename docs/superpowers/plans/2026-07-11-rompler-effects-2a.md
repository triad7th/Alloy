# Rompler Effects 2a — Stereo Bus + Identity Inserts — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the rompler engine stereo and give patches their first insert effects — the stereo chorus/ensemble (the identity effect of the whole aesthetic) and tremolo/auto-pan — plus the deferred Apple `AVAudioFormat` fix. Spec: `docs/superpowers/specs/2026-07-10-alloy-rompler-engine-design.md` (Effects section). Phaser/rotary/drive-EQ/compressor are phase 2b; send reverb/delay + limiter + the 64-voice benchmark are phase 2c.

**Architecture:** Voices stay mono. Per patch, the summed mono voice bus feeds an ordered insert chain (0–3 effects) that produces the stereo output: engine renders into L/R scratch per segment (mono copied to both channels at unity when no inserts), each insert processes the stereo scratch in place, then the scratch adds into the caller's L/R buffers. Effects are pure per-sample DSP twins under the same determinism/twin-test regime as everything else. `renderPatch` becomes stereo; golden fixtures re-baseline with L/R probe windows.

**Tech Stack:** unchanged (TS/Vitest canonical; Swift/XCTest twins; AVFoundation only in `PatchEngineHost.swift`).

## Global Constraints

- All prior constraints hold (determinism, twin protocol one commit per task, no formatters, `.js` suffixes, both suites green per commit, capture workflow for twin references at 1e-6 for units / 1e-4 for goldens).
- `schemaVersion` stays 1: `inserts` is an OPTIONAL patch field; every existing patch JSON (including the 1b fixtures verbatim) must keep decoding and validating on both platforms — pinned by test.
- Real-time rules: no allocation in any process path (delay buffers, scratches allocated at construction); no throwing path reachable from render; insert chain rebuilt only in `setPatch` (drain context).
- Behavior note (document, don't "fix"): voices sounding across a `setPatch` render through the NEW patch's insert chain (one shared chain, hardware-like patch transition; per-generation chains are YAGNI).
- Mono compatibility contract: an insert-free patch renders L === R === exactly the old mono output. This is the bridge that keeps most 1b tests meaningful — pinned by test in Task 3.

## File Structure

| File | Responsibility |
|---|---|
| CREATE `web/.../src/dsp/effects/effect-types.ts` | `EffectUnit`, `InsertSpec`, `validateInsert`, `createInsert` factory |
| CREATE `web/.../src/dsp/effects/stereo-chorus.ts` (+spec) | chorus/ensemble (modulated delay taps) |
| CREATE `web/.../src/dsp/effects/tremolo-auto-pan.ts` (+spec) | tremolo/auto-pan |
| MODIFY `src/dsp/patch.ts`, `src/dsp/patch-engine.ts`, `src/dsp/testing/golden-patches.ts`, `worklet-host-core.ts`, `worklet/alloy-patch-processor.ts` | inserts field; stereo engine; stereo goldens; stereo hosts |
| Swift twins | `DSP/Effects/EffectTypes.swift`, `StereoChorus.swift`, `TremoloAutoPan.swift`; `Patch.swift`, `PatchEngine.swift`, `PatchEngineHost.swift`, fixtures/tests |

---

### Task 1: Effect infrastructure + StereoChorus

**Files:**
- Create: `web/packages/alloy-audio/src/dsp/effects/effect-types.ts`, `stereo-chorus.ts`, `stereo-chorus.spec.ts`; modify `index.ts`
- Create: `swift/Sources/AlloyAudio/DSP/Effects/EffectTypes.swift`, `StereoChorus.swift`; test `StereoChorusTests.swift`

**Interfaces:**

```ts
// effect-types.ts
/** Stereo in-place processor. process() must not allocate or throw. */
export interface EffectUnit {
  process(left: Float32Array, right: Float32Array, frames: number): void;
  /** Clear all internal state (delay lines, phases). */
  reset(): void;
}

export interface ChorusParams {
  mode: 'chorus' | 'ensemble';
  rateHz: number;   // LFO rate
  depthMs: number;  // peak delay deviation
  mix: number;      // 0..1 wet
}
export interface TremoloParams { rateHz: number; depth: number; spread: number } // spread 0=tremolo .. 1=auto-pan

export type InsertSpec =
  | { kind: 'chorus'; chorus: ChorusParams }
  | { kind: 'tremolo'; tremolo: TremoloParams };

export const MAX_INSERTS = 3;

/** Non-throwing; empty = constructible on both platforms. */
export function validateInsert(spec: InsertSpec): string[];
/** Factory used by the engine at setPatch time. */
export function createInsert(spec: InsertSpec, sampleRate: number): EffectUnit;
```

`validateInsert`: chorus — `rateHz` in (0, 20], `depthMs` in (0, 20], `mix` in [0, 1]; tremolo — `rateHz` in (0, 40], `depth` in [0, 1], `spread` in [0, 1]. (`createInsert`'s tremolo case lands in Task 2; in Task 1 its switch has only the chorus arm — TS exhaustiveness via `never` helper is fine since the union already has both kinds: implement the tremolo arm as a temporary `throw new Error('tremolo lands in task 2')` and REPLACE it in Task 2 — acceptable because createInsert is only reachable through validated patches and no patch can carry tremolo until Task 3 wires inserts into the schema.)

**StereoChorus algorithm (the spec — implement exactly, both twins):**
- Constructor allocates one circular mono delay buffer of `ceil((BASE_DELAY_MS + depthMs + 2) / 1000 * sampleRate)` samples, `BASE_DELAY_MS = 7`.
- Per sample: write `(L[i] + R[i]) / 2` at `writeIndex`; each tap `t` reads at delay `(BASE_DELAY_MS + depthMs * sin(TWO_PI * (phase + OFFSETS[t]))) / 1000 * sampleRate` samples behind `writeIndex` with LINEAR interpolation (fractional index between two buffer reads); `phase += rateHz / sampleRate`, wrapped.
- `mode 'chorus'`: `OFFSETS = [0, 0.25]`; `L' = L*(1-mix) + tap0*mix`, `R' = R*(1-mix) + tap1*mix`.
- `mode 'ensemble'`: `OFFSETS = [0, 1/3, 2/3]`; weights `WL = [0.55, 0.30, 0.15]`, `WR = [0.15, 0.30, 0.55]`; `L' = L*(1-mix) + (Σ WL[t]*tap[t])*mix`, similarly R.
- `reset()`: zero buffer, phase, writeIndex.

- [ ] **Step 1: TS failing tests** (`stereo-chorus.spec.ts`) — write as real code:

```ts
// 1. mix 0 is a perfect bypass: stereo sine input, output === input exactly (toBe per sample, 256 frames).
// 2. Widens mono: feed identical L/R (440 Hz sine, 4800 frames, chorus mode rate 0.8 depth 3 mix 0.5);
//    after 1000 frames warmup, L and R must differ (max |L-R| > 0.01) — the taps are 90° apart.
// 3. Delay bounds: an impulse (1 at frame 0, silence after) with mix 1 produces wet energy only within
//    [ (7-3-0.1)ms, (7+3+0.1)ms ] — scan the output for nonzero samples and assert their index range.
// 4. Ensemble differs from chorus: same input/params except mode; outputs differ (max abs diff > 0.01).
// 5. reset() restores initial state: render A, reset, render A again → identical outputs (exact).
// 6. validateInsert: chorus rateHz 0 / depthMs 25 / mix 1.5 each produce an error; valid params → [].
// 7. TWIN_REFERENCE: chorus mode rate 1.2 depth 2.5 mix 0.6, input L=R=sine 440 vel-like amplitude 0.5,
//    first 8 output L samples AND first 8 R samples after a 512-frame warmup render (two arrays), 1e-6.
```

- [ ] **Step 2: FAIL → Step 3: implement TS** (effect-types + stereo-chorus; export both from index.ts) → PASS → capture twin refs.
- [ ] **Step 4: Swift twins** (`Effects/` subdirectory; `EffectTypes.swift` protocol + `InsertSpec` enum with custom Codable keyed on `kind` following `GeneratorSpec`'s pattern EXCEPT: do NOT add Codable in this task — Codable lands with the schema in Task 3; keep Task 1's Swift enum plain) — mirror tests, paste twin refs. RED = missing types compile failure.
- [ ] **Step 5: both suites green → Commit** `feat(audio): add effect infrastructure and stereo chorus twins`

---

### Task 2: TremoloAutoPan

**Files:** `web/.../src/dsp/effects/tremolo-auto-pan.ts` (+spec), factory arm in `effect-types.ts`; Swift `TremoloAutoPan.swift` (+tests), factory arm.

**Interfaces:** `class TremoloAutoPan implements EffectUnit { constructor(params: TremoloParams, sampleRate: number) }`. Per sample: `gainL = 1 - depth * (0.5 + 0.5 * sin(TWO_PI * phase))`, `gainR = 1 - depth * (0.5 + 0.5 * sin(TWO_PI * phase + Math.PI * spread))`, apply in place, advance/wrap phase. `reset()` zeroes phase. Replace Task 1's temporary factory throw with the real arm (both platforms).

- [ ] **Steps (same shape as Task 1):** failing TS tests — spread 0: L === R exactly (tremolo); spread 1: gains anti-phase (when L gain is at min, R at max — probe at phase quarters using rate 1 Hz and fs 1000 for hand-computable indices); depth 0 is bypass (exact); reset determinism; validateInsert tremolo bounds; TWIN_REFERENCE (rate 5.5, depth 0.7, spread 0.5, sine input, 8 L + 8 R values at 1e-6). Implement TS → Swift twins → both suites → Commit `feat(audio): add tremolo/auto-pan insert twins`

---

### Task 3: Patch schema `inserts` + engine stereo bus

**Files:**
- Modify: `web/.../src/dsp/patch.ts` (+spec), `src/dsp/patch-engine.ts` (+spec), `src/dsp/testing/fixtures.ts`
- Modify: `swift/Sources/AlloyAudio/DSP/Patch.swift` (+tests), `PatchEngine.swift` (+tests), `PatchFixtures.swift`, and `EffectTypes.swift` (Codable now)

**Interfaces:**
- `Patch` gains `inserts?: InsertSpec[]` (TS) / `public var inserts: [InsertSpec]?` decoded via `decodeIfPresent` (Swift; add the custom Codable to `InsertSpec` now, keyed on `kind` with `chorus`/`tremolo` payload fields, matching the TS JSON exactly).
- `validatePatch` additions: `inserts.length <= MAX_INSERTS` (`"too many inserts (N > 3)"`), and per insert `validateInsert` errors prefixed `insert N: `.
- `PatchEngine.process` becomes STEREO: `process(left: Float32Array, right: Float32Array, frames: number): void` (ADDS into both; same 4096 cap). The mono `process` is REMOVED (pre-release internal API; all in-repo consumers updated in this task). Segment loop: zero mono scratch, voices render into it, copy mono → L/R stereo scratches (unity, `l[i] = r[i] = mono[i]`), run each insert `process(lScratch, rScratch, segFrames)` in patch order, add scratches into `left`/`right` at the segment offset. Insert chain (`EffectUnit[]`) rebuilt in `setPatch` from `patch.inserts ?? []` via `createInsert`; chain effects are NOT reset on notes — they run continuously (delay tails ring across notes).
- `renderPatch` returns `{ left: Float32Array; right: Float32Array }` (TS) / `(left: [Float], right: [Float])` tuple (Swift). All call sites updated.
- Hosts updated mechanically IN THIS TASK so the tree compiles: `WorkletHostCore.render(left, right, frames, postReply)` (shell writes L→channel 0, R→channel 1 when present, else `(L+R)*0.5` into the single channel — shell stays logic-free-ish: this channel mapping is the one permitted branch, mirrored on Apple); `PatchEngineHost.render(intoLeft:right:frames:)` + `makeSourceNode` writes both channels (still without explicit format — Task 5 fixes that). Flagship host≡renderPatch tests updated to compare BOTH channels exactly.

- [ ] **Step 1: TS failing tests.** patch.spec.ts: inserts validation (4 inserts → error; bad chorus params → `insert 1: ` prefix; fixture WITHOUT inserts still validates — backward compat pin; fixture WITH a chorus insert round-trips). patch-engine.spec.ts updates: mono-compat pin (insert-free patch: L === R === bit-exact vs a saved pre-change expectation… simplest: L === R exactly, and the additive-patch scheduling tests assert on L only with values unchanged from before the stereo change — the mono→stereo copy is unity so existing expected values hold); insert-chain wiring (patch with chorus mix 1: L !== R after warmup); chain continuity across setPatch (document-pinning test: sounding voice + setPatch to a patch with different inserts → no throw, still renders).
- [ ] **Step 2-3: FAIL → implement TS** (patch, engine, renderPatch, worklet-host-core, shell) → PASS.
- [ ] **Step 4: Swift twins** (Patch Codable + validatePatch, PatchEngine stereo, renderPatch tuple, PatchEngineHost + tests, InsertSpec Codable with a decode test using the same insert JSON string as the TS spec). RED = compile break.
- [ ] **Step 5: both suites green → Commit** `feat(audio): stereo insert bus through engine and hosts`

---

### Task 4: Golden stereo re-baseline + zone-set equality

**Files:** `golden-patches.ts` / `GoldenPatchFixtures.swift`; `golden-render.spec.ts` / `GoldenRenderTests.swift`; `worklet-host-core.spec.ts`.

- PATCH_FM gains `inserts: [{ kind: 'chorus', chorus: { mode: 'ensemble', rateHz: 0.7, depthMs: 2.2, mix: 0.35 } }]`; PATCH_ORGAN gains `inserts: [{ kind: 'tremolo', tremolo: { rateHz: 6.8, depth: 0.4, spread: 0.8 } }]`; PATCH_VA and PATCH_SAMPLE stay insert-free (pin the bypass path: their L/R twin arrays must be identical pairs — assert `TWIN_VA_L_AT_x` equals the R capture, then store ONE array per window used for both channels).
- Twin probes become stereo: for FM/ORGAN capture L and R separately (3 windows × 2 channels × 2 patches = 12 arrays) + VA/SAMPLE single arrays asserted on both channels (6 arrays). Same windows (0 / 12000 / 30000), tolerance 1e-4, capture workflow.
- Assertions per patch: determinism (both channels), non-silence RMS on L, tail silence on BOTH channels, twin probes.
- Web zone-set equality upgrade (1b-ii deferral): worklet-host-core test 5 becomes an exact stereo equality vs `renderPatch(PATCH_SAMPLE, ...)` driven through `setZoneSet` messages.
- [ ] **Steps:** TS re-baseline (FAIL on old mono API → rewrite → capture) → Swift mirror → both suites → Commit `test(audio): re-baseline golden renders for the stereo insert bus`

---

### Task 5: Apple AVAudioFormat + phase docs

**Files:** `swift/Sources/AlloyAudio/PatchEngineHost.swift` (+tests); `docs/mirroring.md`; spec status line.

- `makeSourceNode()` now passes an explicit `AVAudioFormat(standardFormatWithSampleRate: sampleRate, channels: 2)!` (mirror `AVSynthEngine`'s format construction) so a hardware/engine rate mismatch converts instead of silently detuning — the riskiest 1b-ii deferral. Document the single-node assumption ("one source node per host; a second call shares engine/transport") and preallocate the node scratch for stereo at the 4096 cap (no render-thread regrowth — drop the regrowth path; frames > 4096 in the callback render silence for the remainder + `assertionFailure` in debug, documented).
- mirroring.md: effects section — `EffectUnit`/`InsertSpec` strict twins, chorus/tremolo constants, the stereo bus contract (mono voices → chain → stereo; insert-free ⇒ L===R), sanctioned asymmetry updates (host render signatures now stereo).
- Spec status: phase-2a landed line under Phasing item 2.
- [ ] **Steps:** failing Swift test (source node format is stereo at host rate — assert via `node.outputFormat(forBus: 0)` after attachment to an AVAudioEngine? Construction-time format assert only, no engine start: `AVAudioSourceNode(format:renderBlock:)` exposes the format — smoke-assert channels==2, sampleRate==host's) → implement → docs edits → full verification (web workspace + alloy-audio build + swift) → Commit `feat(audio): explicit stereo format on the source node; close phase 2a docs`

---

## Self-Review Notes

- **Spec coverage (2a slice):** chorus/ensemble with the exact identity-effect role the spec assigns (Task 1); tremolo/auto-pan (Task 2); per-patch ordered insert list with schema headroom kept at version 1 (Task 3); stereo bus (Task 3); goldens re-baselined stereo (Task 4); AVAudioFormat deferral closed (Task 5). Deferred: phaser/rotary/drive-EQ/compressor (2b); sends/limiter/benchmark (2c); per-generation insert chains (documented non-goal).
- **Backward compat:** schemaVersion stays 1; insert-free patches bit-match old mono output on both channels (Task 3 pin); 1b fixture JSON untouched and re-pinned.
- **The one intentionally temporary state:** Task 1's factory throw for tremolo — replaced in Task 2, unreachable meanwhile (inserts can't reach the engine until Task 3's schema lands).
