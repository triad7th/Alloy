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
  belong to AlloyUI (which will state its own rules) or to apps.
- TypeScript sources: zero runtime dependencies, no Angular imports. Plain
  Vitest for tests.

## Change protocol

1. Design the API on the web side first (or update it there first).
2. Port to Swift in the same change set — twins never ship half-updated.
3. Regenerate data tables if the source changed.
4. Run both test suites before tagging.

## UI mirroring (AlloyUI)

UI twins are semantic mirrors, not transliterations. The web and iOS implementations share the same **component names, semantic roles, and behavioral contracts** — apply-on-close sheets, consistent dismissal paths, synchronized auto-hide timing, and identical selected/disabled a11y states — while keeping internals idiomatic per platform.

**Token generation is the hard-shared layer.** `tokens.json` is the single source of truth for colors and durations, fed through `tools/generate-tokens.mjs` to emit:
- `web/packages/alloy-ui/src/styles/_tokens.scss` (SCSS variables used by components)
- `web/packages/alloy-ui/src/lib/tokens.ts` (TypeScript exports for code paths)
- `swift/Sources/AlloyUI/AlloyTokens.swift` (Swift enum namespaces)

Note the encoding difference: `durationMs` in JSON are milliseconds on web, translated to seconds (÷1000) in Swift's `TimeInterval`.

**Documented asymmetries** are intentional and recorded here:
- **Icon path data** is web-only. iOS renders real SF Symbols by the same semantic name (e.g., "pencil" maps to `Image(systemName: "pencil")`); the web layer holds SVG path data only as needed by the DOM.
- **NavHeaderComponent** is web-only. iOS lacks a direct counterpart; GlassSheet's title row fills that semantic role instead (top-level sheet title + layout anchoring).
- **Chrome sizes** (button height, padding, corner radius) are not yet tokenized. Web buttons are 34 px, iOS buttons are 36 pt — deliberately left asymmetric to avoid pixel churn during iteration. Tokenize when sizes stabilize.
