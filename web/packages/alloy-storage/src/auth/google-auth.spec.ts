import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it } from 'vitest';
import { GoogleAuth, type GoogleAuthConfig } from './google-auth';
import { IndexedDbTokenStore, MemoryTokenStore, type StoredTokens, type TokenStore } from './token-store';

const NOW = 1751980000000;
const config: GoogleAuthConfig = {
  clientId: 'cid',
  scope: 'https://www.googleapis.com/auth/drive.file',
  redirectUri: 'https://app.example/oauth',
  tokenServiceUrl: 'https://oauth.example',
};

function fakeSession(): Storage {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
  } as Storage;
}

/** The CSRF state GoogleAuth stashed in the pending-session entry. */
function stateOf(session: Storage): string {
  return (JSON.parse(session.getItem('alloy-storage.auth.pending')!) as { state: string }).state;
}

function jsonFetch(handler: (url: string, init?: RequestInit) => { status: number; body: unknown }) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fn: typeof fetch = async (input, init) => {
    const url = String(input);
    calls.push({ url, init });
    const { status, body } = handler(url, init);
    return new Response(JSON.stringify(body), { status });
  };
  return { fn, calls };
}

function auth(overrides: {
  stored?: StoredTokens | null;
  fetch?: typeof fetch;
  navigate?: (url: string) => void;
  session?: Storage;
  now?: number;
}) {
  const tokenStore = new MemoryTokenStore();
  const setup = async () => {
    if (overrides.stored) await tokenStore.save(overrides.stored);
    return new GoogleAuth(config, {
      tokenStore,
      fetchFn: overrides.fetch ?? jsonFetch(() => ({ status: 500, body: {} })).fn,
      now: () => overrides.now ?? NOW,
      navigate: overrides.navigate ?? (() => undefined),
      session: overrides.session ?? fakeSession(),
    });
  };
  return { tokenStore, setup };
}

