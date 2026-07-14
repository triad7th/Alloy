# Rompler Phase 4a — The Patch Workbench (Design)

Phase 4 ("first wave" in the founding spec,
`docs/superpowers/specs/2026-07-10-alloy-rompler-engine-design.md`, §Phasing item
4) ships the factory instrument bank: FM electric pianos, tine/Wurli EP,
strings/pads, drawbar organs. It is the first phase whose deliverable is
**content**, not engine.

Phase 4 splits in two:

- **4a — the patch workbench** (this spec). The tool that makes 4b possible.
- **4b — the factory bank.** 8–12 patches, tuned by ear, stored as canonical
  TypeScript with a generated Swift twin.

## Why 4a exists

The bank's acceptance criterion is aesthetic and binding: *"zero noise, polished,
Japanese professional synth — FM8-class EPs, explicitly not Kontakt-style noisy
realism."* The only oracle for that is the user's ear.

A coding agent cannot hear. In phase 3b that was survivable — the piano patch had
about five meaningful knobs, and prose feedback ("wah-wah", "sounds compressed")
mapped onto them. An FM8-class EP is a multi-operator stack with dozens of
interacting parameters, and *"make it woodier"* does not map to a parameter
vector. Authoring blind and auditioning round-trip through the agent means one
full turn per iteration, at a dimensionality where guessing does not converge.

So: build the instrument that lets the user turn the knobs directly, then author
the bank with it. The cost is one sub-phase. It is repaid in 4b and again in
phase 6's GM buildout, which is 128 programs of the same work.

## Decisions (locked)

- **Bank shape (4b): deep and small — 8–12 patches.** Two or three per family,
  each tuned to the bar. The bank is a *quality* proof; breadth waits for phase 6.
- **Patch storage (4b): canonical TypeScript, generated Swift.** `docs/mirroring.md`
  is explicit — *"pure data tables are generated, never hand-twinned"* — and a
  patch bank is exactly a pure data table. Precedent:
  `tools/generate-zone-country.mjs`. Runtime-parsed JSON was considered and
  rejected for now: it would need a tagged-union decoder in both twins plus SPM
  resource-bundle plumbing, to buy a downloadable-content capability nothing
  currently asks for. `Patch` is already a public type, so a JSON decoder can be
  added later without disturbing the bank.
- **Editor scope: the whole `Patch`, generically.** Including layer add/remove
  and key/velocity splits — not just the sound-shaping fields. The extra UI is
  paid back by phase 6.
- **The editor is a harness tool, not a library feature.** It ships in
  `examples/web-harness/`, which is never packed, tagged, or released.

## Blast radius: zero

The workbench changes **nothing** in `alloy-audio` and **nothing** in Swift. It is
web-only by design, like `tools/samplepack/`, and therefore outside the twin
contract (`docs/mirroring.md` — record it there as a sanctioned web-only tool).

Everything it needs already exists as public API:

- `Patch`, `validatePatch` (non-throwing, returns `string[]`) — `dsp/patch.ts`
- `WorkletSynthHost.setPatch / noteOn / noteOff / setZoneSet`, and its
  `onPatchRejected` callback — already driving the harness's rompler section.

**This is the phase's cleanest property and must be preserved.** If a task finds
itself editing `web/packages/alloy-audio` or `swift/`, that is a signal the design
has drifted — stop and re-check rather than "just adding a small export".

## Architecture

New directory `examples/web-harness/src/app/rompler/`. The existing
`rompler-section.component.ts` is already 895 lines; the editor splits out of it
rather than swelling it.

| File | Responsibility |
| --- | --- |
| `patch-schema.ts` | The parameter descriptor table. For each editable field: path, label, control kind (number / enum / toggle), min, max, step, unit. |
| `patch-edit.ts` | Pure immutable operations on a `Patch`: get/set at a path; add, remove and reorder layers and inserts; switch generator or insert kind. |
| `patch-serialize.ts` | Emit a `Patch` as formatted TypeScript source; parse JSON back into a `Patch`. |
| `patch-editor.component.ts` | The UI. Driven entirely by the descriptor table — no per-field markup. |
| `rompler-section.component.ts` | *Modified.* Hosts the editor, owns the A/B slots, wires apply + re-strike. |

### Where parameter ranges live

In `patch-schema.ts`, in the harness — **not** in the library. The two are
different things: `validatePatch` enforces what is *legal* (a filter cutoff must
be positive); the descriptor table declares what is *musical* (20 Hz – 20 kHz, log
taper). The library has no use for the latter, and adding it would create a public,
twinned API surface to maintain for a private tool's benefit.

The risk of that separation is drift — a schema field added later with no
descriptor, silently uneditable. A coverage test closes it (see Testing).

### Generator and insert kind switching

Changing `generator.kind` (fm / additive / va / sample) or an insert's kind
replaces a whole parameter subtree. `patch-edit.ts` owns a **default template per
kind** so the switch always yields a valid, audible patch rather than an empty
shell. Same for adding a layer or an insert.

