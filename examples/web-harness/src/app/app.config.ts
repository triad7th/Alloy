import { ApplicationConfig, provideZonelessChangeDetection } from '@angular/core';

export const appConfig: ApplicationConfig = {
  providers: [
    provideZonelessChangeDetection(),
    // provideAlloyFlags is available from @allyworld/alloy-ui, but the default
    // base path ('flags/1x1') already matches this harness's public/flags/1x1.
  ],
};
