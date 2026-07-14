import { describe, it, expect, beforeEach } from 'vitest';
import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { NumberFieldComponent } from './number-field.component';

describe('NumberFieldComponent', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [NumberFieldComponent] }).compileComponents();
  });

  @Component({
    imports: [NumberFieldComponent],
    template: `<app-number-field [(value)]="beats" [min]="min" [max]="max" />`,
  })
  class HostComponent {
    readonly beats = signal<number | null>(4);
    min: number | null = 1;
    max: number | null = 32;
  }

  function setup() {
    const fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
    const input = (fixture.nativeElement as HTMLElement).querySelector(
      'input.alloy-input',
    ) as HTMLInputElement;
    return { fixture, input };
  }

  it('renders a number input carrying min, max and the current value', () => {
    const { input } = setup();
    expect(input.type).toBe('number');
    expect(input.value).toBe('4');
    expect(input.getAttribute('min')).toBe('1');
    expect(input.getAttribute('max')).toBe('32');
  });

  it('emits the typed number on input without clamping mid-typing', () => {
    const { fixture, input } = setup();
    input.value = '7';
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    expect(fixture.componentInstance.beats()).toBe(7);
  });

  it('emits null when cleared', () => {
    const { fixture, input } = setup();
    input.value = '';
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    expect(fixture.componentInstance.beats()).toBeNull();
  });

  it('clamps above max on blur', () => {
    const { fixture, input } = setup();
    input.value = '99';
    input.dispatchEvent(new Event('input'));
    input.dispatchEvent(new Event('blur'));
    fixture.detectChanges();
    expect(fixture.componentInstance.beats()).toBe(32);
  });

  it('clamps below min on blur', () => {
    const { fixture, input } = setup();
    input.value = '0';
    input.dispatchEvent(new Event('input'));
    input.dispatchEvent(new Event('blur'));
    fixture.detectChanges();
    expect(fixture.componentInstance.beats()).toBe(1);
  });

  it('leaves null untouched on blur', () => {
    const { fixture, input } = setup();
    input.value = '';
    input.dispatchEvent(new Event('input'));
    input.dispatchEvent(new Event('blur'));
    fixture.detectChanges();
    expect(fixture.componentInstance.beats()).toBeNull();
  });
});
