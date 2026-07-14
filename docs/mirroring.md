# The Mirroring Convention

Every Alloy library ships as **mirrored twins**: a TypeScript package
(`web/packages/alloy-<name>`) and a Swift product (`swift/Sources/Alloy<Name>`)
with deliberately identical API shapes. This document is the contract that
keeps them aligned. When the twins disagree, the **web API is canonical** —
the Ally porting rule: the web is the reference implementation, Apple ports
are mechanical translations.

## Naming

| Concept | TypeScript | Swift |
|---------|------------|-------|
| Package/product | `@allyworld/alloy-time` | `AlloyTime` |
| Type | `TimeMachine` | `TimeMachine` |
| Function/method | `zoneOffsetMinutes(timeZone, at)` | `ZoneCatalog.zoneOffsetMinutes(_:at:)` |
| Property | `machine.isMocked` | `machine.isMocked` |
| Constant table | `ZONE_COUNTRY` | `ZoneCountry.table` |
| Module file | `zone-format.ts` | caseless `enum ZoneFormat` namespace |
| Zone parameter | zone-id `string` | `TimeZone` primary + `zone id: String` overload via `ZoneCatalog.resolve` |

- Type, method, and property names are identical wherever both languages
  allow it. Case conventions of the host language win only where they must
  (SCREAMING_SNAKE constants become Swift enum namespaces).
- No abbreviations one side doesn't have. If the web says `timeZone`, Swift
  says `timeZone`, not `tz`.

### Sanctioned exceptions

Two shipped deviations from strict identical-name mirroring, both kept
because existing iOS call sites stayed source-compatible during extraction.
New modules must not add exceptions without recording them here:

- TS `buildTimeZoneOptions` ↔ Swift `ZoneCatalog.buildOptions`
- TS `countryCodeForZone` ↔ Swift `ZoneCountry.country(for:)`

## Idiom boundaries (allowed differences)

Mirroring means same *shape*, not transliterated code:

- TS `string | null` ↔ Swift `String?`
- TS union literals ↔ Swift `enum` with matching raw values
- TS plain objects ↔ Swift structs
- Reactivity stays OUT of both twins: no Angular signals in TS, no
  `@Observable` view-model machinery in Swift beyond what Observation needs
  for plain model types. Apps wrap the models in their own reactive layer.
- Platform time types: TS uses `Date` + epoch milliseconds; Swift uses
  `Date` + `TimeInterval`. Public APIs take/return these native types; the
  mirrored shape is the function signature, not the timestamp encoding.
- TS modules of free functions map to Swift caseless-enum namespaces with identical member names.
- `zone-time` (web) is deliberately web-only: Swift's `Calendar` covers
  wall-clock math natively, and the TS input helpers are specific to the
  HTML `datetime-local` input element. Do not "fix" this asymmetry by
  adding a Swift twin.

## Data is generated, never hand-twinned

Pure data tables (zone→country, region lists, display-name overrides) live
once, as TypeScript source in the web package. A script under `tools/` emits
the Swift literal file into `swift/Sources/`. Regenerate after editing the TS
table; a twin test on each platform asserts the tables agree (entry count +
spot checks). Precedent: allyclock's `assets/flags/render_ios_flags.py`.

## Twin tests

Every behavioral API gets the same fixtures on both sides: fixed instants
(`Date(timeIntervalSince1970:)` / `new Date(ms)`), fixed zone ids, identical
expected outputs. If a test exists on one side and can't be expressed on the
other, the API is probably leaking platform detail — redesign it.

## Dependency rules

- Swift sources: Foundation + Observation only. No UIKit/SwiftUI — views
  belong to AlloyUI (whose rules are in "UI mirroring" below) or to apps.
- TypeScript sources: zero runtime dependencies, no Angular imports. Plain
  Vitest for tests.
- AlloyUI is the sanctioned exception on both sides: its Swift sources use
  SwiftUI, and `@allyworld/alloy-ui` is an Angular component library with
  `@angular/core` + `@angular/common` `^21.0.0` as peer dependencies.
- AlloyAudio's platform edge is the second sanctioned exception: its Swift
  side uses AVFoundation (`AVSynthEngine`, `BundleSampleSource`); its web
  side touches WebAudio only through the `MinimalAudioContext` seam in
  `audio-graph.ts`. The engine core on both sides stays pure.
- Alloy libraries do not depend on each other across domains: alloy-ui and
  AlloyAudio never import alloy-time/AlloyTime. Where a shape overlaps
  (`ZonePickerOption` vs `TimeZoneOption`), the UI library declares its own
  structurally compatible type and the app bridges.

## Change protocol

1. Design the API on the web side first (or update it there first).
2. Port to Swift in the same change set — twins never ship half-updated.
3. Regenerate data tables if the source changed.
4. Run both test suites before tagging.

## UI mirroring (AlloyUI)

