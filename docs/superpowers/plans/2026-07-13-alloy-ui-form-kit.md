# AlloyUI Form Kit + Form Dialog Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give `@allyworld/alloy-ui` a consistent form kit — labeled button, text/number fields, select, field row, and a declarative form dialog — so AllyScore's Time Signature modal (raw native `<input>`/`<select>`) can be rebuilt from shared components.

**Architecture:** Six new standalone components. A shared internal `ModalShellComponent` owns the native `<dialog>` behavior (showModal + jsdom guard, Esc, backdrop click, `animate.leave` fade) and is used by BOTH the existing `DialogHostComponent` (confirm/alert) and the new `FormDialogComponent`, so there is exactly one modal implementation. Two-way binding uses Angular `model()` signals — no `@angular/forms`.

**Tech Stack:** Angular 21 standalone components, signal `input()`/`model()`, OnPush, Vitest + TestBed (jsdom), SCSS consuming generated `_tokens.scss`.

## Global Constraints

- Peer surface stays exactly `@angular/core` + `@angular/common` `^21.0.0`. **No `@angular/forms`**, no CDK, no Material, no new runtime deps.
- Web-only: NO Swift component twins. `docs/mirroring.md` gets a documented-asymmetry entry (Task 8). Token outputs still regenerate for all three targets.
- Component selector prefix is `app-` (`web/angular.json` → `projects.alloy-ui.prefix`); harness components use `hx-`.
- All components: `changeDetection: ChangeDetectionStrategy.OnPush`, standalone (no NgModules), signal `input()` / `model()`.
- **No raw color literals in any component SCSS.** Every color comes from `_tokens.scss` (`@use '../../styles/tokens' as t;`). This is what makes the deferred Graphite/Porcelain theming a zero-rework follow-up.
- Never hand-edit generated files: `web/packages/alloy-ui/src/styles/_tokens.scss`, `web/packages/alloy-ui/src/lib/tokens.ts`, `swift/Sources/AlloyUI/AlloyTokens.swift` come from `tokens.json` via `node tools/generate-tokens.mjs`.
- Test command: `cd web && npx ng test alloy-ui --watch=false`. (Plain `npm run test:ui` defaults to watch mode outside a TTY and hangs.) Swift: `cd swift && swift build && swift test`.
- **This working tree is shared with a concurrent session working on `alloy-audio`.** NEVER run `git add -A`, `git add .`, or `git stash`. Stage only the exact paths listed in each task's commit step; if anything unexpected is staged, commit with an explicit pathspec: `git commit -m "…" -- <paths>`.
- Commit style: conventional commits, imperative subject ≤ 72 chars.
- All new public symbols are exported from `web/packages/alloy-ui/src/public-api.ts`.

---

### Task 1: Form tokens (`field-bg`, `field-border`, `focus-ring`)

**Files:**
- Modify: `tokens.json`
- Modify: `web/packages/alloy-ui/src/lib/tokens.spec.ts`
- Regenerated (never hand-edit): `web/packages/alloy-ui/src/styles/_tokens.scss`, `web/packages/alloy-ui/src/lib/tokens.ts`, `swift/Sources/AlloyUI/AlloyTokens.swift`

**Interfaces:**
- Consumes: nothing.
- Produces: SCSS variables `$field-bg`, `$field-border`, `$focus-ring` (used by Tasks 3, 4, 6, 7). Swift gains unused `AlloyTokens.fieldBg` / `.fieldBorder` / `.focusRing` — harmless, same pattern as the overlay durations.

- [ ] **Step 1: Write the failing test**

In `web/packages/alloy-ui/src/lib/tokens.spec.ts`, add these assertions inside the existing `it('generated SCSS carries the twin-agreed spot values', …)` block (keep all existing assertions):

```ts
expect(tokensScss).toContain('$field-bg: rgba(255, 255, 255, 0.06);');
expect(tokensScss).toContain('$field-border: rgba(255, 255, 255, 0.14);');
expect(tokensScss).toContain('$focus-ring: rgba(10, 132, 255, 0.6);');
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && npx ng test alloy-ui --watch=false`
Expected: FAIL — `tokens.spec.ts` assertions do not find the new SCSS variables.

- [ ] **Step 3: Add the tokens and regenerate**

In `tokens.json`, add three entries to the END of the `color` object (after `knob-card`):

```json
    "knob-card": "rgba(255, 255, 255, 0.04)",
    "field-bg": "rgba(255, 255, 255, 0.06)",
    "field-border": "rgba(255, 255, 255, 0.14)",
    "focus-ring": "rgba(10, 132, 255, 0.6)"
```

Then regenerate: `node tools/generate-tokens.mjs`
Expected output: `tokens generated (scss, ts, swift)`

Note: the generator's Swift color parser only accepts `#rrggbb` or `rgba(r, g, b, a)` with that exact spacing — the values above match it.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd web && npx ng test alloy-ui --watch=false`
Expected: PASS (all suites).

