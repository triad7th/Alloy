import { describe, it, expect, beforeEach } from 'vitest';
import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { SelectComponent, SelectOption } from './select.component';

const PICKUPS: readonly SelectOption[] = [
  { value: 'none', label: 'None' },
  { value: '1', label: '1 beat' },
  { value: '2', label: '2 beats' },
];

describe('SelectComponent', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [SelectComponent] }).compileComponents();
  });

  it('renders one option per entry and reflects the current value', () => {
    @Component({
      imports: [SelectComponent],
      template: `<app-select [options]="options" [(value)]="pickup" selectLabel="Pickup" />`,
    })
    class HostComponent {
      readonly options = PICKUPS;
      readonly pickup = signal('1');
    }
    const fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
    fixture.detectChanges(); // Ensure model binding is established
    const select = (fixture.nativeElement as HTMLElement).querySelector(
      'select.alloy-select',
    ) as HTMLSelectElement;
    const options = select.querySelectorAll('option');
    expect(options.length).toBe(3);
    expect(options[1].textContent).toContain('1 beat');
    expect(select.value).toBe('1');
    expect(select.getAttribute('aria-label')).toBe('Pickup');
  });

  it('two-way binds value on change', () => {
    @Component({
      imports: [SelectComponent],
      template: `<app-select [options]="options" [(value)]="pickup" selectLabel="Pickup" />`,
    })
    class HostComponent {
      readonly options = PICKUPS;
      readonly pickup = signal('1');
    }
    const fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
    const select = (fixture.nativeElement as HTMLElement).querySelector(
      'select.alloy-select',
    ) as HTMLSelectElement;
    select.value = '2';
    select.dispatchEvent(new Event('change'));
    fixture.detectChanges();
    expect(fixture.componentInstance.pickup()).toBe('2');
  });

  it('reflects disabled', () => {
    const fixture = TestBed.createComponent(SelectComponent);
    fixture.componentRef.setInput('options', PICKUPS);
    fixture.componentRef.setInput('disabled', true);
    fixture.detectChanges();
    const select = (fixture.nativeElement as HTMLElement).querySelector(
      'select.alloy-select',
    ) as HTMLSelectElement;
    expect(select.disabled).toBe(true);
  });
});
