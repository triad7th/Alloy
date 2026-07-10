import type { AuthProvider, AuthState } from '../core/auth.js';
import { codeChallenge, generateCodeVerifier } from './pkce.js';
import { IndexedDbTokenStore, type StoredTokens, type TokenStore } from './token-store.js';

const AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
const SESSION_KEY = 'alloy-storage.auth.pending';
/** Refresh this long before nominal expiry (spec: proactive ~5 min). */
const FRESH_MARGIN_MS = 5 * 60_000;

export interface GoogleAuthConfig {
  clientId: string;
  scope: string;
  redirectUri: string;
  /** Base URL of the deployed services/google-oauth function. */
  tokenServiceUrl: string;
}

export interface GoogleAuthDeps {
  tokenStore?: TokenStore;
  fetchFn?: typeof fetch;
  now?: () => number;
  navigate?: (url: string) => void;
  session?: Storage;
}

interface TokenResponse {
  accessToken: string;
  refreshToken?: string;
  expiresIn: number;
}

/** Web Google auth: authorization-code + PKCE via the shared token service.
 *  Durable sessions — the refresh token persists in IndexedDB. */
export class GoogleAuth implements AuthProvider {
  private _state: AuthState = 'signedOut';
  private readonly tokenStore: TokenStore;
  private readonly fetchFn: typeof fetch;
  private readonly now: () => number;
  private readonly navigate: (url: string) => void;
  private readonly session: Storage;

  constructor(
    private readonly config: GoogleAuthConfig,
    deps: GoogleAuthDeps = {}
  ) {
    this.tokenStore = deps.tokenStore ?? new IndexedDbTokenStore();
    this.fetchFn = deps.fetchFn ?? fetch.bind(globalThis);
    this.now = deps.now ?? Date.now;
    this.navigate = deps.navigate ?? ((url) => location.assign(url));
    this.session = deps.session ?? sessionStorage;
  }

  get state(): AuthState {
    return this._state;
  }

  /** Stash PKCE verifier + state, then send the browser to Google. */
  async beginSignIn(): Promise<void> {
    const verifier = generateCodeVerifier();
    const state = generateCodeVerifier().slice(0, 32);
    this.session.setItem(SESSION_KEY, JSON.stringify({ verifier, state }));
    const url = new URL(AUTH_ENDPOINT);
    url.searchParams.set('client_id', this.config.clientId);
    url.searchParams.set('redirect_uri', this.config.redirectUri);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('scope', this.config.scope);
    url.searchParams.set('code_challenge', await codeChallenge(verifier));
    url.searchParams.set('code_challenge_method', 'S256');
    url.searchParams.set('access_type', 'offline'); // ask for a refresh token
    url.searchParams.set('prompt', 'consent'); // Google only reissues refresh tokens on consent
    url.searchParams.set('state', state);
    this.navigate(url.toString());
  }

  /** Call on the redirect page. Returns false on state mismatch / missing code,
   *  and — per contract (mirrored by the Swift twin) — on ANY thrown error:
   *  a corrupted session entry (JSON.parse) or a network-failed exchange
   *  (this.post) must resolve false, never reject. */
  async completeSignIn(callbackUrl: string): Promise<boolean> {
    const pending = this.session.getItem(SESSION_KEY);
    this.session.removeItem(SESSION_KEY);
    if (!pending) return false;
    try {
      const { verifier, state } = JSON.parse(pending) as { verifier: string; state: string };
      const params = new URL(callbackUrl).searchParams;
      const code = params.get('code');
      if (!code || params.get('state') !== state) return false;
      const res = await this.post('/token', {
        code,
        codeVerifier: verifier,
        redirectUri: this.config.redirectUri,
      });
      if (!res.ok) return false;
      await this.tokenStore.save({
        accessToken: res.data.accessToken,
        expiresAt: this.now() + res.data.expiresIn * 1000,
        refreshToken: res.data.refreshToken ?? null,
      });
      this._state = 'signedIn';
      return true;
    } catch {
      return false;
    }
  }

  async accessToken(): Promise<string | null> {
    const stored = await this.tokenStore.load();
    if (!stored) {
      this._state = 'signedOut';
      return null;
    }
    if (this.now() < stored.expiresAt - FRESH_MARGIN_MS) {
      this._state = 'signedIn';
      return stored.accessToken;
    }
    return this.refresh(stored);
  }

  private async refresh(stored: StoredTokens): Promise<string | null> {
    if (!stored.refreshToken) {
      this._state = 'expired';
      return null;
    }
    let res: Awaited<ReturnType<GoogleAuth['post']>>;
    try {
      res = await this.post('/refresh', { refreshToken: stored.refreshToken });
    } catch {
      // Network failure: keep the refresh token for the next attempt.
      this._state = 'expired';
      return null;
    }
    if (!res.ok) {
      if (res.status === 401) {
        // Google refused the grant (revoked/stale) — a new sign-in is required.
        await this.tokenStore.clear();
      }
      // Any other non-OK status (502, 500, 403...) is treated like a network
      // failure — service/Google trouble, not a rejected grant — so the
      // refresh token is kept for the next attempt.
      this._state = 'expired';
      return null;
    }
    const next: StoredTokens = {
      accessToken: res.data.accessToken,
      expiresAt: this.now() + res.data.expiresIn * 1000,
      refreshToken: stored.refreshToken,
    };
    await this.tokenStore.save(next);
    this._state = 'signedIn';
    return next.accessToken;
  }

  /** Best-effort revoke at Google, then wipe. Offline sign-out still signs out. */
  async signOut(): Promise<void> {
    const stored = await this.tokenStore.load();
    if (stored) {
      const token = stored.refreshToken ?? stored.accessToken;
      try {
        await this.fetchFn(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(token)}`, {
          method: 'POST',
        });
      } catch {
        /* revoke is best-effort */
      }
    }
    await this.tokenStore.clear();
    this._state = 'signedOut';
  }

  /** POST JSON to the token service. 2xx → parsed body; non-OK → the status,
   *  so callers can distinguish a rejected grant (401) from a service/Google
   *  outage (502 etc). Network errors still throw. */
  private async post(
    path: string,
    body: object
  ): Promise<{ ok: true; data: TokenResponse } | { ok: false; status: number }> {
    const res = await this.fetchFn(`${this.config.tokenServiceUrl}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) return { ok: false, status: res.status };
    return { ok: true, data: (await res.json()) as TokenResponse };
  }
}
