# AlloyUI Overlay Trio Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add snackbar, confirm/alert dialog, inline spinner, and blocking busy overlay to `@allyworld/alloy-ui` (web-only), per the approved spec `docs/superpowers/specs/2026-07-11-alloy-ui-overlays-design.md`.

**Architecture:** Imperative root-provided services (`AlloySnackbar`, `AlloyDialog`, `AlloyBusy`) hold signal state; thin host components render that state; a single `<app-overlays />` outlet composes the hosts. The dialog and busy overlay use the native `<dialog>` element via `showModal()` for focus trapping, Esc, inerting, and top-layer stacking. Zero new dependencies.

**Tech Stack:** Angular 21 standalone components with signal inputs, OnPush, Vitest + TestBed (jsdom), SCSS with generated `_tokens.scss`.

## Global Constraints

- Peer surface stays exactly `@angular/core` + `@angular/common` `^21.0.0`. No `@angular/cdk`, no Material, no new runtime deps.
- Web-only: NO Swift component twins. `docs/mirroring.md` gets a documented-asymmetry entry (Task 7). Token outputs still regenerate for all three targets.
- Component selector prefix is `app-` (see `web/angular.json` → `projects.alloy-ui.prefix`); harness components use `hx-`.
- All components: `changeDetection: ChangeDetectionStrategy.OnPush`, standalone (no NgModules), signal `input()`s.
- Never edit generated files by hand: `web/packages/alloy-ui/src/styles/_tokens.scss`, `web/packages/alloy-ui/src/lib/tokens.ts`, `swift/Sources/AlloyUI/AlloyTokens.swift` come from `tokens.json` via `node tools/generate-tokens.mjs`.
- Test command: `cd web && npm run test:ui` (runs Vitest for alloy-ui via `ng test alloy-ui`). Swift: `cd swift && swift build && swift test`.
- Commit style: conventional commits, imperative subject ≤ 72 chars.
- All new public symbols are exported from `web/packages/alloy-ui/src/public-api.ts`.

---

### Task 1: Tokens — `snackbar-show` and `overlay-fade` durations (SCSS emission included)

Durations currently emit to TS and Swift only. The overlay components need them in SCSS too, so this task also extends the generator to emit `$name: <n>ms;` SCSS variables. No new color token: the existing `color.backdrop` (`rgba(0, 0, 0, 0.4)`) is the scrim.

**Files:**
- Modify: `tokens.json`
- Modify: `tools/generate-tokens.mjs`
- Modify: `web/packages/alloy-ui/src/lib/tokens.spec.ts`
- Regenerated (never hand-edit): `web/packages/alloy-ui/src/styles/_tokens.scss`, `web/packages/alloy-ui/src/lib/tokens.ts`, `swift/Sources/AlloyUI/AlloyTokens.swift`

**Interfaces:**
- Consumes: nothing.
- Produces: TS constants `SNACKBAR_SHOW_MS = 4000`, `OVERLAY_FADE_MS = 150` (from `./lib/tokens`, already re-exported by public-api); SCSS variables `$snackbar-show: 4000ms;`, `$overlay-fade: 150ms;` plus `$<name>: <n>ms;` for every existing duration; Swift `AlloyTokens.snackbarShow == 4.0`, `AlloyTokens.overlayFade == 0.15`.

- [ ] **Step 1: Write the failing test**

In `web/packages/alloy-ui/src/lib/tokens.spec.ts`, extend the two existing `it` blocks (keep the existing assertions; add these):

```ts
// add to the import from './tokens':
import {
  AUTO_HIDE_MS,
  OVERLAY_FADE_MS,
  SHEET_ANIMATION_MS,
  SHEET_CORNER_RADIUS_PX,
  SNACKBAR_SHOW_MS,
} from './tokens';

// inside `it('exposes the twin-agreed durations and sizes', ...)` add:
expect(SNACKBAR_SHOW_MS).toBe(4000);
expect(OVERLAY_FADE_MS).toBe(150);

// inside `it('generated SCSS carries the twin-agreed spot values', ...)` add:
expect(tokensScss).toContain('$snackbar-show: 4000ms;');
expect(tokensScss).toContain('$overlay-fade: 150ms;');
expect(tokensScss).toContain('$sheet-animation: 280ms;');
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && npm run test:ui`
Expected: FAIL — `tokens.spec.ts` cannot import `SNACKBAR_SHOW_MS` / assertions fail.

- [ ] **Step 3: Add the tokens and extend the generator**

In `tokens.json`, extend `durationMs`:

```json
"durationMs": {
  "sheet-animation": 280,
  "auto-hide": 2500,
  "chrome-fade": 300,
  "snackbar-show": 4000,
  "overlay-fade": 150
},
```

In `tools/generate-tokens.mjs`, add duration emission to the SCSS block. Replace:

```js
writeFileSync(
  join(root, 'web/packages/alloy-ui/src/styles/_tokens.scss'),
  header('//') + scssColors + '\n' + scssSizes + '\n'
);
```

with:

```js
const scssDurations = Object.entries(tokens.durationMs)
  .map(([k, v]) => `$${k}: ${v}ms;`)
  .join('\n');
writeFileSync(
  join(root, 'web/packages/alloy-ui/src/styles/_tokens.scss'),
  header('//') + scssColors + '\n' + scssDurations + '\n' + scssSizes + '\n'
);
```

Then regenerate: `node tools/generate-tokens.mjs`
Expected output: `tokens generated (scss, ts, swift)`

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd web && npm run test:ui`
Expected: PASS (all suites).

Run: `cd swift && swift build && swift test`
Expected: build succeeds, all tests pass (Swift token tests are spot-checks on existing entries; the regenerated file adds `snackbarShow` / `overlayFade`).

- [ ] **Step 5: Commit**

```bash
git add tokens.json tools/generate-tokens.mjs \
  web/packages/alloy-ui/src/styles/_tokens.scss \
  web/packages/alloy-ui/src/lib/tokens.ts \
  web/packages/alloy-ui/src/lib/tokens.spec.ts \
  swift/Sources/AlloyUI/AlloyTokens.swift
git commit -m "feat(ui): add snackbar/overlay duration tokens, emit durations to SCSS"
```

---

### Task 2: Inline spinner component

**Files:**
- Create: `web/packages/alloy-ui/src/lib/spinner/spinner.component.ts`
- Create: `web/packages/alloy-ui/src/lib/spinner/spinner.component.scss`
- Test: `web/packages/alloy-ui/src/lib/spinner/spinner.component.spec.ts`
- Modify: `web/packages/alloy-ui/src/public-api.ts` (append export)

**Interfaces:**
- Consumes: nothing.
- Produces: `SpinnerComponent` (selector `app-spinner`) with signal inputs `size: input(24)` (diameter px) and `ariaLabel: input('Loading')`. Used by Task 3's busy host and Task 7's harness.

- [ ] **Step 1: Write the failing test**

`web/packages/alloy-ui/src/lib/spinner/spinner.component.spec.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { SpinnerComponent } from './spinner.component';

