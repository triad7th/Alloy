import { describe, it, expect, beforeEach } from 'vitest';
import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { NavHeaderComponent } from './nav-header.component';

describe('NavHeaderComponent', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [NavHeaderComponent],
    }).compileComponents();
  });

  it('renders the title', () => {
    const fixture = TestBed.createComponent(NavHeaderComponent);
    fixture.componentRef.setInput('title', 'Time Machine');
    fixture.detectChanges();
    const title = (fixture.nativeElement as HTMLElement).querySelector('.nav-title');
    expect(title?.textContent?.trim()).toBe('Time Machine');
  });

  it('projects leading and trailing content into their slots', () => {
    @Component({
      imports: [NavHeaderComponent],
      template: `
        <app-nav-header title="Settings">
          <button navLeading class="lead-btn">Cancel</button>
          <button navTrailing class="trail-btn">Done</button>
        </app-nav-header>
      `,
    })
    class HostComponent {}

    const fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
    const host = fixture.nativeElement as HTMLElement;

    const lead = host.querySelector('.nav-lead .lead-btn');
    const trail = host.querySelector('.nav-trail .trail-btn');
    expect(lead?.textContent?.trim()).toBe('Cancel');
    expect(trail?.textContent?.trim()).toBe('Done');
    expect(host.querySelector('.nav-title')?.textContent?.trim()).toBe('Settings');
  });
});
