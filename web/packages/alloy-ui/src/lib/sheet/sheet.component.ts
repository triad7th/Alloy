import { ChangeDetectionStrategy, Component, OnDestroy, input, output, signal } from '@angular/core';
import { SHEET_ANIMATION_MS } from '../tokens';

/**
 * iOS bottom-sheet chrome + lifecycle.
 *
 * Owns the dimming backdrop, the rounded panel, the grab handle, and the
 * enter/exit animation. Hosts render `<app-sheet>` (usually under their own
 * `@if open`), project their content into it, and route their own close
 * actions through `close()` after running side-effects. Backdrop click and
 * Escape are handled here and surface to the host only as `(closed)`, which
 * fires once, after the exit animation completes.
 */
@Component({
  selector: 'app-sheet',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './sheet.component.html',
  styleUrl: './sheet.component.scss',
  host: {
    '(document:keydown.escape)': 'close()',
  },
})
export class SheetComponent implements OnDestroy {
  /** Render a dimming backdrop behind the panel. */
  readonly backdrop = input(true);
  /** Panel fills the viewport (content scrolls) vs anchored to the bottom. */
  readonly fullHeight = input(false);
  /**
   * Position the overlay relative to the nearest positioned ancestor instead
   * of the viewport. Face-embedded sheets set this because they render inside
   * the paging strip, whose `transform` makes it the containing block for
   * `position: fixed` — a viewport-fixed overlay would land off-screen on any
   * screen past the first. App-level sheets leave it false (viewport-fixed).
   */
  readonly contained = input(false);
  /** aria-label for the dialog. */
  readonly sheetLabel = input<string>('');

  /** Emitted once, after the exit animation completes. */
  readonly closed = output<void>();

  /** Drives the reverse slide-down + backdrop fade-out keyframes. */
  readonly closing = signal(false);

  private closeTimer: ReturnType<typeof setTimeout> | undefined;

  ngOnDestroy(): void {
    clearTimeout(this.closeTimer);
  }

  /**
   * Start the exit animation, then emit `closed()` once it finishes.
   * Idempotent: re-entry while already closing is ignored.
   */
  close(): void {
    if (this.closing()) return;
    this.closing.set(true);
    clearTimeout(this.closeTimer);
    this.closeTimer = setTimeout(() => this.closed.emit(), SHEET_ANIMATION_MS);
  }
}
