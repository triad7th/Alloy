# AlloyUI Form Kit + Form Dialog (Web-Only)

- **Date:** 2026-07-13
- **Status:** Implemented. **Post-implementation correction:** the shared
  modal shell shipped as an internal *attribute directive*
  `ModalDirective` (`dialog[alloyModal]`), not a `ModalShellComponent`.
  Angular registers `animate.leave` in the LView that declares the element,
  so the exit fade only runs when the `<dialog>` is declared directly in
  each consumer's `@if` view — a component-owned `<dialog>` behind a
  projection boundary never animates on teardown. The directive keeps one
  implementation of the native-dialog behavior while satisfying that
  constraint. Read `web/packages/alloy-ui/src/lib/modal/modal.directive.ts`
  for the shipped shape; the "Shared modal shell" section below describes
  the original (component) design.
- **Scope:** `@allyworld/alloy-ui` (web). No Swift twins — documented asymmetry.
- **Driver:** AllyScore's Time Signature modal is built from raw native
  `<input>` and `<select>` elements and does not match the AlloyUI look. Apps
  have no shared form controls or form-dialog layout, so each app re-solves
  the problem inconsistently.

## Decisions (settled during brainstorming)

1. **Form kit now, theming later.** A Graphite/Porcelain theming system was
   discussed and deliberately **deferred to its own spec**. This spec ships
   the form kit only.
2. **Theming-ready by construction.** Every control's SCSS uses existing
   token variables — **zero hardcoded color literals**. When theming lands
   (tokens become CSS custom properties), this kit themes with no rework.
   This is what makes "form kit first" safe.
3. **Web-only, documented.** SwiftUI already provides native
   `TextField`/`Picker`/`Form`; no Apple app has asked for this. Follows the
   overlay-trio precedent — a `docs/mirroring.md` asymmetry entry, no Swift
   components.
4. **The dialog owns layout + controls; the app owns content.** No
   schema-driven form config. Apps compose their own fields and handle
   submit.
5. **Declarative form dialog.** `<app-form-dialog [open] …>` with projected
   content, because a form's values and validation live in the app's
   template. (The existing `AlloyDialog` stays imperative for
   confirm/alert.) This is the custom-content modal the overlay spec
   explicitly deferred "until a real AllyScore need appears".
6. **Reuse `KnobSegmentComponent`** for segmented preset rows (4/4, 3/4, …).
   No second segmented control.
7. **No new dependencies — notably no `@angular/forms`.** Two-way binding
   uses Angular's `model()` signal, so `[(value)]="beats"` works with plain
   signals. Peer surface stays `@angular/core` + `@angular/common` `^21`.

## Components

New folders under `web/packages/alloy-ui/src/lib/`. All standalone, OnPush,
signal inputs, `app-` selector prefix, exported from `public-api.ts`.

| Component | Selector | Purpose |
| --- | --- | --- |
| `ButtonComponent` | `app-button` | Labeled button. `variant`: `primary` \| `secondary` \| `destructive`; `disabled`; `type`. AlloyUI has only an *icon* button today. |
| `TextFieldComponent` | `app-text-field` | Styled `<input type="text">`. `value` model, `placeholder`, `disabled`, `invalid`. |
| `NumberFieldComponent` | `app-number-field` | `<input type="number">` with native spinners hidden. `min`, `max`, `step`; value is `number \| null`. |
| `SelectComponent` | `app-select` | Styled dropdown. `options: SelectOption[]` (`{ value, label }`), `value` model, `disabled`. |
| `FieldComponent` | `app-field` | Row wrapper: renders a `<label>` containing the label text and the projected control. |
| `FormDialogComponent` | `app-form-dialog` | Declarative modal. Inputs `open`, `title`, `submitLabel` (default `Apply`), `cancelLabel` (default `Cancel`), `submitDisabled`. Outputs `submitted`, `cancelled`. Content projected into the body. |

### Field label association

`FieldComponent` renders a real `<label>` element wrapping its content, so
clicking the label focuses the inner control natively — no generated ids and
no `for`/`id` plumbing. This is correct for a field containing a single input
or select. Segmented rows are not wrapped in `app-field`; they carry their own
`aria-label` (a `<label>` wrapping a group of buttons is not meaningful).

### Two-way binding

Controls expose `value` as an Angular `model()`, enabling `[(value)]="beats"`
against a plain signal. No `ControlValueAccessor` and no `@angular/forms`
dependency. Apps validate with their own signals and drive `submitDisabled`.

