import { describe, it, expect } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { FlagComponent } from './flag.component';
import { provideAlloyFlags } from './flag-config';

function make(countryCode: string | null, name = '') {
  const fixture = TestBed.createComponent(FlagComponent);
  fixture.componentRef.setInput('countryCode', countryCode);
  fixture.componentRef.setInput('name', name);
  fixture.detectChanges();
  return fixture;
}

describe('FlagComponent', () => {
  it('renders the square SVG flag for a country code (case-insensitive)', () => {
    const img = make('KR').nativeElement.querySelector('img') as HTMLImageElement;
    expect(img.getAttribute('src')).toBe('flags/1x1/kr.svg');
  });

  it('falls back to the globe symbol when there is no country', () => {
    const host = make(null).nativeElement as HTMLElement;
    expect(host.querySelector('img')).toBeNull();
    expect(host.querySelector('app-icon')).toBeTruthy();
  });

  it('builds alt text from the provided name', () => {
    const img = make('gb', 'United Kingdom').nativeElement.querySelector('img') as HTMLImageElement;
    expect(img.getAttribute('alt')).toBe('United Kingdom flag');
  });

  it('honors an app-provided asset base path', () => {
    TestBed.configureTestingModule({ providers: [provideAlloyFlags('assets/country-flags')] });
    const img = make('us').nativeElement.querySelector('img') as HTMLImageElement;
    expect(img.getAttribute('src')).toBe('assets/country-flags/us.svg');
  });
});
