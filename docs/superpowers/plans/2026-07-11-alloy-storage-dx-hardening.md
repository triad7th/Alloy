# AlloyStorage DX Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace sign-in Bool results with a diagnosable `SignInResult` on both platforms and add a `DriveStorage` factory that wires GoogleAuth + DriveClient + DriveBackend from one config.

**Architecture:** `SignInResult` is a strict-mirrored discriminated union (`success | cancelled | failed(reason, detail, status?)`) returned by web `completeSignIn` and Swift `signIn`; every currently-silent `return false` maps to a named reason. `createDriveStorage` (TS) / `DriveStorage` (Swift struct) construct the three-object stack, keeping DriveClient internal. Spec: `docs/superpowers/specs/2026-07-11-alloy-storage-dx-hardening-design.md` (the failure-mapping table there is binding).

**Tech Stack:** Pure TypeScript (Vitest), Swift 6 (swift-testing), no new dependencies. Package is unreleased — the Bool signature break needs no shims; harnesses migrate in Task 5.

## Global Constraints

- NodeNext `.js` extensions in non-spec TS source; zero runtime deps; web from `web/` (`npm test -w @allyworld/alloy-storage`), Swift from REPO ROOT (`swift build && swift test --filter AlloyStorageTests`).
- Failure mapping (from the spec, binding): missing/corrupt pending entry, malformed callback URL, bad auth URL, no uiSession/platform → `configurationInvalid`; state mismatch or missing code → `stateMismatch`; token endpoint non-OK → `exchangeFailed` with `status`; token exchange network throw → `exchangeFailed` without status; vault/store save throw → `vaultFailed` with the underlying error message as `detail`; ASWebAuthenticationSession user cancel → `cancelled`.
- `_state`/`setState` transitions unchanged: `signedIn` ONLY on success.
- `accessToken()`, `AuthProvider`, `beginSignIn()` signatures untouched.
- `scope` default in both factory configs: `https://www.googleapis.com/auth/drive.file`.
- Commits: conventional style, imperative subject ≤ 72 chars.

## File Structure

```
web/packages/alloy-storage/src/core/sign-in-result.ts        SignInFailureReason, SignInResult (+ index export)
web/packages/alloy-storage/src/auth/google-auth.ts           completeSignIn returns SignInResult
web/packages/alloy-storage/src/auth/google-auth.spec.ts      updated + new failure-path tests
web/packages/alloy-storage/src/backends/drive/drive-storage.ts     createDriveStorage (+ index export)
web/packages/alloy-storage/src/backends/drive/drive-storage.spec.ts
swift/Sources/AlloyStorage/Core/SignInResult.swift
swift/Sources/AlloyStorage/Auth/GoogleAuth.swift              signIn returns SignInResult; cancel mapping in DefaultAuthUISession
swift/Sources/AlloyStorage/Backends/Drive/DriveStorage.swift
swift/Tests/AlloyStorageTests/GoogleAuthTests.swift           updated + new failure-path tests
swift/Tests/AlloyStorageTests/DriveStorageTests.swift
examples/web-harness/src/app/sections/storage-section.component.ts   factory + result display
examples/apple-harness/Sources/AlloyHarness/StorageDemoView.swift    factory + result display
docs/mirroring.md
```

---

### Task 1: TS SignInResult + completeSignIn migration

**Files:**
- Create: `web/packages/alloy-storage/src/core/sign-in-result.ts`
- Modify: `web/packages/alloy-storage/src/auth/google-auth.ts:79-104` (completeSignIn), `web/packages/alloy-storage/src/index.ts` (export)
- Test: `web/packages/alloy-storage/src/auth/google-auth.spec.ts`

**Interfaces:**
- Consumes: existing `GoogleAuth` internals — `SESSION_KEY`, `this.session`, `this.post(path, body)` returning `{ ok: true; data } | { ok: false; status }` (network errors throw), `this.tokenStore.save`, `this.now()`, `this._state`.
- Produces:

```ts
export type SignInFailureReason =
  | 'configurationInvalid' | 'stateMismatch' | 'exchangeFailed' | 'vaultFailed';
export type SignInResult =
  | { outcome: 'success' }
  | { outcome: 'cancelled' }
  | { outcome: 'failed'; reason: SignInFailureReason; detail: string; status?: number };
// GoogleAuth.completeSignIn(callbackUrl: string): Promise<SignInResult>   (was Promise<boolean>)
```

- [ ] **Step 1: Update the three existing completeSignIn tests and add three new ones**

In `google-auth.spec.ts`, change the existing assertions:

