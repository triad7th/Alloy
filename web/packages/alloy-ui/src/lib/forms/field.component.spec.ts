import { describe, it, expect, beforeEach } from 'vitest';
import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { FieldComponent } from './field.component';

describe('FieldComponent', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [FieldComponent] }).compileComponents();
  });

  it('renders a <label> wrapping the caption and the projected control', () => {
    @Component({
      imports: [FieldComponent],
      template: `<app-field label="Pickup"><input id="ctl" /></app-field>`,
    })
    class HostComponent {}

    const fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
    const host = fixture.nativeElement as HTMLElement;
    const label = host.querySelector('label.alloy-field') as HTMLLabelElement;
    expect(label).not.toBeNull();
    expect(label.querySelector('.alloy-field-label')?.textContent).toContain('Pickup');
    // The control is INSIDE the label element — that is what associates them.
    expect(label.querySelector('#ctl')).not.toBeNull();
  });
});
