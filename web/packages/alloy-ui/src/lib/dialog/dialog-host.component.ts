import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  afterRenderEffect,
  inject,
} from '@angular/core';
import { AlloyDialog } from './dialog.service';
import { ModalDirective } from '../modal/modal.directive';
import { ButtonComponent } from '../button/button.component';

/** Module-level counter so multiple mounted hosts never collide on id. */
let nextHostId = 0;

/**
 * Visual outlet for AlloyDialog. Placed once per app (via <app-overlays>);
 * renders nothing while idle. The native-<dialog> behavior (showModal, Esc,
 * backdrop) lives in ModalDirective; this host owns only the confirm/alert
 * content, the buttons, and the focus policy. The exit fade
 * (animate.leave="modal-leave") must stay on the <dialog> here: Angular only
 * runs a leave animation when the view that declares the element is destroyed,
 * and that view is this template's @if block. See ModalDirective.
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
  imports: [ModalDirective, ButtonComponent],
  template: `
    @if (dialog.current(); as active) {
      <dialog
        alloyModal
        animate.leave="modal-leave"
        [attr.aria-labelledby]="titleId"
        (dismissed)="dialog.settle(false)"
      >
        <div class="alloy-modal-body">
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
        </div>
      </dialog>
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