```ts
// in 'beginSignIn navigates …' (line ~141):
    const result = await a.completeSignIn(`https://app.example/oauth?code=c1&state=${state}`);
    expect(result).toEqual({ outcome: 'success' });

// in 'completeSignIn resolves false (never throws) when the token exchange fetch throws'
// — rename to 'completeSignIn reports exchangeFailed (never throws) when the fetch throws':
    await expect(
      a.completeSignIn(`https://app.example/oauth?code=c1&state=${state}`)
    ).resolves.toMatchObject({ outcome: 'failed', reason: 'exchangeFailed' });
    // no HTTP status on a network throw:
    const r = await a.completeSignIn(`https://app.example/oauth?code=c1&state=${state}`);
    expect(r).toMatchObject({ outcome: 'failed', reason: 'configurationInvalid' }); // 2nd call: pending entry consumed

// in 'completeSignIn rejects a state mismatch without exchanging' (line ~175):
    expect(await a.completeSignIn('https://app.example/oauth?code=c1&state=WRONG')).toMatchObject({
      outcome: 'failed',
      reason: 'stateMismatch',
    });
```

Add three new tests inside the same describe, reusing the file's `auth()` helper and `jsonFetch`:

```ts
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
```

Existing tests capture `state` from the navigated URL; the two new tests above read it from the session instead (no navigate capture wired). Add this small helper near `fakeSession()`:

```ts
/** The CSRF state GoogleAuth stashed in the pending-session entry. */
function stateOf(session: Storage): string {
  return (JSON.parse(session.getItem('alloy-storage.auth.pending')!) as { state: string }).state;
}
```

(Also simplify the exchange-401 test to use `stateOf(session)` only — remove the `new URL(...)` line entirely; it was illustrative noise.) Import `type TokenStore` from `./token-store` and `GoogleAuth, type GoogleAuthConfig` as already imported; import nothing new from vitest.

- [ ] **Step 2: Run to verify failures**

`npm test -w @allyworld/alloy-storage` (from web/) → FAIL: type errors (`completeSignIn` returns boolean) and assertion failures.

- [ ] **Step 3: Implement**

`web/packages/alloy-storage/src/core/sign-in-result.ts`:

```ts
/** Why a sign-in failed — the phase, not user-facing copy. */
export type SignInFailureReason =
  | 'configurationInvalid' // bad auth URL / missing or corrupt pending-session entry / no auth UI
  | 'stateMismatch' // CSRF state check failed, or no code in the callback
  | 'exchangeFailed' // token endpoint rejected or unreachable
  | 'vaultFailed'; // token persistence failed (IndexedDB / Keychain)

/** Result of completeSignIn (web) / signIn (Apple). `cancelled` is a normal
 *  outcome, not an error; `detail` is for developers (logs, status lines),
 *  never end-user copy. */
export type SignInResult =
  | { outcome: 'success' }
  | { outcome: 'cancelled' }
  | { outcome: 'failed'; reason: SignInFailureReason; detail: string; status?: number };
```

Replace `completeSignIn` in `google-auth.ts` (imports gain `type SignInResult` from `../core/sign-in-result.js`):

```ts
  /** Call on the redirect page. Never throws — every failure is a named
   *  SignInResult reason (the web redirect flow has no cancel signal, so
   *  `cancelled` never occurs here; an abandoned redirect simply never
   *  calls this). */
  async completeSignIn(callbackUrl: string): Promise<SignInResult> {
    const failed = (
      reason: SignInFailureReason,
      detail: string,
      status?: number
    ): SignInResult =>
      status === undefined
        ? { outcome: 'failed', reason, detail }
        : { outcome: 'failed', reason, detail, status };

    const pending = this.session.getItem(SESSION_KEY);
    this.session.removeItem(SESSION_KEY); // one-shot: consumed before validation
    if (!pending) return failed('configurationInvalid', 'no pending sign-in session');

    let verifier: string;
    let state: string;
    let code: string | null;
    let callbackState: string | null;
    try {
      ({ verifier, state } = JSON.parse(pending) as { verifier: string; state: string });
      const params = new URL(callbackUrl).searchParams;
      code = params.get('code');
      callbackState = params.get('state');
    } catch (e) {
      return failed('configurationInvalid', `corrupt session entry or callback URL: ${String(e)}`);
    }
    if (!code) return failed('stateMismatch', 'no code in callback URL');
    if (callbackState !== state) return failed('stateMismatch', 'state parameter mismatch');

    let res: Awaited<ReturnType<GoogleAuth['post']>>;
    try {
      res = await this.post('/token', {
        code,
        codeVerifier: verifier,
        redirectUri: this.config.redirectUri,
      });
    } catch (e) {
      return failed('exchangeFailed', `token exchange unreachable: ${String(e)}`);
    }
    if (!res.ok) return failed('exchangeFailed', 'token service rejected the exchange', res.status);

    try {
      await this.tokenStore.save({
        accessToken: res.data.accessToken,
        expiresAt: this.now() + res.data.expiresIn * 1000,
        refreshToken: res.data.refreshToken ?? null,
      });
    } catch (e) {
      return failed('vaultFailed', e instanceof Error ? e.message : String(e));
    }
    this._state = 'signedIn';
    return { outcome: 'success' };
  }
