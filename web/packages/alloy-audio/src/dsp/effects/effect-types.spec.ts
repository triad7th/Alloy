import { describe, expect, it } from 'vitest';
import {
  DEFAULT_MASTER_CONFIG,
  validateDelayParams,
  validateLimiterParams,
  validateMasterConfig,
  validateReverbParams,
} from './effect-types.js';

describe('validateMasterConfig', () => {
  it('accepts DEFAULT_MASTER_CONFIG', () => {
    expect(validateMasterConfig(DEFAULT_MASTER_CONFIG)).toEqual([]);
  });
});

describe('validateReverbParams', () => {
  it('accepts the default reverb params', () => {
    expect(validateReverbParams(DEFAULT_MASTER_CONFIG.reverb)).toEqual([]);
  });

  it('rejects predelayMs outside [0, 100]', () => {
    expect(validateReverbParams({ ...DEFAULT_MASTER_CONFIG.reverb, predelayMs: 101 })).not.toHaveLength(0);
  });

  it('rejects decay outside [0, 1]', () => {
    expect(validateReverbParams({ ...DEFAULT_MASTER_CONFIG.reverb, decay: 1.1 })).not.toHaveLength(0);
  });

  it('rejects damping outside [0, 1]', () => {
    expect(validateReverbParams({ ...DEFAULT_MASTER_CONFIG.reverb, damping: -0.1 })).not.toHaveLength(0);
  });

  it('rejects bandwidth outside [0, 1]', () => {
    expect(validateReverbParams({ ...DEFAULT_MASTER_CONFIG.reverb, bandwidth: 1.1 })).not.toHaveLength(0);
  });

  it('rejects modDepth outside [0, 1]', () => {
    expect(validateReverbParams({ ...DEFAULT_MASTER_CONFIG.reverb, modDepth: -0.1 })).not.toHaveLength(0);
  });

  it('rejects modRateHz outside (0, 5]', () => {
    expect(validateReverbParams({ ...DEFAULT_MASTER_CONFIG.reverb, modRateHz: 0 })).not.toHaveLength(0);
    expect(validateReverbParams({ ...DEFAULT_MASTER_CONFIG.reverb, modRateHz: 5.1 })).not.toHaveLength(0);
  });
});

describe('validateDelayParams', () => {
  it('accepts the default delay params', () => {
    expect(validateDelayParams(DEFAULT_MASTER_CONFIG.delay)).toEqual([]);
  });

  it('rejects an unknown mode', () => {
    expect(
      validateDelayParams({ ...DEFAULT_MASTER_CONFIG.delay, mode: 'bogus' as unknown as 'stereo' }),
    ).not.toHaveLength(0);
  });

  it('rejects timeMs outside (0, 2000]', () => {
    expect(validateDelayParams({ ...DEFAULT_MASTER_CONFIG.delay, timeMs: 0 })).not.toHaveLength(0);
    expect(validateDelayParams({ ...DEFAULT_MASTER_CONFIG.delay, timeMs: 2001 })).not.toHaveLength(0);
  });

  it('rejects feedback outside [0, 0.95]', () => {
    expect(validateDelayParams({ ...DEFAULT_MASTER_CONFIG.delay, feedback: 0.96 })).not.toHaveLength(0);
  });

  it('rejects damping outside [0, 1]', () => {
    expect(validateDelayParams({ ...DEFAULT_MASTER_CONFIG.delay, damping: 1.1 })).not.toHaveLength(0);
  });
});

describe('validateLimiterParams', () => {
  it('accepts the default limiter params', () => {
    expect(validateLimiterParams(DEFAULT_MASTER_CONFIG.limiter)).toEqual([]);
  });

  it('rejects ceilingDb outside [-24, 0]', () => {
    expect(validateLimiterParams({ ...DEFAULT_MASTER_CONFIG.limiter, ceilingDb: 0.1 })).not.toHaveLength(0);
  });

  it('rejects releaseMs outside (0, 1000]', () => {
    expect(validateLimiterParams({ ...DEFAULT_MASTER_CONFIG.limiter, releaseMs: 0 })).not.toHaveLength(0);
    expect(validateLimiterParams({ ...DEFAULT_MASTER_CONFIG.limiter, releaseMs: 1001 })).not.toHaveLength(0);
  });
});
