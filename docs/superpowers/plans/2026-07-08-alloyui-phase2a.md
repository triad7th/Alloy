# AlloyUI Phase 2a Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the AlloyUI core kit (tokens, icon layer, icon button, sheet, nav-header, auto-hide) as an Angular library + Swift product in the Alloy repo, and adopt it in allyclock (web + iOS) and AllyPiano (web).

**Architecture:** `@allyworld/alloy-ui` is a real Angular library (ng-packagr, Angular `^21` peer) in the existing `web/` npm workspace, gaining an `angular.json`; the Swift side is a second product `AlloyUI` (SwiftUI allowed) in the existing package. Tokens live once in `tokens.json` and are generated into SCSS, TS, and Swift. allyclock's copies are canonical; adoption uses the phase-1 shim pattern so app-internal imports don't change.

**Tech Stack:** Angular 21 + ng-packagr + Vitest (`@angular/build:unit-test`), Swift 6 / SwiftUI, Node ≥ 20, GitHub release tarballs, SPM tag.

## Global Constraints

- allyclock is canonical for all component behavior; Piano deltas become inputs or die (each named below).
- Selectors and directive names DO NOT change: `app-icon`, `app-icon-button`, `app-sheet`, `app-nav-header`, `[appAutoHide]` — zero template churn in both apps is a design goal.
- Component public APIs (inputs/outputs/signals) stay exactly as allyclock ships them today, except the three reconciliations named in Task 5.
- AlloyTime is untouched; `alloy-ui` must NOT depend on `alloy-time`.
- Swift package platforms floor stays `.iOS(.v17), .tvOS(.v17), .watchOS(.v10), .macOS(.v14)`; AlloyUI types that use Liquid Glass APIs carry `@available(iOS 26.0, *)` at type level. SwiftUI allowed in AlloyUI; no UIKit.
- Tokens v1 = **colors + durations only** (web-canonical values, including `autoHide` 4000 ms — iOS moves from 3 s to 4 s, a named behavior change). Chrome SIZES are deferred: unifying 34 px web vs 36 pt iOS buttons would change pixels and violate the snapshot gate. Task 12 records this deferral in the spec.
- Hard gates: allyclock iOS pixel snapshots byte-identical; allyclock web suite passes with specs unmodified (moved specs excepted); Piano web suite green (spec changes allowed ONLY where canonical behavior legitimately differs, each named in the report).
- Repos: Alloy `/Volumes/AllyDrive/Storage/Repos/Alloy`, allyclock `/Volumes/AllyDrive/Storage/Repos/allyclock`, AllyPiano `/Volumes/AllyDrive/Storage/Repos/AllyPiano`. Never plain `npm install` at any repo ROOT (apps use `npm --prefix apps/web …`; Alloy's workspace root is `web/`).
- Conventional commits. Tasks 1–10 commit in Alloy; 11–12 in allyclock; 13 in AllyPiano.

---

### Task 1: Angular library scaffold (`@allyworld/alloy-ui`)

**Files:**
- Create: `web/angular.json`, `web/packages/alloy-ui/ng-package.json`, `web/packages/alloy-ui/package.json`, `web/packages/alloy-ui/tsconfig.lib.json`, `web/packages/alloy-ui/tsconfig.spec.json`, `web/packages/alloy-ui/src/public-api.ts`, `web/packages/alloy-ui/src/lib/smoke.spec.ts`
- Modify: `web/package.json` (workspace devDependencies + scripts)

**Interfaces:**
- Produces: `npx ng build alloy-ui` and `npx ng test alloy-ui` runnable from `web/`; `dist/alloy-ui` package output that Task 10 packs. Later tasks add exports to `src/public-api.ts`.

- [ ] **Step 1: Add Angular tooling to the workspace root**

In `web/package.json`, add (versions matching allyclock's apps/web/package.json — copy its exact `@angular/*` versions; they are ^21.2.x):
```json
"devDependencies": {
  "@angular/build": "^21.2.0",
  "@angular/common": "^21.2.0",
  "@angular/compiler": "^21.2.0",
  "@angular/compiler-cli": "^21.2.0",
  "@angular/core": "^21.2.0",
  "@angular/platform-browser": "^21.2.0",
  "ng-packagr": "^21.2.0",
  "rxjs": "^7.8.0",
  "typescript": "^5.9.0",
  "vitest": "^3.0.0"
}
```
(Keep the existing scripts; `npm run build/test --workspaces` continues to cover alloy-time. Alloy-ui builds/tests go through `ng`.) Add scripts to `web/package.json`:
```json
"build:ui": "ng build alloy-ui",
"test:ui": "ng test alloy-ui"
```

- [ ] **Step 2: Write the workspace + library config**

`web/angular.json`:
```json
{
  "$schema": "./node_modules/@angular/cli/lib/config/schema.json",
  "version": 1,
  "projects": {
    "alloy-ui": {
      "projectType": "library",
      "root": "packages/alloy-ui",
      "sourceRoot": "packages/alloy-ui/src",
      "prefix": "app",
      "architect": {
        "build": {
          "builder": "@angular/build:ng-packagr",
          "options": { "project": "packages/alloy-ui/ng-package.json" },
          "configurations": {
            "production": { "tsConfig": "packages/alloy-ui/tsconfig.lib.json" }
          },
          "defaultConfiguration": "production"
        },
        "test": {
          "builder": "@angular/build:unit-test",
          "options": {
            "tsConfig": "packages/alloy-ui/tsconfig.spec.json",
            "buildTarget": "alloy-ui:build"
          }
        }
      }
    }
  }
}
```
NOTE for the implementer: `@angular/cli` is needed for `ng`; add `"@angular/cli": "^21.2.0"` to the devDependencies above. If the `@angular/build:unit-test` builder rejects a library `buildTarget`, fall back to running Vitest directly with `@analogjs`-free config — STOP and report BLOCKED instead of improvising if neither works; the exact test wiring may need one adaptation and that's fine to report.

`web/packages/alloy-ui/ng-package.json`:
```json
{
  "$schema": "../../node_modules/ng-packagr/ng-package.schema.json",
  "dest": "../../dist/alloy-ui",
  "lib": { "entryFile": "src/public-api.ts" },
  "assets": [{ "input": "src/styles", "glob": "**/*.scss", "output": "styles" }]
}
```

`web/packages/alloy-ui/package.json`:
```json
{
  "name": "@allyworld/alloy-ui",
  "version": "0.2.0",
  "description": "Shared liquid-glass UI kit for the Ally app series (web twin of AlloyUI)",
  "license": "MIT",
  "repository": { "type": "git", "url": "https://github.com/triad7th/Alloy.git" },
  "peerDependencies": {
    "@angular/common": "^21.0.0",
    "@angular/core": "^21.0.0"
  },
  "sideEffects": false
}
```

`web/packages/alloy-ui/tsconfig.lib.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "preserve",
    "moduleResolution": "bundler",
    "strict": true,
    "declaration": true,
    "experimentalDecorators": false,
    "importHelpers": false,
    "skipLibCheck": true,
    "outDir": "../../dist/out-tsc",
    "types": []
  },
  "include": ["src/**/*.ts"],
  "exclude": ["src/**/*.spec.ts"],
  "angularCompilerOptions": {
    "compilationMode": "partial",
    "strictTemplates": true
  }
}
```

`web/packages/alloy-ui/tsconfig.spec.json`: same as tsconfig.lib.json but `"include": ["src/**/*.ts"]` (specs included) and `"types": ["vitest/globals"]`.

`src/public-api.ts`:
```ts
// Public API of @allyworld/alloy-ui. Later tasks append exports.
export {};
```

`src/lib/smoke.spec.ts`:
```ts
import { describe, expect, it } from 'vitest';

describe('alloy-ui workspace', () => {
  it('runs specs', () => {
    expect(true).toBe(true);
  });
});
```

- [ ] **Step 3: Install and verify**

Run: `cd /Volumes/AllyDrive/Storage/Repos/Alloy/web && npm install && npx ng build alloy-ui && npx ng test alloy-ui`
Expected: build emits `web/dist/alloy-ui/` (package.json + esm output); test runs 1 passing spec. Also confirm alloy-time still passes: `npm test --workspace @allyworld/alloy-time`.

- [ ] **Step 4: Commit** — `git add -A && git commit -m "feat(web): @allyworld/alloy-ui Angular library scaffold (ng-packagr)"`

---

### Task 2: iOS AlloyUI product scaffold

**Files:**
- Modify: `Package.swift`
- Create: `swift/Sources/AlloyUI/AlloyUI.swift`, `swift/Tests/AlloyUITests/PackageSmokeTests.swift`

**Interfaces:**
- Produces: `AlloyUI` product; later tasks add sources. `swift test` covers both products.

- [ ] **Step 1: Extend the manifest**

`Package.swift` products/targets become:
```swift
  products: [
    .library(name: "AlloyTime", targets: ["AlloyTime"]),
    .library(name: "AlloyUI", targets: ["AlloyUI"]),
  ],
  targets: [
    .target(name: "AlloyTime", path: "swift/Sources/AlloyTime"),
    .testTarget(name: "AlloyTimeTests", dependencies: ["AlloyTime"],
                path: "swift/Tests/AlloyTimeTests"),
    .target(name: "AlloyUI", path: "swift/Sources/AlloyUI"),
    .testTarget(name: "AlloyUITests", dependencies: ["AlloyUI"],
                path: "swift/Tests/AlloyUITests"),
  ]
```
(Platforms line unchanged. AlloyUI does NOT depend on AlloyTime.)

`swift/Sources/AlloyUI/AlloyUI.swift`:
```swift
// AlloyUI — shared liquid-glass UI kit for the Ally apps.
// Semantic mirror of @allyworld/alloy-ui (web/packages/alloy-ui).
```

`swift/Tests/AlloyUITests/PackageSmokeTests.swift`:
```swift
import AlloyUI
import XCTest

final class PackageSmokeTests: XCTestCase {
    func test_packageBuildsAndLinks() { XCTAssertTrue(true) }
}
```

- [ ] **Step 2: Verify** — `cd /Volumes/AllyDrive/Storage/Repos/Alloy && swift test` → all AlloyTime tests + 1 new pass.
- [ ] **Step 3: Commit** — `git add -A && git commit -m "feat(swift): AlloyUI product scaffold"`

---

### Task 3: tokens.json + generator + twin tests

**Files:**
- Create: `tokens.json` (repo root), `tools/generate-tokens.mjs`
- Create (generated): `web/packages/alloy-ui/src/styles/_tokens.scss`, `web/packages/alloy-ui/src/lib/tokens.ts`, `swift/Sources/AlloyUI/AlloyTokens.swift`
- Create: `web/packages/alloy-ui/src/lib/tokens.spec.ts`, `swift/Tests/AlloyUITests/AlloyTokensTests.swift`
- Modify: `web/packages/alloy-ui/src/public-api.ts`; delete `src/lib/smoke.spec.ts`

**Interfaces:**
- Produces: `SHEET_ANIMATION_MS = 280`, `AUTO_HIDE_MS = 4000` exported from the lib (Tasks 5–6 import them); SCSS vars `$tint`, `$tint-hover`, `$live`, `$mock`, `$destructive`, `$sheet-bg`, `$secondary-surface`, `$secondary-surface-hover`, `$grab-handle`, `$label`, `$secondary-label`, `$track`, `$backdrop`; Swift `AlloyTokens.tint … AlloyTokens.backdrop: Color`, `AlloyTokens.sheetAnimation = 0.28`, `AlloyTokens.autoHide = 4.0` (seconds).

- [ ] **Step 1: Write tokens.json** (values verbatim from allyclock's `apps/web/src/app/shared/ui/tokens.scss` + `core/animation-timing.ts`):
```json
{
  "color": {
    "tint": "#0a84ff",
    "tint-hover": "#2691ff",
    "live": "#30d158",
    "mock": "#ff9f0a",
    "destructive": "#ff453a",
    "sheet-bg": "#1c1c1e",
    "secondary-surface": "rgba(118, 118, 128, 0.24)",
    "secondary-surface-hover": "rgba(118, 118, 128, 0.34)",
    "grab-handle": "#555555",
    "label": "#ffffff",
    "secondary-label": "#98989e",
    "track": "rgba(255, 255, 255, 0.16)",
    "backdrop": "rgba(0, 0, 0, 0.5)"
  },
  "durationMs": {
    "sheet-animation": 280,
    "auto-hide": 4000
  }
}
```

- [ ] **Step 2: Write the failing twin tests**

`web/packages/alloy-ui/src/lib/tokens.spec.ts`:
```ts
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { AUTO_HIDE_MS, SHEET_ANIMATION_MS } from './tokens';

const stylesUrl = new URL('../styles/_tokens.scss', import.meta.url);

describe('tokens', () => {
  it('exposes the twin-agreed durations', () => {
    expect(SHEET_ANIMATION_MS).toBe(280);
    expect(AUTO_HIDE_MS).toBe(4000);
  });

  it('generated SCSS carries the twin-agreed spot values', () => {
    const scss = readFileSync(fileURLToPath(stylesUrl), 'utf8');
    expect(scss).toContain('$tint: #0a84ff;');
    expect(scss).toContain('$secondary-surface: rgba(118, 118, 128, 0.24);');
    expect(scss).toContain('$backdrop: rgba(0, 0, 0, 0.5);');
  });
});
```

`swift/Tests/AlloyUITests/AlloyTokensTests.swift`:
```swift
import AlloyUI
import SwiftUI
import XCTest

final class AlloyTokensTests: XCTestCase {
    func test_twinAgreedDurations() {
        XCTAssertEqual(AlloyTokens.sheetAnimation, 0.28, accuracy: 0.0001)
        XCTAssertEqual(AlloyTokens.autoHide, 4.0, accuracy: 0.0001)
    }

    func test_tintSpotValue() {
        // #0a84ff → r 10, g 132, b 255
        let resolved = UIColor(AlloyTokens.tint)
        var r: CGFloat = 0, g: CGFloat = 0, b: CGFloat = 0, a: CGFloat = 0
        resolved.getRed(&r, green: &g, blue: &b, alpha: &a)
        XCTAssertEqual(r, 10.0 / 255.0, accuracy: 0.001)
        XCTAssertEqual(g, 132.0 / 255.0, accuracy: 0.001)
        XCTAssertEqual(b, 255.0 / 255.0, accuracy: 0.001)
        XCTAssertEqual(a, 1.0, accuracy: 0.001)
    }
}
```
NOTE: `UIColor` needs `#if canImport(UIKit)` — wrap `test_tintSpotValue`'s body in `#if canImport(UIKit) … #endif` so macOS test hosts skip it gracefully.

- [ ] **Step 3: Run to verify failure** — `npx ng test alloy-ui` (module `./tokens` missing) and `swift test` (AlloyTokens missing).

- [ ] **Step 4: Write the generator**

`tools/generate-tokens.mjs`:
```js
#!/usr/bin/env node
// Emit _tokens.scss (web), tokens.ts (web), AlloyTokens.swift (iOS) from
// tokens.json — the single source of truth. Never edit the outputs by hand.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const tokens = JSON.parse(readFileSync(join(root, 'tokens.json'), 'utf8'));

const header = (syntax) => `${syntax} AUTO-GENERATED by tools/generate-tokens.mjs from tokens.json.
${syntax} Do not edit by hand.\n`;

// ---- SCSS ----
const scssColors = Object.entries(tokens.color)
  .map(([k, v]) => `$${k}: ${v};`)
  .join('\n');
writeFileSync(
  join(root, 'web/packages/alloy-ui/src/styles/_tokens.scss'),
  header('//') + scssColors + '\n'
);

// ---- TS (durations; SCREAMING_SNAKE with _MS suffix) ----
const tsDurations = Object.entries(tokens.durationMs)
  .map(([k, v]) => `export const ${k.toUpperCase().replace(/-/g, '_')}_MS = ${v};`)
  .join('\n');
writeFileSync(
  join(root, 'web/packages/alloy-ui/src/lib/tokens.ts'),
  header('//') + tsDurations + '\n'
);

// ---- Swift ----
function swiftColor(value) {
  const hex = /^#([0-9a-f]{6})$/i.exec(value);
  if (hex) {
    const n = parseInt(hex[1], 16);
    return colorLiteral((n >> 16) & 255, (n >> 8) & 255, n & 255, 1);
  }
  const rgba = /^rgba\((\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\)$/.exec(value);
  if (rgba) return colorLiteral(+rgba[1], +rgba[2], +rgba[3], +rgba[4]);
  throw new Error(`unsupported color format: ${value}`);
}
const colorLiteral = (r, g, b, a) =>
  `Color(red: ${r} / 255.0, green: ${g} / 255.0, blue: ${b} / 255.0, opacity: ${a})`;
const camel = (k) => k.replace(/-(\w)/g, (_, c) => c.toUpperCase());

const swiftColors = Object.entries(tokens.color)
  .map(([k, v]) => `    public static let ${camel(k)} = ${swiftColor(v)}`)
  .join('\n');
const swiftDurations = Object.entries(tokens.durationMs)
  .map(([k, v]) => `    public static let ${camel(k)}: Double = ${v / 1000}`)
  .join('\n');
writeFileSync(
  join(root, 'swift/Sources/AlloyUI/AlloyTokens.swift'),
  header('//') +
    `import SwiftUI

/// Design tokens shared with the web (\`_tokens.scss\` / \`tokens.ts\`).
/// Durations are SECONDS (web twins carry milliseconds).
public enum AlloyTokens {
${swiftColors}

${swiftDurations}
}
`
);
console.log('tokens generated (scss, ts, swift)');
```

- [ ] **Step 5: Generate, export, verify**

Run: `node tools/generate-tokens.mjs`. Append to `src/public-api.ts`:
```ts
export * from './lib/tokens';
```
Delete `src/lib/smoke.spec.ts`. Run `npx ng test alloy-ui`, `npx ng build alloy-ui`, `swift test` — all pass. Verify `web/dist/alloy-ui/styles/_tokens.scss` exists in the build output (the assets rule works).

- [ ] **Step 6: Commit** — `git add -A && git commit -m "feat(tokens): tokens.json single source with scss/ts/swift generator + twin tests"`

---

### Task 4: Icon layer (registry move + app extensibility)

**Files:**
- Create: `web/packages/alloy-ui/src/lib/icon/icon.component.ts`, `.spec.ts`, `web/packages/alloy-ui/src/lib/icon/icon-registry.ts`
- Modify: `web/packages/alloy-ui/src/public-api.ts`

**Interfaces:**
- Produces: `IconComponent` (selector `app-icon`, `name` input), `SfSymbol` type, `AlloyIconName = SfSymbol | (string & {})`, `provideAlloyIcons(icons: Record<string, string>)`. Tasks 5, 11, 13 rely on these exact names.

- [ ] **Step 1: Move the registry**

`icon-registry.ts`: move the entire `ICON_PATHS` const from `/Volumes/AllyDrive/Storage/Repos/allyclock/apps/web/src/app/shared/ui/icon/icon.component.ts` (lines 1–38, the const + `SfSymbol` type) verbatim — allyclock's registry is the union base (Piano's only extra glyph, `pianokeys`, stays app-side via `provideAlloyIcons`; its redrawn `chevron.left`/`chevron.right`/`slider.horizontal.3` lose to canonical). Add at the end:
```ts
import { InjectionToken, Provider } from '@angular/core';

export type AlloyIconName = SfSymbol | (string & {});

/** App-registered glyphs merged over the built-in registry at render time. */
export const ALLOY_EXTRA_ICONS = new InjectionToken<Record<string, string>[]>('ALLOY_EXTRA_ICONS');

/** Register app-specific SF-named glyphs without waiting for an Alloy release. */
export function provideAlloyIcons(icons: Record<string, string>): Provider {
  return { provide: ALLOY_EXTRA_ICONS, useValue: icons, multi: true };
}
```

- [ ] **Step 2: Write the failing spec**

Port `/Volumes/AllyDrive/Storage/Repos/allyclock/apps/web/src/app/shared/ui/icon/icon.component.spec.ts` verbatim (imports → `./icon.component`), then ADD:
```ts
it('renders app-registered extra icons', async () => {
  TestBed.configureTestingModule({
    providers: [provideAlloyIcons({ pianokeys: 'M1 1h22v22H1z' })],
  });
  const fixture = TestBed.createComponent(IconComponent);
  fixture.componentRef.setInput('name', 'pianokeys');
  await fixture.whenStable();
  const path: SVGPathElement = fixture.nativeElement.querySelector('path');
  expect(path.getAttribute('d')).toBe('M1 1h22v22H1z');
});

it('renders no path for unknown names', async () => {
  const fixture = TestBed.createComponent(IconComponent);
  fixture.componentRef.setInput('name', 'no.such.icon');
  await fixture.whenStable();
  expect(fixture.nativeElement.querySelector('path')).toBeNull();
});
```

- [ ] **Step 3: Run to verify failure** — `npx ng test alloy-ui`.

- [ ] **Step 4: Implement IconComponent**

`icon.component.ts` — allyclock's component (template/styles verbatim from the source file lines 40–69) with the registry import and extras merge:
```ts
import { ChangeDetectionStrategy, Component, computed, inject, input, isDevMode } from '@angular/core';
import { ALLOY_EXTRA_ICONS, AlloyIconName, ICON_PATHS } from './icon-registry';

@Component({
  selector: 'app-icon',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `…verbatim from allyclock icon.component.ts lines 43–57…`,
  styles: `…verbatim lines 58–68…`,
})
export class IconComponent {
  readonly name = input.required<AlloyIconName>();
  private readonly extras = inject(ALLOY_EXTRA_ICONS, { optional: true }) ?? [];
  readonly path = computed(() => {
    const merged = Object.assign({}, ICON_PATHS, ...this.extras) as Record<string, string>;
    const d = merged[this.name()] ?? '';
    if (!d && isDevMode()) console.warn(`[alloy-ui] unknown icon name: ${this.name()}`);
    return d;
  });
}
```
Re-export from `icon-registry.ts`: `export { ICON_PATHS };` already the case; append to `public-api.ts`:
```ts
export { IconComponent } from './lib/icon/icon.component';
export { AlloyIconName, SfSymbol, provideAlloyIcons } from './lib/icon/icon-registry';
```

- [ ] **Step 5: Verify** — `npx ng test alloy-ui && npx ng build alloy-ui` all green.
- [ ] **Step 6: Commit** — `git add -A && git commit -m "feat(ui): icon layer with app-extensible SF-named registry"`

---

### Task 5: Sheet + icon-button + nav-header

**Files:**
- Create under `web/packages/alloy-ui/src/lib/`: `sheet/sheet.component.{ts,html,scss,spec.ts}`, `icon-button/icon-button.component.{ts,scss,spec.ts}`, `nav-header/nav-header.component.{ts,html,scss,spec.ts}` (copy every file from allyclock's `apps/web/src/app/shared/ui/<same>/`, then apply ONLY the deltas below)
- Modify: `public-api.ts`

**Interfaces:**
- Produces: `SheetComponent` (inputs `backdrop`, `fullHeight`, `contained`, `sheetLabel`; output `closed`; method `close()`; public signal `closing`), `IconButtonComponent` (inputs `icon: AlloyIconName`, `variant: 'secondary'|'primary'|'destructive'`, `label`), `NavHeaderComponent` (inputs `title`, `flush`).

- [ ] **Step 1: Copy allyclock's six component files + three specs verbatim, then apply exactly these deltas**

1. All `.ts` imports of `@core/animation-timing` become `../tokens` (`SHEET_ANIMATION_MS`).
2. All `.scss` `@use 'tokens' as t;` become `@use '../../styles/tokens' as t;` (relative — the library cannot rely on app includePaths).
3. `icon-button.component.ts` / `nav-header.component.ts`: icon import path becomes `../icon/icon.component`; `SfSymbol` type reference becomes `AlloyIconName` from `../icon/icon-registry`.
4. **Reconciliation (the ONLY behavior changes, adopted from Piano where noted):**
   - `sheet.component.ts` gains `changeDetection: ChangeDetectionStrategy.OnPush` (Piano's improvement; the component is fully signal-driven so this is safe — allyclock's unmodified sheet spec is the proof gate).
   - `sheet.component.scss` `.sheet-panel` gains Piano's viewport cap, placed with the existing panel rules:
     ```scss
     max-height: 90dvh; // Piano-canonicalized: cap on short/landscape viewports
     ```
     and inside the existing `.full-height` block: `max-height: none;`
   - `.sheet-content` behavior stays allyclock's (scoped to `.full-height`) — Piano adapts (named Piano-side risk, Task 13).
5. `sheet.component.spec.ts`: only the import-path header changes.

- [ ] **Step 2: Export**
```ts
export { SheetComponent } from './lib/sheet/sheet.component';
export { IconButtonComponent } from './lib/icon-button/icon-button.component';
export { NavHeaderComponent } from './lib/nav-header/nav-header.component';
```

- [ ] **Step 3: Verify** — `npx ng test alloy-ui` (moved specs + icon specs green), `npx ng build alloy-ui`.
- [ ] **Step 4: Commit** — `git add -A && git commit -m "feat(ui): sheet, icon-button, nav-header (allyclock canonical + 90dvh cap, OnPush)"`

---

### Task 6: Auto-hide directive

**Files:**
- Create: `web/packages/alloy-ui/src/lib/auto-hide.directive.ts`, `.spec.ts`
- Modify: `public-api.ts`

**Interfaces:**
- Produces: `AutoHideDirective` (selector `[appAutoHide]`, exportAs `autoHide`, inputs `revealBlocked`, `holdVisible`, signal `visible`, method `reveal()`).

- [ ] **Step 1: Move** `apps/web/src/app/shared/ui/auto-hide.directive.ts` + `.spec.ts` from allyclock verbatim; single delta: `import { AUTO_HIDE_MS } from './tokens';` (was `@core/animation-timing`). Spec import path updated.
- [ ] **Step 2: Export** — `export { AutoHideDirective } from './lib/auto-hide.directive';`
- [ ] **Step 3: Verify** — `npx ng test alloy-ui && npx ng build alloy-ui`.
- [ ] **Step 4: Commit** — `git add -A && git commit -m "feat(ui): auto-hide directive"`

---

### Task 7: iOS GlassSheet + SFIcon move (public API)

**Files:**
- Create: `swift/Sources/AlloyUI/SFIcon.swift`, `swift/Sources/AlloyUI/GlassSheet.swift`
- Create: `swift/Tests/AlloyUITests/GlassSheetTests.swift`

**Interfaces:**
- Produces: `public struct SFIcon` (`init(_ name: String)`), `@available(iOS 26.0, *) public struct GlassIconButton` (`init(icon: String, label: String, size: CGFloat = 36, action: @escaping () -> Void)`), `@available(iOS 26.0, *) public struct GlassSheet<Content: View>` (`init(title: String, hInset: CGFloat = 0, onClose: @escaping () -> Void, @ViewBuilder content: @escaping () -> Content)`).

- [ ] **Step 1: Move with public surface**

Copy `/Volumes/AllyDrive/Storage/Repos/allyclock/apps/ios/AllyClock/Shared/SFIcon.swift` and `GlassSheet.swift` verbatim, then:
- `SFIcon`: `struct SFIcon` → `public struct SFIcon`, `let name` → `public let name`, `init` → `public init`, `var body` → `public var body`.
- `GlassSheet.swift`: annotate BOTH types `@available(iOS 26.0, *)` (they use `GlassEffectContainer`/`.glassEffect`/`.buttonStyle(.glass)`, iOS 26 APIs; the package floor is iOS 17). Make both `public` with explicit public memberwise inits (implicit inits are internal):
```swift
    public init(icon: String, label: String, size: CGFloat = 36, action: @escaping () -> Void) {
        self.icon = icon; self.label = label; self.size = size; self.action = action
    }
```
```swift
    public init(title: String, hInset: CGFloat = 0, onClose: @escaping () -> Void,
                @ViewBuilder content: @escaping () -> Content)
    {
        self.title = title; self.hInset = hInset; self.onClose = onClose; self.content = content
    }
```
(`var body` → `public var body` on both; stored properties can stay non-public since the inits cover construction.)

- [ ] **Step 2: Compile-level test** (SwiftUI views can't render in SPM tests; assert construction and availability wiring):
```swift
import AlloyUI
import SwiftUI
import XCTest

final class GlassSheetTests: XCTestCase {
    func test_publicConstruction() {
        _ = SFIcon("globe")
        if #available(iOS 26.0, *) {
            _ = GlassIconButton(icon: "xmark", label: "Close") {}
            _ = GlassSheet(title: "Test", onClose: {}) { Text("body") }
        }
    }
}
```

- [ ] **Step 3: Verify** — `swift test` (all pass; the guts are protected by allyclock's snapshot suite at adoption).
- [ ] **Step 4: Commit** — `git add -A && git commit -m "feat(swift): GlassSheet + GlassIconButton + SFIcon moved into AlloyUI"`

---

### Task 8: iOS AutoHideModel

**Files:**
- Create: `swift/Sources/AlloyUI/AutoHideModel.swift`, `swift/Tests/AlloyUITests/AutoHideModelTests.swift`

**Interfaces:**
- Produces: `@MainActor @Observable public final class AutoHideModel` — `visible: Bool` (read-only), `reveal()`, `setHold(_:)`, `scheduleHide()`; `init(delay: Double = AlloyTokens.autoHide)`. Semantic mirror of the web `AutoHideDirective` (visible/reveal/hold), timing from tokens.

- [ ] **Step 1: Write the failing tests**
```swift
import AlloyUI
import XCTest

@MainActor
final class AutoHideModelTests: XCTestCase {
    func test_visibleByDefault_thenHidesAfterDelay() async throws {
        let model = AutoHideModel(delay: 0.05)
        XCTAssertTrue(model.visible)
        try await Task.sleep(for: .seconds(0.2))
        XCTAssertFalse(model.visible)
    }

    func test_revealRestartsTheClock() async throws {
        let model = AutoHideModel(delay: 0.05)
        try await Task.sleep(for: .seconds(0.2))
        XCTAssertFalse(model.visible)
        model.reveal()
        XCTAssertTrue(model.visible)
        try await Task.sleep(for: .seconds(0.2))
        XCTAssertFalse(model.visible)
    }

    func test_holdKeepsVisible() async throws {
        let model = AutoHideModel(delay: 0.05)
        model.setHold(true)
        try await Task.sleep(for: .seconds(0.2))
        XCTAssertTrue(model.visible)
        model.setHold(false)
        try await Task.sleep(for: .seconds(0.2))
        XCTAssertFalse(model.visible)
    }
}
```

- [ ] **Step 2: Run to verify failure** — `swift test` (type missing). Paste the raw failing output in the report.

- [ ] **Step 3: Implement**
```swift
import Foundation
import Observation

/// Auto-hiding chrome state: visible on interaction, hides after a delay.
/// Semantic mirror of the web `AutoHideDirective` (visible / reveal / hold);
/// delay comes from the shared tokens (web ships 4000 ms).
@MainActor
@Observable
public final class AutoHideModel {
    public private(set) var visible = true

    private let delay: Double
    private var hold = false
    private var hideTask: Task<Void, Never>?

    public init(delay: Double = AlloyTokens.autoHide) {
        self.delay = delay
        scheduleHide()
    }

    /// Show the chrome and restart the hide clock (no-op arming while held).
    public func reveal() {
        visible = true
        scheduleHide()
    }

    /// While held, the chrome never hides (mirror of the web's holdVisible).
    public func setHold(_ holding: Bool) {
        hold = holding
        if holding {
            hideTask?.cancel()
        } else {
            scheduleHide()
        }
    }

    public func scheduleHide() {
        hideTask?.cancel()
        guard !hold else { return }
        hideTask = Task { [weak self, delay] in
            try? await Task.sleep(for: .seconds(delay))
            guard !Task.isCancelled else { return }
            self?.visible = false
        }
    }
}
```

- [ ] **Step 4: Verify** — `swift test`, all green.
- [ ] **Step 5: Commit** — `git add -A && git commit -m "feat(swift): AutoHideModel mirroring the web auto-hide semantics"`

---

### Task 9: Docs

**Files:**
- Modify: `docs/mirroring.md`, `README.md`, `CLAUDE.md`

- [ ] **Step 1:** In `docs/mirroring.md`, add a `## UI mirroring (AlloyUI)` section:
  - UI twins are semantic mirrors, not transliterations: same names/roles/behavioral contracts (apply-on-close, dismissal paths, auto-hide timing, selected/disabled a11y states); internals idiomatic per platform.
  - Tokens are the hard-shared layer: `tokens.json` → `_tokens.scss` + `tokens.ts` + `AlloyTokens.swift` via `tools/generate-tokens.mjs`; durations are ms on web, seconds in Swift.
  - Documented asymmetries: icon path data is web-only (iOS renders real SF Symbols by the same name); `NavHeaderComponent` is web-only (GlassSheet's title row is the iOS counterpart); chrome SIZES are not yet tokenized (34 px web vs 36 pt iOS buttons — deliberate, avoids pixel churn).
- [ ] **Step 2:** `README.md`: AlloyUI row status → `0.2.x — tokens, icon layer, icon button, sheet, nav-header, auto-hide (knobs in 2b)`. `CLAUDE.md`: add AlloyUI to the layout section (`swift/Sources/AlloyUI`, `web/packages/alloy-ui`, `tokens.json` + generator) and note alloy-ui's Angular peer coupling (`^21`).
- [ ] **Step 3: Commit** — `git add -A && git commit -m "docs: UI mirroring rules, AlloyUI status"`

---

### Task 10: Release 0.2.0

**Files:** none (release artifacts)

**Interfaces:**
- Produces: git tag `0.2.0`; release asset `allyworld-alloy-ui-0.2.0.tgz` (packed from `web/dist/alloy-ui`). alloy-time keeps its existing 0.1.1 asset (unchanged package). Tasks 11–13 consume.

- [ ] **Step 1:**
```bash
cd /Volumes/AllyDrive/Storage/Repos/Alloy
git pull --rebase origin main && git push origin main
cd web && npx ng build alloy-ui && cd dist/alloy-ui && npm pack
cd /Volumes/AllyDrive/Storage/Repos/Alloy
gh release create 0.2.0 web/dist/alloy-ui/allyworld-alloy-ui-0.2.0.tgz \
  --title "AlloyUI 0.2.0" \
  --notes "AlloyUI core kit: tokens, icon layer, icon button, sheet, nav-header, auto-hide — Angular library + Swift product. AlloyTime unchanged (use the 0.1.1 asset)."
rm web/dist/alloy-ui/*.tgz
```
NOTE: pack from `dist/alloy-ui` (the ng-packagr OUTPUT), never from `src` — the built package.json carries the FESM entry points.
- [ ] **Step 2: Verify** — `curl -sIL https://github.com/triad7th/Alloy/releases/download/0.2.0/allyworld-alloy-ui-0.2.0.tgz | head -1` → 200; `git ls-remote --tags origin | grep 0.2.0`.

---

### Task 11: allyclock web adoption

Work in `/Volumes/AllyDrive/Storage/Repos/allyclock`. Gate: full web suite passes with specs unmodified (the moved five specs are deleted here — they live in Alloy now).

**Files:**
- Modify: `apps/web/package.json` (+lockfile), `apps/web/src/app/core/animation-timing.ts`
- Rewrite as shims: `apps/web/src/app/shared/ui/icon/icon.component.ts`, `icon-button/icon-button.component.ts`, `sheet/sheet.component.ts`, `nav-header/nav-header.component.ts`, `auto-hide.directive.ts`, `tokens.scss`
- Delete: the five moved specs, plus `sheet/sheet.component.html`, `sheet/sheet.component.scss`, `icon-button/icon-button.component.scss`, `nav-header/nav-header.component.{html,scss}` (absorbed into the library)

- [ ] **Step 1: Dependency** — in `apps/web/package.json`: `"@allyworld/alloy-ui": "https://github.com/triad7th/Alloy/releases/download/0.2.0/allyworld-alloy-ui-0.2.0.tgz"`, then `npm --prefix apps/web install`.

- [ ] **Step 2: Shims** (each old file becomes a re-export so `@shared/ui/...` deep imports keep working):
```ts
// icon/icon.component.ts
export { IconComponent, type AlloyIconName, type SfSymbol } from '@allyworld/alloy-ui';
```
```ts
// icon-button/icon-button.component.ts
export { IconButtonComponent } from '@allyworld/alloy-ui';
```
```ts
// sheet/sheet.component.ts
export { SheetComponent } from '@allyworld/alloy-ui';
```
```ts
// nav-header/nav-header.component.ts
export { NavHeaderComponent } from '@allyworld/alloy-ui';
```
```ts
// auto-hide.directive.ts
export { AutoHideDirective } from '@allyworld/alloy-ui';
```
`tokens.scss` becomes:
```scss
// Tokens moved to @allyworld/alloy-ui; forwarded so `@use 'tokens' as t;`
// (resolved via stylePreprocessorOptions.includePaths) keeps working.
@forward '@allyworld/alloy-ui/styles/tokens';
```
CHECK: if the Sass build cannot resolve the package specifier, use the relative fallback `@forward '../../../../node_modules/@allyworld/alloy-ui/styles/tokens';` and note it.

- [ ] **Step 3: animation-timing rewire** — `apps/web/src/app/core/animation-timing.ts`: delete the local `SHEET_ANIMATION_MS`/`AUTO_HIDE_MS` consts; add `export { AUTO_HIDE_MS, SHEET_ANIMATION_MS } from '@allyworld/alloy-ui';` (keep `FACE_TRANSITION_MS` and `applyAnimationTimingVars` exactly as they are).

- [ ] **Step 4: Delete moved files** — `git rm` the five spec files and the absorbed html/scss listed above. Grep guard: `grep -rn "ICON_PATHS" apps/web/src` must return nothing (registry lives in the lib).

- [ ] **Step 5: Verify** — from repo root: `npm run test:web && npm run build:web`. Every remaining spec passes unmodified.
- [ ] **Step 6: Commit** — `git add -A && git commit -m "refactor(web): consume @allyworld/alloy-ui for shared UI primitives"` (do not push yet).

---

### Task 12: allyclock iOS adoption

Work in `/Volumes/AllyDrive/Storage/Repos/allyclock`. Gate: 9/9 iOS tests, pixel snapshots byte-identical.

**Files:**
- Delete: `apps/ios/AllyClock/Shared/GlassSheet.swift`, `apps/ios/AllyClock/Shared/SFIcon.swift`
- Modify: `apps/ios/AllyClock.xcodeproj/project.pbxproj`; `apps/ios/AllyClock/App/RootFaceView.swift`; import lines in `FacePickerView.swift`, `FullscreenFaceView.swift`, `FullscreenSettingsView.swift`, `WorldCardView.swift`, `Shared/FlagView.swift`, `Shared/ZonePickerView.swift`, `Shared/Knobs.swift` if it references SFIcon (grep), `AdjustSheetView.swift`
- Modify: root `CLAUDE.md` + `apps/ios/CLAUDE.md` (GlassSheet pointer now names AlloyUI)

- [ ] **Step 1: pbxproj** — mirror the existing Alloy/AlloyTime entries (AC…170/171/172) with a SECOND product dependency on the SAME package reference (no new XCRemoteSwiftPackageReference needed):
```
		AC0000000000000000000173 /* AlloyUI */ = {
			isa = XCSwiftPackageProductDependency;
			package = AC0000000000000000000170 /* XCRemoteSwiftPackageReference "Alloy" */;
			productName = AlloyUI;
		};
		AC0000000000000000000174 /* AlloyUI in Frameworks */ = {isa = PBXBuildFile; productRef = AC0000000000000000000173 /* AlloyUI */; };
```
Add `AC…173` to the AllyClock app target's `packageProductDependencies` and `AC…174` to its Frameworks phase `files`. THEN remove the deleted files' four pbxproj entries each (PBXBuildFile, PBXFileReference, group child, Sources-phase file): GlassSheet.swift (refs AC…153/154) and SFIcon.swift (refs AC…113/114).

- [ ] **Step 2: Sources** — delete the two files; add `import AlloyUI` to every file the grep `grep -rln "GlassSheet\|GlassIconButton\|SFIcon" apps/ios/AllyClock` lists. In `RootFaceView.swift`, replace the inline auto-hide state (`@State chromeVisible`, `@State hideTask`, `revealChrome()`, `scheduleHide()`) with the shared model:
```swift
    @State private var autoHide = AutoHideModel()
```
— `chromeVisible` reads become `autoHide.visible`, `revealChrome()` calls become `autoHide.reveal()`, the `.onAppear { scheduleHide() }` becomes `.onAppear { autoHide.scheduleHide() }`, and where sheets open/close drive visibility, call `autoHide.setHold(sheetOpen)` from the existing `.onChange`/state that tracks `sheetOpen` (add `.onChange(of: sheetOpen) { autoHide.setHold(sheetOpen) }` on the root ZStack if no such hook exists). Delete `revealChrome()` and `scheduleHide()`. NAMED BEHAVIOR CHANGE: hide delay moves 3 s → 4 s (token-unified with web).

- [ ] **Step 3: Resolve + verify** — `cd apps/ios && xcodebuild -project AllyClock.xcodeproj -scheme AllyClock -resolvePackageDependencies` (Package.resolved updates Alloy to 0.2.0 — commit it), then the full test run (iPhone 17 sim). Expected 9/9, snapshots unchanged. Also `cd packages/AllyClockCore && swift test`.
- [ ] **Step 4: Docs** — update the two CLAUDE.md GlassSheet references to name AlloyUI as the source of sheet/button chrome.
- [ ] **Step 5: Commit** — `git add -A && git commit -m "refactor(ios): consume AlloyUI for glass chrome; shared AutoHideModel (3s→4s)"` (do not push).

---

### Task 13: AllyPiano web adoption

Work in `/Volumes/AllyDrive/Storage/Repos/AllyPiano` (main branch; commit, do not push). Piano has NO tokens/animation-timing infrastructure — this task creates none: the library carries everything.

**Files:**
- Modify: `apps/web/package.json` (+lockfile), `apps/web/src/app/app.config.ts` (or wherever `bootstrapApplication` providers live — locate it), the five `shared/ui` primitive files → shims, delete their local specs + absorbed html/scss (same file set as Task 11)
- Keep: `pianokeys` glyph (moves into the provider), Piano's redrawn chevron/slider glyphs are RETIRED (canonical wins — named visual change)

- [ ] **Step 1: Dependency** — `"@allyworld/alloy-ui": "https://github.com/triad7th/Alloy/releases/download/0.2.0/allyworld-alloy-ui-0.2.0.tgz"` + `npm --prefix apps/web install`.
- [ ] **Step 2: Register Piano's glyph** — copy the `pianokeys` path string out of Piano's `shared/ui/icon/icon.component.ts` BEFORE shimming, then add to the app's bootstrap providers:
```ts
import { provideAlloyIcons } from '@allyworld/alloy-ui';
// …
provideAlloyIcons({
  pianokeys: '<the exact path string from the old registry>',
}),
```
- [ ] **Step 3: Shims** — same five shim rewrites as Task 11 Step 2 (Piano's copies deleted/absorbed identically). Piano has no tokens.scss and no `@use 'tokens'` anywhere, so no SCSS forwarding stub is needed.
- [ ] **Step 4: Named behavior adoptions for Piano** (expect and accept; update specs ONLY if they assert the old behavior, and name each in the report): canonical chevron/slider glyph shapes; sheet `closing` signal now public; `.sheet-content` flex/overflow now scoped to `full-height` panels (verify the instrument-picker/settings/adjust sheets still scroll correctly — if one relied on the unconditional overflow, set `fullHeight` on it and note it); `SHEET_ANIMATION_MS` import now from the lib if any Piano file imported it from the sheet.
- [ ] **Step 5: Verify** — `npm run test --prefix apps/web` and `npm run build --prefix apps/web`, green. Manually-relevant sheets are covered by Piano's existing component specs.
- [ ] **Step 6: Commit** — `git add -A && git commit -m "refactor(web): consume @allyworld/alloy-ui; retire drifted local UI copies"`.

---

### Task 14: Spec amendment + final sweep

**Files:**
- Modify: `/Volumes/AllyDrive/Storage/Repos/Alloy/docs/superpowers/specs/2026-07-08-alloyui-design.md`

- [ ] **Step 1:** In the spec's Tokens section, replace the "standard chrome sizes (36pt button, 28pt sheet-X)" phrase with: "chrome sizes are deferred past v1 — web (34 px) and iOS (36 pt) intentionally differ today, and unifying them is a visual change, not an extraction". Commit in Alloy: `docs: spec amendment — chrome sizes deferred from tokens v1`, push.
- [ ] **Step 2: Cross-repo verification sweep**
  - Alloy: `swift test` + `cd web && npx ng test alloy-ui && npm test --workspace @allyworld/alloy-time`.
  - allyclock: `npm run test:web && npm run build:web`; iOS suite 9/9 snapshots unchanged.
  - AllyPiano: `npm run test --prefix apps/web && npm run build --prefix apps/web`.
  - Greps return nothing: `grep -rn "ICON_PATHS" allyclock/apps/web/src AllyPiano/apps/web/src` (registry only in lib); `grep -rln "GlassEffectContainer" allyclock/apps/ios/AllyClock` (glass chrome only from AlloyUI).

## Final verification (after Task 14)

Push order: Alloy already pushed (Task 10/14); allyclock and AllyPiano pushes happen at the user's /commit-and-push or explicit instruction — leave both committed locally and report.
