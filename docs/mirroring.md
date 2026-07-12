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

**Rompler effects (phase 2a, strict, twin-tested):** `EffectUnit`
(`process(left, right, frames)` in place; `reset()` clears internal state;
`process()` must not allocate or throw) plus `InsertSpec` /
`ChorusParams` / `TremoloParams` under `DSP/Effects/`
(`dsp/effects/effect-types.ts` ↔ `DSP/Effects/EffectTypes.swift`) —
`validateInsert` (non-throwing, empty = safe to construct) and
`createInsert` (the `setPatch`-time factory). `MAX_INSERTS` is 3.
`Patch.inserts` stays an optional array (`InsertSpec[]` / `[InsertSpec]?`);
`PATCH_SCHEMA_VERSION` stays 1 — inserts are an additive field, not a schema
bump, and insert-free patches validate and render identically to before
phase 2a.

Two insert kinds, both twin-tested against pinned constants
(`StereoChorus.ts`/`.swift`, `TremoloAutoPan.ts`/`.swift`):
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
and rompler-hosts entries above — `EffectUnit`, `InsertSpec`, and both
insert kinds are strict twins with identical, pinned numeric constants.

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
