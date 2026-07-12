import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { AlloySnackbar } from './snackbar.service';

describe('AlloySnackbar', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  function service(): AlloySnackbar {
    return TestBed.inject(AlloySnackbar);
  }

  it('shows immediately when idle and resolves timeout after the duration', async () => {
    const snackbar = service();
    const closed = snackbar.show('Saved', { durationMs: 1000 });
    expect(snackbar.current()?.message).toBe('Saved');
    vi.advanceTimersByTime(1000);
    await expect(closed).resolves.toBe('timeout');
    expect(snackbar.current()).toBeNull();
  });

  it('defaults the duration to the snackbar-show token (4000ms)', async () => {
    const snackbar = service();
    const closed = snackbar.show('Saved');
    vi.advanceTimersByTime(3999);
    expect(snackbar.current()).not.toBeNull();
    vi.advanceTimersByTime(1);
    await expect(closed).resolves.toBe('timeout');
  });

  it('queues FIFO behind the current snack', async () => {
    const snackbar = service();
    const first = snackbar.show('one', { durationMs: 1000 });
    const second = snackbar.show('two', { durationMs: 1000 });
    expect(snackbar.current()?.message).toBe('one');
    vi.advanceTimersByTime(1000);
    await expect(first).resolves.toBe('timeout');
    expect(snackbar.current()?.message).toBe('two');
    vi.advanceTimersByTime(1000);
    await expect(second).resolves.toBe('timeout');
    expect(snackbar.current()).toBeNull();
  });

  it('resolves "dismissed" on dismiss() and advances the queue', async () => {
    const snackbar = service();
    const first = snackbar.show('one', { durationMs: 1000 });
    snackbar.show('two', { durationMs: 1000 });
    snackbar.dismiss();
    await expect(first).resolves.toBe('dismissed');
    expect(snackbar.current()?.message).toBe('two');
  });

  it('resolves "action" when the action fires', async () => {
    const snackbar = service();
    const closed = snackbar.show('Deleted', { durationMs: 1000, actionLabel: 'Undo' });
    expect(snackbar.current()?.actionLabel).toBe('Undo');
    snackbar.action();
    await expect(closed).resolves.toBe('action');
  });

  it('dismiss() when idle is a no-op', () => {
    const snackbar = service();
    expect(() => snackbar.dismiss()).not.toThrow();
    expect(snackbar.current()).toBeNull();
  });

  it('pause() stops the clock and resume() continues from the remainder', async () => {
    const snackbar = service();
    const closed = snackbar.show('Saved', { durationMs: 1000 });
    vi.advanceTimersByTime(600);
    snackbar.pause();
    vi.advanceTimersByTime(5000); // paused — must not close
    expect(snackbar.current()).not.toBeNull();
    snackbar.resume();
    vi.advanceTimersByTime(399);
    expect(snackbar.current()).not.toBeNull();
    vi.advanceTimersByTime(1);
    await expect(closed).resolves.toBe('timeout');
  });
});
