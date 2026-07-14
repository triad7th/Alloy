import { ChangeDetectionStrategy, Component, input, model } from '@angular/core';

/**
 * Numeric input. Native spinners are hidden (see _input.scss).
 *
 * `input` emits exactly what was typed (clamping mid-typing would fight the
 * user — typing "1" toward "12" under min=10 would jump to 10). `blur` clamps
 * the settled value into [min, max]. An empty box is `null`, never 0.
 */
@Component({
  selector: 'app-number-field',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <input
      class="alloy-input"
      type="number"
      [value]="value() ?? ''"
      [attr.min]="min()"
      [attr.max]="max()"
      [attr.step]="step()"
      [disabled]="disabled()"
      [attr.aria-invalid]="invalid() ? 'true' : null"
      (input)="onInput($event)"
      (blur)="onBlur()"
    />
  `,
  styleUrl: './number-field.component.scss',
})
export class NumberFieldComponent {
  readonly value = model<number | null>(null);
  readonly min = input<number | null>(null);
  readonly max = input<number | null>(null);
  readonly step = input(1);
  readonly disabled = input(false);
  readonly invalid = input(false);

  protected onInput(event: Event): void {
    const raw = (event.target as HTMLInputElement).value;
    if (raw === '') {
      this.value.set(null);
      return;
    }
    const parsed = Number(raw);
    this.value.set(Number.isNaN(parsed) ? null : parsed);
  }

  protected onBlur(): void {
    const current = this.value();
    if (current === null) return;
    const min = this.min();
    const max = this.max();
    let clamped = current;
    if (min !== null && clamped < min) clamped = min;
    if (max !== null && clamped > max) clamped = max;
    if (clamped !== current) this.value.set(clamped);
  }
}
