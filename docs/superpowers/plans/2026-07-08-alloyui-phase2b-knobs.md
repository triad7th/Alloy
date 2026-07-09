# AlloyUI Phase 2b (Knobs) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract the "knobs" design language (section cards, labels, toggles, segments, sliders, responsive panel grid) into AlloyUI — a canonical stylesheet + three attribute-selector controls on web, the existing `Knobs.swift` views on iOS — and adopt it in allyclock (web + iOS) and AllyPiano (web).

**Architecture:** The web ships `styles/_knobs.scss` (one canonical copy of the class-based design language, replacing 4 drifted copies in allyclock and 2 in Piano) plus three interactive controls chosen for **zero-spec-churn**: they attach to the SAME native elements the apps already render, so allyclock's `data-knob` attribute selectors and Piano's class selectors keep working — `KnobToggleComponent` (`button[appKnobToggle]`), `KnobSliderDirective` (`input[type=range][appKnobSlider]`, owns the `--fill` math that three apps duplicate as `fillPct()`), and `KnobSegmentComponent` (`app-knob-segment`, single consumer today). iOS moves `Knobs.swift` into AlloyUI publicly, re-sourced onto `AlloyTokens`. Ships as 0.3.0.

**Tech Stack:** Same as 2a (Angular 21 lib in Alloy/web via ng-packagr + Vitest; Swift 6/SwiftUI at package floor — knobs use no Liquid Glass, so NO availability annotations; tarball + tag release).

## Global Constraints

