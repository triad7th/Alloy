import { describe, it, expect, beforeEach } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { AlloyDialog } from './dialog.service';
import { DialogHostComponent } from './dialog-host.component';

describe('DialogHostComponent', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [DialogHostComponent],
    }).compileComponents();
  });

  function setup() {
    const dialog = TestBed.inject(AlloyDialog);
    const fixture = TestBed.createComponent(DialogHostComponent);
    fixture.detectChanges();
    const host = fixture.nativeElement as HTMLElement;
    return { dialog, fixture, host };
  }

  it('renders nothing while idle', () => {
    const { host } = setup();
    expect(host.querySelector('dialog.dialog')).toBeNull();
  });

  it('renders title, message, and both buttons for confirm; confirm click resolves true', async () => {
    const { dialog, fixture, host } = setup();
    const confirmed = dialog.confirm({ title: 'Delete score?', message: 'This cannot be undone.' });
    fixture.detectChanges();
    expect(host.querySelector('.dialog-title')?.textContent).toContain('Delete score?');
    expect(host.querySelector('.dialog-message')?.textContent).toContain('This cannot be undone.');
    const buttons = host.querySelectorAll('button.dialog-button');
    expect(buttons.length).toBe(2);
    expect(buttons[0].textContent).toContain('Cancel');
    expect(buttons[1].textContent).toContain('OK');
    (buttons[1] as HTMLButtonElement).click();
    await expect(confirmed).resolves.toBe(true);
    fixture.detectChanges();
    expect(host.querySelector('dialog.dialog')).toBeNull();
  });

  it('cancel click resolves false', async () => {
    const { dialog, fixture, host } = setup();
    const confirmed = dialog.confirm({ title: 'Delete?' });
    fixture.detectChanges();
    const cancel = host.querySelector('button.dialog-button') as HTMLButtonElement;
    cancel.click();
    await expect(confirmed).resolves.toBe(false);
  });

  it('marks the confirm button destructive when asked', () => {
    const { dialog, fixture, host } = setup();
    void dialog.confirm({ title: 'Delete?', destructive: true, confirmLabel: 'Delete' });
    fixture.detectChanges();
    const confirmButton = host.querySelector('button.dialog-button.confirm');
    expect(confirmButton?.classList.contains('destructive')).toBe(true);
  });

  it('native cancel (Esc) resolves confirm to false', async () => {
    const { dialog, fixture, host } = setup();
    const confirmed = dialog.confirm({ title: 'Delete?' });
    fixture.detectChanges();
    const panel = host.querySelector('dialog.dialog') as HTMLDialogElement;
    panel.dispatchEvent(new Event('cancel', { cancelable: true }));
    await expect(confirmed).resolves.toBe(false);
  });

  it('backdrop click (target = dialog element) resolves confirm to false', async () => {
    const { dialog, fixture, host } = setup();
    const confirmed = dialog.confirm({ title: 'Delete?' });
    fixture.detectChanges();
    const panel = host.querySelector('dialog.dialog') as HTMLDialogElement;
    panel.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await expect(confirmed).resolves.toBe(false);
  });

  it('clicks inside the panel body do not settle the dialog', () => {
    const { dialog, fixture, host } = setup();
    void dialog.confirm({ title: 'Delete?' });
    fixture.detectChanges();
    const title = host.querySelector('.dialog-title') as HTMLElement;
    title.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    fixture.detectChanges();
    expect(host.querySelector('dialog.dialog')).not.toBeNull();
  });

  it('alert renders a single OK button that resolves void', async () => {
    const { dialog, fixture, host } = setup();
    const alerted = dialog.alert({ title: 'Heads up' });
    fixture.detectChanges();
    const buttons = host.querySelectorAll('button.dialog-button');
    expect(buttons.length).toBe(1);
    (buttons[0] as HTMLButtonElement).click();
    await expect(alerted).resolves.toBeUndefined();
  });

  it('wires aria-labelledby to the title element', () => {
    const { dialog, fixture, host } = setup();
    void dialog.confirm({ title: 'Delete?' });
    fixture.detectChanges();
    const panel = host.querySelector('dialog.dialog');
    const labelledby = panel?.getAttribute('aria-labelledby');
    expect(labelledby).toBeTruthy();
    expect(host.querySelector(`#${labelledby}`)?.textContent).toContain('Delete?');
  });

  it('shows the next queued dialog after the first settles', async () => {
    const { dialog, fixture, host } = setup();
    const first = dialog.confirm({ title: 'one' });
    void dialog.confirm({ title: 'two' });
    fixture.detectChanges();
    expect(host.querySelector('.dialog-title')?.textContent).toContain('one');
    const buttons = host.querySelectorAll('button.dialog-button');
    (buttons[1] as HTMLButtonElement).click();
    await first;
    fixture.detectChanges();
    expect(host.querySelector('.dialog-title')?.textContent).toContain('two');
  });

  it('focuses the first (safe) dialog-button on initial open', () => {
    const { dialog, fixture, host } = setup();
    void dialog.confirm({ title: 'Delete?', destructive: true, confirmLabel: 'Delete' });
    fixture.detectChanges();
    const buttons = host.querySelectorAll('button.dialog-button');
    expect(document.activeElement).toBe(buttons[0]);
  });

  it('moves focus to the new active dialog’s safe action when a queued dialog advances', async () => {
    const { dialog, fixture, host } = setup();
    const first = dialog.confirm({ title: 'one' });
    void dialog.confirm({ title: 'two', destructive: true, confirmLabel: 'Delete' });
    fixture.detectChanges();
    const firstButtons = host.querySelectorAll('button.dialog-button');
    // Click dialog A's confirm button (simulating a reflexive click/Enter on OK).
    (firstButtons[1] as HTMLButtonElement).click();
    await first;
    fixture.detectChanges();
    const secondButtons = host.querySelectorAll('button.dialog-button');
    expect(host.querySelector('.dialog-title')?.textContent).toContain('two');
    // Focus must land on dialog B's first button (its Cancel), never its destructive confirm.
    expect(document.activeElement).toBe(secondButtons[0]);
    expect(document.activeElement).not.toBe(secondButtons[1]);
  });
});
