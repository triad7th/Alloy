import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  afterRenderEffect,
  effect,
  inject,
  viewChild,
} from '@angular/core';
import { AlloyDialog } from './dialog.service';

/** Module-level counter so multiple mounted hosts never collide on id. */
let nextHostId = 0;

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
 *
 * `settle()` advances the queue synchronously, so when dialog A settles with
 * B queued, the `@if` never tears down — the same open <dialog> element
 * re-renders with B's content, and showModal() is not re-invoked (it's
 * already open). A second effect explicitly re-focuses the first
 * .dialog-button (the safe action) whenever the active dialog changes, so
 * focus never lingers on whatever button the user just clicked in A.
 */
@Component({
  selector: 'app-dialog-host',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (dialog.current(); as active) {
      <dialog
        #panel
        class="dialog"
        animate.leave="dialog-leave"
        [attr.aria-labelledby]="titleId"
        (cancel)="onCancel($event)"
        (click)="onClick($event)"
      >
        <div class="dialog-body">
          <h2 class="dialog-title" [id]="titleId">{{ active.title }}</h2>
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
  protected readonly titleId = `alloy-dialog-title-${nextHostId++}`;
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

    // Runs after the DOM reflects the current active dialog, so the queued
    // dialog's own buttons exist by the time we focus one. Re-fires whenever
    // dialog.current() changes (including the null->next advance within a
    // single settle()), which is exactly when focus needs to move.
    afterRenderEffect(() => {
      const el = this.panel()?.nativeElement;
      if (el && this.dialog.current()) {
        el.querySelector<HTMLButtonElement>('.dialog-button')?.focus();
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
