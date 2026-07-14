import { ChangeDetectionStrategy, Component } from '@angular/core';
import { OverlaysComponent } from '@allyworld/alloy-ui';
import { IconsSectionComponent } from './sections/icons-section.component';
import { KnobsSectionComponent } from './sections/knobs-section.component';
import { ZonesSectionComponent } from './sections/zones-section.component';
import { SynthSectionComponent } from './sections/synth-section.component';
import { RomplerSectionComponent } from './sections/rompler-section.component';
import { StorageSectionComponent } from './sections/storage-section.component';
import { OverlaysSectionComponent } from './sections/overlays-section.component';
import { FormsSectionComponent } from './sections/forms-section.component';

@Component({
  selector: 'hx-root',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    IconsSectionComponent,
    KnobsSectionComponent,
    ZonesSectionComponent,
    SynthSectionComponent,
    RomplerSectionComponent,
    StorageSectionComponent,
    OverlaysComponent,
    OverlaysSectionComponent,
    FormsSectionComponent,
  ],
  template: `
    <main class="harness">
      <header>
        <h1 class="harness-title">Alloy web harness</h1>
        <p class="harness-subtitle">
          alloy-ui + alloy-time + alloy-audio + alloy-storage, consumed from source. Private;
          never packed or released.
        </p>
      </header>
      <hx-icons-section />
      <hx-knobs-section />
      <hx-zones-section />
      <hx-synth-section />
      <hx-rompler-section />
      <hx-storage-section />
      <hx-overlays-section />
      <hx-forms-section />
    </main>
    <app-overlays />
  `,
})
export class AppComponent {}
