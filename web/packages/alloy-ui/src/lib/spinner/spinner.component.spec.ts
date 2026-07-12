import { describe, it, expect, beforeEach } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { SpinnerComponent } from './spinner.component';

describe('SpinnerComponent', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [SpinnerComponent],
    }).compileComponents();
  });

  function create(inputs: { size?: number; ariaLabel?: string } = {}) {
    const fixture = TestBed.createComponent(SpinnerComponent);
    if (inputs.size !== undefined) fixture.componentRef.setInput('size', inputs.size);
    if (inputs.ariaLabel !== undefined) fixture.componentRef.setInput('ariaLabel', inputs.ariaLabel);
    fixture.detectChanges();
    return fixture;
  }

  it('renders a progressbar with the default size and label', () => {
    const fixture = create();
    const el = (fixture.nativeElement as HTMLElement).querySelector('.spinner') as HTMLElement;
    expect(el).not.toBeNull();
    expect(el.getAttribute('role')).toBe('progressbar');
    expect(el.getAttribute('aria-label')).toBe('Loading');
    expect(el.style.width).toBe('24px');
    expect(el.style.height).toBe('24px');
  });

  it('applies a custom size as width and height', () => {
    const fixture = create({ size: 40 });
    const el = (fixture.nativeElement as HTMLElement).querySelector('.spinner') as HTMLElement;
    expect(el.style.width).toBe('40px');
    expect(el.style.height).toBe('40px');
  });

  it('applies a custom aria-label', () => {
    const fixture = create({ ariaLabel: 'Saving score' });
    const el = (fixture.nativeElement as HTMLElement).querySelector('.spinner');
    expect(el?.getAttribute('aria-label')).toBe('Saving score');
  });
});