describe('SpinnerComponent', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [SpinnerComponent],
    }).compileComponents();
  });

  function create(inputs: { size?: number; ariaLabel?: string } = {}) {
    const fixture = TestBed.createComponent(SpinnerComponent);
    if (inputs.size !== undefined) fixture.componentRef.setInput('size', inputs.size);
    if (inputs.ariaLabel !== undefined) fixture.componentRef.setInput('ariaLabel', inputs.ariaLabel);
    fixture.detectChanges();
    return fixture;
  }

  it('renders a progressbar with the default size and label', () => {
    const fixture = create();
    const el = (fixture.nativeElement as HTMLElement).querySelector('.spinner') as HTMLElement;
    expect(el).not.toBeNull();
    expect(el.getAttribute('role')).toBe('progressbar');
    expect(el.getAttribute('aria-label')).toBe('Loading');
    expect(el.style.width).toBe('24px');
    expect(el.style.height).toBe('24px');
  });

  it('applies a custom size as width and height', () => {
    const fixture = create({ size: 40 });
    const el = (fixture.nativeElement as HTMLElement).querySelector('.spinner') as HTMLElement;
    expect(el.style.width).toBe('40px');
    expect(el.style.height).toBe('40px');
  });

  it('applies a custom aria-label', () => {
    const fixture = create({ ariaLabel: 'Saving score' });
    const el = (fixture.nativeElement as HTMLElement).querySelector('.spinner');
    expect(el?.getAttribute('aria-label')).toBe('Saving score');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && npm run test:ui`
Expected: FAIL — cannot resolve `./spinner.component`.

- [ ] **Step 3: Implement the component**

`web/packages/alloy-ui/src/lib/spinner/spinner.component.ts`:

```ts
import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/**
 * Indeterminate activity spinner. Draws in `currentColor`, so it themes
 * wherever it is placed (buttons, panels, empty states). Honors
 * prefers-reduced-motion by pulsing opacity instead of rotating.
 */
@Component({
  selector: 'app-spinner',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <span
      class="spinner"
      role="progressbar"
      [attr.aria-label]="ariaLabel()"
      [style.width.px]="size()"
      [style.height.px]="size()"
    ></span>
  `,
  styleUrl: './spinner.component.scss',
})
export class SpinnerComponent {
  /** Diameter in px. */
  readonly size = input(24);
  /** Accessible name for the progressbar role. */
  readonly ariaLabel = input('Loading');
}
```

`web/packages/alloy-ui/src/lib/spinner/spinner.component.scss`:

```scss
:host {
  display: inline-flex;
}

.spinner {
  display: inline-block;
  box-sizing: border-box;
  border-radius: 50%;
  border: 2.5px solid color-mix(in srgb, currentColor 25%, transparent);
  border-top-color: currentColor;
  animation: spinner-rotate 0.8s linear infinite;
}

@keyframes spinner-rotate {
  to {
    transform: rotate(360deg);
  }
}

@media (prefers-reduced-motion: reduce) {
  .spinner {
    animation: spinner-pulse 1.6s ease-in-out infinite;
  }
}

@keyframes spinner-pulse {
  50% {
    opacity: 0.4;
  }
}
```

Append to `web/packages/alloy-ui/src/public-api.ts`:

```ts
export { SpinnerComponent } from './lib/spinner/spinner.component';
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web && npm run test:ui`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/packages/alloy-ui/src/lib/spinner/spinner.component.ts \
  web/packages/alloy-ui/src/lib/spinner/spinner.component.scss \
  web/packages/alloy-ui/src/lib/spinner/spinner.component.spec.ts \
  web/packages/alloy-ui/src/public-api.ts
git commit -m "feat(ui): add inline spinner component"
```

---

### Task 3: Busy service + blocking overlay host

**Files:**
- Create: `web/packages/alloy-ui/src/lib/spinner/busy.service.ts`
- Create: `web/packages/alloy-ui/src/lib/spinner/busy-host.component.ts`
- Create: `web/packages/alloy-ui/src/lib/spinner/busy-host.component.scss`
- Test: `web/packages/alloy-ui/src/lib/spinner/busy.service.spec.ts`
- Test: `web/packages/alloy-ui/src/lib/spinner/busy-host.component.spec.ts`
- Modify: `web/packages/alloy-ui/src/public-api.ts` (append exports)

**Interfaces:**
- Consumes: `SpinnerComponent` from Task 2.
- Produces: `AlloyBusy` root service — `begin(label?: string): () => void`, `while<T>(work: Promise<T>, label?: string): Promise<T>`, plus read-only signals `active: Signal<boolean>` and `label: Signal<string | null>` for the host. `BusyHostComponent` (selector `app-busy-host`). Task 6's outlet composes the host.

- [ ] **Step 1: Write the failing service test**

`web/packages/alloy-ui/src/lib/spinner/busy.service.spec.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { AlloyBusy } from './busy.service';

describe('AlloyBusy', () => {
  function service(): AlloyBusy {
    return TestBed.inject(AlloyBusy);
  }

  it('is inactive until begin() and active until released', () => {
    const busy = service();
    expect(busy.active()).toBe(false);
    const release = busy.begin();
    expect(busy.active()).toBe(true);
    release();
    expect(busy.active()).toBe(false);
  });

  it('ref-counts overlapping begins', () => {
    const busy = service();
    const a = busy.begin();
    const b = busy.begin();
    a();
    expect(busy.active()).toBe(true);
    b();
    expect(busy.active()).toBe(false);
  });

  it('treats double-release as a no-op', () => {
    const busy = service();
    const a = busy.begin();
    const b = busy.begin();
    a();
    a();
    expect(busy.active()).toBe(true);
    b();
    expect(busy.active()).toBe(false);
  });

  it('exposes the most recent unreleased label', () => {
    const busy = service();
    const a = busy.begin('Loading score');
    const b = busy.begin(); // unlabeled — label falls through to the latest labeled entry
    expect(busy.label()).toBe('Loading score');
    const c = busy.begin('Exporting');
    expect(busy.label()).toBe('Exporting');
    c();
    expect(busy.label()).toBe('Loading score');
    a();
    b();
    expect(busy.label()).toBeNull();
  });

  it('while() releases on resolve and returns the result', async () => {
    const busy = service();
    const result = busy.while(Promise.resolve(42), 'Working');
    expect(busy.active()).toBe(true);
    await expect(result).resolves.toBe(42);
    expect(busy.active()).toBe(false);
  });

  it('while() releases on reject and rethrows', async () => {
    const busy = service();
    const boom = new Error('boom');
    const result = busy.while(Promise.reject(boom));
    expect(busy.active()).toBe(true);
    await expect(result).rejects.toBe(boom);
    expect(busy.active()).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && npm run test:ui`
Expected: FAIL — cannot resolve `./busy.service`.

- [ ] **Step 3: Implement the service**

`web/packages/alloy-ui/src/lib/spinner/busy.service.ts`:

```ts
import { Injectable, Signal, computed, signal } from '@angular/core';

interface BusyEntry {
  id: number;
  label: string | null;
}

/**
 * Ref-counted blocking busy state. Apps call `begin()`/`while()` from
 * anywhere; the visual lives in BusyHostComponent (placed once via
 * <app-overlays>). The overlay shows while any begin() is unreleased, so
 * overlapping operations do not flicker.
 */
@Injectable({ providedIn: 'root' })
export class AlloyBusy {
  private nextId = 0;
  private readonly entries = signal<BusyEntry[]>([]);

  /** True while any begin() is unreleased. */
  readonly active: Signal<boolean> = computed(() => this.entries().length > 0);

  /** Most recent unreleased label, or null when none carries one. */
  readonly label: Signal<string | null> = computed(() => {
    const entries = this.entries();
    for (let i = entries.length - 1; i >= 0; i--) {
      if (entries[i].label !== null) return entries[i].label;
    }
    return null;
  });

  /** Show the overlay until the returned release fn runs. Releasing twice is a no-op. */
  begin(label?: string): () => void {
    const id = this.nextId++;
    this.entries.update((list) => [...list, { id, label: label ?? null }]);
    return () => this.entries.update((list) => list.filter((e) => e.id !== id));
  }

  /** Hold the overlay for the lifetime of `work`; releases on resolve and reject. */
  async while<T>(work: Promise<T>, label?: string): Promise<T> {
    const release = this.begin(label);
    try {
      return await work;
    } finally {
      release();
    }
  }
}
```

- [ ] **Step 4: Run service test to verify it passes**

Run: `cd web && npm run test:ui`
Expected: PASS.

- [ ] **Step 5: Write the failing host test**

`web/packages/alloy-ui/src/lib/spinner/busy-host.component.spec.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { AlloyBusy } from './busy.service';
import { BusyHostComponent } from './busy-host.component';

describe('BusyHostComponent', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [BusyHostComponent],
    }).compileComponents();
  });

  it('renders nothing while idle', () => {
    const fixture = TestBed.createComponent(BusyHostComponent);
    fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).querySelector('dialog.busy')).toBeNull();
  });

  it('shows the overlay with spinner and label while busy, and removes it on release', () => {
    const busy = TestBed.inject(AlloyBusy);
    const fixture = TestBed.createComponent(BusyHostComponent);
    fixture.detectChanges();

    const release = busy.begin('Exporting');
    fixture.detectChanges();
    const host = fixture.nativeElement as HTMLElement;
    const overlay = host.querySelector('dialog.busy');
    expect(overlay).not.toBeNull();
    expect(overlay?.getAttribute('aria-busy')).toBe('true');
    expect(host.querySelector('app-spinner')).not.toBeNull();
    expect(host.querySelector('.busy-label')?.textContent).toContain('Exporting');

    release();
    fixture.detectChanges();
    expect(host.querySelector('dialog.busy')).toBeNull();
  });

  it('omits the label element when no label is set', () => {
    const busy = TestBed.inject(AlloyBusy);
    const fixture = TestBed.createComponent(BusyHostComponent);
    fixture.detectChanges();
    const release = busy.begin();
    fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).querySelector('.busy-label')).toBeNull();
    release();
  });
});
```

- [ ] **Step 6: Run test to verify it fails**

Run: `cd web && npm run test:ui`
Expected: FAIL — cannot resolve `./busy-host.component`.

- [ ] **Step 7: Implement the host**

`web/packages/alloy-ui/src/lib/spinner/busy-host.component.ts`:

```ts
import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  effect,
  inject,
  viewChild,
} from '@angular/core';
import { AlloyBusy } from './busy.service';
import { SpinnerComponent } from './spinner.component';