Run: `cd swift && swift build && swift test`
Expected: build succeeds, tests pass. (If an unrelated `AlloyAudio` failure appears from the concurrent session's work, it is NOT yours — report it and verify your own scope with `swift build --target AlloyUI` plus `swift test --filter AlloyUITests`.)

- [ ] **Step 5: Commit**

```bash
git add tokens.json \
  web/packages/alloy-ui/src/styles/_tokens.scss \
  web/packages/alloy-ui/src/lib/tokens.ts \
  web/packages/alloy-ui/src/lib/tokens.spec.ts \
  swift/Sources/AlloyUI/AlloyTokens.swift
git commit -m "feat(ui): add form field color tokens"
```

---

### Task 2: `ButtonComponent` (labeled button)

**Files:**
- Create: `web/packages/alloy-ui/src/lib/button/button.component.ts`
- Create: `web/packages/alloy-ui/src/lib/button/button.component.scss`
- Test: `web/packages/alloy-ui/src/lib/button/button.component.spec.ts`
- Modify: `web/packages/alloy-ui/src/public-api.ts`

**Interfaces:**
- Consumes: tokens from Task 1 (only pre-existing ones here).
- Produces: `ButtonComponent`, selector `app-button`. Inputs: `variant: input<'secondary' | 'primary' | 'destructive'>('secondary')`, `disabled: input(false)`, `type: input<'button' | 'submit'>('button')`. Renders `<button class="alloy-button">` with modifier classes `primary` / `destructive`, projecting its label. Used by Tasks 6 (dialog-host) and 7 (form dialog). **The rendered `<button>` carries class `alloy-button` — later tasks and tests query `button.alloy-button`.**

- [ ] **Step 1: Write the failing test**

`web/packages/alloy-ui/src/lib/button/button.component.spec.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ButtonComponent } from './button.component';

describe('ButtonComponent', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [ButtonComponent] }).compileComponents();
  });

  function create(inputs: { variant?: string; disabled?: boolean; type?: string } = {}) {
    const fixture = TestBed.createComponent(ButtonComponent);
    if (inputs.variant !== undefined) fixture.componentRef.setInput('variant', inputs.variant);
    if (inputs.disabled !== undefined) fixture.componentRef.setInput('disabled', inputs.disabled);
    if (inputs.type !== undefined) fixture.componentRef.setInput('type', inputs.type);
    fixture.detectChanges();
    return (fixture.nativeElement as HTMLElement).querySelector(
      'button.alloy-button',
    ) as HTMLButtonElement;
  }

  it('renders a secondary button by default with type=button', () => {
    const button = create();
    expect(button).not.toBeNull();
    expect(button.getAttribute('type')).toBe('button');
    expect(button.classList.contains('primary')).toBe(false);
    expect(button.classList.contains('destructive')).toBe(false);
    expect(button.disabled).toBe(false);
  });

  it('applies the primary and destructive variant classes', () => {
    expect(create({ variant: 'primary' }).classList.contains('primary')).toBe(true);
    expect(create({ variant: 'destructive' }).classList.contains('destructive')).toBe(true);
  });

  it('reflects disabled and type=submit', () => {
    expect(create({ disabled: true }).disabled).toBe(true);
    expect(create({ type: 'submit' }).getAttribute('type')).toBe('submit');
  });

  it('projects its label and bubbles clicks to a host handler', () => {
    @Component({
      imports: [ButtonComponent],
      template: `<app-button (click)="clicks = clicks + 1">Apply</app-button>`,
    })
    class HostComponent {
      clicks = 0;
    }
    const fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
    const button = (fixture.nativeElement as HTMLElement).querySelector(
      'button.alloy-button',
    ) as HTMLButtonElement;
    expect(button.textContent).toContain('Apply');
    button.click();
    expect(fixture.componentInstance.clicks).toBe(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && npx ng test alloy-ui --watch=false`
Expected: FAIL — cannot resolve `./button.component`.

- [ ] **Step 3: Implement**

`web/packages/alloy-ui/src/lib/button/button.component.ts`:

```ts
import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/**
 * Labeled button. The icon-only counterpart is IconButtonComponent.
 *
 * Clicks bubble, so hosts bind their handler on <app-button> directly — there
 * is no custom output. `type="submit"` lets it act as the default button of a
 * surrounding <form> (FormDialogComponent relies on this for Enter-to-submit).
 */
@Component({
  selector: 'app-button',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <button
      class="alloy-button"
      [attr.type]="type()"
      [class.primary]="variant() === 'primary'"
      [class.destructive]="variant() === 'destructive'"
      [disabled]="disabled()"
    >
      <ng-content />
    </button>
  `,
  styleUrl: './button.component.scss',
})
export class ButtonComponent {
  readonly variant = input<'secondary' | 'primary' | 'destructive'>('secondary');
  readonly disabled = input(false);
  readonly type = input<'button' | 'submit'>('button');
}
```

`web/packages/alloy-ui/src/lib/button/button.component.scss`:

```scss
@use '../../styles/tokens' as t;

:host {
  display: inline-flex;
}

.alloy-button {
  border: none;
  border-radius: 10px;
  padding: 8px 16px;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  background: t.$secondary-surface;
  color: t.$label;

  &:hover:not(:disabled) {
    background: t.$secondary-surface-hover;
  }

  &:focus-visible {
    outline: 2px solid t.$focus-ring;
    outline-offset: 2px;
  }

  &:disabled {
    opacity: 0.4;
    cursor: default;
  }

  &.primary {
    background: t.$tint;

    &:hover:not(:disabled) {
      background: t.$tint-hover;
    }
  }

  &.destructive {
    background: t.$destructive;

    &:hover:not(:disabled) {
      filter: brightness(1.1);
    }
  }
}
```

Append to `web/packages/alloy-ui/src/public-api.ts`:

```ts
export { ButtonComponent } from './lib/button/button.component';
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web && npx ng test alloy-ui --watch=false`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/packages/alloy-ui/src/lib/button web/packages/alloy-ui/src/public-api.ts
git commit -m "feat(ui): add labeled button component"
```

---

### Task 3: `TextFieldComponent` and `NumberFieldComponent`

**Files:**
- Create: `web/packages/alloy-ui/src/lib/forms/_input.scss` (shared input chrome partial)
- Create: `web/packages/alloy-ui/src/lib/forms/text-field.component.ts`
- Create: `web/packages/alloy-ui/src/lib/forms/text-field.component.scss`
- Create: `web/packages/alloy-ui/src/lib/forms/number-field.component.ts`
- Create: `web/packages/alloy-ui/src/lib/forms/number-field.component.scss`
- Test: `web/packages/alloy-ui/src/lib/forms/text-field.component.spec.ts`
- Test: `web/packages/alloy-ui/src/lib/forms/number-field.component.spec.ts`
- Modify: `web/packages/alloy-ui/src/public-api.ts`

**Interfaces:**
- Consumes: `$field-bg`, `$field-border`, `$focus-ring` (Task 1).
- Produces:
  - `TextFieldComponent`, selector `app-text-field`. `value = model('')`, `placeholder = input('')`, `disabled = input(false)`, `invalid = input(false)`. Renders `input.alloy-input[type=text]`.
  - `NumberFieldComponent`, selector `app-number-field`. `value = model<number | null>(null)`, `min = input<number | null>(null)`, `max = input<number | null>(null)`, `step = input(1)`, `disabled = input(false)`, `invalid = input(false)`. Renders `input.alloy-input[type=number]`. Emits the typed number on `input` (no clamping mid-typing); clamps into `[min, max]` on `blur`. Empty input emits `null`.

- [ ] **Step 1: Write the failing tests**

`web/packages/alloy-ui/src/lib/forms/text-field.component.spec.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { TextFieldComponent } from './text-field.component';

describe('TextFieldComponent', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [TextFieldComponent] }).compileComponents();
  });

  it('renders a text input with the placeholder and current value', () => {
    const fixture = TestBed.createComponent(TextFieldComponent);
    fixture.componentRef.setInput('value', 'Allegro');
    fixture.componentRef.setInput('placeholder', 'Tempo name');
    fixture.detectChanges();
    const input = (fixture.nativeElement as HTMLElement).querySelector(
      'input.alloy-input',
    ) as HTMLInputElement;
    expect(input.type).toBe('text');
    expect(input.value).toBe('Allegro');
    expect(input.placeholder).toBe('Tempo name');
    expect(input.getAttribute('aria-invalid')).toBeNull();
  });

  it('sets disabled and aria-invalid', () => {
    const fixture = TestBed.createComponent(TextFieldComponent);
    fixture.componentRef.setInput('disabled', true);
    fixture.componentRef.setInput('invalid', true);
    fixture.detectChanges();
    const input = (fixture.nativeElement as HTMLElement).querySelector(
      'input.alloy-input',
    ) as HTMLInputElement;
    expect(input.disabled).toBe(true);
    expect(input.getAttribute('aria-invalid')).toBe('true');
  });

  it('two-way binds value on input', () => {
    @Component({
      imports: [TextFieldComponent],
      template: `<app-text-field [(value)]="name" />`,
    })
    class HostComponent {
      readonly name = signal('one');
    }
    const fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
    const input = (fixture.nativeElement as HTMLElement).querySelector(
      'input.alloy-input',
    ) as HTMLInputElement;
    expect(input.value).toBe('one');
    input.value = 'two';
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    expect(fixture.componentInstance.name()).toBe('two');
  });
});
```

