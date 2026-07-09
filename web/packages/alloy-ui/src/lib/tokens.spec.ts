import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { AUTO_HIDE_MS, SHEET_ANIMATION_MS } from './tokens';

const stylesUrl = new URL('../styles/_tokens.scss', import.meta.url);

describe('tokens', () => {
  it('exposes the twin-agreed durations', () => {
    expect(SHEET_ANIMATION_MS).toBe(280);
    expect(AUTO_HIDE_MS).toBe(4000);
  });

  it('generated SCSS carries the twin-agreed spot values', () => {
    const scss = readFileSync(fileURLToPath(stylesUrl), 'utf8');
    expect(scss).toContain('$tint: #0a84ff;');
    expect(scss).toContain('$secondary-surface: rgba(118, 118, 128, 0.24);');
    expect(scss).toContain('$backdrop: rgba(0, 0, 0, 0.5);');
  });
});
