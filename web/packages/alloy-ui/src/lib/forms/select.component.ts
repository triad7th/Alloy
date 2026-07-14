import { ChangeDetectionStrategy, Component, input, model } from '@angular/core';

export interface SelectOption {
  value: string;
  label: string;
}

/**
 * Dropdown built on a native <select>: the closed state is fully styled
 * (appearance: none + our own arrow), while keyboard behavior and
 * accessibility stay native. `color-scheme: dark` (see the stylesheet) makes
 * the browser render the OS popup dark rather than white.
 *
 * A custom listbox popup is deliberately not implemented — see the spec.
 */
@Component({
  selector: 'app-select',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <select
      class="alloy-select"
      [disabled]="disabled()"
      [attr.aria-label]="selectLabel() || null"
      (change)="onChange($event)"
    >
      @for (option of options(); track option.value) {
        <option [value]="option.value" [selected]="option.value === value()">{{ option.label }}</option>
      }
    </select>
  `,
  styleUrl: './select.component.scss',
})
export class SelectComponent {
  readonly options = input.required<readonly SelectOption[]>();
  readonly value = model<string>('');
  readonly disabled = input(false);
  readonly selectLabel = input<string>('');

  protected onChange(event: Event): void {
    this.value.set((event.target as HTMLSelectElement).value);
  }
}
