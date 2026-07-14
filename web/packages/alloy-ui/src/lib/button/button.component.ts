import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/**
 * Labeled button. The icon-only counterpart is IconButtonComponent.
 *
 * Clicks bubble, so hosts bind their handler on <app-button> directly — there
 * is no custom output. `type="submit"` lets it act as the default button of a
 * surrounding <form> (FormDialogComponent relies on this for Enter-to-submit).
 */
@Component({
  selector: 'app-button',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <button
      class="alloy-button"
      [attr.type]="type()"
      [class.primary]="variant() === 'primary'"
      [class.destructive]="variant() === 'destructive'"
      [disabled]="disabled()"
    >
      <ng-content />
    </button>
  `,
  styleUrl: './button.component.scss',
})
export class ButtonComponent {
  readonly variant = input<'secondary' | 'primary' | 'destructive'>('secondary');
  readonly disabled = input(false);
  readonly type = input<'button' | 'submit'>('button');
}
