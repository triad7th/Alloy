import { describe, expect, it } from 'vitest';
import { createDriveStorage } from './drive-storage';
import { GoogleAuth } from '../../auth/google-auth';
import { MemoryTokenStore } from '../../auth/token-store';
import { isShareable } from '../../core/shareable';

/** Twin fixture: swift/Tests/AlloyStorageTests/DriveStorageTests.swift. */
const config = {
  clientId: 'cid',
  redirectUri: 'https://app.example/',
  tokenServiceUrl: 'https://oauth.example',
  folderPath: 'AllyWorld/Harness',
};

function fakeSession(): Storage {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
  } as Storage;
}

describe('createDriveStorage', () => {
  it('wires a working auth + shareable backend from one config', async () => {
    const urls: string[] = [];
    const fetchFn: typeof fetch = async (input) => {
      urls.push(String(input));
      return new Response(JSON.stringify({ files: [{ id: 'f1' }] }), { status: 200 });
    };
    const store = new MemoryTokenStore();
    const { auth, backend } = createDriveStorage(config, {
      auth: {
        tokenStore: store,
        now: () => 0,
        navigate: () => undefined,
        session: fakeSession(),
      },
      fetchFn,
      cache: null,
    });
    expect(auth).toBeInstanceOf(GoogleAuth);
    expect(isShareable(backend)).toBe(true);
    // The backend's Drive calls flow through the injected fetch, and the
    // folder path from config drives resolution:
    await store.save({ accessToken: 'at', expiresAt: 3_600_000, refreshToken: null });
    await backend.list();
    expect(urls.some((u) => u.includes(encodeURIComponent("name='AllyWorld'")) || u.includes('AllyWorld'))).toBe(true);
  });

  it('defaults scope to drive.file (visible in the beginSignIn URL)', async () => {
    let navigated = '';
    const session = fakeSession();
    const { auth } = createDriveStorage(config, {
      auth: {
        tokenStore: new MemoryTokenStore(),
        now: () => 0,
        navigate: (u) => (navigated = u),
        session,
      },
      fetchFn: async () => new Response('{}'),
      cache: null,
    });
    await auth.beginSignIn();
    expect(new URL(navigated).searchParams.get('scope')).toBe(
      'https://www.googleapis.com/auth/drive.file'
    );
  });

  it('honors an explicit scope override', async () => {
    let navigated = '';
    const { auth } = createDriveStorage(
      { ...config, scope: 'custom-scope' },
      {
        auth: {
          tokenStore: new MemoryTokenStore(),
          now: () => 0,
          navigate: (u) => (navigated = u),
          session: fakeSession(),
        },
        fetchFn: async () => new Response('{}'),
        cache: null,
      }
    );
    await auth.beginSignIn();
    expect(new URL(navigated).searchParams.get('scope')).toBe('custom-scope');
  });
});