/**
 * Visual outlet for AlloyBusy. Placed once per app (via <app-overlays>);
 * renders nothing while idle. Uses a native <dialog> opened with showModal()
 * so the platform blocks pointer and keyboard interaction behind it; the
 * cancel event (Esc) is suppressed — only release() ends the busy state.
 */
@Component({
  selector: 'app-busy-host',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [SpinnerComponent],
  template: `
    @if (busy.active()) {
      <dialog #panel class="busy" aria-busy="true" aria-label="Busy" (cancel)="$event.preventDefault()">
        <app-spinner [size]="32" />
        @if (busy.label(); as label) {
          <p class="busy-label">{{ label }}</p>
        }
      </dialog>
    }
  `,
  styleUrl: './busy-host.component.scss',
})
export class BusyHostComponent {
  protected readonly busy = inject(AlloyBusy);
  private readonly panel = viewChild<ElementRef<HTMLDialogElement>>('panel');

  constructor() {
    effect(() => {
      const el = this.panel()?.nativeElement;
      if (el && this.busy.active() && !el.open) {
        // jsdom guard: fall back to the open attribute where showModal is missing.
        if (typeof el.showModal === 'function') el.showModal();
        else el.setAttribute('open', '');
      }
    });
  }
}
```

`web/packages/alloy-ui/src/lib/spinner/busy-host.component.scss`:

```scss
@use '../../styles/tokens' as t;

:host {
  display: contents;
}

dialog.busy {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  border: none;
  background: transparent;
  color: t.$label;
  outline: none;
  animation: busy-fade t.$overlay-fade ease both;

  &::backdrop {
    background: t.$backdrop;
  }
}

.busy-label {
  margin: 0;
  font-size: 14px;
  color: t.$label;
}

@keyframes busy-fade {
  from {
    opacity: 0;
  }
}
```

Append to `web/packages/alloy-ui/src/public-api.ts`:

```ts
export { AlloyBusy } from './lib/spinner/busy.service';
export { BusyHostComponent } from './lib/spinner/busy-host.component';
```

- [ ] **Step 8: Run tests to verify they pass**

Run: `cd web && npm run test:ui`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add web/packages/alloy-ui/src/lib/spinner/busy.service.ts \
  web/packages/alloy-ui/src/lib/spinner/busy.service.spec.ts \
  web/packages/alloy-ui/src/lib/spinner/busy-host.component.ts \
  web/packages/alloy-ui/src/lib/spinner/busy-host.component.scss \
  web/packages/alloy-ui/src/lib/spinner/busy-host.component.spec.ts \
  web/packages/alloy-ui/src/public-api.ts
git commit -m "feat(ui): add ref-counted busy service and blocking overlay host"
```

---

### Task 4: Snackbar service + host

**Files:**
- Create: `web/packages/alloy-ui/src/lib/snackbar/snackbar.service.ts`
- Create: `web/packages/alloy-ui/src/lib/snackbar/snackbar-host.component.ts`
- Create: `web/packages/alloy-ui/src/lib/snackbar/snackbar-host.component.scss`
- Test: `web/packages/alloy-ui/src/lib/snackbar/snackbar.service.spec.ts`
- Test: `web/packages/alloy-ui/src/lib/snackbar/snackbar-host.component.spec.ts`
- Modify: `web/packages/alloy-ui/src/public-api.ts` (append exports)

**Interfaces:**
- Consumes: `SNACKBAR_SHOW_MS` from `../tokens` (Task 1).
- Produces: `AlloySnackbar` root service — `show(message: string, opts?: { durationMs?: number; actionLabel?: string }): Promise<SnackbarClose>`, `dismiss(): void`, host hooks `action(): void` / `pause(): void` / `resume(): void`, and `current: Signal<{ message: string; actionLabel: string | null } | null>` (host reads it). Type `SnackbarClose = 'timeout' | 'action' | 'dismissed'`. `SnackbarHostComponent` (selector `app-snackbar-host`). Task 6's outlet composes the host.

- [ ] **Step 1: Write the failing service test**

