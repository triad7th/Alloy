import { Directive, DoCheck, ElementRef, inject } from '@angular/core';

/** Owns the slider's --fill custom property (the tinted track progress) so
 *  apps stop hand-rolling fillPct(). Reads min/max/value off the native
 *  input; updates on init, on every input event, and on every change
 *  detection pass (covers [value] rebinds).
 *
 *  Uses DoCheck rather than effect()/afterRenderEffect(): sync() reads no
 *  signals (it reads the native input's DOM properties, not an Angular
 *  input), so both of those primitives track zero dependencies and never
 *  re-fire after their first run — confirmed against Angular's own docs,
 *  which state afterRenderEffect callbacks re-run "only when dirty through
 *  signal dependencies", same gating as effect(). ngDoCheck has no such
 *  gating: it runs on every change-detection pass for this element, so it
 *  picks up a [value] rebind that effect()/afterRenderEffect() would miss. */
@Directive({
  selector: 'input[type=range][appKnobSlider]',
  host: {
    class: 'knobs-slider',
    '(input)': 'sync()',
  },
})
export class KnobSliderDirective implements DoCheck {
  private readonly el = inject<ElementRef<HTMLInputElement>>(ElementRef);

  ngDoCheck(): void {
    this.sync();
  }

  protected sync(): void {
    const input = this.el.nativeElement;
    const min = Number(input.min || 0);
    const max = Number(input.max || 100);
    const value = Number(input.value);
    const pct = max > min ? Math.round(((value - min) / (max - min)) * 100) : 0;
    input.style.setProperty('--fill', `${pct}%`);
  }
}
