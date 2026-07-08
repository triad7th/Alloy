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
