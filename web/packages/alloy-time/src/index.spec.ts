import { describe, expect, it } from 'vitest';
import { ALLOY_TIME } from './index';

describe('package', () => {
  it('builds and links', () => {
    expect(ALLOY_TIME).toBe('alloy-time');
  });
});
