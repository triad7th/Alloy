import { ChangeDetectionStrategy, Component } from '@angular/core';
import { SnackbarHostComponent } from '../snackbar/snackbar-host.component';
import { DialogHostComponent } from '../dialog/dialog-host.component';
import { BusyHostComponent } from '../spinner/busy-host.component';

/**
 * Single outlet for all AlloyUI overlay surfaces. Place once in the app root
 * template; every host renders nothing while idle, so unused features cost
 * nothing. The individual hosts are exported too, but this is the documented
 * path.
 */
@Component({
  selector: 'app-overlays',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [SnackbarHostComponent, DialogHostComponent, BusyHostComponent],
  template: `
    <app-snackbar-host />
    <app-dialog-host />
    <app-busy-host />
  `,
})
export class OverlaysComponent {}
