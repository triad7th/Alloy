import { Directive, OnDestroy, Signal, effect, input, signal } from '@angular/core';
import { AUTO_HIDE_MS } from './tokens';

@Directive({
  selector: '[appAutoHide]',
  exportAs: 'autoHide',
  host: {
    '(document:pointermove)': 'reveal()',
    '(document:pointerdown)': 'reveal()',
    '(document:keydown)': 'reveal()',
  },
})
export class AutoHideDirective implements OnDestroy {
  readonly revealBlocked = input(false);
  readonly holdVisible = input(false);

  private readonly _visible = signal(true);
  readonly visible: Signal<boolean> = this._visible.asReadonly();

  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor() {
    this.armTimer();
    effect(() => {
      if (this.holdVisible()) {
        clearTimeout(this.timer);
        this.timer = undefined;
      } else {
        this.armTimer();
      }
    });
  }

  ngOnDestroy(): void {
    clearTimeout(this.timer);
  }

  reveal(): void {
    if (this.revealBlocked()) return;
    this._visible.set(true);
    this.armTimer();
  }

  private armTimer(): void {
    clearTimeout(this.timer);
    if (this.holdVisible()) return;
    this.timer = setTimeout(() => this._visible.set(false), AUTO_HIDE_MS);
  }
}
