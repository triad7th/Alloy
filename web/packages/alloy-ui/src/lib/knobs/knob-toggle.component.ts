import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';

/** iOS pill switch attached to the app's own <button> — the host keeps its
 *  extra classes and data-knob attributes, so existing spec selectors work. */
@Component({
  selector: 'button[appKnobToggle]',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<span class="knobs-toggle-thumb"></span>`,
  host: {
    class: 'knobs-toggle',
    type: 'button',
    role: 'switch',
    '[class.on]': 'on()',
    '[attr.aria-checked]': 'on()',
    '(click)': 'toggled.emit()',
  },
})
export class KnobToggleComponent {
  readonly on = input.required<boolean>();
  readonly toggled = output<void>();
}