UI twins are semantic mirrors, not transliterations. The web and iOS implementations share the same **component names, semantic roles, and behavioral contracts** — apply-on-close sheets, consistent dismissal paths, synchronized auto-hide timing, and identical selected/disabled a11y states — while keeping internals idiomatic per platform. The sheet twins (`SheetComponent` ↔ `GlassSheet`) both accept an optional panel max width (`maxWidth` input / `maxWidth: CGFloat?`), default unconstrained: a constrained panel centers while the backdrop still fills the screen.

**Token generation is the hard-shared layer.** `tokens.json` is the single source of truth for colors, durations, and sizes, fed through `tools/generate-tokens.mjs` to emit:
- `web/packages/alloy-ui/src/styles/_tokens.scss` (SCSS variables used by components)
- `web/packages/alloy-ui/src/lib/tokens.ts` (TypeScript exports for code paths)
- `swift/Sources/AlloyUI/AlloyTokens.swift` (Swift enum namespaces)

Note the encoding difference: `durationMs` in JSON are milliseconds on web, translated to seconds (÷1000) in Swift's `TimeInterval`. `sizePx` entries carry no such conversion — they are raw px, rendered unit-identically on every platform: `$k: Npx` in SCSS, `K_PX = N` in TS, and `CGFloat` points in Swift (e.g. `sizePx.sheet-corner-radius: 24` → `$sheet-corner-radius: 24px` / `SHEET_CORNER_RADIUS_PX = 24` / `sheetCornerRadius: CGFloat = 24`).

**Sanctioned naming exception:** web `AutoHideDirective`'s `revealBlocked` input ↔ Swift `AutoHideModel.suppressed`. `suppressed` is deliberately wider than `revealBlocked`: it also drives the Swift-only `effectivelyVisible` convenience (`visible && !suppressed`), which hosts bind opacity/hit-testing to. Web has no `effectivelyVisible` counterpart — hosts there read `visible` and `revealBlocked` directly.

**Documented asymmetries** are intentional and recorded here:
- **Icon path data** is web-only. iOS renders real SF Symbols by the same semantic name (e.g., "pencil" maps to `Image(systemName: "pencil")`); the web layer holds SVG path data only as needed by the DOM.
- **NavHeaderComponent** is web-only. iOS lacks a direct counterpart; GlassSheet's title row fills that semantic role instead (top-level sheet title + layout anchoring). The nav-header's `navTrailing` slot mirrors onto GlassSheet's optional `trailing: GlassSheetAction` — a header button opposite the X.
- **Overlay trio** is web-only (spec:
  `docs/superpowers/specs/2026-07-11-alloy-ui-overlays-design.md`): the
  snackbar (`AlloySnackbar` + `SnackbarHostComponent`), confirm/alert dialog
  (`AlloyDialog` + `DialogHostComponent`), inline `SpinnerComponent`, and
  ref-counted busy overlay (`AlloyBusy` + `BusyHostComponent`), composed by
  the `OverlaysComponent` outlet (`<app-overlays />`, placed once per app).
  Apple apps use native affordances instead (`.alert`, `ProgressView`);
  snackbars are non-native to Apple platforms. Their durations
  (`durationMs.snackbar-show`, `durationMs.overlay-fade`) live in
  `tokens.json` and emit to all three outputs regardless. Revisit Swift
  twins only on demonstrated app need.
- **Form kit** is web-only (spec:
  `docs/superpowers/specs/2026-07-13-alloy-ui-form-kit-design.md`):
  `ButtonComponent`, `TextFieldComponent`, `NumberFieldComponent`,
  `SelectComponent`, `FieldComponent`, and the declarative
  `FormDialogComponent`, plus the internal `ModalDirective` (`dialog[alloyModal]`)
  that now backs both the form dialog and the confirm/alert
  `DialogHostComponent`.
  Apple apps use native SwiftUI `TextField` / `Picker` / `Form` instead.
  Two-way binding uses Angular `model()` signals, so `@angular/forms` is NOT
  a dependency. The kit's colors (`color.field-bg`, `color.field-border`,
  `color.focus-ring`) live in `tokens.json` and emit to all three outputs
  regardless; the Swift constants are unused. Segmented rows reuse
  `KnobSegmentComponent` — there is no second segmented control.