`web/packages/alloy-ui/src/lib/forms/number-field.component.spec.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { NumberFieldComponent } from './number-field.component';

describe('NumberFieldComponent', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [NumberFieldComponent] }).compileComponents();
  });

  @Component({
    imports: [NumberFieldComponent],
    template: `<app-number-field [(value)]="beats" [min]="min" [max]="max" />`,
  })
  class HostComponent {
    readonly beats = signal<number | null>(4);
    min: number | null = 1;
    max: number | null = 32;
  }

  function setup() {
    const fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
    const input = (fixture.nativeElement as HTMLElement).querySelector(
      'input.alloy-input',
    ) as HTMLInputElement;
    return { fixture, input };
  }

  it('renders a number input carrying min, max and the current value', () => {
    const { input } = setup();
    expect(input.type).toBe('number');
    expect(input.value).toBe('4');
    expect(input.getAttribute('min')).toBe('1');
    expect(input.getAttribute('max')).toBe('32');
  });

  it('emits the typed number on input without clamping mid-typing', () => {
    const { fixture, input } = setup();
    input.value = '7';
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    expect(fixture.componentInstance.beats()).toBe(7);
  });

  it('emits null when cleared', () => {
    const { fixture, input } = setup();
    input.value = '';
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    expect(fixture.componentInstance.beats()).toBeNull();
  });

  it('clamps above max on blur', () => {
    const { fixture, input } = setup();
    input.value = '99';
    input.dispatchEvent(new Event('input'));
    input.dispatchEvent(new Event('blur'));
    fixture.detectChanges();
    expect(fixture.componentInstance.beats()).toBe(32);
  });

  it('clamps below min on blur', () => {
    const { fixture, input } = setup();
    input.value = '0';
    input.dispatchEvent(new Event('input'));
    input.dispatchEvent(new Event('blur'));
    fixture.detectChanges();
    expect(fixture.componentInstance.beats()).toBe(1);
  });

  it('leaves null untouched on blur', () => {
    const { fixture, input } = setup();
    input.value = '';
    input.dispatchEvent(new Event('input'));
    input.dispatchEvent(new Event('blur'));
    fixture.detectChanges();
    expect(fixture.componentInstance.beats()).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd web && npx ng test alloy-ui --watch=false`
Expected: FAIL — cannot resolve `./text-field.component` / `./number-field.component`.

- [ ] **Step 3: Implement**

`web/packages/alloy-ui/src/lib/forms/_input.scss` (shared input chrome — a Sass partial, `@use`d by both field components so the rules are emitted into each component's scoped styles):

```scss
@use '../../styles/tokens' as t;

.alloy-input {
  box-sizing: border-box;
  width: 100%;
  padding: 8px 10px;
  border-radius: 8px;
  border: 1px solid t.$field-border;
  background: t.$field-bg;
  color: t.$label;
  font-size: 14px;
  font-family: inherit;

  &::placeholder {
    color: t.$secondary-label;
  }

  &:focus-visible {
    outline: 2px solid t.$focus-ring;
    outline-offset: 1px;
  }

  &:disabled {
    opacity: 0.4;
  }

  &[aria-invalid='true'] {
    border-color: t.$destructive;
  }
}
```

`web/packages/alloy-ui/src/lib/forms/text-field.component.ts`:

```ts
import { ChangeDetectionStrategy, Component, input, model } from '@angular/core';

/** Single-line text input. Two-way bind with `[(value)]`; no @angular/forms. */
@Component({
  selector: 'app-text-field',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <input
      class="alloy-input"
      type="text"
      [value]="value()"
      [placeholder]="placeholder()"
      [disabled]="disabled()"
      [attr.aria-invalid]="invalid() ? 'true' : null"
      (input)="onInput($event)"
    />
  `,
  styleUrl: './text-field.component.scss',
})
export class TextFieldComponent {
  readonly value = model('');
  readonly placeholder = input('');
  readonly disabled = input(false);
  readonly invalid = input(false);

  protected onInput(event: Event): void {
    this.value.set((event.target as HTMLInputElement).value);
  }
}
```

`web/packages/alloy-ui/src/lib/forms/number-field.component.ts`:

```ts
import { ChangeDetectionStrategy, Component, input, model } from '@angular/core';

/**
 * Numeric input. Native spinners are hidden (see _input.scss).
 *
 * `input` emits exactly what was typed (clamping mid-typing would fight the
 * user — typing "1" toward "12" under min=10 would jump to 10). `blur` clamps
 * the settled value into [min, max]. An empty box is `null`, never 0.
 */
