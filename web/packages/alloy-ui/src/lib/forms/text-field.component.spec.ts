import { describe, it, expect, beforeEach } from 'vitest';
import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { TextFieldComponent } from './text-field.component';

describe('TextFieldComponent', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [TextFieldComponent] }).compileComponents();
  });

  it('renders a text input with the placeholder and current value', () => {
    const fixture = TestBed.createComponent(TextFieldComponent);
    fixture.componentRef.setInput('value', 'Allegro');
    fixture.componentRef.setInput('placeholder', 'Tempo name');
    fixture.detectChanges();
    const input = (fixture.nativeElement as HTMLElement).querySelector(
      'input.alloy-input',
    ) as HTMLInputElement;
    expect(input.type).toBe('text');
    expect(input.value).toBe('Allegro');
    expect(input.placeholder).toBe('Tempo name');
    expect(input.getAttribute('aria-invalid')).toBeNull();
  });

  it('sets disabled and aria-invalid', () => {
    const fixture = TestBed.createComponent(TextFieldComponent);
    fixture.componentRef.setInput('disabled', true);
    fixture.componentRef.setInput('invalid', true);
    fixture.detectChanges();
    const input = (fixture.nativeElement as HTMLElement).querySelector(
      'input.alloy-input',
    ) as HTMLInputElement;
    expect(input.disabled).toBe(true);
    expect(input.getAttribute('aria-invalid')).toBe('true');
  });

  it('two-way binds value on input', () => {
    @Component({
      imports: [TextFieldComponent],
      template: `<app-text-field [(value)]="name" />`,
    })
    class HostComponent {
      readonly name = signal('one');
    }
    const fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
    const input = (fixture.nativeElement as HTMLElement).querySelector(
      'input.alloy-input',
    ) as HTMLInputElement;
    expect(input.value).toBe('one');
    input.value = 'two';
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    expect(fixture.componentInstance.name()).toBe('two');
  });
});