describe('GoogleAuth', () => {
  it('returns a stored, still-fresh access token without any network call', async () => {
    const { fn, calls } = jsonFetch(() => ({ status: 500, body: {} }));
    const { setup } = auth({
      stored: { accessToken: 'at', expiresAt: NOW + 3_600_000, refreshToken: 'rt' },
      fetch: fn,
    });
    const a = await setup();
    expect(await a.accessToken()).toBe('at');
    expect(a.state).toBe('signedIn');
    expect(calls.length).toBe(0);
  });

  it('refreshes proactively when within 5 minutes of expiry, persisting the result', async () => {
    const { fn, calls } = jsonFetch(() => ({ status: 200, body: { accessToken: 'at2', expiresIn: 3599 } }));
    const { tokenStore, setup } = auth({
      stored: { accessToken: 'at', expiresAt: NOW + 60_000, refreshToken: 'rt' }, // < 5-min margin
      fetch: fn,
    });
    const a = await setup();
    expect(await a.accessToken()).toBe('at2');
    expect(calls[0].url).toBe('https://oauth.example/refresh');
    expect(JSON.parse(String(calls[0].init?.body))).toEqual({ refreshToken: 'rt' });
    expect((await tokenStore.load())?.accessToken).toBe('at2');
    expect((await tokenStore.load())?.expiresAt).toBe(NOW + 3599 * 1000);
    expect((await tokenStore.load())?.refreshToken).toBe('rt'); // kept
  });

  it('a rejected refresh (401) clears tokens and reports expired', async () => {
    const { fn } = jsonFetch(() => ({ status: 401, body: { error: 'invalid_grant' } }));
    const { tokenStore, setup } = auth({
      stored: { accessToken: 'at', expiresAt: NOW - 1, refreshToken: 'stale' },
      fetch: fn,
    });
    const a = await setup();
    expect(await a.accessToken()).toBeNull();
    expect(a.state).toBe('expired');
    expect(await tokenStore.load()).toBeNull();
  });

  it('a network-failed refresh returns null but keeps the refresh token for next time', async () => {
    const failing: typeof fetch = async () => {
      throw new TypeError('offline');
    };
    const { tokenStore, setup } = auth({
      stored: { accessToken: 'at', expiresAt: NOW - 1, refreshToken: 'rt' },
      fetch: failing,
    });
    const a = await setup();
    expect(await a.accessToken()).toBeNull();
    expect(a.state).toBe('expired');
    expect((await tokenStore.load())?.refreshToken).toBe('rt');
  });

  it('a 502 refresh keeps the refresh token for next time', async () => {
    const { fn } = jsonFetch(() => ({ status: 502, body: {} }));
    const { tokenStore, setup } = auth({
      stored: { accessToken: 'at', expiresAt: NOW - 1, refreshToken: 'rt' },
      fetch: fn,
    });
    const a = await setup();
    expect(await a.accessToken()).toBeNull();
    expect(a.state).toBe('expired');
    expect((await tokenStore.load())?.refreshToken).toBe('rt');
  });

  it('beginSignIn navigates to Google with PKCE + state, and completeSignIn exchanges the code', async () => {
    let navigated = '';
    const session = fakeSession();
    const { fn, calls } = jsonFetch(() => ({
      status: 200,
      body: { accessToken: 'at', refreshToken: 'rt', expiresIn: 3599 },
    }));
    const { tokenStore, setup } = auth({ fetch: fn, navigate: (u) => (navigated = u), session });
    const a = await setup();

    await a.beginSignIn();
    const authUrl = new URL(navigated);
    expect(authUrl.origin + authUrl.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    expect(authUrl.searchParams.get('client_id')).toBe('cid');
    expect(authUrl.searchParams.get('code_challenge_method')).toBe('S256');
    expect(authUrl.searchParams.get('access_type')).toBe('offline');
    expect(authUrl.searchParams.get('prompt')).toBe('consent');
    const state = authUrl.searchParams.get('state')!;

    const result = await a.completeSignIn(`https://app.example/oauth?code=c1&state=${state}`);
    expect(result).toEqual({ outcome: 'success' });
    expect(a.state).toBe('signedIn');
    const sent = JSON.parse(String(calls[0].init?.body));
    expect(calls[0].url).toBe('https://oauth.example/token');
    expect(sent.code).toBe('c1');
    expect(typeof sent.codeVerifier).toBe('string');
    expect(sent.redirectUri).toBe(config.redirectUri);
    expect((await tokenStore.load())?.refreshToken).toBe('rt');
  });

  it('completeSignIn reports exchangeFailed (never throws) when the fetch throws', async () => {
    let navigated = '';
    const session = fakeSession();
    const failing: typeof fetch = async () => {
      throw new TypeError('offline');
    };
    const { setup } = auth({ fetch: failing, navigate: (u) => (navigated = u), session });
    const a = await setup();
    await a.beginSignIn();
    const state = new URL(navigated).searchParams.get('state')!;

    await expect(
      a.completeSignIn(`https://app.example/oauth?code=c1&state=${state}`)
    ).resolves.toMatchObject({ outcome: 'failed', reason: 'exchangeFailed' });
    // no HTTP status on a network throw:
    const r = await a.completeSignIn(`https://app.example/oauth?code=c1&state=${state}`);
    expect(r).toMatchObject({ outcome: 'failed', reason: 'configurationInvalid' }); // 2nd call: pending entry consumed
    expect(a.state).not.toBe('signedIn');
  });

  it('completeSignIn rejects a state mismatch without exchanging', async () => {
    const { fn, calls } = jsonFetch(() => ({ status: 200, body: {} }));
    const session = fakeSession();
    const { setup } = auth({ fetch: fn, session });
    const a = await setup();
    await a.beginSignIn();
    expect(await a.completeSignIn('https://app.example/oauth?code=c1&state=WRONG')).toMatchObject({
      outcome: 'failed',
      reason: 'stateMismatch',
    });
    expect(calls.length).toBe(0);
  });

  it('completeSignIn without a pending session entry reports configurationInvalid', async () => {
    const { setup } = auth({});
    const a = await setup();
    expect(await a.completeSignIn('https://app.example/oauth?code=c1&state=x')).toMatchObject({
      outcome: 'failed',
      reason: 'configurationInvalid',
    });
    expect(a.state).not.toBe('signedIn');
  });

  it('completeSignIn maps a token-service rejection to exchangeFailed with the HTTP status', async () => {
    const { fn } = jsonFetch(() => ({ status: 401, body: { error: 'invalid_grant' } }));
    const session = fakeSession();
    const { setup } = auth({ fetch: fn, session });
    const a = await setup();
    await a.beginSignIn();
    const result = await a.completeSignIn(
      `https://app.example/oauth?code=c1&state=${stateOf(session)}`
    );
    expect(result).toMatchObject({ outcome: 'failed', reason: 'exchangeFailed', status: 401 });
  });

  it('completeSignIn maps a failing token store to vaultFailed with the underlying message', async () => {
    const { fn } = jsonFetch(() => ({
      status: 200,
      body: { accessToken: 'at', refreshToken: 'rt', expiresIn: 3599 },
    }));
    const session = fakeSession();
    const failingStore: TokenStore = {
      load: async () => null,
      save: async () => {
        throw new Error('quota exceeded');
      },
      clear: async () => undefined,
    };
    const a = new GoogleAuth(config, {
      tokenStore: failingStore,
      fetchFn: fn,
      now: () => NOW,
      navigate: () => undefined,
      session,
    });
    await a.beginSignIn();
    const result = await a.completeSignIn(`https://app.example/oauth?code=c1&state=${stateOf(session)}`);
    expect(result).toMatchObject({ outcome: 'failed', reason: 'vaultFailed' });
    expect((result as { detail: string }).detail).toContain('quota exceeded');
    expect(a.state).not.toBe('signedIn');
  });

  it('signOut clears the store and state', async () => {
    const { tokenStore, setup } = auth({
      stored: { accessToken: 'at', expiresAt: NOW + 3_600_000, refreshToken: 'rt' },
    });
    const a = await setup();
    await a.accessToken();
    await a.signOut();
    expect(a.state).toBe('signedOut');
    expect(await tokenStore.load()).toBeNull();
    expect(await a.accessToken()).toBeNull();
  });

  it('IndexedDbTokenStore round-trips tokens', async () => {
    const store = new IndexedDbTokenStore(new IDBFactory());
    expect(await store.load()).toBeNull();
    await store.save({ accessToken: 'at', expiresAt: 1, refreshToken: null });
    expect(await store.load()).toEqual({ accessToken: 'at', expiresAt: 1, refreshToken: null });
    await store.clear();
    expect(await store.load()).toBeNull();
  });
});