- **Knobs row** — web's card/label are stylesheet classes, not components. Web exports `_knobs.scss` classes (`cfg`, `knobs-panel`, `knobs-section`, `knobs-section-label`, `knobs-pair`, `knobs-cell`, `knobs-row`, `knobs-toggle`, `knobs-segment`, `knobs-slider`) + three attach-in-place controls (`KnobToggleComponent`, `KnobSegmentComponent`, `KnobSliderDirective`). iOS exports seven views (`KnobCard`, `KnobLabel`, `KnobToggle`, `KnobSwitch`, `KnobSegment`, `KnobField`, `KnobSlider`) + `knobColumns` helper function. `KnobSlider` is the twin of `KnobSliderDirective`; `KnobSwitch` is the twin of `KnobToggleComponent` (the bare pill, hosts compose the row); `KnobToggle` is the label-above convenience composition (KnobLabel + KnobSwitch) with no web component twin — web hosts compose the same arrangement from classes. The asymmetry is intentional: web markup applies classes; iOS markup composes views. `KnobField` has no library-side web twin: its web counterpart, `.knobs-tz`, stayed app-local in allyclock rather than joining the shared stylesheet.
- **Chrome sizes** — sheet corner radius is now tokenized (`sizePx.sheet-corner-radius: 24`; see "Token generation" above). Button height and padding remain untokenized: web buttons are 34 px, iOS buttons are 36 pt — deliberately left asymmetric to avoid pixel churn during iteration. Tokenize the rest when they stabilize.
- **Flag artwork** is app-supplied on both sides, but addressed differently: web composes a URL under an injectable base path (`provideAlloyFlags`, default `flags/1x1`); Apple resolves `<assetPrefix><code>` (default `Flags/`) in an injectable bundle. Same fallback contract: blank code or missing artwork renders the `globe` icon.
- **Zone picker back/cancel** is host-side on the web and dropped on Apple platforms (the sheet's X is the cancel). The Apple twin takes a `listHeight` the web expresses in CSS (`max-height: 45vh`). The filter contract is twin-tested: case-insensitive substring over the full label; `ZonePickerOption { id, label }` is the shared shape on both sides.

## Audio mirroring (AlloyAudio)

Strict-regime core, semantic-regime engines — per the independence direction
doc and the phase-4 spec (2026-07-09).

**Strict (twin-tested, identical fixtures):** the `SynthEngine` interface
(`noteOn`/`noteOff`/`setSustain`/`setInstrument`/`allNotesOff`),
`SynthEngineCore` (polyphony + sustain-pedal latching, DI'd `playerFor` +
`now`; inert until an instrument is selected), the `VoicePlayer` contracts,
pitch math, voice spec types + `InstrumentDescriptor`, and `sampleFileName`
+ nearest-zone lookup (equidistant prefers the lower zone). Instrument ids
are opaque strings; instrument catalogs are app-side.

**Semantic (per-platform by design):** the web plays voices through native
WebAudio nodes behind `MinimalAudioContext`; Swift renders voices per-sample
by hand (`Oscillator`, `BiquadLowpass`, `ParamRamp`) inside an
`AVAudioSourceNode`. The alignment contract is the three AudioParam
scheduling primitives (`setValueAtTime` / `linearRampToValueAtTime` /
`setTargetAtTime`) mirrored by `ParamRamp`, plus pinned shared constants
(`VOICE_PEAK` 0.3, `FAST_STOP_S` 0.03, and the master-bus limiter/reverb/
delay values).

**Sanctioned naming exception:** TS `ActiveVoice` ↔ Swift
`ActiveVoiceHandle` (name-clash avoidance with the render-loop voice
protocol, which is Swift-only — renamed `MixerVoice` in phase 1b when the
twin patch `Voice` class claimed the canonical name on both platforms).

**Documented asymmetries:** the render-loop layer (`MixerVoice`, `VoiceMixer`,
`ChannelCommandQueue`) is Swift-only — the browser exposes no user-visible
audio thread. `MasterChain`/`generateImpulseResponse` are web-only — Swift
builds the equivalent bus inside `AVSynthEngine` from AVFoundation units.
Sample assets ship with apps, never with Alloy; the shared contract is the
naming convention (zero-padded MIDI + `.mp3`) and the zone-list arithmetic.

**Rompler core (phase 1b, strict, twin-tested):** the `Patch` wire schema
(`PatchMeta`, `KeyRange`, `VelRange`, `GeneratorSpec`, `TvfParams`,
`TvaParams`, `LfoRouting`, `PatchLayer`, `PatchSends`) plus `validatePatch`
(non-throwing on both platforms — an array of error strings, empty = safe to
construct voices from); `Voice` (per-note generator → TVF → TVA chain,
per-sample TVA, control-rate TVF envelope + LFO ticked at an absolute
samplePos so behavior — including the layer-liveness latch that governs the
dead-unit skip and the `active`/render-return signal — is identical
regardless of how render() calls are chunked); `PatchEngine` (polyphonic
voice pool over a sample-position transport clock, sample-accurate event
scheduling, voice stealing); `renderPatch` (the offline golden-test/bounce
harness, fixed 128-frame blocks). Golden-render twin tests pin three 8-sample
probe windows per patch (one per generator kind: fm, va, organ/additive,
sample) with `toBeCloseTo(..., 4)` / `XCTAssertEqual(..., accuracy: 1e-4)` —
looser than the 1e-6 twin-reference tolerance used elsewhere in AlloyAudio
because the golden patches stack multiple modulated layers, so tiny
transcendental-function differences between platforms compound over the
render.

**Sanctioned asymmetries (rompler core):**
- `PatchEngine.setPatch` throws on validation errors on TS (`Error` joining
  the messages with `; `) ↔ returns `[String]` on Swift (empty = accepted,
  `@discardableResult`); Swift callers check the return value instead of
  catching, matching Swift's non-throwing-by-default idiom for expected
  rejection paths.
- `EngineEvent` is a TS discriminated union
  (`{ frame, kind: 'noteOn' | 'noteOff' | 'allNotesOff', ... }`) ↔ a Swift
  `struct EngineEvent { let frame: Int; let kind: Kind }` with a nested
  `Kind` enum carrying associated values (`.noteOn(midi:velocity:)`,
  `.noteOff(midi:)`, `.allNotesOff`) — same shape, each language's idiomatic
  sum-type encoding.
- `validatePatch`'s va-generator seed check: TS validates `seed` is an
  integer in `0...0xffffffff` at runtime because the wire type is a plain
  `number`; Swift's `GeneratorSpec.va` seed is typed `UInt32`, so the same
  range is already enforced by the decoder — Swift adds no runtime check
  (an unreachable one would be lint-flagged) and instead carries a comment
  pointing back to this entry.

**Rompler hosts (phase 1b-ii, semantic twins — platform edges):**
`WorkletHostCore` + `WorkletSynthHost` (web) ↔ `PatchCommandQueue` +
`PatchEngineHost` (Apple). Both wrap the same `PatchEngine` with the same
discipline — commands cross to the render context in a FIFO applied only at
render-block starts, at most 512 per block (`MAX_COMMANDS_PER_BLOCK` /
`maxCommandsPerBlock`), invalid patches are dropped with their
`validatePatch` errors surfaced, zone sets live in render-context-owned
storage behind the engine's `zoneSetProvider`, and render paths allocate
only the sanctioned drain hand-off plus voice construction at note starts,
with no throwing path reachable from the shells' fixed 128-frame quantum
(the engine's >4096-frame guard is unreachable there; the Apple host also
slices arbitrary callback sizes). Host render signatures are stereo (phase
2a — see the stereo bus contract below):
`WorkletHostCore.render(left, right, frames, postReply)` ↔
`PatchEngineHost.render(intoLeft:right:frames:)`. The flagship property both
platforms pin in tests: driving the host path with the golden fixtures is
**bit-exactly equal** to `renderPatch` on BOTH channels (plain equality, no
tolerance — same core, same schedule order).

**Sanctioned asymmetries (rompler hosts):**
- Frame domains: worklet messages carry absolute CONTEXT frames
  (`AudioWorkletGlobalScope.currentFrame` timebase; the core anchors at
  construction and subtracts) ↔ Apple commands carry absolute ENGINE
  frames (the host transport). Each matches its platform's native clock.
- Patch rejection surfaces: a `patchRejected` port reply message (web,
  async boundary) ↔ an `onPatchRejected` callback invoked from the render
  drain (Apple).
- The untestable shells are logic-free by design: the
  `AudioWorkletProcessor` subclass (browser-only globals) and the
  `AVAudioSourceNode` render block each delegate everything to the tested
  core/host render function. The Apple shell's one added piece of logic
  (still sanctioned as shell-local, not core) is its channel mapping: L →
  output channel 0, R → channel 1 on stereo-or-wider outputs (channels past
  the pair cleared), `(L+R)*0.5` downmix on a single-channel output — the
  same mapping the worklet shell applies, mirrored rather than shared since
  there is no cross-platform shell code.
- `PatchEngineHost.makeSourceNode()` builds its `AVAudioSourceNode` with an
  explicit stereo `AVAudioFormat` at the host's own sample rate (the
  `AVSynthEngine` pattern), so a hardware/engine rate mismatch converts
  through Core Audio instead of silently detuning — closing the 1b-ii
  deferral. Web has no analogous step: `AudioWorkletProcessor` always runs
  at the `AudioContext`'s rate, so there is no format to negotiate.
  One source node per host: a second `makeSourceNode()` call shares the
  host's engine, transport, and command queue rather than getting an
  independent one — construct a second `PatchEngineHost` for a second,
  independently-clocked node. The node's render-thread scratch pair is
  preallocated at the same 4096-frame cap as the engine slice size (no
  render-thread regrowth); a callback asking for more frames in one call
  renders real audio up to the cap and silence for the remainder, and trips
  an `assertionFailure` in debug builds — this shouldn't happen in practice
  since hosts hand out block-sized callbacks well under 4096 frames.