```

(If `this.post`'s return type isn't nameable via `GoogleAuth['post']` because it's private, declare the local as `{ ok: true; data: { accessToken: string; refreshToken?: string; expiresIn: number } } | { ok: false; status: number }` to match the existing private signature.) Add to `src/index.ts`:

```ts
export * from './core/sign-in-result.js';
```

- [ ] **Step 4: Run to verify pass**

`npm test -w @allyworld/alloy-storage` → PASS; `npm run build -w @allyworld/alloy-storage` → clean.

- [ ] **Step 5: Commit**

```bash
git add web/packages/alloy-storage
git commit -m "feat(storage): completeSignIn returns diagnosable SignInResult"
```

---

### Task 2: Swift SignInResult + signIn migration

**Files:**
- Create: `swift/Sources/AlloyStorage/Core/SignInResult.swift`
- Modify: `swift/Sources/AlloyStorage/Auth/GoogleAuth.swift` (`signIn()` body; `DefaultAuthUISession` cancel mapping)
- Test: `swift/Tests/AlloyStorageTests/GoogleAuthTests.swift`

**Interfaces:**
- Consumes: existing `GoogleAuth` internals (`uiSession`, `transport.send`, `vault.save`, `setState`, `tokenRequest`, `GoogleTokenResponse`); the TS mapping from Task 1 as the canon.
- Produces:

```swift
public enum SignInFailureReason: String, Sendable {
  case configurationInvalid, stateMismatch, exchangeFailed, vaultFailed
}
public enum SignInResult: Equatable, Sendable {
  case success
  case cancelled
  case failed(reason: SignInFailureReason, detail: String, status: Int?)
}
// GoogleAuth.signIn() async -> SignInResult   (was Bool)
```

Cancel signalling contract: `AuthUISession.authenticate` throws Swift's
`CancellationError` for user-cancel; `DefaultAuthUISession` translates
`ASWebAuthenticationSessionError.canceledLogin` (and the nil-URL-nil-error
case) into `CancellationError` before resuming.

- [ ] **Step 1: Update existing tests and add failure-path tests**

In `GoogleAuthTests.swift`:

```swift
// signInRunsUISessionThenExchangesCode: replace `#expect(await auth.signIn())` with:
    #expect(await auth.signIn() == .success)
