import { ChangeDetectionStrategy, Component } from '@angular/core';
import {
  AlloyIconName,
  IconButtonComponent,
  IconComponent,
  NavHeaderComponent,
} from '@allyworld/alloy-ui';

/** Section 1: the SF-named icon registry, icon buttons, and the nav header. */
@Component({
  selector: 'hx-icons-section',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IconComponent, IconButtonComponent, NavHeaderComponent],
  template: `
    <section class="demo">
      <h2 class="demo-title">Icons &amp; buttons</h2>

      <div class="icon-row">
        @for (name of icons; track name) {
          <span class="icon-chip">
            <app-icon [name]="name" />
            <span class="icon-name">{{ name }}</span>
          </span>
        }
      </div>

      <div class="button-row">
        <app-icon-button icon="gearshape" label="Settings" />
        <app-icon-button icon="plus" variant="primary" label="Add" />
        <app-icon-button icon="trash" variant="destructive" label="Delete" />
        <app-icon-button icon="square.and.arrow.up" label="Share" />
      </div>

      <div class="nav-demo">
        <app-nav-header title="Alloy Harness">
          <app-icon-button navLeading icon="chevron.left" label="Back" />
          <app-icon-button navTrailing icon="clock.arrow.circlepath" label="Time Machine" />
          <app-icon-button navTrailing icon="gearshape" label="Settings" />
        </app-nav-header>
      </div>
    </section>
  `,
  styles: `
    .icon-row {
      display: flex;
      flex-wrap: wrap;
      gap: 0.75rem;
    }
    .icon-chip {
      display: inline-flex;
      align-items: center;
      gap: 0.45rem;
      background: rgba(255, 255, 255, 0.04);
      border-radius: 8px;
      padding: 0.45rem 0.7rem;
      font-size: 1.2rem;
    }
    .icon-name {
      font-size: 0.7rem;
      color: #98989e;
      font-family: ui-monospace, monospace;
    }
    .button-row {
      display: flex;
      gap: 0.75rem;
    }
    .nav-demo {
      background: rgba(255, 255, 255, 0.04);
      border-radius: 12px;
      padding: 0.6rem 0;
    }
  `,
})
export class IconsSectionComponent {
  readonly icons: AlloyIconName[] = [
    'gearshape',
    'clock',
    'globe',
    'checkmark',
    'pencil',
    'plus',
    'trash',
    'xmark',
    'arrow.clockwise',
    'clock.arrow.circlepath',
    'slider.horizontal.3',
    'square.grid.2x2',
  ];
}
