import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';

export interface KnobSegmentOption {
  value: string;
  label: string;
}

/** Segmented pill control (web twin of AlloyUI's Swift KnobSegment). */
@Component({
  selector: 'app-knob-segment',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="knobs-segment" role="radiogroup" [attr.aria-label]="segmentLabel() || null">
      @for (option of options(); track option.value) {
        <button
          type="button"
          role="radio"
          class="knobs-segment-btn"
          [class.on]="option.value === selection()"
          [attr.aria-checked]="option.value === selection()"
          (click)="changed.emit(option.value)"
        >
          {{ option.label }}
        </button>
      }
    </div>
  `,
})
export class KnobSegmentComponent {
  readonly options = input.required<readonly KnobSegmentOption[]>();
  readonly selection = input.required<string>();
  readonly segmentLabel = input<string>('');
  readonly changed = output<string>();
}
