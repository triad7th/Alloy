import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { IconComponent } from '../icon/icon.component';
import { ALLOY_FLAG_BASE_PATH } from './flag-config';

// Country flag keyed to an ISO 3166-1 alpha-2 code — the semantic key, mirroring
// the SF-Symbol icon layer. On the Web the code renders a square SVG flag served
// by the app (see provideAlloyFlags); the Apple twin renders the same code from
// the app's asset catalog. A null/blank code (UTC, Etc/*, or an unknown zone)
// falls back to the neutral `globe` symbol.
@Component({
  selector: 'app-flag',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IconComponent],
  template: `
    @if (code(); as c) {
      <img
        class="flag-img"
        [src]="basePath + '/' + c + '.svg'"
        [alt]="alt()"
        loading="lazy"
        decoding="async"
      />
    } @else {
      <app-icon class="flag-globe" name="globe" />
    }
  `,
  styles: `
    :host {
      display: inline-flex;
      overflow: hidden;
    }
    .flag-img {
      width: 100%;
      height: 100%;
      object-fit: cover;
      display: block;
    }
    .flag-globe {
      width: 100%;
      height: 100%;
      color: inherit;
    }
  `,
})
export class FlagComponent {
  // ISO 3166-1 alpha-2 (case-insensitive); '' or null renders the globe.
  readonly countryCode = input<string | null>(null);
  // Optional human name (country or zone) for the flag's alt text.
  readonly name = input<string>('');

  readonly basePath = inject(ALLOY_FLAG_BASE_PATH, { optional: true }) ?? 'flags/1x1';

  readonly code = computed(() => (this.countryCode() ?? '').trim().toLowerCase() || null);
  readonly alt = computed(() => {
    const label = this.name().trim();
    if (label) return `${label} flag`;
    const c = this.code();
    return c ? `${c.toUpperCase()} flag` : '';
  });
}