`web/packages/alloy-ui/src/lib/snackbar/snackbar.service.spec.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { AlloySnackbar } from './snackbar.service';

describe('AlloySnackbar', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  function service(): AlloySnackbar {
    return TestBed.inject(AlloySnackbar);
  }

  it('shows immediately when idle and resolves timeout after the duration', async () => {
    const snackbar = service();
    const closed = snackbar.show('Saved', { durationMs: 1000 });
    expect(snackbar.current()?.message).toBe('Saved');
    vi.advanceTimersByTime(1000);
    await expect(closed).resolves.toBe('timeout');
    expect(snackbar.current()).toBeNull();
  });

  it('defaults the duration to the snackbar-show token (4000ms)', async () => {
    const snackbar = service();
    const closed = snackbar.show('Saved');
    vi.advanceTimersByTime(3999);
    expect(snackbar.current()).not.toBeNull();
    vi.advanceTimersByTime(1);
    await expect(closed).resolves.toBe('timeout');
  });

  it('queues FIFO behind the current snack', async () => {
    const snackbar = service();
    const first = snackbar.show('one', { durationMs: 1000 });
    const second = snackbar.show('two', { durationMs: 1000 });
    expect(snackbar.current()?.message).toBe('one');
    vi.advanceTimersByTime(1000);
    await expect(first).resolves.toBe('timeout');
    expect(snackbar.current()?.message).toBe('two');
    vi.advanceTimersByTime(1000);
    await expect(second).resolves.toBe('timeout');
    expect(snackbar.current()).toBeNull();
  });

  it('resolves "dismissed" on dismiss() and advances the queue', async () => {
    const snackbar = service();
    const first = snackbar.show('one', { durationMs: 1000 });
    snackbar.show('two', { durationMs: 1000 });
    snackbar.dismiss();
    await expect(first).resolves.toBe('dismissed');
    expect(snackbar.current()?.message).toBe('two');
  });

  it('resolves "action" when the action fires', async () => {
    const snackbar = service();
    const closed = snackbar.show('Deleted', { durationMs: 1000, actionLabel: 'Undo' });
    expect(snackbar.current()?.actionLabel).toBe('Undo');
    snackbar.action();
    await expect(closed).resolves.toBe('action');
  });

  it('dismiss() when idle is a no-op', () => {
    const snackbar = service();
    expect(() => snackbar.dismiss()).not.toThrow();
    expect(snackbar.current()).toBeNull();
  });

  it('pause() stops the clock and resume() continues from the remainder', async () => {
    const snackbar = service();
    const closed = snackbar.show('Saved', { durationMs: 1000 });
    vi.advanceTimersByTime(600);
    snackbar.pause();
    vi.advanceTimersByTime(5000); // paused — must not close
    expect(snackbar.current()).not.toBeNull();
    snackbar.resume();
    vi.advanceTimersByTime(399);
    expect(snackbar.current()).not.toBeNull();
    vi.advanceTimersByTime(1);
    await expect(closed).resolves.toBe('timeout');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && npm run test:ui`
Expected: FAIL — cannot resolve `./snackbar.service`.

- [ ] **Step 3: Implement the service**

`web/packages/alloy-ui/src/lib/snackbar/snackbar.service.ts`:

```ts
import { Injectable, signal } from '@angular/core';
import { SNACKBAR_SHOW_MS } from '../tokens';

/** Why a snack closed — the resolution value of `show()`. */
export type SnackbarClose = 'timeout' | 'action' | 'dismissed';

export interface SnackbarOptions {
  /** Auto-hide delay; defaults to the snackbar-show token (4000ms). */
  durationMs?: number;
  /** Renders an action button (e.g. 'Undo'); clicking resolves show() with 'action'. */
  actionLabel?: string;
}

interface Snack {
  message: string;
  actionLabel: string | null;
  durationMs: number;
  resolve: (reason: SnackbarClose) => void;
}

/**
 * Imperative snackbar queue. Apps call `show()` from anywhere; the visual
 * lives in SnackbarHostComponent (placed once via <app-overlays>). One snack
 * shows at a time; further calls queue FIFO. The auto-hide timer pauses
 * while the pointer hovers the snack (host wires pause/resume).
 */
@Injectable({ providedIn: 'root' })
export class AlloySnackbar {
  private readonly queue: Snack[] = [];
  private timer: ReturnType<typeof setTimeout> | undefined;
  private remainingMs = 0;
  private startedAt = 0;

  /** Snack currently on screen; the host template renders from this. */
  readonly current = signal<Snack | null>(null);

  show(message: string, opts: SnackbarOptions = {}): Promise<SnackbarClose> {
    return new Promise((resolve) => {
      this.queue.push({
        message,
        actionLabel: opts.actionLabel ?? null,
        durationMs: opts.durationMs ?? SNACKBAR_SHOW_MS,
        resolve,
      });
      if (!this.current()) this.advance();
    });
  }

  /** Dismiss the current snack (no-op when idle) and advance the queue. */
  dismiss(): void {
    this.close('dismissed');
  }

  /** Host hook: the action button was clicked. */
  action(): void {
    this.close('action');
  }

  /** Host hook: pointer entered the snack — pause the auto-hide timer. */
  pause(): void {
    if (!this.current() || this.timer === undefined) return;
    clearTimeout(this.timer);
    this.timer = undefined;
    this.remainingMs -= Date.now() - this.startedAt;
  }

  /** Host hook: pointer left the snack — resume the auto-hide timer. */
  resume(): void {
    if (!this.current() || this.timer !== undefined) return;
    this.startTimer();
  }

  private close(reason: SnackbarClose): void {
    const snack = this.current();
    if (!snack) return;
    clearTimeout(this.timer);
    this.timer = undefined;
    this.current.set(null);
    snack.resolve(reason);
    this.advance();
  }

  private advance(): void {
    const next = this.queue.shift();
    if (!next) return;
    this.current.set(next);
    this.remainingMs = next.durationMs;
    this.startTimer();
  }

  private startTimer(): void {
    this.startedAt = Date.now();
    this.timer = setTimeout(() => this.close('timeout'), Math.max(0, this.remainingMs));
  }
}
```

- [ ] **Step 4: Run service test to verify it passes**

Run: `cd web && npm run test:ui`
Expected: PASS.

- [ ] **Step 5: Write the failing host test**

