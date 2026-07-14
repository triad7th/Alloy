import { Directive, ElementRef, afterNextRender, inject, output } from '@angular/core';

/**
 * INTERNAL. The shared native-<dialog> behavior behind every AlloyUI modal
 * (confirm/alert via DialogHostComponent, forms via FormDialogComponent).
 * Not exported from public-api — hosts are the public surface.
 *
 * Owns: showModal() (so focus trapping, background inerting and top-layer
 * stacking come from the platform), Esc, and backdrop-click detection. The
 * panel chrome lives in the shared `_modal.scss` partial, which each host's
 * stylesheet @use's.
 *
 * Does NOT own focus policy — each host decides what to focus, because the
 * rules differ (dialog-host re-focuses the safe action on queue advance;
 * form-dialog focuses the first field).
 *
 * Does NOT own the exit fade either: `animate.leave="modal-leave"` must be
 * written on the <dialog> in each host's own template. Angular registers a
 * leave animation in the LView that DECLARES the element, so it only runs when
 * THAT view is destroyed. If the <dialog> lived inside a shared shell
 * component's template, the host's `@if` would tear down the embedded view
 * holding <app-modal-shell> — a view with no leave animations — and Angular
 * would rip the dialog out synchronously without ever animating it. Nor can we
 * animate the shell's host element instead: an open <dialog> is in the top
 * layer, so ancestor opacity/transform have no visual effect on it. That
 * constraint is why this is a directive and not a component. Do not "clean it
 * up" back into a component.
 *
 * Backdrop clicks target the <dialog> element itself; in-panel clicks target
 * .alloy-modal-body or deeper. That is only true because the panel has
 * padding: 0 and the body carries the padding — do not move the padding.
 */
@Directive({
  selector: 'dialog[alloyModal]',
  host: {
    class: 'alloy-modal',
    '(cancel)': 'onCancel($event)',
    '(click)': 'onClick($event)',
  },
})
export class ModalDirective {
  /** Esc or backdrop click. The host decides what dismissal means. */
  readonly dismissed = output<void>();

  private readonly el = inject<ElementRef<HTMLDialogElement>>(ElementRef);

  constructor() {
    // A fresh directive instance is created every time the host's @if renders
    // the dialog, so a one-shot render hook is exactly right — and it
    // guarantees the element is in the document before showModal().
    afterNextRender(() => {
      const el = this.el.nativeElement;
      if (el.open) return;
      // jsdom guard: fall back to the open attribute where showModal is missing.
      if (typeof el.showModal === 'function') el.showModal();
      else el.setAttribute('open', '');
    });
  }

  protected onCancel(event: Event): void {
    // Close by re-rendering (the host's @if removes us), not natively.
    event.preventDefault();
    this.dismissed.emit();
  }

  protected onClick(event: MouseEvent): void {
    if (event.target === this.el.nativeElement) this.dismissed.emit();
  }
}
