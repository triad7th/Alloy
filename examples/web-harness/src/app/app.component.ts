import { ChangeDetectionStrategy, Component } from '@angular/core';
import { IconsSectionComponent } from './sections/icons-section.component';
import { KnobsSectionComponent } from './sections/knobs-section.component';
import { ZonesSectionComponent } from './sections/zones-section.component';
import { SynthSectionComponent } from './sections/synth-section.component';

@Component({
  selector: 'hx-root',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    IconsSectionComponent,
    KnobsSectionComponent,
    ZonesSectionComponent,
    SynthSectionComponent,
  ],
  template: `
    <main class="harness">
      <header>
        <h1 class="harness-title">Alloy web harness</h1>
        <p class="harness-subtitle">
          alloy-ui + alloy-time + alloy-audio, consumed from source. Private; never packed or
          released.
        </p>
      </header>
      <hx-icons-section />
      <hx-knobs-section />
      <hx-zones-section />
      <hx-synth-section />
    </main>
  `,
})
export class AppComponent {}
