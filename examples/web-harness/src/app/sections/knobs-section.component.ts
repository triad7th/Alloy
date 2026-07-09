import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import {
  KnobSegmentComponent,
  KnobSegmentOption,
  KnobSliderDirective,
  KnobToggleComponent,
} from '@allyworld/alloy-ui';

/** Section 2: the knobs design language — stylesheet classes from
 *  alloy-ui/styles/knobs (via styles.scss) plus the three attach-in-place
 *  controls. Markup mirrors allyclock's settings panels. */
@Component({
  selector: 'hx-knobs-section',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [KnobToggleComponent, KnobSegmentComponent, KnobSliderDirective],
  template: `
    <section class="demo">
      <h2 class="demo-title">Knobs</h2>
      <p class="demo-caption">
        Stylesheet classes (cfg / knobs-panel / knobs-section …) + KnobToggle, KnobSegment,
        KnobSlider.
      </p>

      <div class="cfg">
        <div class="knobs-panel">
          <div class="knobs-section">
            <div class="knobs-toggle-row">
              <span class="knobs-section-label">Seconds hand</span>
              <button
                appKnobToggle
                [on]="seconds()"
                [attr.aria-label]="seconds() ? 'Seconds hand on' : 'Seconds hand off'"
                (toggled)="seconds.set(!seconds())"
              ></button>
            </div>
            <div class="knobs-pair">
              <div class="knobs-cell">
                <span class="knobs-section-label">Ticks</span>
                <button
                  appKnobToggle
                  [on]="ticks()"
                  [attr.aria-label]="ticks() ? 'Ticks on' : 'Ticks off'"
                  (toggled)="ticks.set(!ticks())"
                ></button>
              </div>
              <div class="knobs-cell">
                <span class="knobs-section-label">Numerals</span>
                <button
                  appKnobToggle
                  [on]="numerals()"
                  [attr.aria-label]="numerals() ? 'Numerals on' : 'Numerals off'"
                  (toggled)="numerals.set(!numerals())"
                ></button>
              </div>
            </div>
          </div>

          <div class="knobs-section">
            <div class="knobs-segment-row">
              <span class="knobs-section-label">Bar mode</span>
              <app-knob-segment
                segmentLabel="Bar mode"
                [options]="barModes"
                [selection]="barMode()"
                (changed)="barMode.set($event)"
              />
            </div>
          </div>

          <div class="knobs-section">
            <span class="knobs-section-label">Dial</span>
            <div class="knobs-row">
              <span class="knobs-row-label">Size</span>
              <input
                type="range"
                appKnobSlider
                min="0"
                max="100"
                [value]="size()"
                aria-label="Size"
                (input)="size.set($any($event.target).valueAsNumber)"
              />
              <span class="knobs-row-value">{{ size() }}%</span>
            </div>
          </div>
        </div>
      </div>
    </section>
  `,
})
export class KnobsSectionComponent {
  readonly seconds = signal(true);
  readonly ticks = signal(true);
  readonly numerals = signal(false);
  readonly barMode = signal('bars');
  readonly size = signal(60);
  readonly barModes: KnobSegmentOption[] = [
    { value: 'off', label: 'Off' },
    { value: 'bars', label: 'Bars' },
    { value: 'dots', label: 'Dots' },
  ];
}
