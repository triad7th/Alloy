import { describe, it, expect, beforeEach } from 'vitest';
import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ModalShellComponent } from './modal-shell.component';

describe('ModalShellComponent', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [ModalShellComponent] }).compileComponents();
  });

  @Component({
    imports: [ModalShellComponent],
    template: `
      @if (open()) {
        <app-modal-shell (dismissed)="dismissals = dismissals + 1">
          <p class="inner">body</p>
        </app-modal-shell>
      }
    `,
  })
  class HostComponent {
    readonly open = signal(true);
    dismissals = 0;
  }

  function setup() {
    const fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
    const host = fixture.nativeElement as HTMLElement;
    const panel = host.querySelector('dialog.alloy-modal') as HTMLDialogElement;
    return { fixture, host, panel };
  }

  it('renders an open dialog with the projected content', () => {
    const { host, panel } = setup();
    expect(panel).not.toBeNull();
    expect(panel.open).toBe(true);
    expect(host.querySelector('.alloy-modal-body .inner')?.textContent).toContain('body');
  });

  it('emits dismissed on Esc (the native cancel event)', () => {
    const { fixture, panel } = setup();
    panel.dispatchEvent(new Event('cancel', { cancelable: true }));
    expect(fixture.componentInstance.dismissals).toBe(1);
  });

  it('emits dismissed on backdrop click (target is the dialog itself)', () => {
    const { fixture, panel } = setup();
    panel.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(fixture.componentInstance.dismissals).toBe(1);
  });

  it('does not emit dismissed for clicks inside the body', () => {
    const { fixture, host } = setup();
    const inner = host.querySelector('.inner') as HTMLElement;
    inner.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(fixture.componentInstance.dismissals).toBe(0);
  });
});