`web/packages/alloy-ui/src/lib/snackbar/snackbar-host.component.spec.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { AlloySnackbar } from './snackbar.service';
import { SnackbarHostComponent } from './snackbar-host.component';

describe('SnackbarHostComponent', () => {
  beforeEach(async () => {
    vi.useFakeTimers();
    await TestBed.configureTestingModule({
      imports: [SnackbarHostComponent],
    }).compileComponents();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('keeps a permanent polite status region and renders nothing while idle', () => {
    const fixture = TestBed.createComponent(SnackbarHostComponent);
    fixture.detectChanges();
    const host = fixture.nativeElement as HTMLElement;
    const region = host.querySelector('.snack-region');
    expect(region?.getAttribute('role')).toBe('status');
    expect(region?.getAttribute('aria-live')).toBe('polite');
    expect(host.querySelector('.snack')).toBeNull();
  });

  it('renders the current snack message', () => {
    const snackbar = TestBed.inject(AlloySnackbar);
    const fixture = TestBed.createComponent(SnackbarHostComponent);
    fixture.detectChanges();
    void snackbar.show('Saved');
    fixture.detectChanges();
    const host = fixture.nativeElement as HTMLElement;
    expect(host.querySelector('.snack-message')?.textContent).toContain('Saved');
    expect(host.querySelector('button.snack-action')).toBeNull();
  });

  it('renders the action button and resolves show() with "action" on click', async () => {
    const snackbar = TestBed.inject(AlloySnackbar);
    const fixture = TestBed.createComponent(SnackbarHostComponent);
    fixture.detectChanges();
    const closed = snackbar.show('Deleted', { actionLabel: 'Undo' });
    fixture.detectChanges();
    const button = (fixture.nativeElement as HTMLElement).querySelector(
      'button.snack-action',
    ) as HTMLButtonElement;
    expect(button.textContent).toContain('Undo');
    button.click();
    await expect(closed).resolves.toBe('action');
  });

  it('pauses the timer on mouseenter and resumes on mouseleave', () => {
    const snackbar = TestBed.inject(AlloySnackbar);
    const fixture = TestBed.createComponent(SnackbarHostComponent);
    fixture.detectChanges();
    void snackbar.show('Saved', { durationMs: 1000 });
    fixture.detectChanges();
    const snack = (fixture.nativeElement as HTMLElement).querySelector('.snack') as HTMLElement;
    snack.dispatchEvent(new Event('mouseenter'));
    vi.advanceTimersByTime(5000);
    expect(snackbar.current()).not.toBeNull();
    snack.dispatchEvent(new Event('mouseleave'));
    vi.advanceTimersByTime(1000);
    expect(snackbar.current()).toBeNull();
  });
});
```

- [ ] **Step 6: Run test to verify it fails**

Run: `cd web && npm run test:ui`
Expected: FAIL — cannot resolve `./snackbar-host.component`.

- [ ] **Step 7: Implement the host**

`web/packages/alloy-ui/src/lib/snackbar/snackbar-host.component.ts`:

```ts
import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { AlloySnackbar } from './snackbar.service';

/**
 * Visual outlet for AlloySnackbar. Placed once per app (via <app-overlays>).
 * The status region stays in the DOM permanently so screen readers announce
 * snack content when it appears; the snack itself renders only while shown.
 */
@Component({
  selector: 'app-snackbar-host',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="snack-region" role="status" aria-live="polite">
      @if (snackbar.current(); as snack) {
        <div class="snack" (mouseenter)="snackbar.pause()" (mouseleave)="snackbar.resume()">
          <span class="snack-message">{{ snack.message }}</span>
          @if (snack.actionLabel) {
            <button type="button" class="snack-action" (click)="snackbar.action()">
              {{ snack.actionLabel }}
            </button>
          }
        </div>
      }
    </div>
  `,
  styleUrl: './snackbar-host.component.scss',
})
export class SnackbarHostComponent {
  protected readonly snackbar = inject(AlloySnackbar);
}
```

`web/packages/alloy-ui/src/lib/snackbar/snackbar-host.component.scss`:

```scss
@use '../../styles/tokens' as t;

:host {
  display: contents;
}

.snack-region {
  position: fixed;
  left: 0;
  right: 0;
  bottom: 24px;
  display: flex;
  justify-content: center;
  pointer-events: none;
  z-index: 30;
}

.snack {
  display: inline-flex;
  align-items: center;
  gap: 16px;
  max-width: min(480px, calc(100vw - 32px));
  padding: 12px 16px;
  border-radius: 12px;
  background: t.$sheet-bg;
  color: t.$label;
  box-shadow: 0 4px 24px rgba(0, 0, 0, 0.4);
  pointer-events: auto;
  animation: snack-enter t.$overlay-fade ease both;
}

.snack-message {
  font-size: 14px;
}

.snack-action {
  border: none;
  background: none;
  padding: 4px 8px;
  border-radius: 8px;
  color: t.$tint;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;

  &:hover {
    background: t.$secondary-surface;
  }
}

@keyframes snack-enter {
  from {
    opacity: 0;
    transform: translateY(8px);
  }
}
```

Append to `web/packages/alloy-ui/src/public-api.ts`:

```ts
export { AlloySnackbar, SnackbarClose, SnackbarOptions } from './lib/snackbar/snackbar.service';
export { SnackbarHostComponent } from './lib/snackbar/snackbar-host.component';
```

- [ ] **Step 8: Run tests to verify they pass**

Run: `cd web && npm run test:ui`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add web/packages/alloy-ui/src/lib/snackbar \
  web/packages/alloy-ui/src/public-api.ts
git commit -m "feat(ui): add snackbar service with FIFO queue and host"
```

---

### Task 5: Dialog service + host (confirm + alert)

**Files:**
- Create: `web/packages/alloy-ui/src/lib/dialog/dialog.service.ts`
- Create: `web/packages/alloy-ui/src/lib/dialog/dialog-host.component.ts`
- Create: `web/packages/alloy-ui/src/lib/dialog/dialog-host.component.scss`
- Test: `web/packages/alloy-ui/src/lib/dialog/dialog.service.spec.ts`
- Test: `web/packages/alloy-ui/src/lib/dialog/dialog-host.component.spec.ts`
- Modify: `web/packages/alloy-ui/src/public-api.ts` (append exports)

**Interfaces:**
- Consumes: nothing from earlier tasks (styling uses `_tokens.scss`).
- Produces: `AlloyDialog` root service — `confirm(opts: ConfirmOptions): Promise<boolean>`, `alert(opts: AlertOptions): Promise<void>`, host hook `settle(confirmed: boolean): void`, `current: Signal<...|null>`. Types `ConfirmOptions { title: string; message?: string; confirmLabel?: string; cancelLabel?: string; destructive?: boolean }`, `AlertOptions { title: string; message?: string; okLabel?: string }`. `DialogHostComponent` (selector `app-dialog-host`). Task 6's outlet composes the host.

- [ ] **Step 1: Write the failing service test**

`web/packages/alloy-ui/src/lib/dialog/dialog.service.spec.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { AlloyDialog } from './dialog.service';

describe('AlloyDialog', () => {
  function service(): AlloyDialog {
    return TestBed.inject(AlloyDialog);
  }

  it('confirm() resolves true/false via settle()', async () => {
    const dialog = service();
    const first = dialog.confirm({ title: 'Delete?' });
    expect(dialog.current()?.title).toBe('Delete?');
    dialog.settle(true);
    await expect(first).resolves.toBe(true);

    const second = dialog.confirm({ title: 'Again?' });
    dialog.settle(false);
    await expect(second).resolves.toBe(false);
    expect(dialog.current()).toBeNull();
  });

  it('applies confirm defaults and passes overrides through', () => {
    const dialog = service();
    void dialog.confirm({ title: 'Delete?' });
    expect(dialog.current()).toMatchObject({
      kind: 'confirm',
      message: null,
      confirmLabel: 'OK',
      cancelLabel: 'Cancel',
      destructive: false,
    });
    dialog.settle(false);

    void dialog.confirm({
      title: 'Delete score?',
      message: 'This cannot be undone.',
      confirmLabel: 'Delete',
      cancelLabel: 'Keep',
      destructive: true,
    });
    expect(dialog.current()).toMatchObject({
      message: 'This cannot be undone.',
      confirmLabel: 'Delete',
      cancelLabel: 'Keep',
      destructive: true,
    });
    dialog.settle(false);
  });

  it('alert() resolves void on settle and has no cancel label', async () => {
    const dialog = service();
    const alerted = dialog.alert({ title: 'Heads up' });
    expect(dialog.current()).toMatchObject({ kind: 'alert', cancelLabel: null, confirmLabel: 'OK' });
    dialog.settle(true);
    await expect(alerted).resolves.toBeUndefined();
  });

  it('queues concurrent dialogs sequentially in call order', async () => {
    const dialog = service();
    const first = dialog.confirm({ title: 'one' });
    const second = dialog.confirm({ title: 'two' });
    expect(dialog.current()?.title).toBe('one');
    dialog.settle(true);
    await expect(first).resolves.toBe(true);
    expect(dialog.current()?.title).toBe('two');
    dialog.settle(false);
    await expect(second).resolves.toBe(false);
    expect(dialog.current()).toBeNull();
  });

  it('settle() when idle is a no-op', () => {
    const dialog = service();
    expect(() => dialog.settle(true)).not.toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && npm run test:ui`