@Component({
  selector: 'app-number-field',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <input
      class="alloy-input"
      type="number"
      [value]="value() ?? ''"
      [attr.min]="min()"
      [attr.max]="max()"
      [attr.step]="step()"
      [disabled]="disabled()"
      [attr.aria-invalid]="invalid() ? 'true' : null"
      (input)="onInput($event)"
      (blur)="onBlur()"
    />
  `,
  styleUrl: './number-field.component.scss',
})
export class NumberFieldComponent {
  readonly value = model<number | null>(null);
  readonly min = input<number | null>(null);
  readonly max = input<number | null>(null);
  readonly step = input(1);
  readonly disabled = input(false);
  readonly invalid = input(false);

  protected onInput(event: Event): void {
    const raw = (event.target as HTMLInputElement).value;
    if (raw === '') {
      this.value.set(null);
      return;
    }
    const parsed = Number(raw);
    this.value.set(Number.isNaN(parsed) ? null : parsed);
  }

  protected onBlur(): void {
    const current = this.value();
    if (current === null) return;
    const min = this.min();
    const max = this.max();
    let clamped = current;
    if (min !== null && clamped < min) clamped = min;
    if (max !== null && clamped > max) clamped = max;
    if (clamped !== current) this.value.set(clamped);
  }
}
```

Add the spinner-hiding rules to the END of `web/packages/alloy-ui/src/lib/forms/_input.scss`:

```scss
// Hide the native number spinners — they do not match the kit's chrome.
.alloy-input[type='number'] {
  appearance: textfield;

  &::-webkit-outer-spin-button,
  &::-webkit-inner-spin-button {
    appearance: none;
    margin: 0;
  }
}
```

`web/packages/alloy-ui/src/lib/forms/text-field.component.scss`:

```scss
@use './input';

:host {
  display: block;
}
```

`web/packages/alloy-ui/src/lib/forms/number-field.component.scss`:

```scss
@use './input';

:host {
  display: block;
}
```

(`@use './input'` loads the `_input.scss` partial — Sass resolves the leading underscore automatically — and emits its `.alloy-input` rules into each component's scoped stylesheet.)

Append to `web/packages/alloy-ui/src/public-api.ts`:

```ts
export { TextFieldComponent } from './lib/forms/text-field.component';
export { NumberFieldComponent } from './lib/forms/number-field.component';
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd web && npx ng test alloy-ui --watch=false`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/packages/alloy-ui/src/lib/forms web/packages/alloy-ui/src/public-api.ts
git commit -m "feat(ui): add text and number field components"
```

---

### Task 4: `SelectComponent`

**Files:**
- Create: `web/packages/alloy-ui/src/lib/forms/select.component.ts`
- Create: `web/packages/alloy-ui/src/lib/forms/select.component.scss`
- Test: `web/packages/alloy-ui/src/lib/forms/select.component.spec.ts`
- Modify: `web/packages/alloy-ui/src/public-api.ts`

**Interfaces:**
- Consumes: `$field-bg`, `$field-border`, `$focus-ring` (Task 1).
- Produces: `SelectComponent`, selector `app-select`, and `export interface SelectOption { value: string; label: string }`. Inputs: `options = input.required<readonly SelectOption[]>()`, `value = model('')`, `disabled = input(false)`, `selectLabel = input('')` (becomes `aria-label`). Renders `select.alloy-select` with `appearance: none` + custom arrow + `color-scheme: dark` so the OS popup renders dark.

- [ ] **Step 1: Write the failing test**

`web/packages/alloy-ui/src/lib/forms/select.component.spec.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { SelectComponent, SelectOption } from './select.component';

const PICKUPS: readonly SelectOption[] = [
  { value: 'none', label: 'None' },
  { value: '1', label: '1 beat' },
  { value: '2', label: '2 beats' },
];

describe('SelectComponent', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [SelectComponent] }).compileComponents();
  });

  @Component({
    imports: [SelectComponent],
    template: `<app-select [options]="options" [(value)]="pickup" selectLabel="Pickup" />`,
  })
  class HostComponent {
    readonly options = PICKUPS;
    readonly pickup = signal('1');
  }

  function setup() {
    const fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
    const select = (fixture.nativeElement as HTMLElement).querySelector(
      'select.alloy-select',
    ) as HTMLSelectElement;
    return { fixture, select };
  }

  it('renders one option per entry and reflects the current value', () => {
    const { select } = setup();
    const options = select.querySelectorAll('option');
    expect(options.length).toBe(3);
    expect(options[1].textContent).toContain('1 beat');
    expect(select.value).toBe('1');
    expect(select.getAttribute('aria-label')).toBe('Pickup');
  });

  it('two-way binds value on change', () => {
    const { fixture, select } = setup();
    select.value = '2';
    select.dispatchEvent(new Event('change'));
    fixture.detectChanges();
    expect(fixture.componentInstance.pickup()).toBe('2');
  });

  it('reflects disabled', () => {
    const fixture = TestBed.createComponent(SelectComponent);
    fixture.componentRef.setInput('options', PICKUPS);
    fixture.componentRef.setInput('disabled', true);
    fixture.detectChanges();
    const select = (fixture.nativeElement as HTMLElement).querySelector(
      'select.alloy-select',
    ) as HTMLSelectElement;
    expect(select.disabled).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && npx ng test alloy-ui --watch=false`
Expected: FAIL — cannot resolve `./select.component`.

- [ ] **Step 3: Implement**

`web/packages/alloy-ui/src/lib/forms/select.component.ts`:

```ts
import { ChangeDetectionStrategy, Component, input, model } from '@angular/core';

export interface SelectOption {
  value: string;
  label: string;
}

/**
 * Dropdown built on a native <select>: the closed state is fully styled
 * (appearance: none + our own arrow), while keyboard behavior and
 * accessibility stay native. `color-scheme: dark` (see the stylesheet) makes
 * the browser render the OS popup dark rather than white.
 *
 * A custom listbox popup is deliberately not implemented — see the spec.
 */
@Component({
  selector: 'app-select',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <select
      class="alloy-select"
      [disabled]="disabled()"
      [attr.aria-label]="selectLabel() || null"
      (change)="onChange($event)"
    >
      @for (option of options(); track option.value) {
        <option [value]="option.value" [selected]="option.value === value()">{{ option.label }}</option>
      }
    </select>
  `,
  styleUrl: './select.component.scss',
})
export class SelectComponent {
  readonly options = input.required<readonly SelectOption[]>();
  readonly value = model('');
  readonly disabled = input(false);
  readonly selectLabel = input('');

  protected onChange(event: Event): void {
    this.value.set((event.target as HTMLSelectElement).value);
  }
}
```

`web/packages/alloy-ui/src/lib/forms/select.component.scss`:

```scss
@use '../../styles/tokens' as t;

:host {
  display: inline-flex;
}

.alloy-select {
  // Renders the OS popup list dark instead of white.
  color-scheme: dark;
  appearance: none;
  box-sizing: border-box;
  width: 100%;
  padding: 8px 30px 8px 10px;
  border-radius: 8px;
  border: 1px solid t.$field-border;
  background-color: t.$field-bg;
  color: t.$label;
  font-size: 14px;
  font-family: inherit;
  cursor: pointer;

  // Chevron, drawn as an inline SVG data URI so no asset ships with the lib.
  background-image: url("data:image/svg+xml;charset=utf-8,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 12 8'%3E%3Cpath fill='%2398989e' d='M1.4 1.7 6 6.3l4.6-4.6'/%3E%3C/svg%3E");
  background-repeat: no-repeat;
  background-position: right 10px center;
  background-size: 10px 7px;

  &:focus-visible {
    outline: 2px solid t.$focus-ring;
    outline-offset: 1px;
  }

  &:disabled {
    opacity: 0.4;
    cursor: default;
  }
}
```

Note: the chevron's `%2398989e` is the URL-encoded form of the `$secondary-label` value. A data URI cannot interpolate a SCSS variable, so this is the one sanctioned place a color appears literally; keep it in sync if `secondary-label` ever changes.

Append to `web/packages/alloy-ui/src/public-api.ts`:

```ts
export { SelectComponent, SelectOption } from './lib/forms/select.component';
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web && npx ng test alloy-ui --watch=false`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/packages/alloy-ui/src/lib/forms web/packages/alloy-ui/src/public-api.ts
git commit -m "feat(ui): add select component"
```

---

### Task 5: `FieldComponent` (label + control row)

**Files:**
- Create: `web/packages/alloy-ui/src/lib/forms/field.component.ts`
- Create: `web/packages/alloy-ui/src/lib/forms/field.component.scss`
- Test: `web/packages/alloy-ui/src/lib/forms/field.component.spec.ts`
- Modify: `web/packages/alloy-ui/src/public-api.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks (styling only).
- Produces: `FieldComponent`, selector `app-field`. Input `label = input.required<string>()`. Renders `<label class="alloy-field">` containing `<span class="alloy-field-label">` and the projected control. Wrapping in a real `<label>` associates the caption with the control natively — no generated ids.

- [ ] **Step 1: Write the failing test**

`web/packages/alloy-ui/src/lib/forms/field.component.spec.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { FieldComponent } from './field.component';

describe('FieldComponent', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [FieldComponent] }).compileComponents();
  });

  it('renders a <label> wrapping the caption and the projected control', () => {
    @Component({
      imports: [FieldComponent],
      template: `<app-field label="Pickup"><input id="ctl" /></app-field>`,
    })
    class HostComponent {}

    const fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
    const host = fixture.nativeElement as HTMLElement;
    const label = host.querySelector('label.alloy-field') as HTMLLabelElement;
    expect(label).not.toBeNull();
    expect(label.querySelector('.alloy-field-label')?.textContent).toContain('Pickup');
    // The control is INSIDE the label element — that is what associates them.
    expect(label.querySelector('#ctl')).not.toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && npx ng test alloy-ui --watch=false`
Expected: FAIL — cannot resolve `./field.component`.

- [ ] **Step 3: Implement**

`web/packages/alloy-ui/src/lib/forms/field.component.ts`:

```ts
import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/**
 * A labeled form row. The caption and the projected control live inside one
 * <label> element, so clicking the caption focuses the control natively — no
 * generated ids, no for/id plumbing.
 *
 * Use this for a field holding ONE input or select. Do not wrap a segmented
 * control (a group of buttons) in it — a <label> around a button group is not
 * meaningful; give the segment its own aria-label instead.
 */
@Component({
  selector: 'app-field',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <label class="alloy-field">
      <span class="alloy-field-label">{{ label() }}</span>
      <ng-content />
    </label>
  `,
  styleUrl: './field.component.scss',
})
export class FieldComponent {
  readonly label = input.required<string>();
}
```

`web/packages/alloy-ui/src/lib/forms/field.component.scss`:

```scss
@use '../../styles/tokens' as t;

:host {
  display: block;
}

.alloy-field {
  display: flex;
  align-items: center;
  gap: 12px;
}

.alloy-field-label {
  flex: 0 0 auto;
  color: t.$secondary-label;
  font-size: 14px;
}
```

Append to `web/packages/alloy-ui/src/public-api.ts`:

```ts
export { FieldComponent } from './lib/forms/field.component';
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web && npx ng test alloy-ui --watch=false`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/packages/alloy-ui/src/lib/forms web/packages/alloy-ui/src/public-api.ts
git commit -m "feat(ui): add field row component"
```

---

### Task 6: Extract `ModalShellComponent`; move `DialogHostComponent` onto it and onto `ButtonComponent`

This is the riskiest task: it refactors code released in 0.7.0. The existing `dialog-host` suite is the regression net — it MUST stay green (with the selector updates below, which are the only permitted test changes).

**Files:**
- Create: `web/packages/alloy-ui/src/lib/modal/modal-shell.component.ts`
- Create: `web/packages/alloy-ui/src/lib/modal/modal-shell.component.scss`
- Modify: `web/packages/alloy-ui/src/lib/dialog/dialog-host.component.ts`
- Modify: `web/packages/alloy-ui/src/lib/dialog/dialog-host.component.scss`
- Modify: `web/packages/alloy-ui/src/lib/dialog/dialog-host.component.spec.ts` (selector updates only)
- **Do NOT export `ModalShellComponent` from `public-api.ts`** — it is internal.

**Interfaces:**
- Consumes: `ButtonComponent` (Task 2).
- Produces: `ModalShellComponent`, selector `app-modal-shell`. Input `labelledBy = input('')`; output `dismissed = output<void>()` (fires for BOTH Esc and backdrop click). Renders `<dialog class="alloy-modal" animate.leave="modal-leave">` containing `<div class="alloy-modal-body">` with projected content. Opens itself via `showModal()` (jsdom-guarded) when created. Used by Task 7's `FormDialogComponent`.
- **DOM contract change (breaking for tests only):** the dialog element is now `dialog.alloy-modal` (was `dialog.dialog`), and dialog-host's buttons are now `button.alloy-button` (was `button.dialog-button`).

- [ ] **Step 1: Write the failing test**

`web/packages/alloy-ui/src/lib/modal/modal-shell.component.spec.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ModalShellComponent } from './modal-shell.component';

describe('ModalShellComponent', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [ModalShellComponent] }).compileComponents();
  });

  @Component({
    imports: [ModalShellComponent],
    template: `
      @if (open()) {
        <app-modal-shell (dismissed)="dismissals = dismissals + 1">
          <p class="inner">body</p>
        </app-modal-shell>
      }
    `,
  })
  class HostComponent {
    readonly open = signal(true);
    dismissals = 0;
  }

  function setup() {
    const fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
    const host = fixture.nativeElement as HTMLElement;
    const panel = host.querySelector('dialog.alloy-modal') as HTMLDialogElement;
    return { fixture, host, panel };
  }

  it('renders an open dialog with the projected content', () => {
    const { host, panel } = setup();
    expect(panel).not.toBeNull();
    expect(panel.open).toBe(true);
    expect(host.querySelector('.alloy-modal-body .inner')?.textContent).toContain('body');
  });

  it('emits dismissed on Esc (the native cancel event)', () => {
    const { fixture, panel } = setup();
    panel.dispatchEvent(new Event('cancel', { cancelable: true }));
    expect(fixture.componentInstance.dismissals).toBe(1);
  });

  it('emits dismissed on backdrop click (target is the dialog itself)', () => {
    const { fixture, panel } = setup();
    panel.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(fixture.componentInstance.dismissals).toBe(1);
  });

  it('does not emit dismissed for clicks inside the body', () => {
    const { fixture, host } = setup();
    const inner = host.querySelector('.inner') as HTMLElement;
    inner.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(fixture.componentInstance.dismissals).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && npx ng test alloy-ui --watch=false`
Expected: FAIL — cannot resolve `./modal-shell.component`.

- [ ] **Step 3: Implement the shell**

`web/packages/alloy-ui/src/lib/modal/modal-shell.component.ts`:

```ts
import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  effect,
  input,
  output,
  viewChild,
} from '@angular/core';

/**
 * INTERNAL. The shared native-<dialog> shell behind every AlloyUI modal
 * (confirm/alert via DialogHostComponent, forms via FormDialogComponent).
 * Not exported from public-api — hosts are the public surface.
 *
 * Owns: showModal() (so focus trapping, background inerting and top-layer
 * stacking come from the platform), Esc, backdrop-click detection, the
 * animate.leave exit fade, and the panel chrome.
 *
 * Does NOT own focus policy — each host decides what to focus, because the
 * rules differ (dialog-host re-focuses the safe action on queue advance;
 * form-dialog focuses the first field).
 *
 * Backdrop clicks target the <dialog> element itself; in-panel clicks target
 * .alloy-modal-body or deeper. That is only true because the panel has
 * padding: 0 and the body carries the padding — do not move the padding.
 */
@Component({
  selector: 'app-modal-shell',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <dialog
      #panel
      class="alloy-modal"
      animate.leave="modal-leave"
      [attr.aria-labelledby]="labelledBy() || null"
      (cancel)="onCancel($event)"
      (click)="onClick($event)"
    >
      <div class="alloy-modal-body">
        <ng-content />
      </div>
    </dialog>
  `,
  styleUrl: './modal-shell.component.scss',
})
export class ModalShellComponent {
  readonly labelledBy = input('');
  /** Esc or backdrop click. The host decides what dismissal means. */
  readonly dismissed = output<void>();

