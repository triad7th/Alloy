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
