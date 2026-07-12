import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { AlloySnackbar } from './snackbar.service';

/**
 * Visual outlet for AlloySnackbar. Placed once per app (via <app-overlays>).
 * The status region stays in the DOM permanently so screen readers announce
 * snack content when it appears; the snack itself renders only while shown.
 */
@Component({
  selector: 'app-snackbar-host',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="snack-region" role="status" aria-live="polite">
      @if (snackbar.current(); as snack) {
        <div class="snack" (mouseenter)="snackbar.pause()" (mouseleave)="snackbar.resume()">
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
}
