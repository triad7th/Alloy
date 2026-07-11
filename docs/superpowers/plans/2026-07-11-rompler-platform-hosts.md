# Rompler Platform Hosts — Implementation Plan (Phase 1b-ii)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Real-time hosts for the phase-1b-i `PatchEngine`: an AudioWorklet path on web and an `AVAudioSourceNode` path on Apple, each proven bit-identical to the offline `renderPatch` harness. Spec: `docs/superpowers/specs/2026-07-10-alloy-rompler-engine-design.md` (Platform hosts section).

**Architecture:** The hosts are thin platform edges around the pure engine — semantic twins (like `WebSynthEngine` ↔ `AVSynthEngine`), not literal ones. All host logic that CAN be pure is pure and twin-tested: the web side splits into a pure `WorkletHostCore` (message decoding, frame anchoring, zone store — vitest-testable) plus a ~30-line `AudioWorkletProcessor` shell; the Apple side splits into a locked `PatchCommandQueue` + a testable render function, with `AVAudioSourceNode` as the shell. The flagship test on each platform: driving the host path with the golden fixtures produces output EXACTLY equal to `renderPatch` (same core, same schedule order → bit-exact).

**Tech Stack:** TypeScript/Vitest; Swift/XCTest; AVFoundation allowed ONLY in `PatchEngineHost.swift` (platform edge, beside `AVSynthEngine.swift`); WebAudio worklet globals ONLY in the processor shell via ambient declarations.

## Global Constraints

