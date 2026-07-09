import { ChangeDetectionStrategy, Component, computed, inject, input, isDevMode } from '@angular/core';
import { ALLOY_EXTRA_ICONS, AlloyIconName, ICON_PATHS } from './icon-registry';

@Component({
  selector: 'app-icon',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.7"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      @if (path()) {
        <path [attr.d]="path()" />
      }
    </svg>
  `,
  styles: `
    :host {
      display: inline-flex;
      width: 1em;
      height: 1em;
    }
    svg {
      width: 100%;
      height: 100%;
    }
  `,
})
export class IconComponent {
  readonly name = input.required<AlloyIconName>();
  private readonly extras = inject(ALLOY_EXTRA_ICONS, { optional: true }) ?? [];
  readonly path = computed(() => {
    const merged = Object.assign({}, ICON_PATHS, ...this.extras) as Record<string, string>;
    const d = merged[this.name()] ?? '';
    if (!d && isDevMode()) console.warn(`[alloy-ui] unknown icon name: ${this.name()}`);
    return d;
  });
}
