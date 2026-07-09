# AlloyUI — Shared UI Kit for the Ally App Series

**Date:** 2026-07-08
**Status:** Approved
**Scope:** Phase 2 of Alloy. One spec, two implementation plans: 2a (core kit +
adoption), 2b (Knobs).

## Purpose

allyclock and AllyPiano carry drifted copies of the same UI primitives
(`icon`, `icon-button`, `sheet`, `nav-header`, `auto-hide` exist in both web
apps with 40–70-line diffs; allyclock's iOS `Shared/` has the SwiftUI
equivalents). AlloyUI is the canonical kit: liquid-glass panels, glass icon
buttons, overlay chrome, knob controls, the SF-named icon layer, and the
design tokens they all draw from — so every Ally app looks and behaves like
one family.

**Decisions locked during brainstorm:**

- Web packaging: real Angular library (`@allyworld/alloy-ui`, ng-packagr,
  Angular `^21` as peerDependency) — not styles-only, not source-sync.
- v1 scope: full kit including Knobs (Knobs sequenced last, own plan).
- Drift policy: **allyclock canonical.** Piano-only capabilities become
  component inputs/slots; Piano-only icons join the union registry; Piano
  adapts to canonical behavior where they conflict.
- Adopters this phase: allyclock on BOTH platforms, AllyPiano on web only
  (its iOS app is embryonic; it adopts AlloyUI from day one when built).

## Packaging

### Web — `@allyworld/alloy-ui`

- Lives at `web/packages/alloy-ui` in the existing npm workspace.
- Built with ng-packagr via an `angular.json` added at `web/` (projects entry
  pointing into the package); tested with `@angular/build:unit-test` (Vitest),
  the same builder the apps use. Workspace root `web/package.json` gains the
  Angular dev tooling.
- `@angular/core`/`common` are peerDependencies (`^21.0.0`). `alloy-time`
  is NOT a dependency — the kit is time-agnostic.
- Released exactly like alloy-time: `npm pack` output attached as a second
  tarball asset on the same GitHub release/tag. SCSS ships in the package
  (`styles/` export) for tokens and mixins.

### iOS — `AlloyUI` product

- New target `swift/Sources/AlloyUI` (+ `swift/Tests/AlloyUITests`) in the
  existing `Alloy` Swift package; second product alongside `AlloyTime`.
