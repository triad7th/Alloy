import { Injectable, signal } from '@angular/core';
import { SNACKBAR_SHOW_MS } from '../tokens';

/** Why a snack closed — the resolution value of `show()`. */
export type SnackbarClose = 'timeout' | 'action' | 'dismissed';

export interface SnackbarOptions {
  /** Auto-hide delay; defaults to the snackbar-show token (4000ms). */
  durationMs?: number;
  /** Renders an action button (e.g. 'Undo'); clicking resolves show() with 'action'. */
  actionLabel?: string;
}

interface Snack {
  message: string;
  actionLabel: string | null;
  durationMs: number;
  resolve: (reason: SnackbarClose) => void;
}

/**
 * Imperative snackbar queue. Apps call `show()` from anywhere; the visual
 * lives in SnackbarHostComponent (placed once via <app-overlays>). One snack
 * shows at a time; further calls queue FIFO. The auto-hide timer pauses
 * while the pointer hovers the snack (host wires pause/resume).
 */
@Injectable({ providedIn: 'root' })
export class AlloySnackbar {
  private readonly queue: Snack[] = [];
  private timer: ReturnType<typeof setTimeout> | undefined;
  private remainingMs = 0;
  private startedAt = 0;

  /** Snack currently on screen; the host template renders from this. */
  readonly current = signal<Snack | null>(null);

  show(message: string, opts: SnackbarOptions = {}): Promise<SnackbarClose> {
    return new Promise((resolve) => {
      this.queue.push({
        message,
        actionLabel: opts.actionLabel ?? null,
        durationMs: opts.durationMs ?? SNACKBAR_SHOW_MS,
        resolve,
      });
      if (!this.current()) this.advance();
    });
  }

  /** Dismiss the current snack (no-op when idle) and advance the queue. */
  dismiss(): void {
    this.close('dismissed');
  }

  /** Host hook: the action button was clicked. */
  action(): void {
    this.close('action');
  }

  /** Host hook: pointer entered the snack — pause the auto-hide timer. */
  pause(): void {
    if (!this.current() || this.timer === undefined) return;
    clearTimeout(this.timer);
    this.timer = undefined;
    this.remainingMs -= Date.now() - this.startedAt;
  }

  /** Host hook: pointer left the snack — resume the auto-hide timer. */
  resume(): void {
    if (!this.current() || this.timer !== undefined) return;
    this.startTimer();
  }

  private close(reason: SnackbarClose): void {
    const snack = this.current();
    if (!snack) return;
    clearTimeout(this.timer);
    this.timer = undefined;
    this.current.set(null);
    snack.resolve(reason);
    this.advance();
  }

  private advance(): void {
    const next = this.queue.shift();
    if (!next) return;
    this.current.set(next);
    this.remainingMs = next.durationMs;
    this.startTimer();
  }

  private startTimer(): void {
    this.startedAt = Date.now();
    this.timer = setTimeout(() => this.close('timeout'), Math.max(0, this.remainingMs));
  }
}
