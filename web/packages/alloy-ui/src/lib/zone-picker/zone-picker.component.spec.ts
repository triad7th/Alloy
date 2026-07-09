import { describe, it, expect } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { ZonePickerComponent, ZonePickerOption } from './zone-picker.component';

const OPTIONS: ZonePickerOption[] = [
  { id: '', label: 'Follow Time Machine' },
  { id: 'Asia/Seoul', label: 'Asia/Seoul  +09:00' },
  { id: 'Asia/Tokyo', label: 'Asia/Tokyo  +09:00' },
];

function make(selectedId = '') {
  const fixture = TestBed.createComponent(ZonePickerComponent);
  fixture.componentRef.setInput('options', OPTIONS);
  fixture.componentRef.setInput('selectedId', selectedId);
  fixture.detectChanges();
  return fixture;
}

describe('ZonePickerComponent', () => {
  it('renders all options and marks the selected one active', () => {
    const fixture = make('Asia/Seoul');
    const active = fixture.nativeElement.querySelector('.zp-option.active') as HTMLElement;
    expect(active.textContent).toContain('Asia/Seoul');
  });

  it('filters by the full label (name + offset)', () => {
    const fixture = make();
    fixture.componentInstance.query.set('tokyo');
    fixture.detectChanges();
    const opts = fixture.nativeElement.querySelectorAll('.zp-option');
    expect(opts.length).toBe(1);
    expect((opts[0] as HTMLElement).textContent).toContain('Asia/Tokyo');
  });

  it('emits picked on tap', () => {
    const fixture = make();
    let picked = '';
    fixture.componentInstance.picked.subscribe((id: string) => (picked = id));
    (fixture.nativeElement.querySelector('[data-id="Asia/Seoul"]') as HTMLButtonElement).click();
    expect(picked).toBe('Asia/Seoul');
  });

  it('shows the empty state when nothing matches', () => {
    const fixture = make();
    fixture.componentInstance.query.set('zzz');
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.zp-empty')).toBeTruthy();
  });

  it('routes the countryFor lookup into each row flag', () => {
    const fixture = make();
    fixture.componentRef.setInput('countryFor', (id: string) => (id === 'Asia/Seoul' ? 'kr' : null));
    fixture.detectChanges();
    const seoulFlag = fixture.nativeElement.querySelector(
      '[data-id="Asia/Seoul"] img'
    ) as HTMLImageElement;
    expect(seoulFlag.getAttribute('src')).toBe('flags/1x1/kr.svg');
    // Rows without a country render the globe fallback.
    expect(fixture.nativeElement.querySelector('[data-id="Asia/Tokyo"] app-icon')).toBeTruthy();
  });
});
