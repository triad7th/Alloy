# Rompler Workbench — Implementation Plan (examples/web-harness)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Single task.

**Goal:** A playable rompler section in `examples/web-harness` — the spec's "patch workbench" proving ground, first live consumer of `WorkletSynthHost` and the documented dist-serving path. Play patches from screen/computer keyboard; hear all six 2b inserts.

**Architecture:** New standalone `rompler-section.component.ts` beside the existing sections. The worklet loads from the BUILT package dist served as an Angular asset (this validates the real consumption pattern — the harness's tsconfig source paths cover only the main-thread types). Patch catalog is app-side (per the repo's catalog-is-app-side design), hand-authored to exercise the engine + effects musically.

## Global Constraints

- `examples/` is a private harness: web-only, never packed/released; no Swift twin for UI. No changes to `web/packages/*` sources (the libraries are done; if something in them blocks the harness, STOP with NEEDS_CONTEXT — that's a library bug worth knowing).
- Angular 21 standalone component patterns; match the existing sections' style (signals, ChangeDetectionStrategy.OnPush, knob components from `@allyworld/alloy-ui` where the existing synth section uses them).
- Dev-serve stays on the official port ONLY for the human; agent verification uses its own port with `--port`.

### Task 1: Rompler section

**Files:**
- Create: `examples/web-harness/src/app/sections/rompler-section.component.ts` (+ template/styles inline or sibling files matching section conventions)
- Modify: `examples/web-harness/src/app/app.component.ts` (mount the section), `examples/web-harness/angular.json` (asset entry), `examples/web-harness/package.json` (a `prestart`/`prebuild` hook or documented script ensuring `alloy-audio` dist is built)

**Steps:**

- [ ] **Asset wiring:** angular.json gains `{ "glob": "**/*", "input": "../../web/packages/alloy-audio/dist", "output": "/alloy-audio-dist" }`. The worklet URL is `/alloy-audio-dist/worklet/alloy-patch-processor.js` — the WHOLE dist tree is served (the documented import-graph requirement). Add `"prestart": "npm --prefix ../../web/packages/alloy-audio run build"` (and same for prebuild) so the dist can't be stale.
- [ ] **Context adapter (~20 lines, app-side):** wrap the real `AudioContext` as `MinimalWorkletContext` — `audioWorklet.addModule` passthrough, `createWorkletNode(name, opts)` returning `new AudioWorkletNode(ctx, name, { ...opts, outputChannelCount: [2] })` (explicit stereo), `destination`, `sampleRate`, `currentTime`. Bridge DOM types via `unknown` like the existing `createWebSynthEngine` does.
- [ ] **Lifecycle:** create the host lazily on first user gesture (browsers gate AudioContext); status signal ('idle' | 'loading' | 'ready' | 'error: …'); `onPatchRejected` surfaces errors in the UI; dispose on destroy (existing section OnDestroy pattern).
- [ ] **Patch catalog (app-side, hand-authored — this is the first real patch-authoring pass, aim for musical):** at least five patches exercising every generator kind and all six inserts across the set, e.g.: `EP Ensemble` (2-op FM + ensemble chorus + compressor), `Drawbar Organ` (additive 6-partial + rotary fast + drive), `Analog Pad` (va saw unison + tvf env + phaser, slow attack), `Synth Brass` (va + driveEq + compressor, velocity-bright tvf), `Music Box` (fm bell ratios + tremolo + short tva). Validate each with `validatePatch` in a `beforeEach`-style dev assertion (console.error if non-empty). Include per-patch base velocity.
- [ ] **Keyboard UI:** two octaves on screen (reuse the existing synth section's key rendering — `isBlackKey`/`midiToNoteName` from alloy-audio), octave shift buttons, computer-keyboard bindings (A/W/S/E/D/F/T/G/Y/H/U/J = C..B, Z/X octave shift — document in the UI), pointer down/up → `noteOn`/`noteOff`, key-repeat guarded. Patch selector via the knob segment component (like the existing synth section). All-notes-off button.
- [ ] **Verification:** `cd examples/web-harness && npm run build` clean. Then `ng serve --port 4299` and drive it headlessly if browser tooling is available to you — otherwise report build-only and the controller smoke-tests in Chrome. Do NOT touch port 4205.
- [ ] **Commit:** `feat(examples): add rompler workbench section (worklet host, six-insert patches)`

## Self-Review Notes

- The workbench deliberately ships NO library changes; any friction it reveals in `WorkletSynthHost`'s API is a finding to report, not to patch inline.
- Patch quality here seeds phase 3's factory-bank work — favor taste over coverage where they conflict, but keep every generator kind represented.
