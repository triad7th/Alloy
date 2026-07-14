import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/**
 * A labeled form row. The caption and the projected control live inside one
 * <label> element, so clicking the caption focuses the control natively — no
 * generated ids, no for/id plumbing.
 *
 * Use this for a field holding ONE input or select. Do not wrap a segmented
 * control (a group of buttons) in it — a <label> around a button group is not
 * meaningful; give the segment its own aria-label instead.
 */
@Component({
  selector: 'app-field',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <label class="alloy-field">
      <span class="alloy-field-label">{{ label() }}</span>
      <ng-content />
    </label>
  `,
  styleUrl: './field.component.scss',
})
export class FieldComponent {
  readonly label = input.required<string>();
}