  private readonly panel = viewChild<ElementRef<HTMLDialogElement>>('panel');

  constructor() {
    effect(() => {
      const el = this.panel()?.nativeElement;
      if (el && !el.open) {
        // jsdom guard: fall back to the open attribute where showModal is missing.
        if (typeof el.showModal === 'function') el.showModal();
        else el.setAttribute('open', '');
      }
    });
  }

  protected onCancel(event: Event): void {
    // Close by re-rendering (the host's @if removes us), not natively.
    event.preventDefault();
    this.dismissed.emit();
  }

  protected onClick(event: MouseEvent): void {
    if (event.target === this.panel()?.nativeElement) this.dismissed.emit();
  }
}
```

`web/packages/alloy-ui/src/lib/modal/modal-shell.component.scss`:

```scss
@use '../../styles/tokens' as t;

:host {
  display: contents;
}

dialog.alloy-modal {
  padding: 0; // backdrop-vs-panel click detection relies on the body filling the panel
  border: none;
  border-radius: t.$sheet-corner-radius;
  background: t.$sheet-bg;
  color: t.$label;
  min-width: 280px;
  max-width: min(420px, calc(100vw - 32px));
  animation: modal-enter t.$overlay-fade ease both;

  &::backdrop {
    background: t.$backdrop;
  }
}

