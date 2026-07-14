import { describe, it, expect, beforeEach } from 'vitest';
import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ButtonComponent } from './button.component';

describe('ButtonComponent', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [ButtonComponent] }).compileComponents();
  });

  function create(inputs: { variant?: string; disabled?: boolean; type?: string } = {}) {
    const fixture = TestBed.createComponent(ButtonComponent);
    if (inputs.variant !== undefined) fixture.componentRef.setInput('variant', inputs.variant);
    if (inputs.disabled !== undefined) fixture.componentRef.setInput('disabled', inputs.disabled);
    if (inputs.type !== undefined) fixture.componentRef.setInput('type', inputs.type);
    fixture.detectChanges();
    return (fixture.nativeElement as HTMLElement).querySelector(
      'button.alloy-button',
    ) as HTMLButtonElement;
  }

  it('renders a secondary button by default with type=button', () => {
    const button = create();
    expect(button).not.toBeNull();
    expect(button.getAttribute('type')).toBe('button');
    expect(button.classList.contains('primary')).toBe(false);
    expect(button.classList.contains('destructive')).toBe(false);
    expect(button.disabled).toBe(false);
  });

  it('applies the primary and destructive variant classes', () => {
    expect(create({ variant: 'primary' }).classList.contains('primary')).toBe(true);
    expect(create({ variant: 'destructive' }).classList.contains('destructive')).toBe(true);
  });

  it('reflects disabled and type=submit', () => {
    expect(create({ disabled: true }).disabled).toBe(true);
    expect(create({ type: 'submit' }).getAttribute('type')).toBe('submit');
  });

  it('projects its label and bubbles clicks to a host handler', () => {
    @Component({
      imports: [ButtonComponent],
      template: `<app-button (click)="clicks = clicks + 1">Apply</app-button>`,
    })
    class HostComponent {
      clicks = 0;
    }
    const fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
    const button = (fixture.nativeElement as HTMLElement).querySelector(
      'button.alloy-button',
    ) as HTMLButtonElement;
    expect(button.textContent).toContain('Apply');
    button.click();
    expect(fixture.componentInstance.clicks).toBe(1);
  });
});
