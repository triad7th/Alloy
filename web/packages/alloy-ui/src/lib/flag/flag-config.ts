import { InjectionToken, Provider } from '@angular/core';

// Apps serve their own flag artwork (square 1x1 SVGs from flag-icons, copied
// into the app bundle by its build); the library only composes the URL.
// Default matches the Ally apps' convention: `<basePath>/<code>.svg`.
export const ALLOY_FLAG_BASE_PATH = new InjectionToken<string>('ALLOY_FLAG_BASE_PATH');

/** Point FlagComponent at the app's flag asset directory (default 'flags/1x1'). */
export function provideAlloyFlags(basePath: string): Provider {
  return { provide: ALLOY_FLAG_BASE_PATH, useValue: basePath };
}
