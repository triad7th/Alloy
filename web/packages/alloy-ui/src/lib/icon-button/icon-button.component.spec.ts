import { describe, it, expect, beforeEach } from 'vitest';
import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { IconButtonComponent } from './icon-button.component';

describe('IconButtonComponent', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [IconButtonComponent],
    }).compileComponents();
  });

  function create(
    inputs: {
      icon?: string;
      variant?: 'secondary' | 'primary' | 'destructive';
      label?: string;
    } = {},
  ) {
    const fixture = TestBed.createComponent(IconButtonComponent);
    fixture.componentRef.setInput('icon', inputs.icon ?? 'plus');
    if (inputs.variant !== undefined) fixture.componentRef.setInput('variant', inputs.variant);
    if (inputs.label !== undefined) fixture.componentRef.setInput('label', inputs.label);
    fixture.detectChanges();
    return fixture;
  }

  it('renders a button with the icon', () => {
    const fixture = create({ icon: 'checkmark' });
    const host = fixture.nativeElement as HTMLElement;
    const button = host.querySelector('button.icon-button');
    expect(button).not.toBeNull();
    expect(host.querySelector('app-icon')).not.toBeNull();
  });

  it('defaults to the secondary variant (no modifier class)', () => {
    const fixture = create();
    const button = (fixture.nativeElement as HTMLElement).querySelector('button.icon-button');
    expect(button?.classList.contains('primary')).toBe(false);
    expect(button?.classList.contains('destructive')).toBe(false);
  });

  it('adds the .primary class for the primary variant', () => {
    const fixture = create({ variant: 'primary' });
    const button = (fixture.nativeElement as HTMLElement).querySelector('button.icon-button');
    expect(button?.classList.contains('primary')).toBe(true);
  });

  it('adds the .destructive class for the destructive variant', () => {
    const fixture = create({ variant: 'destructive' });
    const button = (fixture.nativeElement as HTMLElement).querySelector('button.icon-button');
    expect(button?.classList.contains('destructive')).toBe(true);
  });

  it('sets aria-label and title from the label input', () => {
    const fixture = create({ label: 'Apply' });
    const button = (fixture.nativeElement as HTMLElement).querySelector('button.icon-button');
    expect(button?.getAttribute('aria-label')).toBe('Apply');
    expect(button?.getAttribute('title')).toBe('Apply');
  });

  it('omits aria-label and title when no label is given', () => {
    const fixture = create();
    const button = (fixture.nativeElement as HTMLElement).querySelector('button.icon-button');
    expect(button?.getAttribute('aria-label')).toBeNull();
    expect(button?.getAttribute('title')).toBeNull();
  });

  it('bubbles clicks to a host (click) handler', () => {
    @Component({
      imports: [IconButtonComponent],
      template: `<app-icon-button icon="plus" (click)="clicked = clicked + 1" />`,
    })
    class HostComponent {
      clicked = 0;
    }

    const fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
    const button = (fixture.nativeElement as HTMLElement).querySelector(
      'button.icon-button',
    ) as HTMLButtonElement;
    button.click();
    expect(fixture.componentInstance.clicked).toBe(1);
  });
});
