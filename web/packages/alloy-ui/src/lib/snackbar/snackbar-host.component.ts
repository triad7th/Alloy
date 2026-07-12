import { ChangeDetectionStrategy, Component, effect, inject } from '@angular/core';
import { AlloySnackbar } from './snackbar.service';

/**
 * Visual outlet for AlloySnackbar. Placed once per app (via <app-overlays>).
 * The status region stays in the DOM permanently so screen readers announce
 * snack content when it appears; the snack itself renders only while shown.
 *
 * `animate.leave` fades the snack out on removal (the exit twin of the
 * `snack-enter` keyframe); a queued snack replaces the current one in the same
 * element, so the leave only fires when the queue drains to empty.
 */
@Component({
  selector: 'app-snackbar-host',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="snack-region" role="status" aria-live="polite">
      @if (snackbar.current(); as snack) {
        <div class="snack" animate.leave="snack-leave" (mouseenter)="onEnter()" (mouseleave)="onLeave()">
          <span class="snack-message">{{ snack.message }}</span>
          @if (snack.actionLabel) {
            <button type="button" class="snack-action" (click)="snackbar.action()">
              {{ snack.actionLabel }}
            </button>
          }
        </div>
      }
    </div>
  `,
  styleUrl: './snackbar-host.component.scss',
})
export class SnackbarHostComponent {
  protected readonly snackbar = inject(AlloySnackbar);

  /** Whether the pointer is currently over the snack. Plain field: read only
   * outside the reactive graph, so it never becomes an effect dependency. */
  private hovered = false;

  constructor() {
    // A queued snack advances into the SAME element, so no fresh mouseenter
    // fires. When the pointer is already over the snack at that moment,
    // re-assert the pause the incoming snack would otherwise miss.
    effect(() => {
      if (this.snackbar.current() && this.hovered) this.snackbar.pause();
    });
  }

  protected onEnter(): void {
    this.hovered = true;
    this.snackbar.pause();
  }

  protected onLeave(): void {
    this.hovered = false;
    this.snackbar.resume();
  }
}
