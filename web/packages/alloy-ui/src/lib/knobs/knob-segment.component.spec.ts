import { describe, it, expect } from 'vitest';
import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { KnobSegmentComponent } from './knob-segment.component';

@Component({
  imports: [KnobSegmentComponent],
  template: `
    <app-knob-segment
      [options]="options()"
      [selection]="selection()"
      [segmentLabel]="label()"
      (changed)="onChanged($event)"
    ></app-knob-segment>
  `,
})
class HostComponent {
  readonly options = signal([
    { value: 'opt1', label: 'Option 1' },
    { value: 'opt2', label: 'Option 2' },
    { value: 'opt3', label: 'Option 3' },
  ]);
  readonly selection = signal('opt1');
  readonly label = signal('Choose one');

  onChanged(value: string): void {
    this.selection.set(value);
  }
}

function setup() {
  const fixture = TestBed.createComponent(HostComponent);
  fixture.detectChanges();
  const segment = fixture.nativeElement.querySelector('app-knob-segment');
  return { fixture, segment };
}

describe('KnobSegmentComponent', () => {
  it('renders one button per option with role radio', () => {
    const { segment } = setup();
    const buttons = segment.querySelectorAll('button[role="radio"]');
    expect(buttons.length).toBe(3);
  });

  it('renders buttons with knobs-segment-btn class', () => {
    const { segment } = setup();
    const buttons = segment.querySelectorAll('button.knobs-segment-btn');
    expect(buttons.length).toBe(3);
  });

  it('renders option labels in the buttons', () => {
    const { segment } = setup();
    const buttons = segment.querySelectorAll('button');
    expect(buttons[0].textContent).toContain('Option 1');
    expect(buttons[1].textContent).toContain('Option 2');
    expect(buttons[2].textContent).toContain('Option 3');
  });

  it('marks the selected option with the on class', async () => {
    const { fixture, segment } = setup();
    await fixture.whenStable();
    const buttons = segment.querySelectorAll('button');
    expect(buttons[0].classList.contains('on')).toBe(true);
    expect(buttons[1].classList.contains('on')).toBe(false);
    expect(buttons[2].classList.contains('on')).toBe(false);
  });

  it('updates the on class when selection changes', async () => {
    const { fixture, segment } = setup();
    await fixture.whenStable();
    fixture.componentInstance.selection.set('opt2');
    await fixture.whenStable();
    const buttons = segment.querySelectorAll('button');
    expect(buttons[0].classList.contains('on')).toBe(false);
    expect(buttons[1].classList.contains('on')).toBe(true);
    expect(buttons[2].classList.contains('on')).toBe(false);
  });

  it('sets aria-checked on the selected button', async () => {
    const { fixture, segment } = setup();
    await fixture.whenStable();
    const buttons = segment.querySelectorAll('button');
    expect(buttons[0].getAttribute('aria-checked')).toBe('true');
    expect(buttons[1].getAttribute('aria-checked')).toBe('false');
  });

  it('emits changed with the clicked option value', async () => {
    const { fixture, segment } = setup();
    await fixture.whenStable();
    const buttons = segment.querySelectorAll('button');
    (buttons[1] as HTMLButtonElement).click();
    await fixture.whenStable();
    expect(fixture.componentInstance.selection()).toBe('opt2');
  });

  it('wraps buttons in a radiogroup div', () => {
    const { segment } = setup();
    const radiogroup = segment.querySelector('[role="radiogroup"]');
    expect(radiogroup).toBeTruthy();
    expect(radiogroup?.classList.contains('knobs-segment')).toBe(true);
  });

  it('applies aria-label to the radiogroup', async () => {
    const { fixture, segment } = setup();
    await fixture.whenStable();
    const radiogroup = segment.querySelector('[role="radiogroup"]');
    expect(radiogroup?.getAttribute('aria-label')).toBe('Choose one');
  });

  it('sets aria-label to null when segmentLabel is empty', async () => {
    const { fixture, segment } = setup();
    fixture.componentInstance.label.set('');
    await fixture.whenStable();
    const radiogroup = segment.querySelector('[role="radiogroup"]');
    expect(radiogroup?.getAttribute('aria-label')).toBeNull();
  });
});
