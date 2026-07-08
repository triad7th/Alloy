import { describe, it, expect } from 'vitest';
import { countryCodeForZone, ZONE_COUNTRY } from './zone-country';

describe('zone-country', () => {
  it('maps well-known zones to their ISO 3166-1 alpha-2 code', () => {
    expect(countryCodeForZone('Europe/London')).toBe('gb');
    expect(countryCodeForZone('Asia/Seoul')).toBe('kr');
    expect(countryCodeForZone('America/New_York')).toBe('us');
    expect(countryCodeForZone('Australia/Sydney')).toBe('au');
  });

  it('returns null for zones with no single country', () => {
    expect(countryCodeForZone('UTC')).toBeNull();
    expect(countryCodeForZone('Etc/GMT+5')).toBeNull();
    expect(countryCodeForZone('Not/AZone')).toBeNull();
  });

  it('exposes only 2-letter lowercase codes', () => {
    const codes = Object.values(ZONE_COUNTRY);
    expect(codes.length).toBeGreaterThan(300);
    for (const code of codes) {
      expect(code).toMatch(/^[a-z]{2}$/);
    }
  });
});
