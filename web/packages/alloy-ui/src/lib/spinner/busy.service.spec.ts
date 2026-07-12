import { describe, it, expect } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { AlloyBusy } from './busy.service';

describe('AlloyBusy', () => {
  function service(): AlloyBusy {
    return TestBed.inject(AlloyBusy);
  }

  it('is inactive until begin() and active until released', () => {
    const busy = service();
    expect(busy.active()).toBe(false);
    const release = busy.begin();
    expect(busy.active()).toBe(true);
    release();
    expect(busy.active()).toBe(false);
  });

  it('ref-counts overlapping begins', () => {
    const busy = service();
    const a = busy.begin();
    const b = busy.begin();
    a();
    expect(busy.active()).toBe(true);
    b();
    expect(busy.active()).toBe(false);
  });

  it('treats double-release as a no-op', () => {
    const busy = service();
    const a = busy.begin();
    const b = busy.begin();
    a();
    a();
    expect(busy.active()).toBe(true);
    b();
    expect(busy.active()).toBe(false);
  });

  it('exposes the most recent unreleased label', () => {
    const busy = service();
    const a = busy.begin('Loading score');
    const b = busy.begin(); // unlabeled — label falls through to the latest labeled entry
    expect(busy.label()).toBe('Loading score');
    const c = busy.begin('Exporting');
    expect(busy.label()).toBe('Exporting');
    c();
    expect(busy.label()).toBe('Loading score');
    a();
    b();
    expect(busy.label()).toBeNull();
  });

  it('while() releases on resolve and returns the result', async () => {
    const busy = service();
    const result = busy.while(Promise.resolve(42), 'Working');
    expect(busy.active()).toBe(true);
    await expect(result).resolves.toBe(42);
    expect(busy.active()).toBe(false);
  });

  it('while() releases on reject and rethrows', async () => {
    const busy = service();
    const boom = new Error('boom');
    const result = busy.while(Promise.reject(boom));
    expect(busy.active()).toBe(true);
    await expect(result).rejects.toBe(boom);
    expect(busy.active()).toBe(false);
  });
});
