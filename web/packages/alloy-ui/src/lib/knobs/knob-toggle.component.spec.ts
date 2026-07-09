import { describe, it, expect } from 'vitest';
import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { KnobToggleComponent } from './knob-toggle.component';

@Component({
  imports: [KnobToggleComponent],
  template: `<button appKnobToggle [on]="on()" (toggled)="onToggle()" class="my-button" data-knob="test"></button>`,
})
class HostComponent {
  readonly on = signal(false);

  onToggle(): void {
    this.on.set(!this.on());
  }
}

function setup() {
  const fixture = TestBed.createComponent(HostComponent);
  fixture.detectChanges();
  const button: HTMLButtonElement = fixture.nativeElement.querySelector('button');
  return { fixture, button };
}

describe('KnobToggleComponent', () => {
  it('renders a thumb span with class knobs-toggle-thumb', () => {
    const { button } = setup();
    const thumb = button.querySelector('.knobs-toggle-thumb');
    expect(thumb).toBeTruthy();
    expect(thumb?.tagName).toBe('SPAN');
  });

  it('applies the knobs-toggle class to the host', async () => {
    const { fixture, button } = setup();
    await fixture.whenStable();
    expect(button.classList.contains('knobs-toggle')).toBe(true);
  });

  it('reflects the on input in the on class', async () => {
    const { fixture, button } = setup();
    await fixture.whenStable();
    expect(button.classList.contains('on')).toBe(false);
    fixture.componentInstance.on.set(true);
    await fixture.whenStable();
    expect(button.classList.contains('on')).toBe(true);
  });

  it('reflects the on input in aria-checked', async () => {
    const { fixture, button } = setup();
    await fixture.whenStable();
    expect(button.getAttribute('aria-checked')).toBe('false');
    fixture.componentInstance.on.set(true);
    await fixture.whenStable();
    expect(button.getAttribute('aria-checked')).toBe('true');
  });

  it('has role switch', async () => {
    const { fixture, button } = setup();
    await fixture.whenStable();
    expect(button.getAttribute('role')).toBe('switch');
  });

  it('emits toggled on click', async () => {
    const { fixture, button } = setup();
    await fixture.whenStable();
    const initialState = fixture.componentInstance.on();
    button.click();
    await fixture.whenStable();
    expect(fixture.componentInstance.on()).toBe(!initialState);
  });

  it('preserves app-provided classes and data attributes', async () => {
    const { fixture, button } = setup();
    await fixture.whenStable();
    expect(button.classList.contains('my-button')).toBe(true);
    expect(button.getAttribute('data-knob')).toBe('test');
  });
});