- Selectors/class names preserved: `.knobs-*` classes stay; new directives/components attach by attribute (`appKnobToggle`, `appKnobSlider`) or a new element (`app-knob-segment`) used only where the old markup is replaced wholesale.
- HARD GATES: allyclock web specs pass UNMODIFIED (they select `[data-knob=…]` on native elements — those elements must remain the event targets); AllyPiano specs pass UNMODIFIED (they select `button.knobs-toggle.labels` and `input.knobs-slider`); allyclock iOS pixel snapshots byte-identical.
- Visual parity: canonicalization fixes named drift ONLY — world-cards-config GAINS the 900px 3-column tier; world-cards-settings GAINS the responsive grid; Piano's auto-fit grid becomes the canonical `@container` grid. Everything else pixel-stable.
- The `tm-*` copy in allyclock's time-machine component is OUT OF SCOPE (noted as future cleanup).
- The `.knobs-tz*` (zone field) classes are allyclock-specific (flag/zone coupling) and STAY app-side.
- Tokens: one addition to tokens.json — `"knob-card"` (the section-card background; verify the exact value in allyclock's `.knobs-section` background — iOS uses white at 4% opacity — and use the WEB value verbatim as canonical).
- 2a conventions carry over: repos, npm rules, conventional commits, controller re-runs suites before each review, RAW RED/GREEN output for TDD tasks, tasks 1–7 commit in Alloy / 8 in allyclock / 9 in AllyPiano.
- Consumption pins: apps bump to the 0.3.0 tarball URL; iOS Package.resolved updates to 0.3.0 and is committed.

---

### Task 1: knob-card token

**Files:**
- Modify: `tokens.json`, regenerate `web/packages/alloy-ui/src/styles/_tokens.scss` + `src/lib/tokens.ts` + `swift/Sources/AlloyUI/AlloyTokens.swift` via `node tools/generate-tokens.mjs`
- Modify: `web/packages/alloy-ui/src/lib/tokens.spec.ts`, `swift/Tests/AlloyUITests/AlloyTokensTests.swift`

**Interfaces:**
- Produces: SCSS `$knob-card`, Swift `AlloyTokens.knobCard: Color`. Task 2's stylesheet and Task 5's Swift move consume them.

- [ ] **Step 1:** Read allyclock's `.knobs-section` background declaration (in `apps/web/src/app/features/faces/fullscreen/fullscreen-toggles/fullscreen-toggles.component.scss`) and put that exact value into tokens.json's color map as `"knob-card"`. (Expected: `rgba(255, 255, 255, 0.04)` — if it differs, the web value wins and the difference is noted in the report.)
- [ ] **Step 2 (TDD):** extend both twin tests with a spot assertion first (web: `expect(scss).toContain('$knob-card: rgba(255, 255, 255, 0.04);')` — adjust to the actual value; Swift: decode `AlloyTokens.knobCard` and assert rgba components), run RED, then edit tokens.json + regenerate, run GREEN. Full-suite verify both sides.
- [ ] **Step 3: Commit** — `feat(tokens): knob-card surface token`

---

### Task 2: canonical `_knobs.scss`

**Files:**
- Create: `web/packages/alloy-ui/src/styles/_knobs.scss`
- Test: visual parity is enforced at adoption (Tasks 8–9 gates); this task's check is that the file compiles standalone: `npx sass --load-path=web/packages/alloy-ui/src/styles -e '@use "knobs";'` (or equivalent via the ng build).

**Interfaces:**
- Produces: one stylesheet importable as `@use '@allyworld/alloy-ui/styles/knobs';` defining, in this order: `.cfg` (container-type wrapper), `.knobs-panel` (grid, `@container` 600px → 2 cols, 900px → 3 cols), `.knobs-section` (uses `t.$knob-card`), `.knobs-section-header`, `.knobs-section-label`, `.knobs-pair`, `.knobs-cell`, `.knobs-row`, `.knobs-row-label`, `.knobs-row-value`, `.knobs-toggle` + `.knobs-toggle-thumb`, `.knobs-toggle-row`, `.knobs-segment-row` + `.knobs-segment` + `.knobs-segment-btn`, `.knobs-slider` (the flex layout rule), and `input[type='range'].knobs-slider` (the track/thumb visuals with `--fill`).

- [ ] **Step 1: Consolidate.** Source mapping (allyclock repo, read-only):
  - Base: every `.cfg`/`.knobs-*` rule from `fullscreen-toggles.component.scss` (the fullest copy) EXCEPT the `.knobs-tz*`/`.knobs-zonepicker` block (app-side).
  - Merge in from `fullscreen-config.component.scss`: the rules it has that toggles doesn't (`.knobs-row`, `.knobs-row-label`, `.knobs-row-value`, `.knobs-slider` layout, `.knobs-toggle-row`) — where both define a class, they are byte-identical (verified by survey); if you find a discrepancy, STOP and report it rather than picking silently.
  - Merge in `shared/ui/_range-slider.scss` wholesale (the `input[type='range'].knobs-slider` visuals).
  - Replace every `@use 'tokens' as t;` with `@use 'tokens' as t;` relative to the new home (sibling file in `styles/` — the bare specifier resolves; verify).
  - `.knobs-section` background switches to `t.$knob-card`.
  - Header comment: canonical knobs design language; consumed globally by each app's styles.scss; classes are the API, three interactive controls live in `lib/knobs/`.
- [ ] **Step 2:** Build check (`npx ng build alloy-ui`) — the assets rule ships it; confirm `dist/alloy-ui/styles/_knobs.scss` exists.
- [ ] **Step 3: Commit** — `feat(ui): canonical knobs stylesheet`

---

### Task 3: KnobSliderDirective (TDD)

**Files:**
- Create: `web/packages/alloy-ui/src/lib/knobs/knob-slider.directive.ts`, `.spec.ts`
- Modify: `public-api.ts`

**Interfaces:**
- Produces: `KnobSliderDirective`, selector `input[type=range][appKnobSlider]`. Behavior: on init and on every `input` event, sets the host's `--fill` custom property to `round(((value - min) / (max - min)) * 100) + '%'` (the shared `fillPct` logic — reading min/max/value from the native input, so `[value]` bindings and user drags both update it). No outputs — apps keep their existing `(input)` handlers. Also applies `class.knobs-slider` to the host so markup can drop the literal class (but apps may keep it; both work).

- [ ] **Step 1: Failing spec** — TestBed host template:
```ts
@Component({
  imports: [KnobSliderDirective],
  template: `<input type="range" appKnobSlider min="0.5" max="2" step="0.05" [value]="v()" />`,
})
class Host {
  readonly v = signal(1.25);
}
```
Tests: (a) `--fill` is `'50%'` at value 1.25 (i.e. (1.25−0.5)/1.5); (b) dispatching an `input` event after setting `.value = '2'` updates `--fill` to `'100%'`; (c) host has class `knobs-slider`. RED run with raw output.
- [ ] **Step 2: Implement**
```ts
import { Directive, ElementRef, effect, inject } from '@angular/core';

/** Owns the slider's --fill custom property (the tinted track progress) so
 *  apps stop hand-rolling fillPct(). Reads min/max/value off the native
 *  input; updates on init, on every input event, and after change detection
 *  (covers [value] rebinds). */
@Directive({
  selector: 'input[type=range][appKnobSlider]',
  host: {
    class: 'knobs-slider',
    '(input)': 'sync()',
  },
})
export class KnobSliderDirective {
  private readonly el = inject<ElementRef<HTMLInputElement>>(ElementRef);

  constructor() {
    effect(() => this.sync());
  }

  protected sync(): void {
    const input = this.el.nativeElement;
    const min = Number(input.min || 0);
    const max = Number(input.max || 100);
    const value = Number(input.value);
    const pct = max > min ? Math.round(((value - min) / (max - min)) * 100) : 0;
    input.style.setProperty('--fill', `${pct}%`);
  }
}
```
NOTE: the zoneless `effect()` covers the initial render; if a `[value]` rebind after first render doesn't retrigger it (no signal read inside), replace the effect with `afterRenderEffect(() => this.sync())` — pick whichever makes test (a)+(b) pass and note the choice.
- [ ] **Step 3:** GREEN + full lib suite + build. Export from `public-api.ts`.
- [ ] **Step 4: Commit** — `feat(ui): KnobSliderDirective owns the --fill track math`

---

### Task 4: KnobToggleComponent + KnobSegmentComponent (TDD)

**Files:**
- Create: `web/packages/alloy-ui/src/lib/knobs/knob-toggle.component.ts`, `.spec.ts`, `knob-segment.component.ts`, `.spec.ts`
- Modify: `public-api.ts`

**Interfaces:**
- Produces:
  - `KnobToggleComponent`, selector `button[appKnobToggle]` (attribute component on the app's existing `<button>`): input `on: boolean` (required), output `toggled: void`; template renders `<span class="knobs-toggle-thumb"></span>`; host bindings `class.knobs-toggle`, `[class.on]="on()"`, `type="button"`, `role="switch"`, `[attr.aria-checked]="on()"`, `(click)="toggled.emit()"`. The app's own classes (e.g. Piano's `.labels`) and `data-knob` attributes remain on the button — untouched.
  - `KnobSegmentComponent`, selector `app-knob-segment`: inputs `options: readonly { value: string; label: string }[]` (required), `selection: string` (required), `segmentLabel: string` (aria-label); output `changed: string`; renders the `role="radiogroup"` div with `button.knobs-segment-btn[role=radio]` children, `[class.on]` + `aria-checked` on the selected one. String-valued (the one consumer maps its enum to/from strings at the boundary).

- [ ] **Step 1: Failing specs** — toggle: renders thumb span, reflects `on` in class + aria-checked, emits `toggled` on click, host keeps extra classes. Segment: renders one radio per option, marks selection, emits `changed` with the clicked value, radiogroup has the aria-label. RED with raw output.
- [ ] **Step 2: Implement**

`knob-toggle.component.ts`:
```ts
import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';

/** iOS pill switch attached to the app's own <button> — the host keeps its
 *  extra classes and data-knob attributes, so existing spec selectors work. */
@Component({
  selector: 'button[appKnobToggle]',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<span class="knobs-toggle-thumb"></span>`,
  host: {
    class: 'knobs-toggle',
    type: 'button',
    role: 'switch',
    '[class.on]': 'on()',
    '[attr.aria-checked]': 'on()',
    '(click)': 'toggled.emit()',
  },
})
export class KnobToggleComponent {
  readonly on = input.required<boolean>();
  readonly toggled = output<void>();
}
```

`knob-segment.component.ts`:
```ts
import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';

export interface KnobSegmentOption {
  value: string;
  label: string;
}

/** Segmented pill control (web twin of AlloyUI's Swift KnobSegment). */
@Component({
  selector: 'app-knob-segment',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="knobs-segment" role="radiogroup" [attr.aria-label]="segmentLabel() || null">
      @for (option of options(); track option.value) {
        <button
          type="button"
          role="radio"
          class="knobs-segment-btn"
          [class.on]="option.value === selection()"
          [attr.aria-checked]="option.value === selection()"
          (click)="changed.emit(option.value)"
        >
          {{ option.label }}
        </button>
      }
    </div>
  `,
})
export class KnobSegmentComponent {
  readonly options = input.required<readonly KnobSegmentOption[]>();
  readonly selection = input.required<string>();
  readonly segmentLabel = input<string>('');
  readonly changed = output<string>();
}
```
(Also export `KnobSegmentOption` from `public-api.ts`.)
- [ ] **Step 3:** GREEN + full suite + build; export both.
- [ ] **Step 4: Commit** — `feat(ui): KnobToggle + KnobSegment controls`

---

### Task 5: iOS Knobs move

**Files:**
- Create: `swift/Sources/AlloyUI/Knobs.swift` (from allyclock's `apps/ios/AllyClock/Shared/Knobs.swift`, read-only source)
- Create: `swift/Tests/AlloyUITests/KnobsTests.swift`

**Interfaces:**
- Produces: `public enum Knobs` (colors now aliases of `AlloyTokens`), `public struct KnobCard/KnobLabel/KnobToggle/KnobSegment/KnobField` with public memberwise inits (explicit, same pattern as the GlassSheet move), `public func knobColumns(for width: CGFloat) -> Int`. NO availability annotations (plain SwiftUI, compiles at the floor).

- [ ] **Step 1:** Copy verbatim; changes limited to: `public` on types/inits/bodies/`knobColumns`; `Knobs.tint/secondarySurface/secondaryLabel` become `AlloyTokens.tint/secondarySurface/secondaryLabel`; `Knobs.card` becomes `AlloyTokens.knobCard`; header comment notes it mirrors `styles/_knobs.scss` + the three web controls.
- [ ] **Step 2:** Test file: construction test for each view (no #available needed) + `knobColumns` boundary assertions (599→1, 600→2, 899→2, 900→3).
- [ ] **Step 3:** `swift test` full suite green (RAW output).
- [ ] **Step 4: Commit** — `feat(swift): Knobs views moved into AlloyUI on AlloyTokens`

---

### Task 6: Docs

- [ ] `docs/mirroring.md` UI section gains the knobs row: web = canonical classes (`_knobs.scss`) + three attach-in-place controls; iOS = five views + `knobColumns`; asymmetry (web's card/label are classes, not components — CSS exists only on web). `README.md` AlloyUI row → `0.3.x — … + knobs`. `CLAUDE.md` styles note lists `_knobs.scss`.
- [ ] Amend the SPEC's kit table (docs/superpowers/specs/2026-07-08-alloyui-design.md, Knobs row): web export becomes "`_knobs.scss` classes + `KnobToggleComponent`/`KnobSegmentComponent`/`KnobSliderDirective`" — the five-component listing predates the zero-spec-churn design; card/label ship as classes on web.
- [ ] Commit `docs: knobs conventions; spec amended to the classes+controls web shape`.

---

### Task 7: Release 0.3.0

- [ ] Bump alloy-ui to 0.3.0; push; `cd web && ng build alloy-ui && cd dist/alloy-ui && npm pack`; `gh release create 0.3.0 <tarball> --title "AlloyUI 0.3.0" --notes "Knobs: canonical stylesheet + KnobToggle/KnobSegment/KnobSlider controls (web), Knobs views on AlloyTokens (iOS)."`; delete tarball; verify asset 200 + tag on remote. (Two-package procedure per CLAUDE.md — alloy-time unchanged, no new asset.)

---

### Task 8: allyclock adoption (web + iOS)

Work in `/Volumes/AllyDrive/Storage/Repos/allyclock`; commit web and iOS as TWO commits; do not push.

**Web:**
- [ ] Bump dep to the 0.3.0 tarball; `npm --prefix apps/web install`.
- [ ] `src/styles.scss`: replace `@use 'range-slider';` with `@use '@allyworld/alloy-ui/styles/knobs';`; `git rm apps/web/src/app/shared/ui/_range-slider.scss`.
- [ ] In the four knobs SCSS files (`fullscreen-toggles`, `fullscreen-config`, `world-cards-config`, `world-cards-settings` component SCSS): delete every rule now provided by the lib (`.cfg`, `.knobs-panel`, `.knobs-section*`, `.knobs-pair`, `.knobs-cell`, `.knobs-row*`, `.knobs-toggle*`, `.knobs-segment*`, `.knobs-slider` layout) keeping only app-specific rules (`.knobs-tz*`, `.knobs-zonepicker`, `.knobs-tz-back`, any face-preview styles). Named visual changes (expected, accepted): world-cards-config gains the 900px tier; world-cards-settings gains the responsive grid.
- [ ] Templates: toggles/sliders/segments adopt the controls IN PLACE — `<button type="button" class="knobs-toggle" [class.on]="x()" (click)="…">` becomes `<button appKnobToggle [on]="x()" (toggled)="…" data-knob="…">` (drop the manual class/thumb/click; KEEP data-knob); sliders add `appKnobSlider` and drop `[style.--fill]` + the component's `fillPct()` method; fullscreen-toggles' segment block becomes `<app-knob-segment [options]=… [selection]=… (changed)=… data-knob="bar-mode" segmentLabel="Bar mode" />` with the enum↔string mapping at the call site — CHECK the fullscreen-toggles spec's `data-knob="bar-mode"` usage first: if it dispatches clicks on the inner radio buttons, they still exist inside the component; if it queries the container by data-knob, the attribute now sits on `app-knob-segment` — verify the spec passes UNMODIFIED, and if it cannot (element-type assertion), STOP and report rather than editing the spec.
- [ ] Gate: `npm run test:web` all specs UNMODIFIED green + `npm run build:web`. Commit `refactor(web): knobs from @allyworld/alloy-ui`.

**iOS:**
- [ ] Delete `apps/ios/AllyClock/Shared/Knobs.swift`; remove its four pbxproj entries (ids for Knobs.swift: grep "Knobs.swift"); consumers gain `import AlloyUI` if not already imported (grep `KnobCard\|KnobToggle\|KnobSegment\|KnobField\|KnobLabel\|knobColumns` — expect FullscreenSettingsView, AdjustSheetView, possibly ZonePickerView; most already import AlloyUI from 2a).
- [ ] Resolve packages (Package.resolved → 0.3.0, commit it); full iOS suite: 9/9, snapshots byte-identical (`git diff --stat -- '*.png'` empty); `packages/AllyClockCore` swift test green.
- [ ] Commit `refactor(ios): Knobs from AlloyUI`.

---

### Task 9: AllyPiano adoption

Work in `/Volumes/AllyDrive/Storage/Repos/AllyPiano`; commit; do not push.

- [ ] Bump dep to 0.3.0; `npm --prefix apps/web install`.
- [ ] `src/styles.scss`: delete the inlined range-slider block (lines ~11–66, the "ported from AllyClock's _range-slider partial" comment marks it); add `@use '@allyworld/alloy-ui/styles/knobs';`.
- [ ] `adjust-sheet` + `settings-sheet` SCSS: delete rules the lib now provides (panel/section/label/row/toggle/slider layout), keep app-specific ones (`.opt-row`/`.opt-label`). NAMED change: Piano's auto-fit grid becomes the canonical `@container` grid — the panels need the `.cfg` wrapper div around `.knobs-panel` in both templates (add it).
- [ ] Templates: toggle → `appKnobToggle` KEEPING the `labels` class and `knobs-toggle` semantics (host binding adds the class; Piano's spec selector `button.knobs-toggle.labels` must pass UNMODIFIED); sliders → `appKnobSlider` (spec selector `input.knobs-slider` keeps passing via the host class), delete Piano's `fillPct`.
- [ ] Gate: `npm run test --prefix apps/web` UNMODIFIED green + build. Visual sanity at 700×340 (the 2a check): adjust-sheet rows reachable.
- [ ] Commit `refactor(web): knobs from @allyworld/alloy-ui`.

---

### Task 10: Final sweep

- [ ] Alloy: `swift test` + `cd web && npm test` (workspace script runs both suites since the 2a fix).
- [ ] allyclock: web suite + build; iOS suite; `grep -rn "fillPct" apps/web/src` → nothing.
- [ ] AllyPiano: suite + build; `grep -rn "fillPct\|--fill" apps/web/src` → only lib-provided usage (no local fillPct).
- [ ] Both app repos: `grep -rn "knobs-toggle-thumb" apps/web/src` → nothing (thumb rendered by the component).
- [ ] Report unpushed commits; pushes on user instruction.