Existing capacity limits are the editor's bounds: **1–4 layers**, **0–3 inserts**
(`MAX_INSERTS`). Operator and partial counts are unbounded by validation; the
editor bounds them musically (see the voice-cost readout below).

## The three mechanics that carry the phase

### 1. Apply and re-strike

Every edit: rebuild the `Patch` → `validatePatch` → if it returns errors, show
them inline and **do not send** (the engine's `setPatch` throws on an invalid
patch; the editor must never let it get there) → otherwise `host.setPatch()`.

**A knob turn is inaudible on a sustaining note.** `PatchEngine.setPatch` swaps
the patch and rebuilds the shared insert chain, but a `Voice` captures its
generator, TVF and TVA parameters at `noteOn`. This is deliberate and documented
(`docs/mirroring.md`: voices still sounding on an old patch render through the new
insert chain — "a hardware-like patch transition"). Fighting it would mean an
engine change this phase otherwise does not need.

So the editor works with it: **re-strike the last-played note on every edit**
(toggle, default on). Each knob turn replays the note. Inserts and sends *do* take
effect live, so a held/drone note remains the right way to tune those.

### 2. A/B slots

Two patch slots. Edit either; a compare control swaps which one is live; copy A→B
to branch from a version worth keeping. Without this the user cannot tell whether
a change helped — only that something changed. This is the difference between
tuning and wandering.

### 3. Export round-trip

- **Copy as TS** — a paste-ready `Patch` literal for 4b's `factory-bank.ts`. This
  is the bridge between the two sub-phases: the bank is *authored by this button*.
- **Copy as JSON** / **paste to import** — resume tuning across sessions and
  machines.
- **localStorage autosave**, keyed by patch id, plus revert-to-catalog. An hour of
  tuning must not die to a page refresh.

The exporter's faithfulness is load-bearing: a lossy export means the bank shipped
in 4b silently differs from the sound that was approved. It gets a round-trip test.

## The voice-cost readout

A derived, live number: `layers × (FM operators | additive partials | unison
oscillators)` — displayed **beside the same figure for the patch the CPU budget
was actually measured on** (the benchmark's FM patch: 1 layer × 3 operators = 3).
So the readout says "this voice is 3× the benchmarked voice", not "this voice is
bad".

**No warning threshold is invented here.** There is no measurement that would
justify one — oscillator count is a proxy, not a prediction, and a fabricated
red line is worse than none because it looks like knowledge. The reference figure
gives the user the comparison; 4b's re-pointed benchmark is the only real gate.

This exists because of a specific, measured trap. The 64-voice full-FX Swift
release benchmark sits at **21.9% of one core against a hard <25% budget** — and
it renders a **3-operator FM** patch. A 9-drawbar additive organ is nine sines per
voice; a 7-oscillator unison supersaw is seven PolyBLEP oscillators per voice.
Either can be a heavier voice than the one the budget was measured on. The user
should see a patch drifting expensive *while tuning it*, not discover it in 4b's
benchmark.

The readout is a proxy, deliberately dumb — it does not predict Swift release CPU.
**4b's obligation** (recorded here so it is not lost): re-point the benchmark at
the most expensive patch in the shipped bank, so the budget tracks the bank rather
than a fixed fixture.

## Testing

The harness has no test runner today and its components stay untested, as now.
Add a **minimal vitest setup for the three pure modules only**. Three properties
justify it:

- **Descriptor coverage** — every field of a fully-populated reference `Patch` is
  reachable by some descriptor in `patch-schema.ts`. This is what stops the editor
  going quietly stale when the patch schema grows.
- **Bounds safety** — setting every descriptor to its declared min, and again to
  its max, yields a patch that `validatePatch` accepts. The editor must be
  incapable of constructing an invalid patch.
- **Export round-trip** — export → re-import → deep-equal the original, across
  every generator kind and every insert kind. Protects 4b from a lossy exporter.

Plus ordinary unit tests for `patch-edit.ts`: get/set round-trips, immutability
(operations never mutate their input), and that every kind-switch template
produces a patch `validatePatch` accepts.

## Out of scope

- Any change to `alloy-audio` or to Swift. See "Blast radius".
- The factory bank itself — that is 4b, and it starts once this tool works.
- Live parameter updates to *sounding* voices. That is an engine change (voices
  would have to re-read patch params per block), and re-strike solves the problem
  without it.
- A patch browser, tagging, or preset management beyond the two A/B slots.
- Any new DSP unit. Phase 4 is expected to need **none**: FM covers the EPs, the
  additive generator's `{ratio, level}` partials *are* drawbars, the VA generator
  is PolyBLEP-band-limited with built-in unison/detune, and `RotarySpeaker`,
  `StereoChorus` and `Phaser` already exist as inserts. If 4b finds a family that
  genuinely cannot be voiced with the existing units, that is a separate decision
  against the CPU envelope — not a quiet addition.
