import { describe, expect, it } from 'vitest';
// Bundler-safe raw import: @angular/build's esbuild pipeline resolves the
// `loader: 'text'` import attribute (Vite's `?raw` suffix is not supported here).
import tokensScss from '../styles/_tokens.scss' with { loader: 'text' };
import { AUTO_HIDE_MS, SHEET_ANIMATION_MS } from './tokens';

describe('tokens', () => {
  it('exposes the twin-agreed durations', () => {
    expect(SHEET_ANIMATION_MS).toBe(280);
    expect(AUTO_HIDE_MS).toBe(4000);
  });

  it('generated SCSS carries the twin-agreed spot values', () => {
    expect(tokensScss).toContain('$tint: #0a84ff;');
    expect(tokensScss).toContain('$secondary-surface: rgba(118, 118, 128, 0.24);');
    expect(tokensScss).toContain('$backdrop: rgba(0, 0, 0, 0.5);');
    expect(tokensScss).toContain('$knob-card: rgba(255, 255, 255, 0.04);');
  });
});
