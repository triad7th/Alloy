import { ChangeDetectionStrategy, Component, computed, signal } from '@angular/core';
import {
  ButtonComponent,
  FieldComponent,
  FormDialogComponent,
  KnobSegmentComponent,
  KnobSegmentOption,
  NumberFieldComponent,
  SelectComponent,
  SelectOption,
} from '@allyworld/alloy-ui';

const PRESETS: readonly KnobSegmentOption[] = [
  { value: '4/4', label: '4/4' },
  { value: '3/4', label: '3/4' },
  { value: '2/4', label: '2/4' },
  { value: '6/8', label: '6/8' },
  { value: '2/2', label: '2/2' },
];
const BEAT_VALUES: readonly SelectOption[] = [
  { value: '2', label: '2' },
  { value: '4', label: '4' },
  { value: '8', label: '8' },
  { value: '16', label: '16' },
];
const PICKUPS: readonly SelectOption[] = [
  { value: 'none', label: 'None' },
  { value: '1', label: '1 beat' },
  { value: '2', label: '2 beats' },
];

@Component({
  selector: 'hx-forms-section',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    ButtonComponent,
    FieldComponent,
    FormDialogComponent,
    KnobSegmentComponent,
    NumberFieldComponent,
    SelectComponent,
  ],
  template: `
    <section class="section">
      <h2>Forms</h2>
      <p>AllyScore's Time signature dialog, rebuilt from the AlloyUI form kit.</p>
      <div class="row">
        <app-button variant="primary" (click)="openDialog()">Time signature…</app-button>
      </div>
      <p>last result: {{ result() }}</p>

      <app-form-dialog
        [open]="open()"
        title="Time signature"
        submitLabel="Apply"
        [submitDisabled]="!valid()"
        (submitted)="apply()"
        (cancelled)="open.set(false)"
      >
        <app-knob-segment
          [options]="presets"
          [selection]="preset()"
          segmentLabel="Preset"
          (changed)="choosePreset($event)"
        />
        <app-field label="Beats">
          <app-number-field [(value)]="beats" [min]="1" [max]="32" />
        </app-field>
        <app-field label="Beat value">
          <app-select [options]="beatValues" [(value)]="beatValue" />
        </app-field>
        <app-field label="Pickup">
          <app-select [options]="pickups" [(value)]="pickup" />
        </app-field>
      </app-form-dialog>
    </section>
  `,
})
export class FormsSectionComponent {
  protected readonly presets = PRESETS;
  protected readonly beatValues = BEAT_VALUES;
  protected readonly pickups = PICKUPS;

  protected readonly open = signal(false);
  protected readonly preset = signal('4/4');
  protected readonly beats = signal<number | null>(4);
  protected readonly beatValue = signal('4');
  protected readonly pickup = signal('none');
  protected readonly result = signal('—');

  /** Drives submitDisabled — the app owns validation, not the library. */
  protected readonly valid = computed(() => this.beats() !== null);

  protected openDialog(): void {
    this.open.set(true);
  }

  protected choosePreset(value: string): void {
    this.preset.set(value);
    const [beats, beatValue] = value.split('/');
    this.beats.set(Number(beats));
    this.beatValue.set(beatValue);
  }

  protected apply(): void {
    this.result.set(
      `${this.beats()}/${this.beatValue()}, pickup: ${this.pickup()}`,
    );
    this.open.set(false);
  }
}
