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
