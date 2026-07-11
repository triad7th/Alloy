# AlloyStorage Sharing — Shareable capability + public fetch

**Date:** 2026-07-10
**Status:** Approved design, pre-implementation
**Extends:** `2026-07-09-alloy-storage-design.md` (Release 1, shipped). This is
the port of AllyScore's Drive share feature — the last functional gap before
the AllyScore pilot migration.

## Purpose

AllyScore shares a score via Drive's "anyone with the link can view"
permission: a dialog checks/creates/removes the permission and copies a link
embedding the native Drive file id (`https://allyscores.netlify.app/s/<fileId>`).
Its mechanics live on `DriveClient` (three permission REST calls) and
`DriveScoreStore.fileIdOf` (record id → Drive file id), reached through two
Angular injection tokens that deliberately puncture the storage facade.

This port moves the mechanism into AlloyStorage so the AllyScore refactor can
close that puncture, and adds the receiving side (public unauthenticated
fetch) that AllyScore's planned `/s/<fileId>` viewer page will need.

## Decisions (settled during brainstorming)

| Question | Decision |
|---|---|
| API shape | **Shareable capability only** — a 3-method interface implemented by DriveBackend; permission REST calls stay private inside DriveClient (promotable later; sealed-now → open-later is additive) |
| Receiving side | **Included** — standalone auth-free `fetchSharedFile` (viewer pages have no signed-in user) |
| UI | Stays app-side (AllyScore's dialog, link format, API key value, `/s/` route) |
| Twins | Full Swift twin in the same change set, per mirroring.md |

## Core contract (strict regime)

```ts
// src/core/shareable.ts  ↔  Core/Shareable.swift
export interface ShareStatus {
  shared: boolean;
  /** Backend-native handle apps embed in share links (Drive: the file id).
   *  The one sanctioned backend leak — link URL format is app policy. */
  nativeRef: string;
}

export interface Shareable {
  /** Current status, or null if the record doesn't exist in this backend. */
  shareStatus(id: string): Promise<ShareStatus | null>;
  /** Idempotent: sharing an already-shared record is a no-op.
   *  Throws StorageError('notFound') for a missing record. */
  share(id: string): Promise<ShareStatus>;
  /** Idempotent, like StorageBackend.delete. */
  unshare(id: string): Promise<void>;
}
```

- All methods take the **app's record id**, not a file id; resolution happens
  inside the backend (legacy `allyscoreId` records resolve too, so existing
  AllyScore shares keep working).
- TS ships an `isShareable(backend)` type guard; Swift apps use
  `backend as? any Shareable`.
- Local backends do NOT implement it — the capability's absence maps onto
  AllyScore's dialog `local` state.
- Swift: `public protocol Shareable: Sendable` with the same member names;
  `ShareStatus` a `Sendable, Equatable` struct; `share` is
  `@discardableResult`.

## Drive implementation (semantic-regime edge, wire format strict)

`DriveBackend` conforms to `Shareable` using the existing `withFolder` +
`findByAlloyId` machinery. The permission mechanics port verbatim from
AllyScore into **private** DriveClient methods:

- create: `POST /files/<id>/permissions` body `{"role":"reader","type":"anyone"}`
- check: `GET /files/<id>/permissions?fields=permissions(id,type)`, filter
  `type === 'anyone'`
- remove: find the `anyone` permission id, then `DELETE
  /files/<id>/permissions/<permId>`

Semantics:

- `share()` checks before creating (idempotency is ours, not Drive's) and
  returns the resulting `ShareStatus`.
- `unshare()` on an unshared record is a no-op.
- Failures map through `StorageError` as everywhere else; the 404-folder
  re-resolve behavior applies via `withFolder`.

## Public fetch (receiving side)

Standalone, auth-free — callable where nobody is signed in:

```ts
// src/backends/drive/drive-public.ts
fetchSharedFile(nativeRef: string, apiKey: string, fetchFn?: typeof fetch): Promise<string>
```

```swift
// Backends/Drive/DrivePublic.swift — caseless enum namespace
DrivePublic.fetchSharedFile(nativeRef:apiKey:transport:) async throws -> String
```

`GET https://www.googleapis.com/drive/v3/files/<ref>?alt=media&key=<apiKey>`,
non-OK mapped via `StorageError.fromHttpStatus` (404 → notFound covers
revoked sharing; 403 → auth covers a bad/restricted API key). The API key is
a public referrer-restricted credential owned by the app, passed as a
parameter — Alloy stores no keys.

## Testing

Twin tests with identical fixtures (scripted fetch / ScriptedTransport):

- Permission wire shapes: POST body, fields param, DELETE path.
- `share` on missing record → `StorageError(notFound)`.
- `share` twice → exactly one create call (idempotent).
- `unshare` when unshared → no DELETE issued.
- Legacy `allyscoreId` record → shareable, correct `nativeRef`.
- `fetchSharedFile`: URL shape (alt=media + key), payload round-trip,
  404/403 error mapping.

Harness QA (both platforms): the storage demo's Drive card gains
Share/Unshare + link display when signed in — the manual surface for the
real permission calls.

## Out of scope (stays app-side / later)

- The share dialog UI, `SHARE_LINK_BASE`, the API key value, the `/s/`
  viewer route and page.
- Richer sharing (specific users, roles, expiry) — grow the interface or
  promote the private client methods when a real consumer appears.
- Closing AllyScore's DI puncture — that lands in the pilot migration plan,
  where the dialog switches to a single injected `Shareable`.

## Docs & release

`docs/mirroring.md` AlloyStorage section gains `Shareable`/`ShareStatus`
(strict) and `DrivePublic`/`fetchSharedFile` (strict shape, injected
transport edge). Rides the next alloy-storage release with everything else
at 0.1.0-unreleased.
