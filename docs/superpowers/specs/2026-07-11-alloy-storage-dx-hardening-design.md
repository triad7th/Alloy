# AlloyStorage DX hardening — SignInResult + DriveStorage factory

**Date:** 2026-07-11
**Status:** Approved design, pre-implementation
**Extends:** `2026-07-09-alloy-storage-design.md` (Release 1) and
`2026-07-10-alloy-storage-sharing-design.md`. Pre-pilot developer-experience
work: both items directly reduce AllyScore-migration friction and were
field-proven pain during harness QA.

## Purpose

1. **Diagnosable sign-in failures.** `signIn()`/`completeSignIn()` currently
   return `Bool`; every failure — user cancel, CSRF mismatch, token-exchange
   rejection, vault write failure — collapses to `false`. A real field bug
   (simulator Keychain entitlement failure) surfaced as "sign-in failed /
   cancelled" and required system-log archaeology. Replace the Bool with a
   result type that names the failure phase and carries detail.
2. **One-call Drive wiring.** Apps must hand-wire `GoogleAuth` → `DriveClient`
   → `DriveBackend` (three constructions plus a keep-alive holder in SwiftUI).
   A factory takes one config and returns the two objects apps actually use.

The package is unreleased (0.1.0 untagged); the Bool-signature break has no
external consumers — only the harnesses, which migrate in the same change.

## 1. SignInResult (strict regime)

```ts
// src/core/sign-in-result.ts  ↔  Core/SignInResult.swift
export type SignInFailureReason =
  | 'configurationInvalid'   // bad auth URL / missing or corrupt pending-session entry
  | 'stateMismatch'          // CSRF state check failed (or code missing from callback)
  | 'exchangeFailed'         // token endpoint rejected/unreachable
  | 'vaultFailed';           // token persistence failed (Keychain / IndexedDB)

export type SignInResult =
  | { outcome: 'success' }
  | { outcome: 'cancelled' }   // user dismissed the auth UI — a normal outcome, not an error
  | { outcome: 'failed'; reason: SignInFailureReason; detail: string; status?: number };
```

```swift
public enum SignInFailureReason: String, Sendable {
  case configurationInvalid, stateMismatch, exchangeFailed, vaultFailed
}
public enum SignInResult: Equatable, Sendable {
  case success
  case cancelled
  case failed(reason: SignInFailureReason, detail: String, status: Int?)
}
```

Signature changes:

- Web `GoogleAuth.completeSignIn(callbackUrl): Promise<SignInResult>` (was Bool).
- Swift `GoogleAuth.signIn() async -> SignInResult` (was Bool).
- Web `beginSignIn()` stays `Promise<void>` — it navigates away; nothing to report.
- `accessToken()` and `AuthProvider` are untouched (null-return convention stands).

Mapping of today's silent `false` paths:

| Today | Becomes |
|---|---|
| no pending session entry / JSON.parse throws / bad auth URL / no uiSession or platform support | `failed(configurationInvalid, <detail>)` |
| state param mismatch, or no `code` in callback | `failed(stateMismatch, <detail>)` |
| ASWebAuthenticationSession cancel (`ASWebAuthenticationSessionError.canceledLogin`) | `cancelled` |
| token service / Google non-OK | `failed(exchangeFailed, <detail>, status)` |
| token exchange network throw | `failed(exchangeFailed, <detail>)` (no status) |
| vault/store save throws | `failed(vaultFailed, <underlying error message>)` |

The `detail` string is for developers (status lines, logs), not end users —
apps map `reason` to their own copy. State transitions are unchanged
(`signedIn` only on success). Harnesses display `reason: detail` in their
status text; success/cancelled display as today.

## 2. DriveStorage factory (semantic-regime config, mirrored names)

```ts
// src/backends/drive/drive-storage.ts
export interface DriveStorageConfig {
  clientId: string;
  redirectUri: string;
  tokenServiceUrl: string;
  folderPath: string;
  /** Defaults to 'https://www.googleapis.com/auth/drive.file'. */
  scope?: string;
}
export interface DriveStorage {
  auth: GoogleAuth;
  backend: DriveBackend;
}
export function createDriveStorage(config: DriveStorageConfig): DriveStorage;
```

```swift
// Backends/Drive/DriveStorage.swift
public struct DriveStorageConfig: Sendable {
  public init(clientId: String, redirectScheme: String, folderPath: String,
              scope: String = "https://www.googleapis.com/auth/drive.file")
}
public struct DriveStorage {
  public let auth: GoogleAuth
  public let backend: DriveBackend
  public init(config: DriveStorageConfig)
}
```

- `DriveClient` remains internal wiring (constructed inside; not exposed).
- Config fields differ per platform exactly as `GoogleAuthConfig` already
  does (web: redirectUri + tokenServiceUrl; Apple: redirectScheme) — a
  documented semantic-regime asymmetry.
- The existing constructors stay public — the factory is sugar, not a seal.
- Both harnesses switch to the factory (deleting the three-way hand-wiring;
  Swift keeps one static holder for the single `DriveStorage` value).

## Testing

- Twin tests per failure path with identical fixtures: cancelled (stub UI
  session throws cancel / missing pending entry — note the web "missing
  entry" case is `configurationInvalid`, not cancelled), stateMismatch,
  exchangeFailed with and without HTTP status, vaultFailed via a
  failing TokenVault/TokenStore fake, and success unchanged.
- Factory: wiring smoke test (auth drives backend authorization — scripted
  transport sees the bearer token; folderPath reaches the backend) and the
  scope default (auth URL contains drive.file when scope omitted).
- Harness manual QA: the Keychain-failure class of bug now shows
  `vaultFailed: <message>` in the status line.

## Docs

`docs/mirroring.md` AlloyStorage section: `SignInResult`/`SignInFailureReason`
under strict regime; `DriveStorage`/`DriveStorageConfig` noted alongside the
existing GoogleAuthConfig semantic-regime config asymmetry.

## Out of scope

- `accessToken()` error reporting (null-return convention stands).
- Retry/backoff, richer cancellation detection on web (full-page redirect
  flow has no cancel signal — an abandoned redirect simply never calls
  `completeSignIn`).
- Any release/tagging — rides the pilot as planned.