// Exit twin, applied by animate.leave on removal.
dialog.alloy-modal.modal-leave {
  animation: modal-exit t.$overlay-fade ease both;
}

.alloy-modal-body {
  padding: 24px;
}

@keyframes modal-enter {
  from {
    opacity: 0;
    transform: scale(0.96);
  }
}

@keyframes modal-exit {
  to {
    opacity: 0;
    transform: scale(0.96);
  }
}
```

- [ ] **Step 4: Run the shell test to verify it passes**

Run: `cd web && npx ng test alloy-ui --watch=false`
Expected: the four `ModalShellComponent` tests PASS. The `dialog-host` suite still passes too (untouched so far).

- [ ] **Step 5: Move `DialogHostComponent` onto the shell and onto `ButtonComponent`**

Replace `web/packages/alloy-ui/src/lib/dialog/dialog-host.component.ts` entirely with:

```ts
import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  afterRenderEffect,
  inject,
} from '@angular/core';
import { AlloyDialog } from './dialog.service';
import { ModalShellComponent } from '../modal/modal-shell.component';
import { ButtonComponent } from '../button/button.component';

/** Module-level counter so multiple mounted hosts never collide on id. */
let nextHostId = 0;

/**
 * Visual outlet for AlloyDialog. Placed once per app (via <app-overlays>);
 * renders nothing while idle. The native-<dialog> behavior (showModal, Esc,
 * backdrop, exit fade) lives in ModalShellComponent; this host owns only the
 * confirm/alert content, the buttons, and the focus policy.
 *
 * `settle()` advances the queue synchronously, so when dialog A settles with
 * B queued, the `@if` never tears down — the same open <dialog> re-renders
 * with B's content. The afterRenderEffect below re-focuses the first button
 * (the safe action) whenever the active dialog changes, so focus never
 * lingers on whatever button the user just clicked in A.
 */
@Component({
  selector: 'app-dialog-host',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ModalShellComponent, ButtonComponent],
  template: `
    @if (dialog.current(); as active) {
      <app-modal-shell [labelledBy]="titleId" (dismissed)="dialog.settle(false)">
        <h2 class="dialog-title" [id]="titleId">{{ active.title }}</h2>
        @if (active.message) {
          <p class="dialog-message">{{ active.message }}</p>
        }
        <div class="dialog-actions">
          @if (active.cancelLabel) {
            <app-button (click)="dialog.settle(false)">{{ active.cancelLabel }}</app-button>
          }
          <app-button
            [variant]="active.destructive ? 'destructive' : 'primary'"
            (click)="dialog.settle(true)"
          >
            {{ active.confirmLabel }}
          </app-button>
        </div>
      </app-modal-shell>
    }
  `,
  styleUrl: './dialog-host.component.scss',
})
export class DialogHostComponent {
  protected readonly dialog = inject(AlloyDialog);
  protected readonly titleId = `alloy-dialog-title-${nextHostId++}`;
  private readonly el = inject(ElementRef<HTMLElement>);

  constructor() {
    // Runs after the DOM reflects the active dialog, so the queued dialog's
    // own buttons exist by the time we focus one. Re-fires whenever
    // dialog.current() changes (including the null->next advance inside a
    // single settle()), which is exactly when focus must move.
    afterRenderEffect(() => {
      if (!this.dialog.current()) return;
      const host = this.el.nativeElement as HTMLElement;
      host.querySelector<HTMLButtonElement>('button.alloy-button')?.focus();
    });
  }
}
```

Replace `web/packages/alloy-ui/src/lib/dialog/dialog-host.component.scss` entirely with (the panel chrome and button styles now live in the shell and in ButtonComponent):

```scss
@use '../../styles/tokens' as t;

:host {
  display: contents;
}

.dialog-title {
  margin: 0;
  font-size: 17px;
  font-weight: 600;
}

.dialog-message {
  margin: 8px 0 0;
  font-size: 14px;
  color: t.$secondary-label;
}

.dialog-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 20px;
}
```

- [ ] **Step 6: Update the dialog-host spec's selectors (the ONLY permitted test changes)**

In `web/packages/alloy-ui/src/lib/dialog/dialog-host.component.spec.ts`, apply exactly these substitutions throughout the file — every assertion's meaning stays the same:

- `dialog.dialog` → `dialog.alloy-modal` (in every `querySelector`)
- `button.dialog-button` → `button.alloy-button` (in every `querySelector` / `querySelectorAll`)
- The destructive-variant test currently reads:

```ts
    const confirmButton = host.querySelector('button.dialog-button.confirm');
    expect(confirmButton?.classList.contains('destructive')).toBe(true);
```

Replace those two lines with (the confirm button is the LAST `.alloy-button`, and ButtonComponent applies the `destructive` class):

```ts
    const buttons = host.querySelectorAll('button.alloy-button');
    const confirmButton = buttons[buttons.length - 1];
    expect(confirmButton.classList.contains('destructive')).toBe(true);
```

Do not change any other assertion, and do not delete any test.

- [ ] **Step 7: Run the full suite**

Run: `cd web && npx ng test alloy-ui --watch=false`
Expected: PASS — every pre-existing `dialog-host` test still green (confirm/alert, Esc, backdrop, in-panel click, queueing, destructive, aria-labelledby, focus-on-advance), plus the new shell tests.

- [ ] **Step 8: Commit**

```bash
git add web/packages/alloy-ui/src/lib/modal \
  web/packages/alloy-ui/src/lib/dialog/dialog-host.component.ts \
  web/packages/alloy-ui/src/lib/dialog/dialog-host.component.scss \
  web/packages/alloy-ui/src/lib/dialog/dialog-host.component.spec.ts
git commit -m "refactor(ui): extract shared modal shell; dialog-host uses it and app-button"
```

---

### Task 7: `FormDialogComponent`

**Files:**
- Create: `web/packages/alloy-ui/src/lib/forms/form-dialog.component.ts`
- Create: `web/packages/alloy-ui/src/lib/forms/form-dialog.component.scss`
- Test: `web/packages/alloy-ui/src/lib/forms/form-dialog.component.spec.ts`
- Modify: `web/packages/alloy-ui/src/public-api.ts`

**Interfaces:**
- Consumes: `ModalShellComponent` (Task 6), `ButtonComponent` (Task 2).
- Produces: `FormDialogComponent`, selector `app-form-dialog`. Inputs: `open = input(false)`, `title = input.required<string>()`, `submitLabel = input('Apply')`, `cancelLabel = input('Cancel')`, `submitDisabled = input(false)`. Outputs: `submitted = output<void>()`, `cancelled = output<void>()`. Body content is projected.

Enter-to-submit comes free: the body and footer live inside a real `<form>`, and the submit button is `type="submit"`, so the browser's implicit submission fires `(submit)`. `onSubmit` calls `preventDefault()` and guards on `submitDisabled`.

- [ ] **Step 1: Write the failing test**

`web/packages/alloy-ui/src/lib/forms/form-dialog.component.spec.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { FormDialogComponent } from './form-dialog.component';