**Rompler effects (phase 2a + 2b, strict, twin-tested):** `EffectUnit`
(`process(left, right, frames)` in place; `reset()` clears internal state;
`process()` must not allocate or throw) plus `InsertSpec` /
`ChorusParams` / `TremoloParams` / `PhaserParams` / `RotaryParams` /
`DriveEqParams` / `CompressorParams` under `DSP/Effects/`
(`dsp/effects/effect-types.ts` ↔ `DSP/Effects/EffectTypes.swift`) —
`validateInsert` (non-throwing, empty = safe to construct) and
`createInsert` (the `setPatch`-time factory). `MAX_INSERTS` is 3.
`Patch.inserts` stays an optional array (`InsertSpec[]` / `[InsertSpec]?`);
`PATCH_SCHEMA_VERSION` stays 1 — inserts are an additive field, not a schema
bump, and insert-free patches validate and render identically to before
phase 2a. Control-heavy math (tan/log/pow) runs at a shared control-rate
tick, `EFFECT_CONTROL_INTERVAL` / `EffectConstants.controlInterval` = 16
samples — same two-rate philosophy as the voice's `CONTROL_INTERVAL`;
phaser's swept allpass coefficient and the compressor's gain recompute on
this tick, while rotary and drive-EQ are cheap enough to stay fully
per-sample.