```

Add new tests to the suite (reusing `makeAuth`, `ScriptedTransport`, `nowFixed`):

```swift
  @Test func signInWithoutUISessionReportsConfigurationInvalid() async {
    let vault = MemoryTokenVault()
    let config = GoogleAuthConfig(clientId: "cid", scope: "s", redirectScheme: "r")
    let auth = GoogleAuth(
      config: config, vault: vault, transport: ScriptedTransport([]), uiSession: nil,
      now: { nowFixed })
    guard case .failed(let reason, _, _) = await auth.signIn() else {
      Issue.record("expected failed")
      return
    }
    #expect(reason == .configurationInvalid)
  }

  @Test func signInMapsUserCancelToCancelled() async {
    struct CancellingUI: AuthUISession {
      func authenticate(url: URL, callbackScheme: String) async throws -> URL {
        throw CancellationError()
      }
    }
    let (auth, _) = makeAuth(uiSession: CancellingUI())
    #expect(await auth.signIn() == .cancelled)
    #expect(auth.state != .signedIn)
  }

  @Test func signInMapsWrongStateToStateMismatch() async {
    struct WrongStateUI: AuthUISession {
      func authenticate(url: URL, callbackScheme: String) async throws -> URL {
        URL(string: "\(callbackScheme)://oauth?code=c1&state=WRONG")!
      }
    }
    let (auth, _) = makeAuth(uiSession: WrongStateUI())
    guard case .failed(let reason, _, _) = await auth.signIn() else {
      Issue.record("expected failed")
      return
    }
    #expect(reason == .stateMismatch)
  }

  @Test func signInMapsExchangeRejectionToExchangeFailedWithStatus() async {
    let transport = ScriptedTransport([
      .init(matches: { $0.httpMethod == "POST" }, body: #"{"error":"invalid_grant"}"#, status: 400)
    ])
    let (auth, _) = makeAuth(transport: transport, uiSession: EchoStateUI())
    guard case .failed(let reason, _, let status) = await auth.signIn() else {
      Issue.record("expected failed")
      return
    }
    #expect(reason == .exchangeFailed)
    #expect(status == 400)
  }

  @Test func signInMapsVaultFailureToVaultFailed() async {
    final class FailingVault: TokenVault, @unchecked Sendable {
      func load() throws -> StoredTokens? { nil }
      func save(_ tokens: StoredTokens) throws {
        throw StorageError(category: .unreachable, message: "keychain says no")
      }
      func clear() throws {}
    }
    let transport = ScriptedTransport([
      .init(matches: { $0.httpMethod == "POST" },
            body: #"{"access_token":"at","refresh_token":"rt","expires_in":3599}"#, status: 200)
    ])
    let config = GoogleAuthConfig(
      clientId: "cid", scope: "https://www.googleapis.com/auth/drive.file", redirectScheme: "com.example.app")
    let auth = GoogleAuth(
      config: config, vault: FailingVault(), transport: transport, uiSession: EchoStateUI(),
      now: { nowFixed })
    guard case .failed(let reason, let detail, _) = await auth.signIn() else {
      Issue.record("expected failed")
      return
    }
    #expect(reason == .vaultFailed)
    #expect(detail.contains("keychain says no"))
    #expect(auth.state != .signedIn)
  }
```

The existing `signInRunsUISessionThenExchangesCode` test defines a state-echoing stub inline; hoist it to a file-scope `EchoStateUI` struct (same body — echoes the request's `state` back with `code=c1`) so the new tests reuse it, and update that test to use `EchoStateUI` too. If `makeAuth` lacks a `uiSession` parameter or preloaded-vault flexibility, extend it mechanically (default `uiSession: nil` preserved for existing call sites).

- [ ] **Step 2: Run to verify failures**

`swift test --filter AlloyStorageTests` (repo root) → FAIL: `signIn()` returns Bool; `SignInResult` not found.

- [ ] **Step 3: Implement**

`swift/Sources/AlloyStorage/Core/SignInResult.swift`:

```swift
/// Why a sign-in failed — the phase, not user-facing copy.
public enum SignInFailureReason: String, Sendable {
  case configurationInvalid // bad auth URL / no auth UI available on this platform
  case stateMismatch // CSRF state check failed, or no code in the callback
  case exchangeFailed // token endpoint rejected or unreachable
  case vaultFailed // token persistence failed (Keychain)
}

/// Result of signIn (Apple) / completeSignIn (web). `cancelled` is a normal
/// outcome, not an error; `detail` is for developers (logs, status lines),
/// never end-user copy. Twin of core/sign-in-result.ts.
public enum SignInResult: Equatable, Sendable {
  case success
  case cancelled
  case failed(reason: SignInFailureReason, detail: String, status: Int?)
}
```

In `GoogleAuth.signIn()`, change the signature to `public func signIn() async -> SignInResult` and map each existing `return false` per the binding table:

```swift
  public func signIn() async -> SignInResult {
    guard let uiSession else {
      return .failed(
        reason: .configurationInvalid,
        detail: "no auth UI session available on this platform", status: nil)
    }
    // … verifier/challenge/requestState/redirectUri/authComponents unchanged …
    guard let authURL = authComponents.url else {
      return .failed(reason: .configurationInvalid, detail: "could not build auth URL", status: nil)
    }

    let callbackURL: URL
    do {
      callbackURL = try await uiSession.authenticate(url: authURL, callbackScheme: config.redirectScheme)
    } catch is CancellationError {
      return .cancelled
    } catch {
      return .failed(
        reason: .configurationInvalid,
        detail: "auth UI failed: \(String(describing: error))", status: nil)
    }

    guard
      let callbackComponents = URLComponents(url: callbackURL, resolvingAgainstBaseURL: false),
      let code = callbackComponents.queryItems?.first(where: { $0.name == "code" })?.value
    else {
      return .failed(reason: .stateMismatch, detail: "no code in callback URL", status: nil)
    }
    guard callbackComponents.queryItems?.first(where: { $0.name == "state" })?.value == requestState
    else {
      return .failed(reason: .stateMismatch, detail: "state parameter mismatch", status: nil)
    }

    // … tokenRequest unchanged …
    let data: Data
    let response: HTTPURLResponse
    do {
      (data, response) = try await transport.send(request)
    } catch {
      return .failed(
        reason: .exchangeFailed,
        detail: "token exchange unreachable: \(String(describing: error))", status: nil)
    }
    guard (200..<300).contains(response.statusCode) else {
      return .failed(
        reason: .exchangeFailed, detail: "Google rejected the exchange",
        status: response.statusCode)
    }
    guard let decoded = try? JSONDecoder().decode(GoogleTokenResponse.self, from: data) else {
      return .failed(
        reason: .exchangeFailed, detail: "undecodable token response",
        status: response.statusCode)
    }

    let tokens = StoredTokens(
      accessToken: decoded.accessToken,
      expiresAt: now().addingTimeInterval(decoded.expiresIn),
      refreshToken: decoded.refreshToken)
    do {
      try vault.save(tokens)
    } catch {
      return .failed(
        reason: .vaultFailed, detail: String(describing: error), status: nil)
    }
    setState(.signedIn)
    return .success
  }
```

(The `guard (try? vault.save…)` form becomes the do/catch above so the underlying error reaches `detail`. Everything elided with `…` stays byte-identical to the current implementation.)

In `DefaultAuthUISession.authenticate`'s completion handler, translate cancel before resuming:

```swift
        ) { [weak self] callbackURL, error in
          self?.currentSession = nil
          if let callbackURL {
            continuation.resume(returning: callbackURL)
          } else if let error, (error as? ASWebAuthenticationSessionError)?.code == .canceledLogin {
            continuation.resume(throwing: CancellationError())
          } else if let error {
            continuation.resume(throwing: error)
          } else {
            // No URL and no error: treat as user cancel.
            continuation.resume(throwing: CancellationError())
          }
        }
```

Document the contract on the protocol: add to `AuthUISession`'s doc comment: `/// Throws CancellationError when the user cancels the auth UI.`

- [ ] **Step 4: Run to verify pass**

`swift build && swift test --filter AlloyStorageTests` → all PASS, no new warnings. (The apple-harness will NOT build until Task 5 — that's expected; do not touch it here.)

- [ ] **Step 5: Commit**

```bash
git add swift/Sources/AlloyStorage swift/Tests/AlloyStorageTests
git commit -m "feat(storage): Swift signIn returns diagnosable SignInResult"
```

---

### Task 3: TS createDriveStorage factory

**Files:**
- Create: `web/packages/alloy-storage/src/backends/drive/drive-storage.ts`
- Modify: `web/packages/alloy-storage/src/index.ts` (export)
- Test: `web/packages/alloy-storage/src/backends/drive/drive-storage.spec.ts`

**Interfaces:**
- Consumes: `GoogleAuth(config, deps)` + `GoogleAuthDeps` (auth/google-auth.ts), `DriveClient(auth, fetchFn?)`, `DriveBackend(client, folderPath, cache?)`.
- Produces:

```ts
export interface DriveStorageConfig {
  clientId: string;
  redirectUri: string;
  tokenServiceUrl: string;
  folderPath: string;
  /** Defaults to 'https://www.googleapis.com/auth/drive.file'. */
  scope?: string;
}
export interface DriveStorageDeps {
  auth?: GoogleAuthDeps;
  fetchFn?: typeof fetch;              // Drive REST transport
  cache?: Storage | null;              // folder-id cache
}
export interface DriveStorage { auth: GoogleAuth; backend: DriveBackend; }
export function createDriveStorage(config: DriveStorageConfig, deps?: DriveStorageDeps): DriveStorage;
```

- [ ] **Step 1: Write the failing spec**

`drive-storage.spec.ts`:

```ts
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
    const { auth, backend } = createDriveStorage(config, {
      auth: {
        tokenStore: new MemoryTokenStore(),
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
    await auth['tokenStore'].save({ accessToken: 'at', expiresAt: 60_000, refreshToken: null });
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
```

Note on the first test: `auth['tokenStore']` reaches a private field via index access — if tsc rejects it under the package's strictness, instead preload the store before construction (`const store = new MemoryTokenStore(); await store.save({...}); createDriveStorage(config, { auth: { tokenStore: store, ... } })`) — that form is also cleaner; prefer it.

- [ ] **Step 2: Run to verify it fails**

`npm test -w @allyworld/alloy-storage` → FAIL: cannot resolve `./drive-storage`.

- [ ] **Step 3: Implement**

`drive-storage.ts`:

```ts
import { GoogleAuth, type GoogleAuthDeps } from '../../auth/google-auth.js';
import { DriveBackend } from './drive-backend.js';
import { DriveClient } from './drive-client.js';

const DEFAULT_SCOPE = 'https://www.googleapis.com/auth/drive.file';

export interface DriveStorageConfig {
  clientId: string;
  redirectUri: string;
  tokenServiceUrl: string;
  /** Folder path find-or-created from the Drive root, e.g. 'AllyWorld/AllyClock'. */
  folderPath: string;
  /** Defaults to drive.file — the app sees only files it created. */
  scope?: string;
}

/** Injection seams, forwarded to the underlying pieces (tests, custom transports). */
export interface DriveStorageDeps {
  auth?: GoogleAuthDeps;
  fetchFn?: typeof fetch;
  cache?: Storage | null;
}

export interface DriveStorage {
  auth: GoogleAuth;
  backend: DriveBackend;
}

/** One-call wiring of the Drive stack: GoogleAuth → DriveClient → DriveBackend.
 *  The client is internal plumbing; apps keep the two objects they use.
 *  Sugar, not a seal — the individual constructors remain public. */
export function createDriveStorage(
  config: DriveStorageConfig,
  deps: DriveStorageDeps = {}
): DriveStorage {
  const auth = new GoogleAuth(
    {
      clientId: config.clientId,
      scope: config.scope ?? DEFAULT_SCOPE,
      redirectUri: config.redirectUri,
      tokenServiceUrl: config.tokenServiceUrl,
    },
    deps.auth ?? {}
  );
  const client = deps.fetchFn ? new DriveClient(auth, deps.fetchFn) : new DriveClient(auth);
  const backend =
    deps.cache === undefined
      ? new DriveBackend(client, config.folderPath)
      : new DriveBackend(client, config.folderPath, deps.cache);
  return { auth, backend };
}
```

Add to `src/index.ts`:

```ts
export * from './backends/drive/drive-storage.js';
```

- [ ] **Step 4: Run to verify pass**

`npm test -w @allyworld/alloy-storage` → PASS; build clean.

- [ ] **Step 5: Commit**

```bash
git add web/packages/alloy-storage
git commit -m "feat(storage): add createDriveStorage one-call wiring"
```

---

### Task 4: Swift DriveStorage twin

**Files:**
- Create: `swift/Sources/AlloyStorage/Backends/Drive/DriveStorage.swift`
- Test: `swift/Tests/AlloyStorageTests/DriveStorageTests.swift`

**Interfaces:**
- Consumes: `GoogleAuth(config:vault:transport:uiSession:now:)`, `GoogleAuthConfig(clientId:scope:redirectScheme:)`, `DriveClient(auth:transport:)`, `DriveBackend(client:folderPath:cache:)`, test helpers `ScriptedTransport`, `MemoryTokenVault`, `EchoStateUI` (Task 2).
- Produces:

```swift
public struct DriveStorageConfig: Sendable {
  public let clientId: String
  public let redirectScheme: String
  public let folderPath: String
  public let scope: String
  public init(clientId: String, redirectScheme: String, folderPath: String,
              scope: String = "https://www.googleapis.com/auth/drive.file")
}
public struct DriveStorage {
  public let auth: GoogleAuth
  public let backend: DriveBackend
  public init(config: DriveStorageConfig,
              vault: any TokenVault = KeychainTokenVault(),
              transport: any HTTPTransport = URLSessionTransport(),
              uiSession: (any AuthUISession)? = nil,
              cache: UserDefaults? = .standard)
}
```

- [ ] **Step 1: Write the failing test**

`DriveStorageTests.swift`:

```swift
import Foundation
import Testing
@testable import AlloyStorage

/// Twin of web .../drive/drive-storage.spec.ts.
@Suite struct DriveStorageTests {
  private let config = DriveStorageConfig(
    clientId: "cid", redirectScheme: "com.example.app", folderPath: "AllyWorld/Harness")

  @Test func wiresWorkingAuthAndShareableBackendFromOneConfig() async throws {
    let transport = ScriptedTransport([
      .init(matches: { $0.url!.absoluteString.contains("files?q=") },
            body: #"{"files":[{"id":"f1"}]}"#, status: 200),
      .init(matches: { _ in true }, body: #"{"files":[]}"#, status: 200),
    ])
    // Token must be fresh relative to GoogleAuth's default now: { Date() } —
    // DriveStorage's init takes no clock, so real wall-time + far-future
    // expiry is the correct (and here permitted) fixture.
    let vault = MemoryTokenVault(
      StoredTokens(accessToken: "at", expiresAt: Date().addingTimeInterval(3600), refreshToken: nil))
    let storage = DriveStorage(config: config, vault: vault, transport: transport, cache: nil)
    #expect((storage.backend as any StorageBackend) as? any Shareable != nil)
    // Backend calls flow through the injected transport with the config's folder path:
    _ = try await storage.backend.list()
    let hitAllyWorld = transport.requests.contains {
      $0.url!.absoluteString.removingPercentEncoding?.contains("AllyWorld") == true
    }
    #expect(hitAllyWorld)
  }

  @Test func defaultsScopeToDriveFile() async {
    let capture = URLCaptureUI()
    let storage = DriveStorage(
      config: config, vault: MemoryTokenVault(), transport: ScriptedTransport([]),
      uiSession: capture, cache: nil)
    _ = await storage.auth.signIn() // cancelled by the stub after capturing
    #expect(capture.lastURL?.absoluteString
      .removingPercentEncoding?.contains("https://www.googleapis.com/auth/drive.file") == true)
  }

  @Test func honorsExplicitScopeOverride() async {
    let custom = DriveStorageConfig(
      clientId: "cid", redirectScheme: "com.example.app", folderPath: "F", scope: "custom-scope")
    let capture = URLCaptureUI()
    let storage = DriveStorage(
      config: custom, vault: MemoryTokenVault(), transport: ScriptedTransport([]),
      uiSession: capture, cache: nil)
    _ = await storage.auth.signIn()
    #expect(capture.lastURL?.absoluteString.contains("custom-scope") == true)
  }
}

/// Captures the auth URL, then cancels — lets tests inspect signIn's URL
/// without scripting the whole flow.
final class URLCaptureUI: AuthUISession, @unchecked Sendable {
  var lastURL: URL?
  func authenticate(url: URL, callbackScheme: String) async throws -> URL {
    lastURL = url
    throw CancellationError()
  }
}
```

Adaptation note: if `MemoryTokenVault`'s initializer doesn't accept an initial value, `try vault.save(...)` before constructing the `DriveStorage`.

- [ ] **Step 2: Run to verify it fails**

`swift test --filter AlloyStorageTests` → FAIL: `DriveStorage` not found.

- [ ] **Step 3: Implement**

`DriveStorage.swift`:

```swift
import Foundation

/// Config for the one-call Drive stack. Twin of DriveStorageConfig in
/// drive-storage.ts — fields differ per platform exactly as GoogleAuthConfig
/// does (web: redirectUri + tokenServiceUrl; Apple: redirectScheme).
public struct DriveStorageConfig: Sendable {
  public let clientId: String
  public let redirectScheme: String
  /// Folder path find-or-created from the Drive root, e.g. "AllyWorld/AllyClock".
  public let folderPath: String
  /// Defaults to drive.file — the app sees only files it created.
  public let scope: String

  public init(
    clientId: String, redirectScheme: String, folderPath: String,
    scope: String = "https://www.googleapis.com/auth/drive.file"
  ) {
    self.clientId = clientId
    self.redirectScheme = redirectScheme
    self.folderPath = folderPath
    self.scope = scope
  }
}

/// One-call wiring of the Drive stack: GoogleAuth → DriveClient → DriveBackend.
/// The client is internal plumbing; apps keep the two objects they use.
/// Sugar, not a seal — the individual initializers remain public.
public struct DriveStorage {
  public let auth: GoogleAuth
  public let backend: DriveBackend

  public init(
    config: DriveStorageConfig,
    vault: any TokenVault = KeychainTokenVault(),
    transport: any HTTPTransport = URLSessionTransport(),
    uiSession: (any AuthUISession)? = nil,
    cache: UserDefaults? = .standard
  ) {
    let auth = GoogleAuth(
      config: GoogleAuthConfig(
        clientId: config.clientId, scope: config.scope, redirectScheme: config.redirectScheme),
      vault: vault, transport: transport, uiSession: uiSession)
    self.auth = auth
    self.backend = DriveBackend(
      client: DriveClient(auth: auth, transport: transport),
      folderPath: config.folderPath, cache: cache)
  }
}
```

(Check `GoogleAuth.init`'s actual parameter list — if `uiSession: nil` at init means "no default UI," mirror the existing behavior: pass the parameter through exactly as `GoogleAuth` treats it today, so a nil here still gets the platform default at sign-in time if that's the current semantic; read GoogleAuth.swift first and preserve its nil-handling.)

- [ ] **Step 4: Run to verify pass**

`swift build && swift test --filter AlloyStorageTests` → all PASS, no new warnings.

- [ ] **Step 5: Commit**

```bash
git add swift/Sources/AlloyStorage swift/Tests/AlloyStorageTests
git commit -m "feat(storage): add Swift DriveStorage one-call wiring twin"
```

---

### Task 5: Harness migration + mirroring.md + full verification

**Files:**
- Modify: `examples/web-harness/src/app/sections/storage-section.component.ts`
- Modify: `examples/apple-harness/Sources/AlloyHarness/StorageDemoView.swift`
- Modify: `docs/mirroring.md` (AlloyStorage section)

**Interfaces:**
- Consumes: everything above. No new API.

- [ ] **Step 1: Web harness**

In `storage-section.component.ts`:
1. Replace the `GoogleAuth`/`DriveClient`/`DriveBackend` imports and hand-wiring with the factory. The component currently builds `auth` and `drive` in two field initializers; replace with:

```ts
  private readonly driveStorage = this.driveConfigured
    ? createDriveStorage({
        clientId: GOOGLE_CLIENT_ID,
        redirectUri: `${location.origin}/`,
        tokenServiceUrl: TOKEN_SERVICE_URL,
        folderPath: DRIVE_FOLDER,
      })
    : null;
  private readonly auth = this.driveStorage?.auth ?? null;
  private readonly drive = this.driveStorage?.backend ?? null;
```

(`driveConfigured` must be declared BEFORE `driveStorage` in the class body — field initializer order. `DRIVE_SCOPE` const and its usage disappear — the factory's default covers it. Imports: drop `DriveBackend, DriveClient, GoogleAuth` if now unused, add `createDriveStorage`.)
2. In `finishRedirectIfPending`, use the result:

```ts
      const result = await this.auth!.completeSignIn(location.href);
      history.replaceState(null, '', location.pathname);
      this.driveStatus.set(
        result.outcome === 'success'
          ? 'signed in'
          : result.outcome === 'cancelled'
            ? 'sign-in cancelled'
            : `sign-in failed — ${result.reason}: ${result.detail}`
      );
```

Verify: `cd examples/web-harness && npx ng build` → clean.

- [ ] **Step 2: Apple harness**

In `StorageDemoView.swift`:
1. Replace the `StorageDemo` holder's two-step wiring with the factory (one stored value):

```swift
private enum StorageDemo {
    static let local = LocalStorageBackend(collection: "harness")
    static let drive: DriveStorage? = {
        guard !googleClientID.isEmpty, !googleRedirectScheme.isEmpty else { return nil }
        return DriveStorage(config: DriveStorageConfig(
            clientId: googleClientID,
            redirectScheme: googleRedirectScheme,
            folderPath: driveFolder
        ))
    }()
}
```

Then mechanical renames through the file: `StorageDemo.auth` → `StorageDemo.drive?.auth`, `StorageDemo.drive` (backend uses) → `StorageDemo.drive?.backend` — adjust optional-chaining/guards accordingly (e.g. `guard let backend = StorageDemo.drive?.backend`), and the Shareable cast site keeps its two-step form via `any StorageBackend`. `driveScope` constant disappears (factory default).
2. `signIn()` uses the result:

```swift
    private func signIn() async {
        guard let auth = StorageDemo.drive?.auth else { return }
        let result = await auth.signIn()
        authState = auth.state
        switch result {
        case .success: driveStatus = "signed in"
        case .cancelled: driveStatus = "sign-in cancelled"
        case .failed(let reason, let detail, let status):
            driveStatus = "sign-in failed — \(reason.rawValue): \(detail)"
                + (status.map { " (HTTP \($0))" } ?? "")
        }
    }
```

Verify: `cd examples/apple-harness && swift build` → clean.

- [ ] **Step 3: mirroring.md**

In the AlloyStorage section: add to the **Strict regime** list:

```markdown
- `SignInResult` / `SignInFailureReason` (success | cancelled |
  failed(reason, detail, status?); returned by web `completeSignIn` ↔ Apple
  `signIn`; `cancelled` is Apple-only in practice — the web redirect flow
  has no cancel signal)
```

And to the **Semantic regime** list, extending the existing sign-in-shape bullet's neighborhood:

```markdown
- One-call wiring: `createDriveStorage(config, deps?)` ↔ `DriveStorage(config:…)`
  — config fields differ per platform exactly as GoogleAuthConfig does
  (web: redirectUri + tokenServiceUrl; Apple: redirectScheme); scope
  defaults to drive.file on both
```

- [ ] **Step 4: Full verification**

```bash
cd web && npm test                       # all packages
cd .. && swift build && swift test      # entire package, repo root
cd examples/web-harness && npx ng build
cd ../apple-harness && swift build
cd ../.. && cd web && npm pack -w @allyworld/alloy-storage --dry-run   # dist only
```

All green.

- [ ] **Step 5: Commit**

```bash
git add docs/mirroring.md examples
git commit -m "docs(storage): SignInResult + factory mirroring; harness adoption"
```

---

## After this plan

- Manual QA: break something deliberately (e.g. stop the token service) and confirm the harness status line now names the phase (`exchangeFailed: …`) instead of "sign-in failed / cancelled".
- The AllyScore pilot migration consumes `createDriveStorage` + `SignInResult` directly.