describe('FormDialogComponent', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [FormDialogComponent] }).compileComponents();
  });

  @Component({
    imports: [FormDialogComponent],
    template: `
      <app-form-dialog
        [open]="open()"
        title="Time signature"
        submitLabel="Apply"
        [submitDisabled]="blocked()"
        (submitted)="submits = submits + 1"
        (cancelled)="cancels = cancels + 1"
      >
        <input class="beats" />
      </app-form-dialog>
    `,
  })
  class HostComponent {
    readonly open = signal(true);
    readonly blocked = signal(false);
    submits = 0;
    cancels = 0;
  }

  function setup() {
    const fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
    const host = fixture.nativeElement as HTMLElement;
    return { fixture, host };
  }

  const buttonNamed = (host: HTMLElement, label: string) =>
    [...host.querySelectorAll('button.alloy-button')].find((b) =>
      b.textContent?.includes(label),
    ) as HTMLButtonElement;

  it('renders nothing while closed', () => {
    const fixture = TestBed.createComponent(HostComponent);
    fixture.componentInstance.open.set(false);
    fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).querySelector('dialog.alloy-modal')).toBeNull();
  });

  it('renders the title, projected body, and both buttons when open', () => {
    const { host } = setup();
    expect(host.querySelector('dialog.alloy-modal')).not.toBeNull();
    expect(host.querySelector('.form-dialog-title')?.textContent).toContain('Time signature');
    expect(host.querySelector('input.beats')).not.toBeNull();
    expect(buttonNamed(host, 'Apply')).toBeTruthy();
    expect(buttonNamed(host, 'Cancel')).toBeTruthy();
  });

  it('emits submitted when the submit button is clicked', () => {
    const { fixture, host } = setup();
    buttonNamed(host, 'Apply').click();
    expect(fixture.componentInstance.submits).toBe(1);
  });

  it('emits submitted on Enter (implicit form submission)', () => {
    const { fixture, host } = setup();
    const form = host.querySelector('form.form-dialog') as HTMLFormElement;
    form.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
    expect(fixture.componentInstance.submits).toBe(1);
  });

  it('emits cancelled from the cancel button, Esc, and backdrop click', () => {
    const { fixture, host } = setup();
    buttonNamed(host, 'Cancel').click();
    expect(fixture.componentInstance.cancels).toBe(1);

    const panel = host.querySelector('dialog.alloy-modal') as HTMLDialogElement;
    panel.dispatchEvent(new Event('cancel', { cancelable: true }));
    expect(fixture.componentInstance.cancels).toBe(2);

    panel.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(fixture.componentInstance.cancels).toBe(3);
  });

  it('submitDisabled blocks BOTH the button and Enter, and disables the button', () => {
    const { fixture, host } = setup();
    fixture.componentInstance.blocked.set(true);
    fixture.detectChanges();

    expect(buttonNamed(host, 'Apply').disabled).toBe(true);
    buttonNamed(host, 'Apply').click();
    const form = host.querySelector('form.form-dialog') as HTMLFormElement;
    form.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
    expect(fixture.componentInstance.submits).toBe(0);
  });

  it('focuses the first field in the body on open', () => {
    const { host } = setup();
    expect(document.activeElement).toBe(host.querySelector('input.beats'));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && npx ng test alloy-ui --watch=false`
Expected: FAIL — cannot resolve `./form-dialog.component`.

- [ ] **Step 3: Implement**

`web/packages/alloy-ui/src/lib/forms/form-dialog.component.ts`:

```ts
import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  afterRenderEffect,
  inject,
  input,
  output,
} from '@angular/core';
import { ModalShellComponent } from '../modal/modal-shell.component';
import { ButtonComponent } from '../button/button.component';

/** Module-level counter so multiple mounted dialogs never collide on id. */
let nextFormDialogId = 0;

/**
 * Declarative form modal: the library owns the layout (title, body, footer
 * actions) and the app owns the content. Project fields into the body, bind
 * their values with your own signals, and drive `submitDisabled` from your own
 * validation — there is no schema and no @angular/forms.
 *
 * The body and footer sit inside a real <form> whose submit button is
 * type="submit", so pressing Enter in a field triggers the browser's implicit
 * submission and `submitted` fires. Esc and backdrop click both emit
 * `cancelled`.
 */
@Component({
  selector: 'app-form-dialog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ModalShellComponent, ButtonComponent],
  template: `
    @if (open()) {
      <app-modal-shell [labelledBy]="titleId" (dismissed)="cancelled.emit()">
        <form class="form-dialog" (submit)="onSubmit($event)">
          <h2 class="form-dialog-title" [id]="titleId">{{ title() }}</h2>
          <div class="form-dialog-body">
            <ng-content />
          </div>
          <div class="form-dialog-actions">
            <app-button (click)="cancelled.emit()">{{ cancelLabel() }}</app-button>
            <app-button type="submit" variant="primary" [disabled]="submitDisabled()">
              {{ submitLabel() }}
            </app-button>
          </div>
        </form>
      </app-modal-shell>
    }
  `,
  styleUrl: './form-dialog.component.scss',
})
export class FormDialogComponent {
  readonly open = input(false);
  readonly title = input.required<string>();
  readonly submitLabel = input('Apply');
  readonly cancelLabel = input('Cancel');
  readonly submitDisabled = input(false);

  readonly submitted = output<void>();
  readonly cancelled = output<void>();

  protected readonly titleId = `alloy-form-dialog-title-${nextFormDialogId++}`;
  private readonly el = inject(ElementRef<HTMLElement>);

  constructor() {
    // Focus the first field once the body has rendered. Falls back to the
    // submit button when the body projects no focusable control.
    afterRenderEffect(() => {
      if (!this.open()) return;
      const host = this.el.nativeElement as HTMLElement;
      const first = host.querySelector<HTMLElement>(
        '.form-dialog-body input, .form-dialog-body select, .form-dialog-body textarea, .form-dialog-body button',
      );
      (first ?? host.querySelector<HTMLElement>('button.alloy-button[type="submit"]'))?.focus();
    });
  }

  protected onSubmit(event: Event): void {
    // Never let the browser navigate; we are not posting anywhere.
    event.preventDefault();
    if (this.submitDisabled()) return;
    this.submitted.emit();
  }
}
```

`web/packages/alloy-ui/src/lib/forms/form-dialog.component.scss`:

```scss
@use '../../styles/tokens' as t;

:host {
  display: contents;
}

.form-dialog-title {
  margin: 0;
  font-size: 17px;
  font-weight: 600;
  color: t.$label;
}

.form-dialog-body {
  display: flex;
  flex-direction: column;
  gap: 14px;
  margin-top: 16px;
}

.form-dialog-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 20px;
}
```

Append to `web/packages/alloy-ui/src/public-api.ts`:

```ts
export { FormDialogComponent } from './lib/forms/form-dialog.component';
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web && npx ng test alloy-ui --watch=false`
Expected: PASS (all suites, including the untouched dialog-host regression net).

- [ ] **Step 5: Commit**

```bash
git add web/packages/alloy-ui/src/lib/forms web/packages/alloy-ui/src/public-api.ts
git commit -m "feat(ui): add declarative form dialog"
```

---

### Task 8: Harness Time Signature section, `mirroring.md` entry, full verification

**Files:**
- Create: `examples/web-harness/src/app/sections/forms-section.component.ts`
- Modify: `examples/web-harness/src/app/app.component.ts`
- Modify: `docs/mirroring.md`

**Interfaces:**
- Consumes: everything from Tasks 2–7 via `@allyworld/alloy-ui` (the harness maps that import to `web/packages/alloy-ui/src/public-api.ts` in its tsconfig), plus the pre-existing `KnobSegmentComponent` (`selection` input + `changed` output — it is NOT a `model()`).
- Produces: the manual verification surface and the contract documentation.

- [ ] **Step 1: Create the harness section — a rebuild of AllyScore's Time Signature dialog**

`examples/web-harness/src/app/sections/forms-section.component.ts`:

```ts
import { ChangeDetectionStrategy, Component, computed, signal } from '@angular/core';
import {
  ButtonComponent,
  FieldComponent,
  FormDialogComponent,
  KnobSegmentComponent,
  KnobSegmentOption,
  NumberFieldComponent,
  SelectComponent,
  SelectOption,
} from '@allyworld/alloy-ui';

