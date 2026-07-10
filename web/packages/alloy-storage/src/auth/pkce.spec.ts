import { describe, expect, it } from 'vitest';
import { codeChallenge, generateCodeVerifier } from './pkce';

describe('PKCE', () => {
  it('matches the RFC 7636 appendix B vector', async () => {
    // Twin fixture: swift/Tests/AlloyStorageTests/PKCETests.swift
    expect(await codeChallenge('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk')).toBe(
      'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM'
    );
  });

  it('generates 64-char base64url verifiers, unique per call', () => {
    const a = generateCodeVerifier();
    const b = generateCodeVerifier();
    expect(a).toMatch(/^[A-Za-z0-9\-_]{64}$/);
    expect(a).not.toBe(b);
  });
});
