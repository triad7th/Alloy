import { describe, it, expect, beforeEach } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { OverlaysComponent } from './overlays.component';

describe('OverlaysComponent', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [OverlaysComponent],
    }).compileComponents();
  });

  it('composes the snackbar, dialog, and busy hosts', () => {
    const fixture = TestBed.createComponent(OverlaysComponent);
    fixture.detectChanges();
    const host = fixture.nativeElement as HTMLElement;
    expect(host.querySelector('app-snackbar-host')).not.toBeNull();
    expect(host.querySelector('app-dialog-host')).not.toBeNull();
    expect(host.querySelector('app-busy-host')).not.toBeNull();
  });
});
