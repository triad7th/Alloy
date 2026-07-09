import { describe, it, expect, beforeEach } from 'vitest';
import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { IconComponent } from './icon.component';
import { SfSymbol, provideAlloyIcons } from './icon-registry';

@Component({
  standalone: true,
  imports: [IconComponent],
  template: '<app-icon [name]="name" />',
})
class HostComponent {
  name: SfSymbol = 'pencil';
}

describe('IconComponent', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [HostComponent],
    }).compileComponents();
  });

  function render(name: string): SVGElement | null {
    const fixture = TestBed.createComponent(HostComponent);
    fixture.componentInstance.name = name as SfSymbol;
    fixture.detectChanges();
    return fixture.nativeElement.querySelector('svg');
  }

  it('renders an svg for a known name', () => {
    const svg = render('pencil');
    expect(svg).toBeTruthy();
    expect(svg!.querySelector('path')).toBeTruthy();
  });

  it('renders each supported SF Symbol name', () => {
    for (const name of [
      'pencil',
      'photo',
      'plus',
      'trash',
      'square.and.arrow.up',
      'square.on.square',
      'xmark',
      'checkmark',
      'gearshape',
      'arrow.right',
      'arrow.clockwise',
    ]) {
      expect(render(name)!.querySelector('path')).toBeTruthy();
    }
  });

  it('renders an empty svg (no path) for an unknown name', () => {
    const svg = render('does.not.exist');
    expect(svg).toBeTruthy();
    expect(svg!.querySelector('path')).toBeNull();
  });
});

describe('IconComponent icon set', () => {
  function render(name: string): SVGPathElement | null {
    const fixture = TestBed.createComponent(IconComponent);
    fixture.componentRef.setInput('name', name as SfSymbol);
    fixture.detectChanges();
    return fixture.nativeElement.querySelector('path');
  }

  it('renders a non-empty path for the new screen/nav icons', () => {
    for (const name of ['chevron.left', 'chevron.right', 'clock.arrow.circlepath', 'clock']) {
      const path = render(name);
      expect(path, name).toBeTruthy();
      expect(path!.getAttribute('d')!.length, name).toBeGreaterThan(0);
    }
  });

  it('renders app-registered extra icons', async () => {
    TestBed.configureTestingModule({
      providers: [provideAlloyIcons({ pianokeys: 'M1 1h22v22H1z' })],
    });
    const fixture = TestBed.createComponent(IconComponent);
    fixture.componentRef.setInput('name', 'pianokeys');
    await fixture.whenStable();
    const path: SVGPathElement = fixture.nativeElement.querySelector('path');
    expect(path.getAttribute('d')).toBe('M1 1h22v22H1z');
  });

  it('renders no path for unknown names', async () => {
    const fixture = TestBed.createComponent(IconComponent);
    fixture.componentRef.setInput('name', 'no.such.icon');
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelector('path')).toBeNull();
  });
});
