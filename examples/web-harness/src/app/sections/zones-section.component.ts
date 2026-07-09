import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { buildTimeZoneOptions, countryCodeForZone } from '@allyworld/alloy-time';
import { FlagComponent, ZonePickerComponent, ZonePickerOption } from '@allyworld/alloy-ui';

/** Section 3: FlagComponent + ZonePickerComponent wired to real alloy-time
 *  data. Four square SVG flags ship as harness assets under
 *  public/flags/1x1 (the FlagComponent default base path); zones whose
 *  country has no artwork here — or no country at all (UTC, Etc/*) — exercise
 *  the fallback path. */
@Component({
  selector: 'hx-zones-section',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FlagComponent, ZonePickerComponent],
  template: `
    <section class="demo">
      <h2 class="demo-title">Flag &amp; zone picker</h2>
      <p class="demo-caption">
        Options from buildTimeZoneOptions(), row flags from countryCodeForZone(). fr / de / jp / it
        have artwork; a blank country code renders the globe fallback.
      </p>

      <div class="flag-row">
        @for (flag of flags; track flag.code) {
          <span class="flag-chip">
            <app-flag class="flag" [countryCode]="flag.code" [name]="flag.name" />
            <span class="flag-name">{{ flag.name }}</span>
          </span>
        }
        <span class="flag-chip">
          <app-flag class="flag" [countryCode]="null" name="UTC" />
          <span class="flag-name">UTC (globe fallback)</span>
        </span>
      </div>

      <div class="picker-card">
        <app-zone-picker
          [options]="zoneOptions"
          [selectedId]="selectedZone()"
          [countryFor]="countryFor"
          (picked)="selectedZone.set($event)"
        />
      </div>
      <p class="demo-caption">
        Selected zone: <code>{{ selectedZone() }}</code>
      </p>
    </section>
  `,
  styles: `
    .flag-row {
      display: flex;
      flex-wrap: wrap;
      gap: 0.75rem;
    }
    .flag-chip {
      display: inline-flex;
      align-items: center;
      gap: 0.5rem;
      background: rgba(255, 255, 255, 0.04);
      border-radius: 8px;
      padding: 0.45rem 0.7rem;
    }
    .flag {
      width: 1.6rem;
      height: 1.6rem;
      border-radius: 50%;
      color: #98989e; /* tints the globe fallback */
    }
    .flag-name {
      font-size: 0.8rem;
      color: #98989e;
    }
    .picker-card {
      background: rgba(255, 255, 255, 0.04);
      border-radius: 12px;
      padding: 0.75rem;
      max-width: 30rem;
    }
    code {
      font-family: ui-monospace, monospace;
      color: #0a84ff;
    }
  `,
})
export class ZonesSectionComponent {
  readonly zoneOptions: ZonePickerOption[] = buildTimeZoneOptions(
    Intl.DateTimeFormat().resolvedOptions().timeZone,
    new Date(),
  ).map(({ id, label }) => ({ id, label }));

  readonly selectedZone = signal('Europe/Paris');
  readonly countryFor = countryCodeForZone;

  readonly flags = [
    { code: 'fr', name: 'France' },
    { code: 'de', name: 'Germany' },
    { code: 'jp', name: 'Japan' },
    { code: 'it', name: 'Italy' },
  ];
}
