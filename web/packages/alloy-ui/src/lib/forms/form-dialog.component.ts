import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  afterRenderEffect,
  inject,
  input,
  output,
} from '@angular/core';
import { ModalDirective } from '../modal/modal.directive';
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
 *
 * The native-<dialog> behavior lives in ModalDirective, but the exit fade
 * (animate.leave="modal-leave") must stay on the <dialog> here: Angular only
 * runs a leave animation when the view that declares the element is destroyed,
 * and that view is this template's @if block. See ModalDirective.
 */
@Component({
  selector: 'app-form-dialog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ModalDirective, ButtonComponent],
  template: `
    @if (open()) {
      <dialog
        alloyModal
        animate.leave="modal-leave"
        [attr.aria-labelledby]="titleId"
        (dismissed)="cancelled.emit()"
      >
        <div class="alloy-modal-body">
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
        </div>
      </dialog>
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