The full six-kind `InsertSpec` union (identical wire shape both platforms,
payload field = kind name):
```ts
export type InsertSpec =
  | { kind: 'chorus'; chorus: ChorusParams }
  | { kind: 'tremolo'; tremolo: TremoloParams }
  | { kind: 'phaser'; phaser: PhaserParams }
  | { kind: 'rotary'; rotary: RotaryParams }
  | { kind: 'driveEq'; driveEq: DriveEqParams }
  | { kind: 'compressor'; compressor: CompressorParams };
```

Six insert kinds, all twin-tested against pinned constants
(web `stereo-chorus.ts` ↔ `StereoChorus.swift`, `tremolo-auto-pan.ts` ↔
`TremoloAutoPan.swift`, `phaser.ts` ↔ `Phaser.swift`, `rotary-speaker.ts` ↔
`RotarySpeaker.swift`, `drive-eq.ts` ↔ `DriveEq.swift`, `compressor.ts` ↔
`Compressor.swift`):
- **Chorus/ensemble** (`ChorusParams.mode: 'chorus' | 'ensemble'`): sums the
  incoming stereo pair to mono into one circular delay buffer, then reads
  back 2 (`chorus`) or 3 (`ensemble`) linearly-interpolated taps whose delay
  sweeps sinusoidally around `BASE_DELAY_MS` (7 ms), each tap at its own
  phase offset (`CHORUS_OFFSETS` `[0, 0.25]`; `ENSEMBLE_OFFSETS`
  `[0, 1/3, 2/3]`) so the taps drift in and out of alignment with each
  other. `chorus` mode routes tap 0 to L and tap 1 to R directly; `ensemble`
  mixes all taps down to L/R with fixed weights (`ENSEMBLE_WEIGHTS_L`
  `[0.55, 0.3, 0.15]` / `ENSEMBLE_WEIGHTS_R` `[0.15, 0.3, 0.55]`). `mix` is
  a plain per-sample dry/wet crossfade.
- **Tremolo/auto-pan**: an amplitude LFO applied independently to L and R,
  with R's phase offset from L's by `spread` half-turns (`Math.PI * spread`
  / `.pi * spread`) — `spread` 0 keeps both channels in phase (classic
  tremolo), `spread` 1 puts them a half-cycle apart (hard auto-pan; L and R
  gains swap peaks and troughs). `depth` scales the LFO's excursion below
  unity gain.
- **Phaser** (`PhaserParams.stages: 4 | 8`): per channel, a chain of
  `stages` first-order allpass filters (one-multiply form,
  `H(z) = (-c + z^-1)/(1 - c z^-1)`, `|H| = 1`) sharing one swept
  coefficient, plus feedback from the chain's last output. The sweep
  frequency is exponential between `PHASER_F_MIN` (200 Hz) and
  `PHASER_F_MAX` (2200 Hz); L and R use the same LFO phase but quadrature
  offsets (L 0, R 0.25 — same convention as chorus), so the two channels'
  notches move independently and decorrelate. `feedback` (0..0.9) feeds the
  chain's last output back into its input; `mix` is the dry/wet crossfade.
