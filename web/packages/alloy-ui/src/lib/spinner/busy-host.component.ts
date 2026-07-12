import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  effect,
  inject,
  viewChild,
} from '@angular/core';
import { AlloyBusy } from './busy.service';
import { SpinnerComponent } from './spinner.component';

/**
 * Visual outlet for AlloyBusy. Placed once per app (via <app-overlays>);
 * renders nothing while idle. Uses a native <dialog> opened with showModal()
 * so the platform blocks pointer and keyboard interaction behind it; the
 * cancel event (Esc) is suppressed — only release() ends the busy state.
 */
@Component({
  selector: 'app-busy-host',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [SpinnerComponent],
  template: `
    @if (busy.active()) {
      <dialog
        #panel
        class="busy"
        animate.leave="busy-leave"
        aria-busy="true"
        aria-label="Busy"
        (cancel)="$event.preventDefault()"
      >
        <app-spinner [size]="32" />
        @if (busy.label(); as label) {
          <p class="busy-label">{{ label }}</p>
        }
      </dialog>
    }
  `,
  styleUrl: './busy-host.component.scss',
})
export class BusyHostComponent {
  protected readonly busy = inject(AlloyBusy);
  private readonly panel = viewChild<ElementRef<HTMLDialogElement>>('panel');

  constructor() {
    effect(() => {
      const el = this.panel()?.nativeElement;
      if (el && this.busy.active() && !el.open) {
        // jsdom guard: fall back to the open attribute where showModal is missing.
        if (typeof el.showModal === 'function') el.showModal();
        else el.setAttribute('open', '');
      }
    });
  }
}