- All prior constraints hold (determinism, no formatters, `.js` suffixes, conventional commits, both suites green per commit, ledger'd twin conventions).
- `src/dsp/` purity is untouched: `worklet-host-core.ts` is pure (imports engine/patch types only); the processor shell and `WorkletSynthHost` live OUTSIDE `src/dsp/`.
- Real-time hygiene (from the 1b-i final review, binding here): no allocation in any render path (preallocate scratch at construction/config time); command/event drain per render callback is bounded (`MAX_COMMANDS_PER_BLOCK = 512`, leftovers carry to the next block); no throwing path reachable from a render callback.
- Frame domains: worklet messages carry ABSOLUTE CONTEXT frames (`AudioWorkletGlobalScope.currentFrame` timebase); the core anchors at construction and maps to engine frames. Apple commands carry ABSOLUTE ENGINE frames (the host's transport). Document both in code.
- `setPatch` across the async boundary cannot throw: invalid patches produce a `patchRejected` reply (web) / are dropped with the `[String]` errors surfaced via a callback (Apple). Document in `docs/mirroring.md` (Task 4).
- Stereo is phase 2: hosts render the mono engine and copy channel 0 to all output channels.

## File Structure

| File | Responsibility |
|---|---|
| CREATE `web/packages/alloy-audio/src/worklet-host-core.ts` (+spec) | pure: message protocol types, zone deserialization, frame anchoring, `WorkletHostCore` |
| CREATE `web/packages/alloy-audio/src/worklet/alloy-patch-processor.ts` | thin `AudioWorkletProcessor` shell (no unit test; documented) |
| CREATE `web/packages/alloy-audio/src/worklet/worklet-globals.d.ts` | ambient decls: `AudioWorkletProcessor`, `registerProcessor`, `sampleRate`, `currentFrame` |
| CREATE `web/packages/alloy-audio/src/worklet-synth-host.ts` (+spec) | main-thread `WorkletSynthHost` over a minimal worklet-context seam |
| MODIFY `web/packages/alloy-audio/src/index.ts`, `package.json` | exports (+ `"./worklet"` subpath) |
| CREATE `swift/Sources/AlloyAudio/PatchCommandQueue.swift` (+tests) | locked main→render command queue |
| CREATE `swift/Sources/AlloyAudio/PatchEngineHost.swift` (+tests) | testable render function + `makeSourceNode()` |
| MODIFY `docs/mirroring.md`, spec status line | host twin contract; phase 1b complete |

---

### Task 1: WorkletHostCore (pure web host logic)

**Files:**
- Create: `web/packages/alloy-audio/src/worklet-host-core.ts`, test `worklet-host-core.spec.ts`
- Modify: `web/packages/alloy-audio/src/index.ts` (export)

**Interfaces:**
- Consumes: `PatchEngine`, `EngineEvent`, `Patch`, `validatePatch`, `VelocityLayerData`, `SampleZoneData` (all existing).
- Produces (the wire protocol both Task 2 sides use):

```ts
/** Zone data as it crosses the message port (buffers are transferred). */
export interface WireZone {
  rootMidi: number;
  sampleRate: number;
  samples: Float32Array;
  loopStart?: number;
  loopEnd?: number;
}
export interface WireZoneLayer { topVelocity: number; zones: WireZone[] }

/** All frames are ABSOLUTE CONTEXT frames (AudioWorkletGlobalScope.currentFrame timebase). Omitted atFrame = immediate. */
export type WorkletInMessage =
  | { type: 'setPatch'; patch: Patch }
  | { type: 'setZoneSet'; id: string; layers: WireZoneLayer[] }
  | { type: 'noteOn'; midi: number; velocity: number; atFrame?: number }
  | { type: 'noteOff'; midi: number; atFrame?: number }
  | { type: 'allNotesOff'; atFrame?: number };

export type WorkletOutMessage = { type: 'patchRejected'; errors: string[] };

export const WORKLET_PROCESSOR_NAME = 'alloy-patch-engine';
export const MAX_COMMANDS_PER_BLOCK = 512;

export class WorkletHostCore {
  /** anchorFrame: the context frame at which engine frame 0 occurs (processor construction). */
  constructor(sampleRate: number, anchorFrame: number, options?: { maxVoices?: number });
  /** Queue a message; applied (bounded) at the start of the next render. Never throws. */
  onMessage(message: WorkletInMessage): void;
  /** Drain ≤ MAX_COMMANDS_PER_BLOCK queued messages, then engine.process into out (ADDS; caller passes the pre-zeroed worklet buffer). postReply collects any patchRejected replies. */
  render(out: Float32Array, frames: number, postReply: (reply: WorkletOutMessage) => void): void;
}
```

Behavior: messages are queued on arrival (port callbacks interleave with render on the same worklet thread — the queue makes application points deterministic: only at render starts). During drain: `setPatch` runs `validatePatch` first — errors → `postReply({type:'patchRejected', errors})` and the patch is NOT applied; `setZoneSet` stores `WireZoneLayer[]` converted to `VelocityLayerData[]` in a `Map<string, VelocityLayerData[]>` that backs the engine's `zoneSetProvider`; note events map `atFrame` → engine frames via `Math.max(engine frame domain: atFrame - anchorFrame, treated as immediate if past)` — implement as `const engineFrame = atFrame === undefined ? 0 : atFrame - this.anchorFrame;` and schedule (`PatchEngine` already treats past frames as immediate). Drain bound: at most `MAX_COMMANDS_PER_BLOCK` per render; leftovers stay queued in order.

- [ ] **Step 1: failing tests** (`worklet-host-core.spec.ts`) — real code for each:

```ts
// 1. setPatch then noteOn then render: non-silent output (use the additive make-patch helper pattern from patch-engine.spec.ts).
// 2. Invalid patch: postReply receives patchRejected with the validatePatch errors; engine keeps rendering silence; a later valid setPatch recovers.
// 3. Frame anchoring: core anchored at 1000; noteOn atFrame 1100 → first 100 rendered frames exactly 0, sound starts at offset 100 (render 256; attack 0.001).
// 4. Past atFrame (500 < anchor 1000) fires immediately (frame 0 output nonzero within attack).
// 5. Zone set: setZoneSet with a WireZone built from the golden sine recipe + PATCH_SAMPLE-style sample patch → non-silent render; unknown zoneSetId patch renders silence without error.
// 6. Drain bound: queue MAX_COMMANDS_PER_BLOCK + 1 noteOn messages for distinct midis (maxVoices generous), render one block → activeVoiceCount === MAX_COMMANDS_PER_BLOCK (expose nothing new: assert instead via output growth across two renders — simplest observable: after first render, queue length not empty; after second, empty. Make the core expose `readonly pendingMessageCount: number` for this test and host debugging.)
// 7. FLAGSHIP equality: for PATCH_FM and PATCH_ORGAN (import from './dsp/testing/golden-patches.js') — drive a core (anchor 0) with setPatch + the GOLDEN_EVENTS as noteOn/noteOff messages (atFrame = event frame), render in 128-frame blocks into a concatenated buffer of GOLDEN_FRAMES; assert EVERY sample toBe-equal to renderPatch(patch, GOLDEN_EVENTS, GOLDEN_FRAMES, GOLDEN_FS). Bit-exact — same core, same schedule order. (Zone patch equality is covered on the Swift side in Task 3 and here only via test 5's audibility to keep this spec fast.)
```

Add `pendingMessageCount` to the Interfaces block — it is part of the produced API.

- [ ] **Step 2: run, verify FAIL.** `cd web/packages/alloy-audio && npx vitest run src/worklet-host-core.spec.ts`
- [ ] **Step 3: implement** `worklet-host-core.ts` per the Interfaces block (preallocate nothing per render — the engine owns scratch; the core's drain loop is array shift via head index, not `Array.shift()` in a loop — keep a cursor and `splice` once, or a ring; implement with head-index + periodic compaction). Export from `index.ts`. Run → PASS.
- [ ] **Step 4: both full suites green → Commit** `feat(audio): add pure worklet host core with wire protocol`

---

### Task 2: Worklet shell + WorkletSynthHost (main thread)

**Files:**
- Create: `web/packages/alloy-audio/src/worklet/alloy-patch-processor.ts`, `web/packages/alloy-audio/src/worklet/worklet-globals.d.ts`
- Create: `web/packages/alloy-audio/src/worklet-synth-host.ts`, test `worklet-synth-host.spec.ts`
- Modify: `web/packages/alloy-audio/src/index.ts`, `web/packages/alloy-audio/package.json`

**Interfaces:**
- Consumes: Task 1's protocol + `WORKLET_PROCESSOR_NAME`.
- Produces:

`worklet-globals.d.ts` (ambient, no exports):

```ts
// AudioWorkletGlobalScope globals — not in TS dom lib.
declare abstract class AudioWorkletProcessor {
  readonly port: MessagePort;
  constructor(options?: { processorOptions?: unknown });
  abstract process(inputs: Float32Array[][], outputs: Float32Array[][], parameters: Record<string, Float32Array>): boolean;
}
declare function registerProcessor(name: string, ctor: typeof AudioWorkletProcessor): void;
declare const sampleRate: number;
declare const currentFrame: number;
```

`alloy-patch-processor.ts` — the entire shell (worklet output buffers arrive zeroed per spec, so the core ADDS directly):

```ts
// AudioWorklet shell around WorkletHostCore. Registered under
// WORKLET_PROCESSOR_NAME; apps load this module via
// ctx.audioWorklet.addModule(<url to dist/worklet/alloy-patch-processor.js>).
// Keep this file logic-free: everything testable lives in WorkletHostCore.
import { WorkletHostCore, WORKLET_PROCESSOR_NAME, type WorkletInMessage } from '../worklet-host-core.js';

class AlloyPatchProcessor extends AudioWorkletProcessor {
  private readonly core: WorkletHostCore;

  constructor(options?: { processorOptions?: { maxVoices?: number } }) {
    super(options);
    this.core = new WorkletHostCore(sampleRate, currentFrame, options?.processorOptions);
    this.port.onmessage = (event: MessageEvent<WorkletInMessage>) => this.core.onMessage(event.data);
  }

  process(_inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    const channels = outputs[0];
    const mono = channels[0];
    this.core.render(mono, mono.length, (reply) => this.port.postMessage(reply));
    for (let c = 1; c < channels.length; c++) {
      channels[c].set(mono);
    }
    return true;
  }
}

registerProcessor(WORKLET_PROCESSOR_NAME, AlloyPatchProcessor);
```

`worklet-synth-host.ts`:

```ts
/** The worklet-facing subset of AudioContext/AudioWorkletNode — the test seam. */
export interface MinimalWorkletPort {
  postMessage(message: unknown, transfer?: Transferable[]): void;
  onmessage: ((event: { data: unknown }) => void) | null;
}
export interface MinimalWorkletNode { readonly port: MinimalWorkletPort; connect(destination: unknown): void; disconnect(): void }
export interface MinimalWorkletContext {
  readonly sampleRate: number;
  readonly currentTime: number;
  audioWorklet: { addModule(url: string): Promise<void> };
  createWorkletNode(name: string, options: { processorOptions?: unknown }): MinimalWorkletNode; // real impl wraps `new AudioWorkletNode(ctx, name, opts)`
  destination: unknown;
}

export class WorkletSynthHost {
  /** addModule(moduleUrl) then construct + connect the node. The app owns the module URL (bundlers differ; Angular apps copy dist/worklet/ to assets). */
  static async create(ctx: MinimalWorkletContext, moduleUrl: string, options?: { maxVoices?: number }): Promise<WorkletSynthHost>;
  onPatchRejected: ((errors: string[]) => void) | null;
  setPatch(patch: Patch): void;
  /** Transfers each zone's underlying ArrayBuffer. */
  setZoneSet(id: string, layers: WireZoneLayer[]): void;
  /** when: AudioContext seconds (ctx.currentTime domain); undefined = now. Converted to absolute context frames via Math.round(when * sampleRate). */
  noteOn(midi: number, velocity: number, when?: number): void;
  noteOff(midi: number, when?: number): void;
  allNotesOff(): void;
  dispose(): void; // disconnect + clear onmessage
}
```

`package.json`: add `"./worklet": "./dist/worklet/alloy-patch-processor.js"` to `exports` (keep the existing `"."` entry unchanged).

- [ ] **Step 1: failing tests** (`worklet-synth-host.spec.ts`) with a fake `MinimalWorkletContext` capturing addModule calls, node construction, posted messages + transfer lists:

```ts
// 1. create(): awaits addModule(moduleUrl) exactly once, constructs node with WORKLET_PROCESSOR_NAME and processorOptions {maxVoices}, connects to ctx.destination.
// 2. setPatch posts {type:'setPatch', patch} verbatim; noteOn(60, 0.8) posts atFrame === undefined; noteOn(60, 0.8, when) posts atFrame === Math.round(when * sampleRate).
// 3. setZoneSet posts the layers AND the transfer list contains every zone's samples.buffer exactly once.
// 4. patchRejected reply from the fake port fires onPatchRejected with the errors array.
// 5. dispose() disconnects and clears port.onmessage.
```

- [ ] **Step 2: run, verify FAIL.** — **Step 3: implement** shell, ambient decls, host; export `worklet-synth-host` (types + class) and the protocol name from `index.ts` (the shell is NOT exported — it is a worklet-only module). Verify `npm run build` (tsc) emits `dist/worklet/alloy-patch-processor.js` with relative `../worklet-host-core.js` import intact (worklet modules are ES modules; relative imports resolve against the module URL — document this constraint in the shell's header comment). Run → PASS.
- [ ] **Step 4: both full suites green + `cd web/packages/alloy-audio && npm run build` clean → Commit** `feat(audio): add AudioWorklet shell and main-thread synth host`

---

### Task 3: Apple host — PatchCommandQueue + PatchEngineHost

**Files:**
- Create: `swift/Sources/AlloyAudio/PatchCommandQueue.swift`, test `swift/Tests/AlloyAudioTests/PatchCommandQueueTests.swift`
- Create: `swift/Sources/AlloyAudio/PatchEngineHost.swift`, test `swift/Tests/AlloyAudioTests/PatchEngineHostTests.swift`

**Interfaces:**
- Consumes: `PatchEngine`, `EngineEvent`, `Patch`, `validatePatch`, `VelocityLayerData` (DSP core, Foundation-only); AVFoundation ONLY in `PatchEngineHost.swift`.
- Produces:

```swift
/// Commands crossing main → render thread. Frames are ABSOLUTE ENGINE frames.
public enum PatchCommand {
    case setPatch(Patch)
    case setZoneSet(String, [VelocityLayerData])
    case noteOn(midi: Int, velocity: Double, atFrame: Int)
    case noteOff(midi: Int, atFrame: Int)
    case allNotesOff(atFrame: Int)
}

/// Locked FIFO; push on any thread, drain on the render thread. Mirror the
/// locking pattern of the existing ChannelCommandQueue (read it first and
/// use the same primitive and @unchecked Sendable justification comment).
public final class PatchCommandQueue: @unchecked Sendable {
    public init()
    public func push(_ command: PatchCommand)
    /// Removes and returns up to `max` commands, FIFO.
    public func drain(max: Int) -> [PatchCommand]
}

public final class PatchEngineHost: @unchecked Sendable {
    public static let maxCommandsPerBlock = 512
    public init(sampleRate: Double, maxVoices: Int = 64)
    /// Rejected patches (validatePatch errors) surface here, called on the render thread's drain — document; nil = drop silently.
    public var onPatchRejected: (([String]) -> Void)?
    /// Transport: frames rendered so far (updated after each render callback; read-only elsewhere).
    public var renderedFrames: Int { get }
    public func setPatch(_ patch: Patch)
    public func setZoneSet(_ id: String, _ layers: [VelocityLayerData])
    public func noteOn(midi: Int, velocity: Double, atFrame: Int = 0) // 0/past = immediate
    public func noteOff(midi: Int, atFrame: Int = 0)
    public func allNotesOff()
    /// The testable render body: drain ≤ maxCommandsPerBlock, slice frames into ≤4096 chunks, engine.process each, update renderedFrames. ADDS into out (caller zero-fills).
    public func render(into out: inout [Float], frames: Int)
    /// AVAudioSourceNode wrapping render(into:frames:) — mono render copied to every output channel. Not covered by unit tests beyond a construction smoke test.
    public func makeSourceNode() -> AVAudioSourceNode
}
```

Details: `render` drains commands FIRST (all applied at the block start — same semantics as the web core), applying `setPatch` via `engine.setPatch` (non-empty errors → `onPatchRejected`, patch dropped), `setZoneSet` into a plain dictionary owned by the render thread (only touched inside `render` — no extra locking; the engine's `zoneSetProvider` closure reads it), and note commands via `engine.schedule`. Slicing: preallocated `[Float](repeating: 0, count: 4096)` scratch; per ≤4096 slice: zero the scratch prefix, `engine.process`, add into `out` at offset. `renderedFrames` update guarded by the same pattern `AVSynthEngine.Channel` uses (read that class first; keep its comment style for the @unchecked Sendable justification). `makeSourceNode`: `AVAudioSourceNode { _, _, frameCount, audioBufferList in ... }` rendering into the first channel then copying — mirror the buffer-list handling of the existing `AVSynthEngine` source-node code.

- [ ] **Step 1: failing queue tests** (`PatchCommandQueueTests.swift`): FIFO order (push 5, drain(max: 3) returns first 3, drain(max: 10) returns remaining 2); drain on empty returns []; concurrent pushes from 4 `DispatchQueue.concurrentPerform` lanes total 4000 commands, drained fully with no loss (count check).
- [ ] **Step 2: run FAIL, implement `PatchCommandQueue`, run PASS.**
- [ ] **Step 3: failing host tests** (`PatchEngineHostTests.swift`):

```swift
// 1. FLAGSHIP equality: for goldenFmPatch() and goldenSamplePatch() (+ its zone set via setZoneSet):
//    push setPatch/setZoneSet, push each GOLDEN_EVENT as the matching command (atFrame = event frame),
//    then call render(into:frames:) in 128-frame blocks accumulating goldenFrames() samples;
//    XCTAssertEqual with renderPatch(...) output — EXACT (no accuracy), same core, same order.
// 2. Slicing: one render(into:frames: 5000) call (>4096) equals two engines' renderPatch of 5000 frames (exact) — pins the slice loop.
// 3. Rejected patch: setPatch with an invalid patch (schemaVersion 2) → onPatchRejected fires with errors on next render; engine renders silence; later valid patch recovers.
// 4. Command bound: push 513 noteOns (distinct midis, maxVoices 600); after one 128-frame render, renderedFrames == 128 and a 514th... simplest observable: drain bound via queue — push 513, render one block, assert engine.activeVoiceCount == 512 (host exposes engine's count? Add `public var activeVoiceCount: Int` passthrough to the host API — include it in the Interfaces block), second render → 513.
// 5. makeSourceNode() construction smoke test: node is created; no render assertion (no running engine in CI).
```

Add `activeVoiceCount` passthrough to the host's produced API.

- [ ] **Step 4: run FAIL, implement `PatchEngineHost`, run PASS.** Both full suites green.
- [ ] **Step 5: Commit** `feat(audio): add AVAudioSourceNode patch engine host twins`

---

### Task 4: Cross-host contract docs + phase close

**Files:**
- Modify: `docs/mirroring.md`, `docs/superpowers/specs/2026-07-10-alloy-rompler-engine-design.md`
- Modify (only if Task 1 left it out): none — verify `index.ts` exports are complete.

**Interfaces:** none new — documentation + verification.

- [ ] **Step 1:** `docs/mirroring.md` — extend the rompler twin-surface paragraph (added in 1b-i) with the host pairing: `WorkletHostCore`+`WorkletSynthHost` ↔ `PatchCommandQueue`+`PatchEngineHost` are SEMANTIC twins (platform edges); sanctioned asymmetries: frame domains (context frames vs engine frames), patch rejection surfaces (port reply message vs callback), drain constant shared (512). State the flagship property both platforms now pin: host path ≡ `renderPatch` bit-exactly.
- [ ] **Step 2:** spec status line → "(Phase 1 complete: 1a units, 1b-i engine, 1b-ii hosts — patches render identically offline, in the worklet path, and in the source-node path.)"
- [ ] **Step 3:** Run everything: `cd web && npm test`, `cd web/packages/alloy-audio && npx vitest run && npm run build`, `cd swift && swift build && swift test` → all green.
- [ ] **Step 4: Commit** `docs: close rompler phase 1b — hosts land on both platforms`

---

## Self-Review Notes

- **Spec coverage (1b-ii slice):** worklet module shipped by alloy-audio + app registers via addModule (Task 2 — app supplies URL; Angular assets pattern documented in the shell header); sample-accurate note events over the port (context-frame protocol, Task 1); one AVAudioSourceNode for the whole engine (Task 3); block-based, no per-render allocation, bounded drains (1b-i review carry-overs, enforced in both hosts); transport clock is the engine's (hosts expose it; web anchoring maps into it). The `createWorkletHost()` seam named in the spec landed as `MinimalWorkletContext.createWorkletNode` — same intent (browserless tests), narrower shape; Task 4's mirroring.md note records the naming.
- **Deliberately deferred:** stereo (phase 2); `InstrumentDescriptor` `{kind:'patch'}` + `SynthEngine` integration and the examples workbench (phase 3, when the first real patch exists); AUv3/latency reporting (roadmap).
- **Testing honesty:** the two untestable shells (AudioWorkletProcessor subclass, AVAudioSourceNode render block) are kept logic-free and documented as such; everything else — including both flagship host≡offline equalities — runs in plain vitest/XCTest.