## Shared modal shell (targeted refactor)

`DialogHostComponent` currently hand-rolls the native `<dialog>` behavior:
`showModal()` with the jsdom fallback guard, Esc (`cancel` event),
backdrop-click detection (`event.target === panel`, which relies on the panel
having `padding: 0` and an inner body carrying the padding), the
`animate.leave` exit fade, and panel styling. `FormDialogComponent` needs all
of the same behavior.

Rather than duplicate it, extract an **internal, non-exported
`ModalShellComponent`** that owns exactly that shell. Both
`DialogHostComponent` and `FormDialogComponent` project into it. One modal
implementation, not two divergent ones.

- The shell owns: the `<dialog>` element, `showModal()` + jsdom guard,
  `animate.leave` fade, corner radius / background / backdrop styling, and
  emitting a single `dismissed` output for both Esc and backdrop click.
- The shell does **not** own focus policy — that stays with each host.
  `DialogHostComponent` keeps its `afterRenderEffect` that focuses the first
  `.dialog-button` on queue advance (a fix landed in 0.7.0);
  `FormDialogComponent` focuses its first focusable field on open.

This touches just-released code and is the riskiest part of the work. It gets
its own task, with the existing `dialog-host` suite as the regression net.

`ButtonComponent` likewise replaces `dialog-host`'s hand-rolled
`.dialog-button` styles so confirm/alert and form dialogs share one button.
Expect small selector churn in the existing dialog specs.

## Select: scope of the fix

The raw native `<select>` is the current modal's worst offender. v1 styles the
**native** select: `appearance: none`, custom chrome and arrow, and
`color-scheme: dark` so Chrome renders the OS popup dark rather than white.
This fixes the closed state — what the user actually sees — while keeping
native keyboard behavior and accessibility for free.

A fully custom listbox popup (styled option list) is **out of scope**: it
requires reimplementing keyboard navigation, focus management, ARIA listbox
semantics, and popup positioning. Revisit only if the native popup proves
unacceptable in practice.

## Tokens

The kit needs a few colors that do not exist yet. Add to `tokens.json` in the
current flat shape (theming will regroup them later):

- `color.field-bg` — input/select background
- `color.field-border` — input/select border (resting)
- `color.focus-ring` — focus outline

These emit to `_tokens.scss` and to Swift's `AlloyTokens` as unused constants
— the same harmless pattern the overlay durations already set. No component
SCSS in this kit may contain a raw color literal.

## Behavior and accessibility

- **Dismissal:** Esc and backdrop click both emit `cancelled`.
- **Submission:** the submit button and Enter pressed inside a field both emit
  `submitted`. Both are suppressed while `submitDisabled` is true.
- **Focus:** on open, focus moves to the first focusable field in the body
  (falling back to the submit button when the body has none).
- **Labelling:** the dialog reuses the `aria-labelledby` → title wiring;
  fields associate via `<label>` wrapping; invalid fields set `aria-invalid`.

## Testing

Vitest specs per component, following existing patterns:

- **Button:** variant classes, disabled blocks click, label renders.
- **TextField / NumberField:** `[(value)]` round-trip, disabled, `invalid`
  sets `aria-invalid`; number field clamps to `min`/`max` and emits `null`
  when cleared.
- **Select:** renders options, `[(value)]` round-trip, disabled.
- **Field:** renders a `<label>` wrapping the projected control.
- **FormDialog:** renders when `open`; `submitted` on button and on Enter;
  `cancelled` on cancel button, Esc, and backdrop; `submitDisabled` blocks
  both submit paths; focus lands on the first field.
- **Regression net:** the existing `dialog-host` suite must stay green across
  the modal-shell extraction and the button swap.

Manual verification: a harness section reproducing AllyScore's **Time
Signature dialog** (segment presets + number field + selects + Apply),
verified in a browser.

## Release

Ships in a subsequent `alloy-ui` release via `tools/release.mjs`. AllyScore
then migrates its Time Signature modal to the kit (separate work, in the
AllyScore repo).

## Out of scope

- Theming (Graphite / Porcelain) — its own spec, next.
- Custom listbox popup for `Select`.
- `@angular/forms` / `ControlValueAccessor` integration.
- A validation framework — apps validate with signals.
- Date, color, file, textarea, checkbox, and radio inputs — add on demand.
- SwiftUI twins.
