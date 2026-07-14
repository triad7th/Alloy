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
