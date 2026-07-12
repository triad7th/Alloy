import { describe, it, expect } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { AlloyDialog } from './dialog.service';

describe('AlloyDialog', () => {
  function service(): AlloyDialog {
    return TestBed.inject(AlloyDialog);
  }

  it('confirm() resolves true/false via settle()', async () => {
    const dialog = service();
    const first = dialog.confirm({ title: 'Delete?' });
    expect(dialog.current()?.title).toBe('Delete?');
    dialog.settle(true);
    await expect(first).resolves.toBe(true);

    const second = dialog.confirm({ title: 'Again?' });
    dialog.settle(false);
    await expect(second).resolves.toBe(false);
    expect(dialog.current()).toBeNull();
  });

  it('applies confirm defaults and passes overrides through', () => {
    const dialog = service();
    void dialog.confirm({ title: 'Delete?' });
    expect(dialog.current()).toMatchObject({
      kind: 'confirm',
      message: null,
      confirmLabel: 'OK',
      cancelLabel: 'Cancel',
      destructive: false,
    });
    dialog.settle(false);

    void dialog.confirm({
      title: 'Delete score?',
      message: 'This cannot be undone.',
      confirmLabel: 'Delete',
      cancelLabel: 'Keep',
      destructive: true,
    });
    expect(dialog.current()).toMatchObject({
      message: 'This cannot be undone.',
      confirmLabel: 'Delete',
      cancelLabel: 'Keep',
      destructive: true,
    });
    dialog.settle(false);
  });

  it('alert() resolves void on settle and has no cancel label', async () => {
    const dialog = service();
    const alerted = dialog.alert({ title: 'Heads up' });
    expect(dialog.current()).toMatchObject({ kind: 'alert', cancelLabel: null, confirmLabel: 'OK' });
    dialog.settle(true);
    await expect(alerted).resolves.toBeUndefined();
  });

  it('queues concurrent dialogs sequentially in call order', async () => {
    const dialog = service();
    const first = dialog.confirm({ title: 'one' });
    const second = dialog.confirm({ title: 'two' });
    expect(dialog.current()?.title).toBe('one');
    dialog.settle(true);
    await expect(first).resolves.toBe(true);
    expect(dialog.current()?.title).toBe('two');
    dialog.settle(false);
    await expect(second).resolves.toBe(false);
    expect(dialog.current()).toBeNull();
  });

  it('settle() when idle is a no-op', () => {
    const dialog = service();
    expect(() => dialog.settle(true)).not.toThrow();
  });
});
