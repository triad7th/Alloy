import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { IconComponent } from '../icon/icon.component';
import { AlloyIconName } from '../icon/icon-registry';

/**
 * Reusable 34px circular iOS nav button.
 *
 * Renders an SF Symbol via <app-icon>. Clicks bubble, so hosts bind their
 * handler on <app-icon-button> directly — there is no custom output.
 */
@Component({
  selector: 'app-icon-button',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IconComponent],
  template: `
    <button
      type="button"
      class="icon-button"
      [class.primary]="variant() === 'primary'"
      [class.destructive]="variant() === 'destructive'"
      [attr.aria-label]="label() || null"
      [attr.title]="label() || null"
    >
      <app-icon [name]="icon()" />
    </button>
  `,
  styleUrl: './icon-button.component.scss',
})
export class IconButtonComponent {
  /** SF Symbol name rendered inside the button. */
  readonly icon = input.required<AlloyIconName>();
  /** Visual style. `secondary`/`primary` are used today; `destructive` is for completeness. */
  readonly variant = input<'secondary' | 'primary' | 'destructive'>('secondary');
  /** Used as both aria-label and title. */
  readonly label = input<string>('');
}
