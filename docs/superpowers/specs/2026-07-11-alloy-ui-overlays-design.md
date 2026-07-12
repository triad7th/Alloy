# AlloyUI Overlay Trio: Snackbar, Dialog, Spinner/Busy (Web-Only)

- **Date:** 2026-07-11
- **Status:** Approved design, pending implementation plan
- **Scope:** `@allyworld/alloy-ui` (web). No Swift twins — documented asymmetry.

## Motivation

AllyScore is a web editor-style app and needs the traditional web feedback
surfaces: transient notifications (snackbar), busy indication (spinner and a
blocking busy overlay), and modal confirmation (confirm/alert dialog).
AllyClock and AllyPiano have little use for these, but the components are
app-agnostic and belong in the shared library rather than in AllyScore.

## Decisions (settled during brainstorming)

1. **Web-only, documented.** SwiftUI already provides native equivalents
   (`.alert`, `ProgressView`); snackbars are non-native to Apple platforms.
   No Swift twins ship. A new "Documented asymmetries" entry in
   `docs/mirroring.md` records this, following the NavHeader precedent.
   Swift twins may be added later if a real need appears.
2. **Imperative services** for snackbar, dialog, and busy overlay; apps place
   a single outlet component in their root template. The inline spinner is a
   plain declarative component.
3. **Dialog scope: confirm + alert.** No generic content-projection modal in
   this version (YAGNI until AllyScore demonstrates a need).
4. **Spinner scope: inline component + blocking busy overlay.**
5. **Zero new dependencies.** No `@angular/cdk`, no Material. The dialog uses
   the native `<dialog>` element (`showModal()`), which provides focus
   trapping, Esc handling, background inerting, and top-layer stacking.
   Peer surface stays exactly `@angular/core` + `@angular/common` `^21`.

## Package shape

New folders under `web/packages/alloy-ui/src/lib/`, matching the existing
per-component layout (component + spec + scss where needed):

```
lib/snackbar/   snackbar.service.ts, snackbar-host.component.ts, specs
lib/dialog/     dialog.service.ts, dialog-host.component.ts, specs
lib/spinner/    spinner.component.ts, busy.service.ts, busy-host.component.ts, specs
lib/overlays/   overlays.component.ts   (composes the three hosts)
```

All standalone; all exported from `public-api.ts`.

### The outlet

```html
<!-- app root template, once -->
<app-overlays />
```

`OverlaysComponent` composes the snackbar, dialog, and busy hosts. Each
host renders nothing while idle, so unused features cost nothing. The
individual host components are exported too, for apps that want to place
them separately, but `<app-overlays />` is the documented path.

## Snackbar

`AlloySnackbar` injectable service (root-provided):

```ts
show(message: string, opts?: {
  durationMs?: number;    // default: tokens durationMs.snackbar-show (4000)
  actionLabel?: string;   // e.g. 'Undo'
}): Promise<SnackbarClose>;   // 'timeout' | 'action' | 'dismissed'

dismiss(): void;          // dismiss current snack, advance the queue
```

Behavior:

- One snack visible at a time; further `show()` calls join a FIFO queue.
- The returned promise resolves with *why* the snack closed, enabling the
  Undo pattern:
  `if (await snackbar.show('Deleted', { actionLabel: 'Undo' }) === 'action') restore();`
- Auto-hide timer pauses while the pointer hovers the snack.
- Bottom-center placement; fade/slide transitions use
  `durationMs.overlay-fade`.
- A11y: container is `role="status"` with `aria-live="polite"`; the action
  renders as a real `<button>`.

## Dialog (confirm + alert)

`AlloyDialog` injectable service (root-provided):

```ts
confirm(opts: {
  title: string;
  message?: string;
  confirmLabel?: string;  // default 'OK'
  cancelLabel?: string;   // default 'Cancel'
  destructive?: boolean;  // styles the confirm button as destructive (red)
}): Promise<boolean>;

alert(opts: {
  title: string;
  message?: string;
  okLabel?: string;       // default 'OK'
}): Promise<void>;
```

Behavior:

- Rendered inside a native `<dialog>` opened with `showModal()`. Focus trap,
  Esc, background inerting, and top-layer stacking come from the platform.
- Esc and backdrop click resolve `confirm` to `false` (alert just closes).
- One dialog at a time; concurrent calls queue sequentially in call order.
- Panel styling follows the sheet/knobs design language: tokenized corner
  radius (`sizePx.sheet-corner-radius`), scrim, and durations.
- A11y: `aria-labelledby` wired to the title; initial focus lands on the
  cancel button in `confirm` (the safe action) and on the OK button in
  `alert`.

## Spinner and busy overlay

### Inline spinner

```html
<app-spinner [size]="24" ariaLabel="Loading" />
```

- Indeterminate, pure CSS animation, draws in `currentColor` so it themes
  wherever placed (buttons, panels, empty states).
- `size` is the diameter in px (default 24).
- `role="progressbar"` with an `aria-label` (default "Loading").
- Honors `prefers-reduced-motion`: falls back to a pulsing-opacity animation
  rather than a frozen glyph.

### Busy overlay

`AlloyBusy` injectable service (root-provided):

```ts
begin(label?: string): () => void;  // returns a release fn; ref-counted
while<T>(work: Promise<T>, label?: string): Promise<T>;  // begin/release around work
```

- Ref-counted: the overlay is visible while any `begin()` is unreleased, so
  overlapping operations don't flicker. Releasing twice is a no-op.
- Full-viewport scrim + spinner + optional label (most recent unreleased
  label wins); blocks pointer and keyboard interaction; `aria-busy` on the
  overlay host.
- `while()` is sugar: begins before the promise, releases in `finally`,
  returns/rethrows the promise result.

## Tokens

New `tokens.json` entries, emitted through `tools/generate-tokens.mjs` to
SCSS/TS/Swift as usual (tokens remain the hard-shared layer even though the
components are web-only):

- `durationMs.snackbar-show: 4000`
- `durationMs.overlay-fade: 150`
- a scrim color entry if the existing palette lacks one

Component SCSS consumes `_tokens.scss`; no hand-written constants.

## Testing

Vitest specs following the existing component patterns:

- **Snackbar:** queue ordering; promise resolution for timeout / action /
  dismiss; hover pauses the timer; host renders nothing when idle.
- **Dialog:** confirm resolves true/false across button, Esc, and backdrop
  paths; alert resolves on OK; sequential queueing of concurrent calls;
  destructive styling hook present.
- **Busy:** ref-counting across overlapping begin/release; double-release
  no-op; `while()` releases on both resolve and reject.
- **Spinner:** renders with size and aria attributes.

Manual verification: a new section in `examples/web-harness` exercising all
three surfaces.

## Release

Ships in the next `alloy-ui` release via `tools/release.mjs` (packed from
the ng-packagr output). AllyScore consumes the release tarball. The
`docs/mirroring.md` asymmetry entry lands in the same change set as the
components.

## Out of scope

- Swift/SwiftUI twins (documented asymmetry; revisit on demand).
- Generic content-projection modal, toast stacking/multiple simultaneous
  snacks, determinate progress bars, non-blocking per-region busy states.
