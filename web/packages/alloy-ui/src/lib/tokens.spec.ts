import { describe, expect, it } from 'vitest';
// Bundler-safe raw import: @angular/build's esbuild pipeline resolves the
// `loader: 'text'` import attribute (Vite's `?raw` suffix is not supported here).
import tokensScss from '../styles/_tokens.scss' with { loader: 'text' };
import {
  AUTO_HIDE_MS,
  OVERLAY_FADE_MS,
  SHEET_ANIMATION_MS,
  SHEET_CORNER_RADIUS_PX,
  SNACKBAR_SHOW_MS,
} from './tokens';

describe('tokens', () => {
  it('exposes the twin-agreed durations and sizes', () => {
    expect(SHEET_ANIMATION_MS).toBe(280);
    expect(AUTO_HIDE_MS).toBe(2500);
    expect(SHEET_CORNER_RADIUS_PX).toBe(24);
    expect(SNACKBAR_SHOW_MS).toBe(4000);
    expect(OVERLAY_FADE_MS).toBe(150);
  });

  it('generated SCSS carries the twin-agreed spot values', () => {
    expect(tokensScss).toContain('$tint: #0a84ff;');
    expect(tokensScss).toContain('$secondary-surface: rgba(118, 118, 128, 0.24);');
    expect(tokensScss).toContain('$backdrop: rgba(0, 0, 0, 0.4);');
    expect(tokensScss).toContain('$knob-card: rgba(255, 255, 255, 0.04);');
    expect(tokensScss).toContain('$sheet-corner-radius: 24px;');
    expect(tokensScss).toContain('$snackbar-show: 4000ms;');
    expect(tokensScss).toContain('$overlay-fade: 150ms;');
    expect(tokensScss).toContain('$sheet-animation: 280ms;');
  });
});
