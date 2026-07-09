import { ChangeDetectionStrategy, Component, computed, input, output, signal } from '@angular/core';
import { FlagComponent } from '../flag/flag.component';

// Structurally compatible with alloy-time's TimeZoneOption — kept as a local
// shape so alloy-ui does not depend on alloy-time; hosts pass their options
// (and any synthetic leading entry like "Follow Time Machine") straight in.
export interface ZonePickerOption {
  id: string;
  label: string;
}

// Searchable zone list: a search box over a scrollable, filtered list. Live-apply
// on tap (emits picked immediately — no draft/commit). Hosts supply the options,
// the selected id, and a countryFor lookup (e.g. alloy-time's countryCodeForZone)
// for the row flags, and place this inside their own sheet/sub-view with a
// back/cancel control.
@Component({
  selector: 'app-zone-picker',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FlagComponent],
  templateUrl: './zone-picker.component.html',
  styleUrl: './zone-picker.component.scss',
})
export class ZonePickerComponent {
  readonly options = input.required<ZonePickerOption[]>();
  readonly selectedId = input<string>('');
  // Zone id -> ISO country code for the row flag (null synthetic/unknown -> globe).
  readonly countryFor = input<(id: string) => string | null>(() => null);
  readonly picked = output<string>();

  readonly query = signal('');
  readonly filtered = computed(() => {
    const q = this.query().trim().toLowerCase();
    const all = this.options();
    return q ? all.filter((z) => z.label.toLowerCase().includes(q)) : all;
  });

  pick(id: string): void {
    this.picked.emit(id);
  }
}