const PRESETS: readonly KnobSegmentOption[] = [
  { value: '4/4', label: '4/4' },
  { value: '3/4', label: '3/4' },
  { value: '2/4', label: '2/4' },
  { value: '6/8', label: '6/8' },
  { value: '2/2', label: '2/2' },
];
const BEAT_VALUES: readonly SelectOption[] = [
  { value: '2', label: '2' },
  { value: '4', label: '4' },
  { value: '8', label: '8' },
  { value: '16', label: '16' },
];
const PICKUPS: readonly SelectOption[] = [
  { value: 'none', label: 'None' },
  { value: '1', label: '1 beat' },
  { value: '2', label: '2 beats' },
];

@Component({
  selector: 'hx-forms-section',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    ButtonComponent,
    FieldComponent,
    FormDialogComponent,
    KnobSegmentComponent,
    NumberFieldComponent,
    SelectComponent,
  ],
  template: `
    <section class="section">
      <h2>Forms</h2>
      <p>AllyScore's Time signature dialog, rebuilt from the AlloyUI form kit.</p>
      <div class="row">
        <app-button variant="primary" (click)="openDialog()">Time signature…</app-button>
      </div>
      <p>last result: {{ result() }}</p>

      <app-form-dialog
        [open]="open()"
        title="Time signature"
        submitLabel="Apply"
        [submitDisabled]="!valid()"
        (submitted)="apply()"
        (cancelled)="open.set(false)"
      >
        <app-knob-segment
          [options]="presets"
          [selection]="preset()"
          segmentLabel="Preset"
          (changed)="choosePreset($event)"
        />
        <app-field label="Beats">
          <app-number-field [(value)]="beats" [min]="1" [max]="32" />
        </app-field>
        <app-field label="Beat value">
          <app-select [options]="beatValues" [(value)]="beatValue" />
        </app-field>
        <app-field label="Pickup">
          <app-select [options]="pickups" [(value)]="pickup" />
        </app-field>
      </app-form-dialog>
    </section>
  `,
})
export class FormsSectionComponent {
  protected readonly presets = PRESETS;
  protected readonly beatValues = BEAT_VALUES;
  protected readonly pickups = PICKUPS;

  protected readonly open = signal(false);
  protected readonly preset = signal('4/4');
  protected readonly beats = signal<number | null>(4);
  protected readonly beatValue = signal('4');
  protected readonly pickup = signal('none');
  protected readonly result = signal('—');

  /** Drives submitDisabled — the app owns validation, not the library. */
  protected readonly valid = computed(() => this.beats() !== null);

  protected openDialog(): void {
    this.open.set(true);
  }

  protected choosePreset(value: string): void {
    this.preset.set(value);
    const [beats, beatValue] = value.split('/');
    this.beats.set(Number(beats));
    this.beatValue.set(beatValue);
  }

  protected apply(): void {
    this.result.set(
      `${this.beats()}/${this.beatValue()}, pickup: ${this.pickup()}`,
    );
    this.open.set(false);
  }
}
```

- [ ] **Step 2: Register the section in the harness app**

In `examples/web-harness/src/app/app.component.ts`:

1. Add the import: `import { FormsSectionComponent } from './sections/forms-section.component';`
2. Add `FormsSectionComponent` to the component's `imports` array.
3. Add `<hx-forms-section />` inside `<main class="harness">`, immediately after `<hx-overlays-section />`.

- [ ] **Step 3: Verify the harness builds**

Run: `cd examples/web-harness && npm run build`
Expected: build succeeds with no errors.

- [ ] **Step 4: Add the `mirroring.md` asymmetry entry**

In `docs/mirroring.md`, under "**Documented asymmetries** are intentional and recorded here:", add this bullet immediately AFTER the existing "Overlay trio" bullet:

```markdown
- **Form kit** is web-only (spec:
  `docs/superpowers/specs/2026-07-13-alloy-ui-form-kit-design.md`):
  `ButtonComponent`, `TextFieldComponent`, `NumberFieldComponent`,
  `SelectComponent`, `FieldComponent`, and the declarative
  `FormDialogComponent`, plus the internal `ModalShellComponent` that now
  backs both the form dialog and the confirm/alert `DialogHostComponent`.
  Apple apps use native SwiftUI `TextField` / `Picker` / `Form` instead.
  Two-way binding uses Angular `model()` signals, so `@angular/forms` is NOT
  a dependency. The kit's colors (`color.field-bg`, `color.field-border`,
  `color.focus-ring`) live in `tokens.json` and emit to all three outputs
  regardless; the Swift constants are unused. Segmented rows reuse
  `KnobSegmentComponent` — there is no second segmented control.
```

- [ ] **Step 5: Run both full suites**

Run: `cd web && npm test`
Expected: PASS (all workspaces).

Run: `cd swift && swift build && swift test`
Expected: PASS. (An `AlloyAudio` failure from the concurrent session's work is NOT yours — report it verbatim and verify your own scope with `swift test --filter AlloyUITests`.)

- [ ] **Step 6: Manual smoke check (serve on a free port — NEVER kill an existing 4205 server)**

Run: `cd examples/web-harness && npx ng serve --port 4299`, open the Forms section and check: the dialog opens with focus on the segment/beats field; preset buttons update beats + beat value; the number field clamps on blur (type 99 → 32); the selects render dark chrome with the custom chevron; Enter in the beats field applies; Esc and backdrop cancel; clearing beats disables Apply and blocks Enter. Stop the server afterwards.

- [ ] **Step 7: Commit**

```bash
git add examples/web-harness/src/app/sections/forms-section.component.ts \
  examples/web-harness/src/app/app.component.ts \
  docs/mirroring.md
git commit -m "feat(ui): add form kit harness section and mirroring asymmetry entry"
```
