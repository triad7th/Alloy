import { describe, it, expect } from 'vitest';
import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { KnobSliderDirective } from './knob-slider.directive';

@Component({
  imports: [KnobSliderDirective],
  template: `<input type="range" appKnobSlider min="0.5" max="2" step="0.05" [value]="v()" />`,
})
class HostComponent {
  readonly v = signal(1.25);
}

function setup() {
  const fixture = TestBed.createComponent(HostComponent);
  fixture.detectChanges();
  const input: HTMLInputElement = fixture.nativeElement.querySelector('input');
  return { fixture, input };
}

describe('KnobSliderDirective', () => {
  it('sets --fill from the initial [value] binding', async () => {
    const { fixture, input } = setup();
    await fixture.whenStable();
    expect(input.style.getPropertyValue('--fill')).toBe('50%');
  });

  it('updates --fill on an input event after the value changes', async () => {
    const { fixture, input } = setup();
    await fixture.whenStable();
    input.value = '2';
    input.dispatchEvent(new Event('input'));
    await fixture.whenStable();
    expect(input.style.getPropertyValue('--fill')).toBe('100%');
  });

  it('updates --fill when [value] is rebound programmatically', async () => {
    const { fixture, input } = setup();
    await fixture.whenStable();
    fixture.componentInstance.v.set(2);
    await fixture.whenStable();
    expect(input.style.getPropertyValue('--fill')).toBe('100%');
  });

  it('applies the knobs-slider class to the host', async () => {
    const { fixture, input } = setup();
    await fixture.whenStable();
    expect(input.classList.contains('knobs-slider')).toBe(true);
  });
});