Expected: FAIL — cannot resolve `./dialog.service`.

- [ ] **Step 3: Implement the service**

`web/packages/alloy-ui/src/lib/dialog/dialog.service.ts`:

```ts
import { Injectable, signal } from '@angular/core';

export interface ConfirmOptions {
  title: string;
  message?: string;
  /** Confirm button label; default 'OK'. */
  confirmLabel?: string;
  /** Cancel button label; default 'Cancel'. */
  cancelLabel?: string;
  /** Styles the confirm button as destructive (red). */
  destructive?: boolean;
}

export interface AlertOptions {
  title: string;
  message?: string;
  /** OK button label; default 'OK'. */
  okLabel?: string;
}

interface PendingDialog {
  kind: 'confirm' | 'alert';
  title: string;
  message: string | null;
  confirmLabel: string;
  /** null → no cancel button (alert). */
  cancelLabel: string | null;
  destructive: boolean;
  resolve: (confirmed: boolean) => void;
}

/**
 * Imperative confirm/alert dialogs. Apps call `confirm()`/`alert()` from
 * anywhere; the visual lives in DialogHostComponent (placed once via
 * <app-overlays>). One dialog shows at a time; concurrent calls queue
 * sequentially in call order.
 */
@Injectable({ providedIn: 'root' })
export class AlloyDialog {
  private readonly queue: PendingDialog[] = [];

  /** Dialog currently on screen; the host template renders from this. */
  readonly current = signal<PendingDialog | null>(null);

  confirm(opts: ConfirmOptions): Promise<boolean> {
    return new Promise((resolve) => {
      this.enqueue({
        kind: 'confirm',
        title: opts.title,
        message: opts.message ?? null,
        confirmLabel: opts.confirmLabel ?? 'OK',
        cancelLabel: opts.cancelLabel ?? 'Cancel',
        destructive: opts.destructive ?? false,
        resolve,
      });
    });
  }

  alert(opts: AlertOptions): Promise<void> {
    return new Promise((resolve) => {
      this.enqueue({
        kind: 'alert',
        title: opts.title,
        message: opts.message ?? null,
        confirmLabel: opts.okLabel ?? 'OK',
        cancelLabel: null,
        destructive: false,
        resolve: () => resolve(),
      });
    });
  }

  /** Host hook: settle the on-screen dialog (no-op when idle) and advance the queue. */
  settle(confirmed: boolean): void {
    const dialog = this.current();
    if (!dialog) return;
    this.current.set(null);
    dialog.resolve(confirmed);
    this.advance();
  }

  private enqueue(dialog: PendingDialog): void {
    this.queue.push(dialog);
    if (!this.current()) this.advance();
  }

  private advance(): void {
    this.current.set(this.queue.shift() ?? null);
  }
}
```

- [ ] **Step 4: Run service test to verify it passes**

Run: `cd web && npm run test:ui`
Expected: PASS.

- [ ] **Step 5: Write the failing host test**

`web/packages/alloy-ui/src/lib/dialog/dialog-host.component.spec.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { AlloyDialog } from './dialog.service';
import { DialogHostComponent } from './dialog-host.component';

describe('DialogHostComponent', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [DialogHostComponent],
    }).compileComponents();
  });

  function setup() {
    const dialog = TestBed.inject(AlloyDialog);
    const fixture = TestBed.createComponent(DialogHostComponent);
    fixture.detectChanges();
    const host = fixture.nativeElement as HTMLElement;
    return { dialog, fixture, host };
  }

  it('renders nothing while idle', () => {
    const { host } = setup();
    expect(host.querySelector('dialog.dialog')).toBeNull();
  });

  it('renders title, message, and both buttons for confirm; confirm click resolves true', async () => {
    const { dialog, fixture, host } = setup();
    const confirmed = dialog.confirm({ title: 'Delete score?', message: 'This cannot be undone.' });
    fixture.detectChanges();
    expect(host.querySelector('.dialog-title')?.textContent).toContain('Delete score?');
    expect(host.querySelector('.dialog-message')?.textContent).toContain('This cannot be undone.');
    const buttons = host.querySelectorAll('button.dialog-button');
    expect(buttons.length).toBe(2);
    expect(buttons[0].textContent).toContain('Cancel');
    expect(buttons[1].textContent).toContain('OK');
    (buttons[1] as HTMLButtonElement).click();
    await expect(confirmed).resolves.toBe(true);
    fixture.detectChanges();
    expect(host.querySelector('dialog.dialog')).toBeNull();
  });

  it('cancel click resolves false', async () => {
    const { dialog, fixture, host } = setup();
    const confirmed = dialog.confirm({ title: 'Delete?' });
    fixture.detectChanges();
    const cancel = host.querySelector('button.dialog-button') as HTMLButtonElement;
    cancel.click();
    await expect(confirmed).resolves.toBe(false);
  });

  it('marks the confirm button destructive when asked', () => {
    const { dialog, fixture, host } = setup();
    void dialog.confirm({ title: 'Delete?', destructive: true, confirmLabel: 'Delete' });
    fixture.detectChanges();
    const confirmButton = host.querySelector('button.dialog-button.confirm');
    expect(confirmButton?.classList.contains('destructive')).toBe(true);
  });

  it('native cancel (Esc) resolves confirm to false', async () => {
    const { dialog, fixture, host } = setup();
    const confirmed = dialog.confirm({ title: 'Delete?' });
    fixture.detectChanges();
    const panel = host.querySelector('dialog.dialog') as HTMLDialogElement;
    panel.dispatchEvent(new Event('cancel', { cancelable: true }));
    await expect(confirmed).resolves.toBe(false);
  });

  it('backdrop click (target = dialog element) resolves confirm to false', async () => {
    const { dialog, fixture, host } = setup();
    const confirmed = dialog.confirm({ title: 'Delete?' });
    fixture.detectChanges();
    const panel = host.querySelector('dialog.dialog') as HTMLDialogElement;
    panel.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await expect(confirmed).resolves.toBe(false);
  });

  it('clicks inside the panel body do not settle the dialog', () => {
    const { dialog, fixture, host } = setup();
    void dialog.confirm({ title: 'Delete?' });
    fixture.detectChanges();
    const title = host.querySelector('.dialog-title') as HTMLElement;
    title.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    fixture.detectChanges();
    expect(host.querySelector('dialog.dialog')).not.toBeNull();
  });

  it('alert renders a single OK button that resolves void', async () => {
    const { dialog, fixture, host } = setup();
    const alerted = dialog.alert({ title: 'Heads up' });
    fixture.detectChanges();
    const buttons = host.querySelectorAll('button.dialog-button');
    expect(buttons.length).toBe(1);
    (buttons[0] as HTMLButtonElement).click();
    await expect(alerted).resolves.toBeUndefined();
  });

  it('wires aria-labelledby to the title element', () => {
    const { dialog, fixture, host } = setup();
    void dialog.confirm({ title: 'Delete?' });
    fixture.detectChanges();
    const panel = host.querySelector('dialog.dialog');
    const labelledby = panel?.getAttribute('aria-labelledby');
    expect(labelledby).toBeTruthy();
    expect(host.querySelector(`#${labelledby}`)?.textContent).toContain('Delete?');
  });

  it('shows the next queued dialog after the first settles', async () => {
    const { dialog, fixture, host } = setup();
    const first = dialog.confirm({ title: 'one' });
    void dialog.confirm({ title: 'two' });
    fixture.detectChanges();
    expect(host.querySelector('.dialog-title')?.textContent).toContain('one');
    const buttons = host.querySelectorAll('button.dialog-button');
    (buttons[1] as HTMLButtonElement).click();
    await first;
    fixture.detectChanges();
    expect(host.querySelector('.dialog-title')?.textContent).toContain('two');
  });
});
```

- [ ] **Step 6: Run test to verify it fails**

Run: `cd web && npm run test:ui`
Expected: FAIL — cannot resolve `./dialog-host.component`.

- [ ] **Step 7: Implement the host**

`web/packages/alloy-ui/src/lib/dialog/dialog-host.component.ts`:

```ts
import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  effect,
  inject,
  viewChild,
} from '@angular/core';
import { AlloyDialog } from './dialog.service';

