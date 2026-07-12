import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { AlloyBusy, AlloyDialog, AlloySnackbar, SpinnerComponent } from '@allyworld/alloy-ui';

@Component({
  selector: 'hx-overlays-section',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [SpinnerComponent],
  template: `
    <section class="section">
      <h2>Overlays</h2>
      <div class="row">
        <button type="button" (click)="toast()">Snackbar</button>
        <button type="button" (click)="undoable()">Snackbar + Undo</button>
        <button type="button" (click)="stack()">Queue 3 snacks</button>
        <button type="button" (click)="confirmPlain()">Confirm</button>
        <button type="button" (click)="confirmDestructive()">Destructive confirm</button>
        <button type="button" (click)="alertDemo()">Alert</button>
        <button type="button" (click)="busyDemo()">Busy (2s)</button>
      </div>
      <div class="row">
        <app-spinner [size]="16" />
        <app-spinner />
        <app-spinner [size]="32" style="color: #0a84ff" />
      </div>
      <p>last result: {{ last() }}</p>
    </section>
  `,
})
export class OverlaysSectionComponent {
  private readonly snackbar = inject(AlloySnackbar);
  private readonly dialog = inject(AlloyDialog);
  private readonly busy = inject(AlloyBusy);
  protected readonly last = signal('—');

  protected async toast(): Promise<void> {
    this.last.set(`snackbar: ${await this.snackbar.show('Saved')}`);
  }

  protected async undoable(): Promise<void> {
    const reason = await this.snackbar.show('Score deleted', { actionLabel: 'Undo' });
    this.last.set(reason === 'action' ? 'undo clicked' : `snackbar: ${reason}`);
  }

  protected stack(): void {
    void this.snackbar.show('First', { durationMs: 1500 });
    void this.snackbar.show('Second', { durationMs: 1500 });
    void this.snackbar.show('Third', { durationMs: 1500 });
  }

  protected async confirmPlain(): Promise<void> {
    this.last.set(`confirm: ${await this.dialog.confirm({ title: 'Apply changes?' })}`);
  }

  protected async confirmDestructive(): Promise<void> {
    const ok = await this.dialog.confirm({
      title: 'Delete score?',
      message: 'This cannot be undone.',
      confirmLabel: 'Delete',
      destructive: true,
    });
    this.last.set(`destructive confirm: ${ok}`);
  }

  protected async alertDemo(): Promise<void> {
    await this.dialog.alert({ title: 'Export finished', message: 'Saved to Drive.' });
    this.last.set('alert dismissed');
  }

  protected async busyDemo(): Promise<void> {
    await this.busy.while(new Promise((r) => setTimeout(r, 2000)), 'Working…');
    this.last.set('busy finished');
  }
}