- **RotarySpeaker** (`RotaryParams.speed: 'slow' | 'fast'`, baked per patch
  — no live-switch path yet): mono-sums the input through a one-pole
  crossover at 800 Hz, then applies opposed-pan AM per band ("polished over
  realistic" — amplitude + pan, no doppler). Rotor rates: fast horn 6.6 Hz /
  drum 5.7 Hz; slow horn 0.8 Hz / drum 0.7 Hz. Gains are unity-centered
  (`1 + depth * sin(...)`, swinging 0..2) so `depth` 0 leaves each channel
  carrying the full crossover-flat mono sum — matching the engine's unity
  mono→stereo convention.
- **DriveEq** (`DriveEqParams`): per channel, in fixed order drive → low
  shelf → mid peak → high shelf → level. `drive` (0..1) sets
  `preGain = 1 + drive * 4` ahead of a `tanh` saturator. The EQ stages are
  pinned at low shelf 250 Hz, mid peak 1000 Hz (Q 0.707, via the shared
  `Svf` bandpass), high shelf 3000 Hz — each a one-pole (or SVF, for the
  mid) gain stage computed from its `*Db` param (`10 ** (db / 20)`), -12..12
  dB range. `levelDb` is a final output trim.
- **Compressor** (`CompressorParams`): stereo-linked feed-forward. The
  detector runs per-sample on `d = max(|L|, |R|)`, smoothed by an
  attack/release envelope follower (`attackMs`/`releaseMs`, exponential
  time constants) — same detector signal drives both channels' gain, so a
  loud transient on one channel compresses both identically (no
  independent-channel pumping). The gain computer runs at
  `EFFECT_CONTROL_INTERVAL`: converts the envelope to dB, computes
  `over = max(0, envDb - thresholdDb)`, `reductionDb = over * (1 - 1/ratio)`,
  and applies `makeupDb`, holding the resulting linear gain constant across
  the tick before the next recompute.

**Stereo bus contract (`PatchEngine`):** voices stay mono, unchanged from
phase 1b. Per `process()` segment, the summed mono voice bus is copied to a
stereo scratch pair at unity — **insert-free ⇒ L === R === the old mono
output, bit-exact** (the phase 1b golden fixtures are re-pinned on both
channels rather than re-baselined, and `PATCH_VA`/`PATCH_SAMPLE` stay
insert-free specifically to pin this bypass path) — then the patch's
ordered insert chain (`Patch.inserts`, applied in array order) processes the
pair in place, and the result ADDS into the caller's left/right buffers.
The insert chain is rebuilt only inside `setPatch` (never inside
`process()` — no render-thread allocation from insert construction); it is
one shared chain, never reset on note events, so effect tails (delay lines,
LFO phase) ring continuously across notes AND across `setPatch` calls —
voices still sounding on an old patch render through the NEW chain (a
hardware-like patch transition; per-generation insert chains are an
explicit non-goal, documented on `setPatch`).

**Sanctioned asymmetries (rompler effects):** none beyond the rompler-core
and rompler-hosts entries above — `EffectUnit`, `InsertSpec`, and all six
insert kinds are strict twins with identical, pinned numeric constants.

**Rompler pack pipeline (phase 3a + 3b, mixed regime):** the offline
`tools/samplepack/` pipeline feeds a twinned runtime under `pack/` on both
platforms (`web/packages/alloy-audio/src/pack/` ↔
`swift/Sources/AlloyAudio/Pack/`):
- `PackManifest` / `validateManifest` — identical JSON schema both sides
  (`schemaVersion`, `id`, `tier: 'tiny' | 'standard' | 'hq'`, `sampleRate`,
  `format: 'm4a'`, `zoneSets: Record<string, { layers: LayerSpec[] }>`,
  `LayerSpec { topVelocity, zones }`, `ZoneSpec { rootMidi, file, gain,
  tuneCents, loopStart?, loopEnd? }`, `credits`); non-throwing, `string[]`
  errors, empty = safe to construct from, on both platforms.
- `PackSource` + `BasePathPackSource` — the byte origin. Both fetch
  `${base}/manifest.json` and `${base}/<file>` through an injected
  `FetchFn`: web injects `globalThis.fetch` or a test double behind a
  minimal `{ json(); arrayBuffer() }` surface; Swift injects a fetch
  closure (`(String) async throws -> Data`, backed by `URLSession` in
  production) or a test double. `fetchManifest()` runs `validateManifest`
  immediately and throws on any error on both sides.
- `SampleDecoder` — the decode seam, and AlloyAudio's third sanctioned
  platform edge (alongside the WebAudio/AVFoundation engine split and the
  render-loop asymmetry above): web's `WebAudioDecoder` (WebAudio
  `decodeAudioData`) and Swift's `AVAudioFileDecoder` (`AVAudioFile`,
  landed phase 3b, public alongside `public enum SampleDecoderError`) are
  deliberately NOT identical implementations, but share one contract —
  any channel count is averaged to mono at equal weight, and the decoded
  file's own sample rate is reported (never resampled to a fixed rate).
- `PackLoader` — a stateful `ZoneSetProvider` (the `(zoneSetId) =>
  VelocityLayerData[] | null` / `(String) -> [VelocityLayerData]?` seam
  defined in `dsp/voice.ts` ↔ `DSP/Voice.swift`). `provide` returns
  null/nil until that zone set has finished decoding — progressive
  delivery, which falls out of `Voice`'s existing "unresolvable zoneSetId
  = layer inactive" behavior with no engine change. Both platforms iterate
  `manifest.zoneSets` keys **sorted** (`Object.keys(...).sort()` ↔
  `manifest.zoneSets.keys.sorted()`) so progressive load order is
  twin-stable even though only Swift's `Dictionary` iteration order is
  actually unspecified.
