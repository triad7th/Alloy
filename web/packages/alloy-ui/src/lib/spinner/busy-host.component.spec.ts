import { describe, it, expect, beforeEach } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { AlloyBusy } from './busy.service';
import { BusyHostComponent } from './busy-host.component';

describe('BusyHostComponent', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [BusyHostComponent],
    }).compileComponents();
  });

  it('renders nothing while idle', () => {
    const fixture = TestBed.createComponent(BusyHostComponent);
    fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).querySelector('dialog.busy')).toBeNull();
  });

  it('shows the overlay with spinner and label while busy, and removes it on release', () => {
    const busy = TestBed.inject(AlloyBusy);
    const fixture = TestBed.createComponent(BusyHostComponent);
    fixture.detectChanges();

    const release = busy.begin('Exporting');
    fixture.detectChanges();
    const host = fixture.nativeElement as HTMLElement;
    const overlay = host.querySelector('dialog.busy');
    expect(overlay).not.toBeNull();
    expect(overlay?.getAttribute('aria-busy')).toBe('true');
    expect(host.querySelector('app-spinner')).not.toBeNull();
    expect(host.querySelector('.busy-label')?.textContent).toContain('Exporting');

    release();
    fixture.detectChanges();
    expect(host.querySelector('dialog.busy')).toBeNull();
  });

  it('omits the label element when no label is set', () => {
    const busy = TestBed.inject(AlloyBusy);
    const fixture = TestBed.createComponent(BusyHostComponent);
    fixture.detectChanges();
    const release = busy.begin();
    fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).querySelector('.busy-label')).toBeNull();
    release();
  });
});
