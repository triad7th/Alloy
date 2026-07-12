import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/**
 * Indeterminate activity spinner. Draws in `currentColor`, so it themes
 * wherever it is placed (buttons, panels, empty states). Honors
 * prefers-reduced-motion by pulsing opacity instead of rotating.
 */
@Component({
  selector: 'app-spinner',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <span
      class="spinner"
      role="progressbar"
      [attr.aria-label]="ariaLabel()"
      [style.width.px]="size()"
      [style.height.px]="size()"
    ></span>
  `,
  styleUrl: './spinner.component.scss',
})
export class SpinnerComponent {
  /** Diameter in px. */
  readonly size = input(24);
  /** Accessible name for the progressbar role. */
  readonly ariaLabel = input('Loading');
}