- **Equal-power velocity-layer gain law** (`SampleZoneGenerator.pickLayers`,
  `dsp/sample-zone-generator.ts` ↔ `DSP/SampleZoneGenerator.swift`) is a
  twin-tested behavioral contract, not an implementation detail: crossfade
  gains between adjacent velocity layers are `sqrt(u)` / `sqrt(1-u)` (power
  sums to 1), NOT linear (`u` / `1-u`, amplitude sums to 1). This is
  deliberate — the layers are different, uncorrelated hammer strikes, so
  they add in power; linear gains put an audible ~3 dB (measured -5.3 dB on
  the real piano pack) notch at every layer boundary. Do not "simplify"
  this back to linear. Twin-tested: `sample-zone-generator.spec.ts` ↔
  `SampleZoneGeneratorTests.swift`, both asserting the boundary gain sum is
  `Math.SQRT2` / `2.0.squareRoot()` and stays bounded in `[1, sqrt(2)]`
  across the crossfade window.

**FM anti-aliasing (phase 3c, strict, twin-tested):** `dsp/fm-oversampling.ts`
↔ `DSP/FmOversampling.swift`. `FmGenerator` renders its operator loop at K times
the output rate and decimates back down, where K is chosen per VOICE:

- `FM_OVERSAMPLING` = **4** on both platforms, and `FM_DECIMATION_TAPS` is a
  **32-tap pinned constant, identical to the last digit in both twins** — a
  Blackman-windowed sinc, cutoff 0.45/4 of the oversampled rate, normalized to
  unity DC gain. It must NEVER be computed at runtime: JS `Math.sin` and Swift
  `sin` may differ in the last ulp, which would silently diverge the twins'
  audio while every structural test still passed. `FmDecimator.output()` is
  textbook convolution — `taps[0]` multiplies the NEWEST sample — and depends on
  no symmetry of the table (the table is near-symmetric but NOT bit-exactly
  palindromic: 10 of its 16 mirror pairs differ in the last ulps, so an
  implementation that leaned on symmetry would be resting on a false premise).
  `output()` walks the ring as two contiguous runs rather than `% n` per tap;
  a twin test pins that this is BIT-identical to the naive modulo convolution
  (exact equality, no tolerance), since it is the same taps over the same
  samples in the same summation order.
- `chooseOversampling(maxOpFrequency, sampleRate)` — threshold `sampleRate / 4`,
  **exclusive** (`maxOpFrequency > sampleRate/4`; exactly at the threshold, K=1).
  A pure function of the note and the patch: deterministic, twin-identical, and
  decided ONCE per `noteOn`. `setPitchRatio` deliberately does NOT re-decide it
  mid-note — switching K under a sounding voice would glitch.
- **Pitch modulation is priced into K, not clamped out of the patch.** Because K
  is committed at `noteOn`, `maxOpFrequency` must be the worst case the note can
  reach while it sounds:
  `midiToFrequency(midi) * max(op.ratio) * maxPitchModRatio(toPitchCents)`, where
  `maxPitchModRatio(c) = 2 ** (|c| / 1200)` — the LFO's peak (its value is in
  [-1, 1], and a negative depth still bends UP on the negative half-cycle). A
  `PatchLayer` has at most one `mod` route, so this is a single term today; a
  second route to pitch would make it the sum of the absolute depths. `Voice`
  passes `layer.mod?.toPitchCents ?? 0` into `FmGenerator`'s constructor
  (`pitchModCents`, default 0 → ratio exactly 1 → K and CPU unchanged for every
  patch without vibrato). Without this, a 1200-cent vibrato route on midi 80 with
  a ratio-14 modulator renders at K=1 while the LFO sweeps the modulator to
  23.3 kHz — measured -25 dB of foldback, i.e. the exact bug phase 3c exists to
  kill. Twin-tested on both sides.
- **The behavioral contract that matters most: operator envelopes step once per
  OUTPUT sample, held constant across the K sub-samples.** This is what keeps the
  K=1 path bit-identical to the pre-3c code, and therefore what keeps the golden
  renders stable. A future contributor who "tidies" the envelope step back inside
  the oversampled operator loop will silently break twin golden agreement — on
  both platforms at once, so the goldens will still AGREE while both are wrong.
- `FmGenerator.oversampling` is a read-only accessor (the chosen K) on both
  sides, exposed for tests only.

**Patch workbench (phase 4a) is deliberately web-only.** The patch editor and
its harness wiring (`examples/web-harness/src/app/rompler/`) are a private
authoring tool for the phase-4b factory bank, in the same spirit as the
`tools/samplepack/` pipeline: they live in a harness that is never packed,
tagged, or released, and consume only the existing public `alloy-audio` API
(`Patch`, `validatePatch`, `WorkletSynthHost`). The workbench adds **no**
library surface and requires **no** Swift twin — it is outside the twin
contract entirely. Do not "fix" this asymmetry by porting it.