/**
 * Visual outlet for AlloyDialog. Placed once per app (via <app-overlays>);
 * renders nothing while idle. Uses a native <dialog> via showModal(): focus
 * trapping, Esc (the cancel event), background inerting, and top-layer
 * stacking come from the platform. DOM order puts cancel first, so
 * showModal()'s default initial focus lands on the safe action.
 *
 * Backdrop clicks target the <dialog> element itself; in-panel clicks target
 * .dialog-body or deeper (the body fills the panel — padding lives on it),
 * which is how the two are told apart.
 */
@Component({
  selector: 'app-dialog-host',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (dialog.current(); as active) {
      <dialog
        #panel
        class="dialog"
        aria-labelledby="alloy-dialog-title"
        (cancel)="onCancel($event)"
        (click)="onClick($event)"
      >
        <div class="dialog-body">
          <h2 class="dialog-title" id="alloy-dialog-title">{{ active.title }}</h2>
          @if (active.message) {
            <p class="dialog-message">{{ active.message }}</p>
          }
          <div class="dialog-actions">
            @if (active.cancelLabel) {
              <button type="button" class="dialog-button" (click)="dialog.settle(false)">
                {{ active.cancelLabel }}
              </button>
            }
            <button
              type="button"
              class="dialog-button confirm"
              [class.destructive]="active.destructive"
              (click)="dialog.settle(true)"
            >
              {{ active.confirmLabel }}
            </button>
          </div>
        </div>
      </dialog>
    }
  `,
  styleUrl: './dialog-host.component.scss',
})
export class DialogHostComponent {
  protected readonly dialog = inject(AlloyDialog);
  private readonly panel = viewChild<ElementRef<HTMLDialogElement>>('panel');

  constructor() {
    effect(() => {
      const el = this.panel()?.nativeElement;
      if (el && this.dialog.current() && !el.open) {
        // jsdom guard: fall back to the open attribute where showModal is missing.
        if (typeof el.showModal === 'function') el.showModal();
        else el.setAttribute('open', '');
      }
    });
  }

  protected onCancel(event: Event): void {
    // Close by re-rendering (the @if removes the element), not natively.
    event.preventDefault();
    this.dialog.settle(false);
  }

  protected onClick(event: MouseEvent): void {
    if (event.target === this.panel()?.nativeElement) this.dialog.settle(false);
  }
}
```

`web/packages/alloy-ui/src/lib/dialog/dialog-host.component.scss`:

```scss
@use '../../styles/tokens' as t;

:host {
  display: contents;
}

dialog.dialog {
  padding: 0; // backdrop-vs-panel click detection relies on the body filling the panel
  border: none;
  border-radius: t.$sheet-corner-radius;
  background: t.$sheet-bg;
  color: t.$label;
  min-width: 280px;
  max-width: min(420px, calc(100vw - 32px));
  animation: dialog-fade t.$overlay-fade ease both;

  &::backdrop {
    background: t.$backdrop;
  }
}

.dialog-body {
  padding: 24px;
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

.dialog-button {
  border: none;
  border-radius: 10px;
  padding: 8px 16px;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  background: t.$secondary-surface;
  color: t.$label;

  &:hover {
    background: t.$secondary-surface-hover;
  }

  &.confirm {
    background: t.$tint;

    &:hover {
      background: t.$tint-hover;
    }

    &.destructive {
      background: t.$destructive;

      &:hover {
        background: t.$destructive;
        filter: brightness(1.1);
      }
    }
  }
}

@keyframes dialog-fade {
  from {
    opacity: 0;
    transform: scale(0.96);
  }
}
```

Append to `web/packages/alloy-ui/src/public-api.ts`:

```ts
export { AlloyDialog, ConfirmOptions, AlertOptions } from './lib/dialog/dialog.service';
export { DialogHostComponent } from './lib/dialog/dialog-host.component';
```

- [ ] **Step 8: Run tests to verify they pass**

Run: `cd web && npm run test:ui`
Expected: PASS.

Note: when the queue advances (`one` settles → `two` shows), the `@if` stays truthy and the same `<dialog>` element persists already-open with the new content — the effect's `!el.open` guard makes the re-open a no-op. That is the intended behavior, not a bug.

- [ ] **Step 9: Commit**

```bash
git add web/packages/alloy-ui/src/lib/dialog \
  web/packages/alloy-ui/src/public-api.ts
git commit -m "feat(ui): add confirm/alert dialog service and native-dialog host"
```

---

### Task 6: `<app-overlays />` outlet

**Files:**
- Create: `web/packages/alloy-ui/src/lib/overlays/overlays.component.ts`
- Test: `web/packages/alloy-ui/src/lib/overlays/overlays.component.spec.ts`
- Modify: `web/packages/alloy-ui/src/public-api.ts` (append export)

**Interfaces:**
- Consumes: `SnackbarHostComponent` (Task 4), `DialogHostComponent` (Task 5), `BusyHostComponent` (Task 3).
- Produces: `OverlaysComponent` (selector `app-overlays`) — the single outlet apps place in their root template.

- [ ] **Step 1: Write the failing test**

`web/packages/alloy-ui/src/lib/overlays/overlays.component.spec.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { OverlaysComponent } from './overlays.component';

describe('OverlaysComponent', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [OverlaysComponent],
    }).compileComponents();
  });

  it('composes the snackbar, dialog, and busy hosts', () => {
    const fixture = TestBed.createComponent(OverlaysComponent);
    fixture.detectChanges();
    const host = fixture.nativeElement as HTMLElement;
    expect(host.querySelector('app-snackbar-host')).not.toBeNull();
    expect(host.querySelector('app-dialog-host')).not.toBeNull();
    expect(host.querySelector('app-busy-host')).not.toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && npm run test:ui`
Expected: FAIL — cannot resolve `./overlays.component`.

- [ ] **Step 3: Implement the component**

`web/packages/alloy-ui/src/lib/overlays/overlays.component.ts`:

```ts
import { ChangeDetectionStrategy, Component } from '@angular/core';
import { SnackbarHostComponent } from '../snackbar/snackbar-host.component';
import { DialogHostComponent } from '../dialog/dialog-host.component';
import { BusyHostComponent } from '../spinner/busy-host.component';

/**
 * Single outlet for all AlloyUI overlay surfaces. Place once in the app root
 * template; every host renders nothing while idle, so unused features cost
 * nothing. The individual hosts are exported too, but this is the documented
 * path.
 */
@Component({
  selector: 'app-overlays',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [SnackbarHostComponent, DialogHostComponent, BusyHostComponent],
  template: `
    <app-snackbar-host />
    <app-dialog-host />
    <app-busy-host />
  `,
})
export class OverlaysComponent {}
```

Append to `web/packages/alloy-ui/src/public-api.ts`:

```ts
export { OverlaysComponent } from './lib/overlays/overlays.component';
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web && npm run test:ui`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/packages/alloy-ui/src/lib/overlays \
  web/packages/alloy-ui/src/public-api.ts
git commit -m "feat(ui): add app-overlays outlet composing overlay hosts"
```

---

### Task 7: Harness section, mirroring.md asymmetry entry, full-suite verification

**Files:**
- Create: `examples/web-harness/src/app/sections/overlays-section.component.ts`
- Modify: `examples/web-harness/src/app/app.component.ts`
- Modify: `docs/mirroring.md` (add a bullet under "Documented asymmetries")

**Interfaces:**
- Consumes: everything from Tasks 2–6 via `@allyworld/alloy-ui` (the harness maps that import to `web/packages/alloy-ui/src/public-api.ts` in its tsconfig).
- Produces: nothing consumed later; this is the manual verification surface and the contract documentation.

- [ ] **Step 1: Create the harness section**

`examples/web-harness/src/app/sections/overlays-section.component.ts`:

```ts
import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { AlloyBusy, AlloyDialog, AlloySnackbar, SpinnerComponent } from '@allyworld/alloy-ui';

@Component({
  selector: 'hx-overlays-section',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [SpinnerComponent],
  template: `
    <section class="section">
      <h2>Overlays</h2>
      <div class="row">
        <button type="button" (click)="toast()">Snackbar</button>
        <button type="button" (click)="undoable()">Snackbar + Undo</button>
        <button type="button" (click)="stack()">Queue 3 snacks</button>
        <button type="button" (click)="confirmPlain()">Confirm</button>
        <button type="button" (click)="confirmDestructive()">Destructive confirm</button>
        <button type="button" (click)="alertDemo()">Alert</button>
        <button type="button" (click)="busyDemo()">Busy (2s)</button>
      </div>
      <div class="row">
        <app-spinner [size]="16" />
        <app-spinner />
        <app-spinner [size]="32" style="color: #0a84ff" />
      </div>
      <p>last result: {{ last() }}</p>
    </section>
  `,
})
export class OverlaysSectionComponent {
  private readonly snackbar = inject(AlloySnackbar);
  private readonly dialog = inject(AlloyDialog);
  private readonly busy = inject(AlloyBusy);
  protected readonly last = signal('—');

  protected async toast(): Promise<void> {
    this.last.set(`snackbar: ${await this.snackbar.show('Saved')}`);
  }

  protected async undoable(): Promise<void> {
    const reason = await this.snackbar.show('Score deleted', { actionLabel: 'Undo' });
    this.last.set(reason === 'action' ? 'undo clicked' : `snackbar: ${reason}`);
  }

  protected stack(): void {
    void this.snackbar.show('First', { durationMs: 1500 });
    void this.snackbar.show('Second', { durationMs: 1500 });
    void this.snackbar.show('Third', { durationMs: 1500 });
  }

  protected async confirmPlain(): Promise<void> {
    this.last.set(`confirm: ${await this.dialog.confirm({ title: 'Apply changes?' })}`);
  }

  protected async confirmDestructive(): Promise<void> {
    const ok = await this.dialog.confirm({
      title: 'Delete score?',
      message: 'This cannot be undone.',
      confirmLabel: 'Delete',
      destructive: true,
    });
    this.last.set(`destructive confirm: ${ok}`);
  }

  protected async alertDemo(): Promise<void> {
    await this.dialog.alert({ title: 'Export finished', message: 'Saved to Drive.' });
    this.last.set('alert dismissed');
  }

  protected async busyDemo(): Promise<void> {
    await this.busy.while(new Promise((r) => setTimeout(r, 2000)), 'Working…');
    this.last.set('busy finished');
  }
}
```

- [ ] **Step 2: Register the section and the outlet in the harness app**

In `examples/web-harness/src/app/app.component.ts`:

1. Add imports at the top:

```ts
import { OverlaysComponent } from '@allyworld/alloy-ui';
import { OverlaysSectionComponent } from './sections/overlays-section.component';
```

2. Add `OverlaysComponent` and `OverlaysSectionComponent` to the component's `imports` array.
3. Add `<hx-overlays-section />` after `<hx-storage-section />` inside `<main class="harness">`, and `<app-overlays />` as the last line of the template, after `</main>`.

- [ ] **Step 3: Verify the harness builds**

Run: `cd examples/web-harness && npm run build`
Expected: build succeeds with no errors.

- [ ] **Step 4: Add the mirroring.md asymmetry entry**

In `docs/mirroring.md`, under the "**Documented asymmetries** are intentional and recorded here:" list (after the **NavHeaderComponent** bullet), add:

```markdown
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
```

- [ ] **Step 5: Run both full suites**

Run: `cd web && npm test`
Expected: PASS (all workspaces + alloy-ui).

Run: `cd swift && swift build && swift test`
Expected: PASS.

- [ ] **Step 6: Manual smoke check (serve on a free port — NEVER kill an existing 4205 server)**

Run: `cd examples/web-harness && npx ng serve --port 4299` and exercise the Overlays section in a browser: snackbar (auto-hide + hover pause), undo action, queued snacks, confirm true/false via buttons/Esc/backdrop, destructive styling, alert, busy overlay blocking for 2s, spinners at three sizes. Stop the server afterwards.

- [ ] **Step 7: Commit**

```bash
git add examples/web-harness/src/app/sections/overlays-section.component.ts \
  examples/web-harness/src/app/app.component.ts \
  docs/mirroring.md
git commit -m "feat(ui): add overlays harness section and mirroring asymmetry entry"
```
