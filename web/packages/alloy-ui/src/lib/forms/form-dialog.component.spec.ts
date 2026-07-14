import { describe, it, expect, beforeEach } from 'vitest';
import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { FormDialogComponent } from './form-dialog.component';

describe('FormDialogComponent', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [FormDialogComponent] }).compileComponents();
  });

  @Component({
    imports: [FormDialogComponent],
    template: `
      <app-form-dialog
        [open]="open()"
        title="Time signature"
        submitLabel="Apply"
        [submitDisabled]="blocked()"
        (submitted)="submits = submits + 1"
        (cancelled)="cancels = cancels + 1"
      >
        <input class="beats" />
      </app-form-dialog>
    `,
  })
  class HostComponent {
    readonly open = signal(true);
    readonly blocked = signal(false);
    submits = 0;
    cancels = 0;
  }

  function setup() {
    const fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
    const host = fixture.nativeElement as HTMLElement;
    return { fixture, host };
  }

  const buttonNamed = (host: HTMLElement, label: string) =>
    [...host.querySelectorAll('button.alloy-button')].find((b) =>
      b.textContent?.includes(label),
    ) as HTMLButtonElement;

  it('renders nothing while closed', () => {
    const fixture = TestBed.createComponent(HostComponent);
    fixture.componentInstance.open.set(false);
    fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).querySelector('dialog.alloy-modal')).toBeNull();
  });

  it('renders the title, projected body, and both buttons when open', () => {
    const { host } = setup();
    expect(host.querySelector('dialog.alloy-modal')).not.toBeNull();
    expect(host.querySelector('.form-dialog-title')?.textContent).toContain('Time signature');
    expect(host.querySelector('input.beats')).not.toBeNull();
    expect(buttonNamed(host, 'Apply')).toBeTruthy();
    expect(buttonNamed(host, 'Cancel')).toBeTruthy();
  });

  it('emits submitted when the submit button is clicked', () => {
    const { fixture, host } = setup();
    buttonNamed(host, 'Apply').click();
    expect(fixture.componentInstance.submits).toBe(1);
  });

  it('emits submitted on Enter (implicit form submission)', () => {
    const { fixture, host } = setup();
    const form = host.querySelector('form.form-dialog') as HTMLFormElement;
    form.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
    expect(fixture.componentInstance.submits).toBe(1);
  });

  it('emits cancelled from the cancel button, Esc, and backdrop click', () => {
    const { fixture, host } = setup();
    buttonNamed(host, 'Cancel').click();
    expect(fixture.componentInstance.cancels).toBe(1);

    const panel = host.querySelector('dialog.alloy-modal') as HTMLDialogElement;
    panel.dispatchEvent(new Event('cancel', { cancelable: true }));
    expect(fixture.componentInstance.cancels).toBe(2);

    panel.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(fixture.componentInstance.cancels).toBe(3);
  });

  it('submitDisabled blocks BOTH the button and Enter, and disables the button', () => {
    const { fixture, host } = setup();
    fixture.componentInstance.blocked.set(true);
    fixture.detectChanges();

    expect(buttonNamed(host, 'Apply').disabled).toBe(true);
    buttonNamed(host, 'Apply').click();
    const form = host.querySelector('form.form-dialog') as HTMLFormElement;
    form.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
    expect(fixture.componentInstance.submits).toBe(0);
  });

  it('focuses the first field in the body on open', () => {
    const { host } = setup();
    expect(document.activeElement).toBe(host.querySelector('input.beats'));
  });
});