- MAY import SwiftUI (unlike AlloyTime's Foundation-only rule). No UIKit.
- The package's platforms floor stays iOS 17 / tvOS 17 / watchOS 10 /
  macOS 14 (AlloyTime's floor must not rise). AlloyUI types that use
  newer-OS APIs (Liquid Glass) carry `@available(iOS 26.0, *)` annotations
  at the type level — the package compiles at the floor, and iOS-26-only
  apps like allyclock use the kit without `if #available` guards at call
  sites.

### Versioning

One version line for the whole Alloy repo: the next tag (0.2.0) covers
AlloyTime (unchanged) + AlloyUI (new). Each web package gets its own tarball
asset per release.

## The kit (v1)

| Primitive | Web export | iOS export | Canonical source |
|---|---|---|---|
| Tokens | generated `_tokens.scss` | generated `AlloyTokens.swift` | NEW `tokens.json` in Alloy |
| Icon layer | `IconComponent` + `provideAlloyIcons()` | `SFIcon` view | allyclock (union registry) |
| Icon button | `IconButtonComponent` | `GlassIconButton` | allyclock |
| Sheet | `SheetComponent` | `GlassSheet` | allyclock |
| Nav header | `NavHeaderComponent` | — (asymmetry, see Mirroring) | allyclock |
| Auto-hide | `AutoHideDirective` | `AutoHide` modifier | allyclock (iOS: extracted from RootFaceView's scheduleHide) |
| Knobs (plan 2b) | `KnobCard/KnobLabel/KnobToggle/KnobSegment/KnobField` | `Knobs.swift` contents move as-is | allyclock (web side untangled from its settings components) |

### Tokens

- `tokens.json` is the single source: colors (tint `#0a84ff`, surfaces,
  label tiers) and the animation durations shared by sheet/auto-hide.
  Chrome sizes are deferred past v1 — web (34 px) and iOS (36 pt) buttons
  intentionally differ today, and unifying them is a visual change, not an
  extraction.
- A `tools/generate-tokens.mjs` script emits `_tokens.scss`, `tokens.ts`,
  and `AlloyTokens.swift`. Twin tests assert agreement (spot values), the
  zone-country pattern.

### Icon layer

- The shared contract is the **SF Symbol name**. Web renders from an SVG
  path registry (union of allyclock's + Piano's glyphs, allyclock wins on
  conflicts); iOS maps the same name to `Image(systemName:)`.
- The web registry is app-extensible: `provideAlloyIcons({...})` at
  bootstrap merges app-specific glyphs so an app never blocks on an Alloy
  release for one icon. Unknown names render nothing in prod and warn in
  dev mode.
- Inherent asymmetry (documented): path data exists only on web.

### Sheet

- Canonical behavior (from allyclock, already documented in its repo
  memory/conventions): content-hugging glass bottom panel; applies live;
  accepts on ANY dismissal (X, backdrop, Escape on web); no confirm/cancel,
  no rollback.
- Piano's drifted deltas are reconciled as inputs/slots (exact API decided
  in plan 2a from the diff), never as forked behavior.

### Auto-hide

- Web: `AutoHideDirective` (allyclock canonical, Piano's copy retired).
- iOS: the show/schedule-hide state machine currently inline in allyclock's
  `RootFaceView` becomes an `AlloyUI` modifier/utility with the same timing
  tokens as the web.

## Mirroring rules for UI (new section in docs/mirroring.md)

- UI twins are **semantic mirrors, not transliterations**: same names, same
  roles, same behavioral contracts (apply-on-close, dismissal paths,
  auto-hide timing, disabled/selected accessibility states); internals are
  idiomatic per platform.
- Tokens are the hard-shared layer (generated both ways from `tokens.json`).
- Documented asymmetries: icon path data (web-only), `NavHeaderComponent`
  (web-only; `GlassSheet`'s title row is the iOS counterpart).

## Stays app-side (deliberately)

zone-picker + FlagView (zone/asset-bound, allyclock), Piano's
instrument-picker, `LayoutDebug` (allyclock debug tooling),
`ContainerSizeDirective`/`resize-observer` helpers (not yet convergent —
revisit when a third consumer appears).

## Migration & regression net

- **allyclock web:** `shared/ui` shrinks to app-specific pieces; shared
  primitives import from `@allyworld/alloy-ui`. Component specs move to
  Alloy with the code.
- **AllyPiano web:** same swap; where Piano's copies behaved differently,
  Piano moves to canonical behavior (visual diffs expected and accepted
  there — that's the point).
- **allyclock iOS:** `Shared/` files (GlassSheet, Knobs, SFIcon) move into
  the AlloyUI product; FlagView/LayoutDebug/ZonePickerView stay.
- **Hard gates:** allyclock iOS pixel snapshots byte-identical; allyclock
  web suite passes unmodified; Piano web suite green (specs updated only
  where canonical behavior legitimately differs — each such change named in
  the plan/report, never silent).

## Testing

- Component specs travel with the code (TestBed/Vitest on web,
  XCTest + snapshot-friendly design on iOS).
- Token twin tests on both platforms.
- Adoption verified by each app's full existing suite plus a build.

## Risks

- **Angular peer coupling:** both apps are Angular 21 today; the peer range
  pins the kit to a major. Upgrading Angular becomes a coordinated bump
  (accepted — the apps already move together in practice).
- **TestBed infra in Alloy** is new machinery (angular.json, Vitest builder);
  isolated to `web/`, mirrors the apps' own setup.
- **Knob web extraction** is a design-then-extract job, not a move — hence
  plan 2b, so a stall there never blocks the core kit.
- **Piano visual changes:** canonical-behavior adoption may visibly change
  Piano's sheets/chrome; treated as intended convergence, called out in the
  plan.
