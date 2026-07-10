import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { SheetComponent } from './sheet.component';
import { SHEET_ANIMATION_MS } from '../tokens';

describe('SheetComponent', () => {
  beforeEach(async () => {
    vi.useFakeTimers();
    await TestBed.configureTestingModule({
      imports: [SheetComponent],
    }).compileComponents();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function createSheet(
    inputs: {
      backdrop?: boolean;
      fullHeight?: boolean;
      sheetLabel?: string;
      contained?: boolean;
      maxWidth?: number;
    } = {},
  ) {
    const fixture = TestBed.createComponent(SheetComponent);
    if (inputs.backdrop !== undefined) fixture.componentRef.setInput('backdrop', inputs.backdrop);
    if (inputs.fullHeight !== undefined)
      fixture.componentRef.setInput('fullHeight', inputs.fullHeight);
    if (inputs.sheetLabel !== undefined)
      fixture.componentRef.setInput('sheetLabel', inputs.sheetLabel);
    if (inputs.contained !== undefined)
      fixture.componentRef.setInput('contained', inputs.contained);
    if (inputs.maxWidth !== undefined) fixture.componentRef.setInput('maxWidth', inputs.maxWidth);
    fixture.detectChanges();
    return fixture;
  }

  it('opening renders the panel and the backdrop by default', () => {
    const fixture = createSheet();
    const host = fixture.nativeElement as HTMLElement;
    expect(host.querySelector('.sheet-panel')).not.toBeNull();
    expect(host.querySelector('.sheet-backdrop')).not.toBeNull();
  });

  it('omits the backdrop when [backdrop]=false', () => {
    const fixture = createSheet({ backdrop: false });
    const host = fixture.nativeElement as HTMLElement;
    expect(host.querySelector('.sheet-panel')).not.toBeNull();
    expect(host.querySelector('.sheet-backdrop')).toBeNull();
  });

  it('exposes the sheet label as the dialog aria-label', () => {
    const fixture = createSheet({ sheetLabel: 'Choose a clock face' });
    const panel = (fixture.nativeElement as HTMLElement).querySelector('.sheet-panel');
    expect(panel?.getAttribute('aria-label')).toBe('Choose a clock face');
  });

  it('adds the full-height class to the panel when [fullHeight]=true', () => {
    const fixture = createSheet({ fullHeight: true });
    const panel = (fixture.nativeElement as HTMLElement).querySelector('.sheet-panel');
    expect(panel?.classList.contains('full-height')).toBe(true);
  });

  // Face-embedded sheets render inside `.screens-strip`, which is `transform`ed
  // for paging. A transformed ancestor is the containing block for `position:
  // fixed` descendants, so a viewport-fixed overlay lands off-screen on any
  // screen past the first. `contained` positions the overlay relative to the
  // screen cell instead. Default stays viewport-fixed for app-level sheets.
  it('does not mark the overlay contained by default', () => {
    const fixture = createSheet();
    const overlay = (fixture.nativeElement as HTMLElement).querySelector('.sheet-overlay');
    expect(overlay?.classList.contains('contained')).toBe(false);
  });

  it('marks the overlay contained when [contained]=true', () => {
    const fixture = createSheet({ contained: true });
    const overlay = (fixture.nativeElement as HTMLElement).querySelector('.sheet-overlay');
    expect(overlay?.classList.contains('contained')).toBe(true);
  });

  it('leaves the panel unconstrained by default', () => {
    const fixture = createSheet();
    const panel = (fixture.nativeElement as HTMLElement).querySelector(
      '.sheet-panel',
    ) as HTMLElement;
    expect(panel.style.maxWidth).toBe('');
  });

  it('constrains and centers the panel when [maxWidth] is set', () => {
    const fixture = createSheet({ maxWidth: 480 });
    const panel = (fixture.nativeElement as HTMLElement).querySelector(
      '.sheet-panel',
    ) as HTMLElement;
    expect(panel.style.maxWidth).toBe('480px');
  });

  it('close() emits (closed) only after SHEET_ANIMATION_MS', () => {
    const fixture = createSheet();
    let closed = false;
    fixture.componentInstance.closed.subscribe(() => {
      closed = true;
    });

    fixture.componentInstance.close();
    fixture.detectChanges();
    expect(
      (fixture.nativeElement.querySelector('.sheet-overlay') as HTMLElement).classList.contains(
        'closing',
      ),
    ).toBe(true);
    expect(closed).toBe(false);

    vi.advanceTimersByTime(SHEET_ANIMATION_MS - 1);
    expect(closed).toBe(false);

    vi.advanceTimersByTime(1);
    expect(closed).toBe(true);
  });

  it('emits (closed) once even when close() is called repeatedly', () => {
    const fixture = createSheet();
    let count = 0;
    fixture.componentInstance.closed.subscribe(() => {
      count += 1;
    });

    fixture.componentInstance.close();
    fixture.componentInstance.close();
    vi.advanceTimersByTime(SHEET_ANIMATION_MS);
    expect(count).toBe(1);
  });

  it('closes when the backdrop is clicked', () => {
    const fixture = createSheet();
    let closed = false;
    fixture.componentInstance.closed.subscribe(() => {
      closed = true;
    });

    (fixture.nativeElement.querySelector('.sheet-backdrop') as HTMLElement).click();
    expect(closed).toBe(false);
    vi.advanceTimersByTime(SHEET_ANIMATION_MS);
    expect(closed).toBe(true);
  });

  it('closes on Escape', () => {
    const fixture = createSheet();
    let closed = false;
    fixture.componentInstance.closed.subscribe(() => {
      closed = true;
    });

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    vi.advanceTimersByTime(SHEET_ANIMATION_MS);
    expect(closed).toBe(true);
  });
});
