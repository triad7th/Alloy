import { Injectable, signal } from '@angular/core';

export interface ConfirmOptions {
  title: string;
  message?: string;
  /** Confirm button label; default 'OK'. */
  confirmLabel?: string;
  /** Cancel button label; default 'Cancel'. */
  cancelLabel?: string;
  /** Styles the confirm button as destructive (red). */
  destructive?: boolean;
}

export interface AlertOptions {
  title: string;
  message?: string;
  /** OK button label; default 'OK'. */
  okLabel?: string;
}

interface PendingDialog {
  kind: 'confirm' | 'alert';
  title: string;
  message: string | null;
  confirmLabel: string;
  /** null → no cancel button (alert). */
  cancelLabel: string | null;
  destructive: boolean;
  resolve: (confirmed: boolean) => void;
}

/**
 * Imperative confirm/alert dialogs. Apps call `confirm()`/`alert()` from
 * anywhere; the visual lives in DialogHostComponent (placed once via
 * <app-overlays>). One dialog shows at a time; concurrent calls queue
 * sequentially in call order.
 */
@Injectable({ providedIn: 'root' })
export class AlloyDialog {
  private readonly queue: PendingDialog[] = [];

  /** Dialog currently on screen; the host template renders from this. */
  readonly current = signal<PendingDialog | null>(null);

  confirm(opts: ConfirmOptions): Promise<boolean> {
    return new Promise((resolve) => {
      this.enqueue({
        kind: 'confirm',
        title: opts.title,
        message: opts.message ?? null,
        confirmLabel: opts.confirmLabel ?? 'OK',
        cancelLabel: opts.cancelLabel ?? 'Cancel',
        destructive: opts.destructive ?? false,
        resolve,
      });
    });
  }

  alert(opts: AlertOptions): Promise<void> {
    return new Promise((resolve) => {
      this.enqueue({
        kind: 'alert',
        title: opts.title,
        message: opts.message ?? null,
        confirmLabel: opts.okLabel ?? 'OK',
        cancelLabel: null,
        destructive: false,
        resolve: () => resolve(),
      });
    });
  }

  /** Host hook: settle the on-screen dialog (no-op when idle) and advance the queue. */
  settle(confirmed: boolean): void {
    const dialog = this.current();
    if (!dialog) return;
    this.current.set(null);
    dialog.resolve(confirmed);
    this.advance();
  }

  private enqueue(dialog: PendingDialog): void {
    this.queue.push(dialog);
    if (!this.current()) this.advance();
  }

  private advance(): void {
    this.current.set(this.queue.shift() ?? null);
  }
}