**Policy — param-level string-enum runtime validation:** whenever an
`InsertSpec` param field's TS type is a string-literal union (e.g.
`RotaryParams.speed: 'slow' | 'fast'`, `ChorusParams.mode: 'chorus' |
'ensemble'`), the TS validator MUST include a runtime check rejecting values
outside that union — the wire type is a plain `string`, so nothing else
stops a bad JSON payload from reaching the field. Swift needs no equivalent
check: the field is typed as a `String, Codable` enum (`RotarySpeed`,
`ChorusMode`), so `Decodable` rejects an unrecognized raw value
structurally before the validator ever runs, the same pattern as
`validatePatch`'s va-generator seed check above. `rotary.speed` carried this
check from its introduction; `chorus.mode` predated the policy and was
retrofitted in phase 2b's closing task (`validateChorusParams` in
`effect-types.ts`, plus a small TS test — Swift's `ChorusMode` already had
the structural guarantee, so no Swift change was needed). The same policy
applies to numeric-literal unions (e.g. `PhaserParams.stages: 4 | 8`, plain
`Int` on Swift): BOTH platforms need the runtime check there, since neither
type system narrows the wire value structurally.

## AlloyStorage

Storage abstraction + backends (`@allyworld/alloy-storage` ↔ `AlloyStorage`).

**Strict regime** (identical API, twin fixtures — the backend contract suite and
the StorageError table run the same scenarios and instants on both platforms):

- `StorageRecordMeta` / `StorageRecord` (TS `updatedAt: number` epoch ms ↔ Swift
  `updatedAt: Date` — the platform-time rule above)
- `StorageBackend` (`list`/`read`/`write`/`delete`; list is metadata-only,
  read misses resolve null/nil, delete is idempotent)
- `AuthProvider` + `AuthState`
- `StorageError` with `fromHttpStatus` ↔ `fromHTTPStatus` mapping
  (401/403→auth, 404→notFound, 409/412→conflict, 429→quota, else unreachable)
- `DriveClient` method surface + Drive query strings; `DriveBackend` semantics
  (folder-path resolution, id cache + one 404 re-resolve, per-id write chains,
  `alloyId`/`alloySavedAt` writes with legacy `allyscoreId`/`savedAt` reads)
- `PKCE` helpers (RFC 7636 vector as the twin fixture)
- `GoogleAuth` refresh state machine (5-minute proactive margin; rejected grant
  clears stored tokens → `expired` (web keys on 401 from the token service,
  Swift on Google 4xx since Google returns 400 for invalid_grant); 5xx and
  network failures keep the refresh token)
- `ShareStatus` / `Shareable` (`shareStatus`/`share`/`unshare` in the app's
  record-id namespace; `nativeRef` is the backend-native link handle; share
  is idempotent, missing record → notFound; local backends deliberately do
  not implement it — TS `isShareable()` ↔ Swift `as? any Shareable`)
- `DrivePublic.fetchSharedFile` ↔ `fetchSharedFile` (auth-free public fetch:
  `alt=media` + API key; 404→notFound, 403→auth; injected fetch/transport)
- Drive permission wire format (create anyone-reader POST, `fields=
  permissions(id,type)` check, find-then-DELETE) — kept NON-public on both
  platforms (TS `@internal` doc, Swift `internal`), per the capability-only
  decision in the sharing spec
- `SignInResult` / `SignInFailureReason` (success | cancelled |
  failed(reason, detail, status?); returned by web `completeSignIn` ↔ Apple
  `signIn`; `cancelled` is Apple-only in practice — the web redirect flow
  has no cancel signal) (edge asymmetry: an undecodable 2xx token response
  reports exchangeFailed WITH status on Apple; on web the JSON parse
  happens inside post() so it folds into the no-status unreachable path —
  detail strings are unmirrored by design)

**Semantic regime** (same behavior, platform-appropriate shape):

- Transport seam: TS injected `fetch` ↔ Swift `HTTPTransport`/`URLSessionTransport`
- Local replica: `BrowserStorageBackend` (IndexedDB) ↔ `LocalStorageBackend`
  (FileManager under Application Support)
- Folder-id cache: TS `Storage` (localStorage) ↔ Swift `UserDefaults`
- Token persistence: `TokenStore`/`IndexedDbTokenStore` ↔ `TokenVault`/`KeychainTokenVault`
- Sign-in shape: web `beginSignIn()`/`completeSignIn(callbackUrl)` (page
  redirect via the shared `services/google-oauth` token function — web needs a
  confidential client) ↔ Apple `signIn()` (in-process
  `ASWebAuthenticationSession`, iOS-type client, no backend, no secret)
- One-call wiring: `createDriveStorage(config, deps?)` ↔ `DriveStorage(config:…)`
  — config fields differ per platform exactly as GoogleAuthConfig does
  (web: redirectUri + tokenServiceUrl; Apple: redirectScheme); scope
  defaults to drive.file on both
- `CryptoKit`/`AuthenticationServices`/`Security` imports are confined to
  `Auth/`; everything else stays Foundation + Observation.
