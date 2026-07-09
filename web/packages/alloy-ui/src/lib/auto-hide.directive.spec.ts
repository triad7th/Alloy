import { describe, it, expect, vi } from 'vitest';
import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { AutoHideDirective } from './auto-hide.directive';
import { AUTO_HIDE_MS } from './tokens';

@Component({
  selector: 'test-host',
  imports: [AutoHideDirective],
  template: `<div
    appAutoHide
    #ah="autoHide"
    [revealBlocked]="blocked()"
    [holdVisible]="hold()"
  ></div>`,
})
class HostComponent {
  blocked = signal(false);
  hold = signal(false);
}

function setup() {
  const fixture = TestBed.createComponent(HostComponent);
  fixture.detectChanges();
  const dir = fixture.debugElement.children[0].injector.get(AutoHideDirective);
  return { fixture, dir };
}

describe('AutoHideDirective', () => {
  it('starts visible and auto-hides after AUTO_HIDE_MS', () => {
    vi.useFakeTimers();
    try {
      const { dir } = setup();
      expect(dir.visible()).toBe(true);
      vi.advanceTimersByTime(AUTO_HIDE_MS);
      expect(dir.visible()).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('reveal() restores visibility and re-arms the timer', () => {
    vi.useFakeTimers();
    try {
      const { dir } = setup();
      vi.advanceTimersByTime(AUTO_HIDE_MS);
      expect(dir.visible()).toBe(false);
      dir.reveal();
      expect(dir.visible()).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('reveal() is a no-op while revealBlocked is true', () => {
    vi.useFakeTimers();
    try {
      const { fixture, dir } = setup();
      vi.advanceTimersByTime(AUTO_HIDE_MS);
      fixture.componentInstance.blocked.set(true);
      fixture.detectChanges();
      dir.reveal();
      expect(dir.visible()).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('holdVisible suppresses the auto-hide timer', () => {
    vi.useFakeTimers();
    try {
      const { fixture, dir } = setup();
      fixture.componentInstance.hold.set(true);
      fixture.detectChanges();
      dir.reveal();
      vi.advanceTimersByTime(AUTO_HIDE_MS * 2);
      expect(dir.visible()).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});
