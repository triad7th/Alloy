import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { AlloySnackbar } from './snackbar.service';
import { SnackbarHostComponent } from './snackbar-host.component';

describe('SnackbarHostComponent', () => {
  beforeEach(async () => {
    vi.useFakeTimers();
    await TestBed.configureTestingModule({
      imports: [SnackbarHostComponent],
    }).compileComponents();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('keeps a permanent polite status region and renders nothing while idle', () => {
    const fixture = TestBed.createComponent(SnackbarHostComponent);
    fixture.detectChanges();
    const host = fixture.nativeElement as HTMLElement;
    const region = host.querySelector('.snack-region');
    expect(region?.getAttribute('role')).toBe('status');
    expect(region?.getAttribute('aria-live')).toBe('polite');
    expect(host.querySelector('.snack')).toBeNull();
  });

  it('renders the current snack message', () => {
    const snackbar = TestBed.inject(AlloySnackbar);
    const fixture = TestBed.createComponent(SnackbarHostComponent);
    fixture.detectChanges();
    void snackbar.show('Saved');
    fixture.detectChanges();
    const host = fixture.nativeElement as HTMLElement;
    expect(host.querySelector('.snack-message')?.textContent).toContain('Saved');
    expect(host.querySelector('button.snack-action')).toBeNull();
  });

  it('renders the action button and resolves show() with "action" on click', async () => {
    const snackbar = TestBed.inject(AlloySnackbar);
    const fixture = TestBed.createComponent(SnackbarHostComponent);
    fixture.detectChanges();
    const closed = snackbar.show('Deleted', { actionLabel: 'Undo' });
    fixture.detectChanges();
    const button = (fixture.nativeElement as HTMLElement).querySelector(
      'button.snack-action',
    ) as HTMLButtonElement;
    expect(button.textContent).toContain('Undo');
    button.click();
    await expect(closed).resolves.toBe('action');
  });

  it('pauses the timer on mouseenter and resumes on mouseleave', () => {
    const snackbar = TestBed.inject(AlloySnackbar);
    const fixture = TestBed.createComponent(SnackbarHostComponent);
    fixture.detectChanges();
    void snackbar.show('Saved', { durationMs: 1000 });
    fixture.detectChanges();
    const snack = (fixture.nativeElement as HTMLElement).querySelector('.snack') as HTMLElement;
    snack.dispatchEvent(new Event('mouseenter'));
    vi.advanceTimersByTime(5000);
    expect(snackbar.current()).not.toBeNull();
    snack.dispatchEvent(new Event('mouseleave'));
    vi.advanceTimersByTime(1000);
    expect(snackbar.current()).toBeNull();
  });

  it('keeps a queued snack paused when it advances under a stationary pointer', () => {
    const snackbar = TestBed.inject(AlloySnackbar);
    const fixture = TestBed.createComponent(SnackbarHostComponent);
    fixture.detectChanges();
    // Two snacks queued; the first carries an action so we can close it by click.
    void snackbar.show('one', { durationMs: 1000, actionLabel: 'Undo' });
    void snackbar.show('two', { durationMs: 1000 });
    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    const snack = host.querySelector('.snack') as HTMLElement;
    snack.dispatchEvent(new Event('mouseenter')); // pointer over snack "one"
    const action = host.querySelector('button.snack-action') as HTMLButtonElement;
    action.click(); // close "one" -> "two" advances into the SAME element, no mouseenter fires
    fixture.detectChanges();
    expect(snackbar.current()?.message).toBe('two');

    // Pointer is still over the snack, so "two" must not time out.
    vi.advanceTimersByTime(5000);
    expect(snackbar.current()?.message).toBe('two');

    // Pointer leaves -> "two" resumes its countdown and closes.
    snack.dispatchEvent(new Event('mouseleave'));
    vi.advanceTimersByTime(1000);
    expect(snackbar.current()).toBeNull();
  });
});
