# AlloyStorage Sharing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Port AllyScore's Drive share feature into AlloyStorage as a `Shareable` capability on DriveBackend plus an auth-free `fetchSharedFile` for the receiving side, twin-mirrored.

**Architecture:** A 3-method `Shareable` interface (record-id namespace, `nativeRef` = Drive file id for link building) implemented by `DriveBackend`; the permission REST mechanics port verbatim from AllyScore into DriveClient as non-advertised methods (TS `@internal` doc, Swift `internal` access). `DrivePublic.fetchSharedFile` fetches a publicly-shared file with an API key and no AuthProvider. Spec: `docs/superpowers/specs/2026-07-10-alloy-storage-sharing-design.md`.

**Tech Stack:** Pure TypeScript (Vitest, scripted fetch fakes), Swift 6 (swift-testing, ScriptedTransport), no new dependencies.

## Global Constraints

- Zero runtime deps; NodeNext: non-spec TS source uses explicit `.js` extensions in relative imports; spec files may stay extensionless.
- Web API canonical; Swift mechanical port, identical member names. Run web tests from `web/`: `npm test -w @allyworld/alloy-storage`; Swift from REPO ROOT: `swift build && swift test --filter AlloyStorageTests`.
- Permission wire format (ported verbatim from AllyScore): create = `POST <API>/files/<fileId>/permissions` body `{"role":"reader","type":"anyone"}`; check = `GET <API>/files/<fileId>/permissions?fields=permissions(id,type)` filtered on `type === 'anyone'`; remove = find anyone-permission id then `DELETE <API>/files/<fileId>/permissions/<permId>`. `API = 'https://www.googleapis.com/drive/v3'`.
- `share()` is idempotent (check before create; ours, not Drive's); `unshare()` idempotent like delete; `share()` on a missing record throws `StorageError('notFound', ...)`; legacy `allyscoreId` records resolve (findByAlloyId already handles this).
- Capability-only: permission methods are NOT advertised public API — TS: `/** @internal */` TSDoc; Swift: `internal` (no `public`).
- Commits: conventional style, imperative subject ≤ 72 chars.

## File Structure

```
web/packages/alloy-storage/src/core/shareable.ts            ShareStatus, Shareable, isShareable
web/packages/alloy-storage/src/backends/drive/drive-client.ts    +4 permission methods (@internal)
web/packages/alloy-storage/src/backends/drive/drive-backend.ts   +Shareable conformance
web/packages/alloy-storage/src/backends/drive/drive-share.spec.ts     backend-level twin tests
web/packages/alloy-storage/src/backends/drive/drive-client.spec.ts    +permission wire tests
web/packages/alloy-storage/src/backends/drive/drive-public.ts    fetchSharedFile
web/packages/alloy-storage/src/backends/drive/drive-public.spec.ts
web/packages/alloy-storage/src/index.ts                      +exports
swift/Sources/AlloyStorage/Core/Shareable.swift
swift/Sources/AlloyStorage/Backends/Drive/DriveClient.swift  +internal permission methods
swift/Sources/AlloyStorage/Backends/Drive/DriveBackend.swift +extension DriveBackend: Shareable
swift/Sources/AlloyStorage/Backends/Drive/DrivePublic.swift
swift/Tests/AlloyStorageTests/DriveShareTests.swift
swift/Tests/AlloyStorageTests/DrivePublicTests.swift
examples/web-harness/src/app/sections/storage-section.component.ts   +share row
examples/apple-harness/Sources/AlloyHarness/StorageDemoView.swift    +share row
docs/mirroring.md                                            +Shareable/DrivePublic entries
```

---

### Task 1: TS Shareable contract + DriveBackend conformance + DriveClient permission methods

**Files:**
- Create: `web/packages/alloy-storage/src/core/shareable.ts`
- Modify: `web/packages/alloy-storage/src/backends/drive/drive-client.ts` (add 4 methods at the end of the class, after `deleteFile`)
- Modify: `web/packages/alloy-storage/src/backends/drive/drive-backend.ts` (implement Shareable)
- Modify: `web/packages/alloy-storage/src/index.ts` (export shareable)
- Test: create `web/packages/alloy-storage/src/backends/drive/drive-share.spec.ts`; extend `web/packages/alloy-storage/src/backends/drive/drive-client.spec.ts`

**Interfaces:**
- Consumes (already shipped): `DriveBackend { constructor(client: DriveClient, folderPath: string, cache?: Storage | null); private withFolder<T>(fn: (folderId: string) => Promise<T>): Promise<T> }`; `DriveClient.findByAlloyId(folderId: string, id: string): Promise<DriveFileMeta | null>`; `DriveClient['call']` private helper; `const API = 'https://www.googleapis.com/drive/v3'`; `StorageError` with `('notFound', message)` constructor form `new StorageError('notFound', msg)`.
- Produces: `interface ShareStatus { shared: boolean; nativeRef: string }`; `interface Shareable { shareStatus(id: string): Promise<ShareStatus | null>; share(id: string): Promise<ShareStatus>; unshare(id: string): Promise<void> }`; `isShareable(value: unknown): value is Shareable`; `class DriveBackend implements StorageBackend, Shareable`; DriveClient methods `createPublicPermission(fileId)`, `hasPublicPermission(fileId): Promise<boolean>`, `deletePublicPermission(fileId)` (all `@internal`), private `anyonePermissionId(fileId)`.

- [ ] **Step 1: Write the failing backend-level spec**

`web/packages/alloy-storage/src/backends/drive/drive-share.spec.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import type { DriveClient, DriveFileMeta } from './drive-client';
import { BrowserStorageBackend } from '../browser-storage';
import { isShareable } from '../../core/shareable';
import { DriveBackend } from './drive-backend';

/** Twin fixture: swift/Tests/AlloyStorageTests/DriveShareTests.swift runs the
 *  same scenarios. */
function fakeClient(overrides: Partial<Record<keyof DriveClient, unknown>> = {}): DriveClient {
  const base = {
    resolveFolderPath: vi.fn(async () => 'folder1'),
    findByAlloyId: vi.fn(async (): Promise<DriveFileMeta | null> => null),
    hasPublicPermission: vi.fn(async () => false),
    createPublicPermission: vi.fn(async () => undefined),
    deletePublicPermission: vi.fn(async () => undefined),
  };
  return { ...base, ...overrides } as unknown as DriveClient;
}

function memStorage(): Storage {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
  } as Storage;
}

const FILE: DriveFileMeta = { id: 'd1', name: 'a.json', appProperties: { alloyId: 'a' } };

describe('DriveBackend Shareable', () => {
  it('is detected by isShareable; local backends are not', () => {
    expect(isShareable(new DriveBackend(fakeClient(), 'App', memStorage()))).toBe(true);
    expect(isShareable(new BrowserStorageBackend('t'))).toBe(false);
    expect(isShareable(null)).toBe(false);
  });

  it('shareStatus resolves null for a record the backend does not hold', async () => {
    const b = new DriveBackend(fakeClient(), 'App', memStorage());
    expect(await b.shareStatus('missing')).toBeNull();
  });

  it('shareStatus reports shared/unshared with the native file id', async () => {
    const client = fakeClient({
      findByAlloyId: vi.fn(async () => FILE),
      hasPublicPermission: vi.fn(async () => true),
    });
    const b = new DriveBackend(client, 'App', memStorage());
    expect(await b.shareStatus('a')).toEqual({ shared: true, nativeRef: 'd1' });
    expect(client.hasPublicPermission).toHaveBeenCalledWith('d1');
  });

  it('share on a missing record throws StorageError(notFound)', async () => {
    const b = new DriveBackend(fakeClient(), 'App', memStorage());
    await expect(b.share('missing')).rejects.toMatchObject({ category: 'notFound' });
  });

  it('share creates the permission once and is idempotent when already shared', async () => {
    const client = fakeClient({ findByAlloyId: vi.fn(async () => FILE) });
    const b = new DriveBackend(client, 'App', memStorage());
    expect(await b.share('a')).toEqual({ shared: true, nativeRef: 'd1' });
    expect(client.createPublicPermission).toHaveBeenCalledTimes(1);

    const shared = fakeClient({
      findByAlloyId: vi.fn(async () => FILE),
      hasPublicPermission: vi.fn(async () => true),
    });
    const b2 = new DriveBackend(shared, 'App', memStorage());
    expect(await b2.share('a')).toEqual({ shared: true, nativeRef: 'd1' });
    expect(shared.createPublicPermission).not.toHaveBeenCalled();
  });

  it('legacy allyscoreId records are shareable with the correct nativeRef', async () => {
    const legacy: DriveFileMeta = {
      id: 'd2',
      name: 'b.allyscore',
      appProperties: { allyscoreId: 'b', savedAt: '1751980000000' },
    };
    const client = fakeClient({ findByAlloyId: vi.fn(async () => legacy) });
    const b = new DriveBackend(client, 'App', memStorage());
    expect(await b.shareStatus('b')).toEqual({ shared: false, nativeRef: 'd2' });
    expect(client.findByAlloyId).toHaveBeenCalledWith('folder1', 'b'); // dual-key query does the rest
  });

  it('unshare delegates for an existing record and no-ops for a missing one', async () => {
    const client = fakeClient({ findByAlloyId: vi.fn(async () => FILE) });
    const b = new DriveBackend(client, 'App', memStorage());
    await b.unshare('a');
    expect(client.deletePublicPermission).toHaveBeenCalledWith('d1');

    const empty = fakeClient();
    const b2 = new DriveBackend(empty, 'App', memStorage());
    await expect(b2.unshare('missing')).resolves.toBeUndefined();
    expect(empty.deletePublicPermission).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Add the failing client-level wire tests**

Append to the `describe('DriveClient', ...)` block in `web/packages/alloy-storage/src/backends/drive/drive-client.spec.ts`, reusing that file's existing `auth` const and `fakeFetch` helper:

```ts
  it('createPublicPermission POSTs the anyone-reader body', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const client = new DriveClient(auth, fakeFetch([{ match: () => true, response: {} }], calls));
    await client.createPublicPermission('f9');
    expect(calls[0].url).toBe('https://www.googleapis.com/drive/v3/files/f9/permissions');
    expect(calls[0].init?.method).toBe('POST');
    expect(JSON.parse(String(calls[0].init?.body))).toEqual({ role: 'reader', type: 'anyone' });
  });

  it('hasPublicPermission filters the permission list for type anyone', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const client = new DriveClient(
      auth,
      fakeFetch(
        [{ match: () => true, response: { permissions: [{ id: 'p1', type: 'user' }, { id: 'p2', type: 'anyone' }] } }],
        calls
      )
    );
    expect(await client.hasPublicPermission('f9')).toBe(true);
    expect(calls[0].url).toContain('/files/f9/permissions?fields=permissions(id,type)');
  });

  it('deletePublicPermission deletes the anyone permission, or issues no DELETE when absent', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const client = new DriveClient(
      auth,
      fakeFetch(
        [
          { match: (u) => u.includes('?fields='), response: { permissions: [{ id: 'p2', type: 'anyone' }] } },
          { match: (_u, i) => i?.method === 'DELETE', response: '' },
        ],
        calls
      )
    );
    await client.deletePublicPermission('f9');
    expect(calls[1].url).toBe('https://www.googleapis.com/drive/v3/files/f9/permissions/p2');
    expect(calls[1].init?.method).toBe('DELETE');

    const noAnyone: Array<{ url: string; init?: RequestInit }> = [];
    const client2 = new DriveClient(
      auth,
      fakeFetch([{ match: () => true, response: { permissions: [{ id: 'p1', type: 'user' }] } }], noAnyone)
    );
    await client2.deletePublicPermission('f9');
    expect(noAnyone.length).toBe(1); // only the lookup — no DELETE issued
  });
```

- [ ] **Step 3: Run to verify both fail**

Run (from `web/`): `npm test -w @allyworld/alloy-storage`
Expected: FAIL — cannot resolve `../../core/shareable`; `createPublicPermission` is not a function.

- [ ] **Step 4: Implement**

`web/packages/alloy-storage/src/core/shareable.ts`:

```ts
/** Result of a share query/operation. */
export interface ShareStatus {
  shared: boolean;
  /** Backend-native handle apps embed in share links (Drive: the file id).
   *  The one sanctioned backend leak — link URL format is app policy. */
  nativeRef: string;
}

/** Optional capability: backends that can share a record via a public link.
 *  Local backends deliberately do not implement it. All methods take the
 *  app's record id, never a backend-native id. */
export interface Shareable {
  /** Current status, or null if the record doesn't exist in this backend. */
  shareStatus(id: string): Promise<ShareStatus | null>;
  /** Idempotent: sharing an already-shared record is a no-op.
   *  Throws StorageError('notFound') for a missing record. */
  share(id: string): Promise<ShareStatus>;
  /** Idempotent, like StorageBackend.delete. */
  unshare(id: string): Promise<void>;
}

export function isShareable(value: unknown): value is Shareable {
  const v = value as Partial<Shareable> | null;
  return (
    typeof v?.shareStatus === 'function' &&
    typeof v?.share === 'function' &&
    typeof v?.unshare === 'function'
  );
}
```

Append to the end of the `DriveClient` class (after `deleteFile`), ported verbatim from AllyScore's drive-client:

```ts
  /** @internal Shareable mechanism — not part of the supported public surface. */
  async createPublicPermission(fileId: string): Promise<void> {
    await this.call(`${API}/files/${fileId}/permissions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: 'reader', type: 'anyone' }),
    });
  }

  private async anyonePermissionId(fileId: string): Promise<string | null> {
    const res = await this.call(`${API}/files/${fileId}/permissions?fields=permissions(id,type)`);
    const body = (await res.json()) as { permissions?: Array<{ id: string; type: string }> };
    return body.permissions?.find((p) => p.type === 'anyone')?.id ?? null;
  }

  /** @internal Shareable mechanism — not part of the supported public surface. */
  async hasPublicPermission(fileId: string): Promise<boolean> {
    return (await this.anyonePermissionId(fileId)) !== null;
  }

  /** @internal Shareable mechanism — not part of the supported public surface. */
  async deletePublicPermission(fileId: string): Promise<void> {
    const id = await this.anyonePermissionId(fileId);
    if (id) await this.call(`${API}/files/${fileId}/permissions/${id}`, { method: 'DELETE' });
  }
```

In `drive-backend.ts`: add `Shareable, ShareStatus` to the imports from `../../core/shareable.js`, change the class declaration to `export class DriveBackend implements StorageBackend, Shareable`, and add after `delete(id)`:

```ts
  async shareStatus(id: string): Promise<ShareStatus | null> {
    return this.withFolder(async (folderId) => {
      const file = await this.client.findByAlloyId(folderId, id);
      if (!file) return null;
      return { shared: await this.client.hasPublicPermission(file.id), nativeRef: file.id };
    });
  }

  async share(id: string): Promise<ShareStatus> {
    return this.withFolder(async (folderId) => {
      const file = await this.client.findByAlloyId(folderId, id);
      if (!file) throw new StorageError('notFound', `no record '${id}' to share`);
      if (!(await this.client.hasPublicPermission(file.id))) {
        await this.client.createPublicPermission(file.id);
      }
      return { shared: true, nativeRef: file.id };
    });
  }

  async unshare(id: string): Promise<void> {
    return this.withFolder(async (folderId) => {
      const file = await this.client.findByAlloyId(folderId, id);
      if (file) await this.client.deletePublicPermission(file.id);
    });
  }
```

(`StorageError` is already imported in drive-backend.ts.) Add to `src/index.ts`:

```ts
export * from './core/shareable.js';
```

- [ ] **Step 5: Run to verify pass**

`npm test -w @allyworld/alloy-storage` → PASS; `npm run build -w @allyworld/alloy-storage` → clean.

- [ ] **Step 6: Commit**

```bash
git add web/packages/alloy-storage
git commit -m "feat(storage): add Shareable capability to DriveBackend"
```

---

### Task 2: TS DrivePublic — fetchSharedFile

**Files:**
- Create: `web/packages/alloy-storage/src/backends/drive/drive-public.ts`
- Modify: `web/packages/alloy-storage/src/index.ts` (export)
- Test: `web/packages/alloy-storage/src/backends/drive/drive-public.spec.ts`

**Interfaces:**
- Consumes: `StorageError` (Task-1-independent; shipped in Release 1).
- Produces: `fetchSharedFile(nativeRef: string, apiKey: string, fetchFn?: typeof fetch): Promise<string>`.

- [ ] **Step 1: Write the failing spec**

```ts
import { describe, expect, it } from 'vitest';
import { StorageError } from '../../core/errors';
import { fetchSharedFile } from './drive-public';

/** Twin fixture: swift/Tests/AlloyStorageTests/DrivePublicTests.swift. */
function fakeFetch(status: number, body: string, calls: string[] = []): typeof fetch {
  return async (input) => {
    calls.push(String(input));
    return new Response(body, { status });
  };
}

describe('fetchSharedFile', () => {
  it('GETs alt=media with the API key and returns the payload', async () => {
    const calls: string[] = [];
    const text = await fetchSharedFile('d1', 'KEY-9', fakeFetch(200, '{"v":1}', calls));
    expect(text).toBe('{"v":1}');
    expect(calls[0]).toBe('https://www.googleapis.com/drive/v3/files/d1?alt=media&key=KEY-9');
  });

  it('maps 404 to notFound (sharing revoked) and 403 to auth (bad API key)', async () => {
    await expect(fetchSharedFile('d1', 'k', fakeFetch(404, ''))).rejects.toMatchObject({
      category: 'notFound',
    });
    await expect(fetchSharedFile('d1', 'k', fakeFetch(403, ''))).rejects.toMatchObject({
      category: 'auth',
    });
  });

  it('wraps network failures as unreachable', async () => {
    const failing: typeof fetch = async () => {
      throw new TypeError('offline');
    };
    const err = await fetchSharedFile('d1', 'k', failing).catch((e) => e);
    expect(err).toBeInstanceOf(StorageError);
    expect(err.category).toBe('unreachable');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

`npm test -w @allyworld/alloy-storage` → FAIL: cannot resolve `./drive-public`.

- [ ] **Step 3: Implement**

`web/packages/alloy-storage/src/backends/drive/drive-public.ts`:

```ts
import { StorageError } from '../../core/errors.js';

const API = 'https://www.googleapis.com/drive/v3';

/** Fetch a publicly-shared Drive file WITHOUT sign-in — the receiving side
 *  of the Shareable capability (viewer pages have no signed-in user). The
 *  API key is the app's public, referrer-restricted key; Alloy stores no
 *  keys. 404 → notFound (sharing revoked or bad ref); 403 → auth (key
 *  invalid/restricted). */
export async function fetchSharedFile(
  nativeRef: string,
  apiKey: string,
  fetchFn: typeof fetch = fetch.bind(globalThis)
): Promise<string> {
  let res: Response;
  try {
    res = await fetchFn(`${API}/files/${nativeRef}?alt=media&key=${encodeURIComponent(apiKey)}`);
  } catch (e) {
    throw new StorageError('unreachable', String(e));
  }
  if (!res.ok) throw StorageError.fromHttpStatus(res.status);
  return res.text();
}
```

Add to `src/index.ts`:

```ts
export * from './backends/drive/drive-public.js';
```

- [ ] **Step 4: Run to verify pass**

`npm test -w @allyworld/alloy-storage` → PASS; build clean.

- [ ] **Step 5: Commit**

```bash
git add web/packages/alloy-storage
git commit -m "feat(storage): add fetchSharedFile for public share links"
```

---

### Task 3: Swift twins — Shareable + DriveBackend conformance + internal permission methods

**Files:**
- Create: `swift/Sources/AlloyStorage/Core/Shareable.swift`
- Modify: `swift/Sources/AlloyStorage/Backends/Drive/DriveClient.swift` (add internal permission methods after `deleteFile`)
- Modify: `swift/Sources/AlloyStorage/Backends/Drive/DriveBackend.swift` (add `extension DriveBackend: Shareable` at file end)
- Test: `swift/Tests/AlloyStorageTests/DriveShareTests.swift`

**Interfaces:**
- Consumes (shipped): `DriveClient.findByAlloyId(folderId:id:) async throws -> DriveFileMeta?`; DriveClient's private `call(_:method:headers:body:) async throws -> Data` and `api` constant; `DriveBackend`'s private `withFolder<T>(_ fn:)` helper (actor); `ScriptedTransport` + `StubAuth` test helpers in DriveClientTests.swift; `StorageError(category:message:status:)`.
- Produces:

```swift
public struct ShareStatus: Sendable, Equatable {
  public let shared: Bool
  public let nativeRef: String
  public init(shared: Bool, nativeRef: String)
}
public protocol Shareable: Sendable {
  func shareStatus(id: String) async throws -> ShareStatus?
  @discardableResult func share(id: String) async throws -> ShareStatus
  func unshare(id: String) async throws
}
extension DriveBackend: Shareable
// DriveClient (internal, NOT public): createPublicPermission(fileId:),
// hasPublicPermission(fileId:) -> Bool, deletePublicPermission(fileId:)
```

- [ ] **Step 1: Write the failing tests**

`swift/Tests/AlloyStorageTests/DriveShareTests.swift` — mirror the TS scenarios at the transport level (DriveClient is final, so DriveBackend share tests script HTTP responses, as DriveBackendTests already does). Twin of `drive-share.spec.ts` + the client wire tests:

```swift
import Foundation
import Testing
@testable import AlloyStorage

/// Twin of web .../drive/drive-share.spec.ts + the drive-client permission
/// wire tests — same scenarios at the transport level.
@Suite struct DriveShareTests {
  private let fileHit =
    #"{"files":[{"id":"d1","name":"a.json","appProperties":{"alloyId":"a"}}]}"#
  private let fileMiss = #"{"files":[]}"#

  private func backend(_ entries: [ScriptedTransport.Entry]) -> (DriveBackend, ScriptedTransport) {
    let transport = ScriptedTransport(entries)
    let client = DriveClient(auth: StubAuth(token: "tok"), transport: transport)
    let suite = UserDefaults(suiteName: "alloy-share-tests-\(UUID().uuidString)")
    suite?.set("folder1", forKey: "alloy-storage.folderId.App")
    return (DriveBackend(client: client, folderPath: "App", cache: suite), transport)
  }

  @Test func localBackendIsNotShareable() {
    let dir = FileManager.default.temporaryDirectory
      .appendingPathComponent("share-\(UUID().uuidString)")
    let local: any StorageBackend = LocalStorageBackend(collection: "t", directory: dir)
    #expect(local as? any Shareable == nil)
    let (drive, _) = backend([])
    #expect((drive as any StorageBackend) as? any Shareable != nil)
  }

  @Test func shareStatusNilForMissingRecord() async throws {
    let (b, _) = backend([
      .init(matches: { $0.url!.absoluteString.contains("files?q=") }, body: fileMiss, status: 200)
    ])
    #expect(try await b.shareStatus(id: "missing") == nil)
  }

  @Test func shareStatusReportsSharedWithNativeRef() async throws {
    let (b, transport) = backend([
      .init(matches: { $0.url!.absoluteString.contains("files?q=") }, body: fileHit, status: 200),
      .init(matches: { $0.url!.absoluteString.contains("/permissions?fields=") },
            body: #"{"permissions":[{"id":"p2","type":"anyone"}]}"#, status: 200),
    ])
    #expect(try await b.shareStatus(id: "a") == ShareStatus(shared: true, nativeRef: "d1"))
    let permURL = transport.requests.last!.url!.absoluteString
    #expect(permURL.contains("/files/d1/permissions?fields=permissions(id,type)"))
  }

  @Test func shareOnMissingRecordThrowsNotFound() async {
    let (b, _) = backend([
      .init(matches: { $0.url!.absoluteString.contains("files?q=") }, body: fileMiss, status: 200)
    ])
    do {
      _ = try await b.share(id: "missing")
      Issue.record("expected notFound")
    } catch let e as StorageError {
      #expect(e.category == .notFound)
    } catch { Issue.record("wrong error type") }
  }

  @Test func shareCreatesOnceAndIsIdempotent() async throws {
    let (b, transport) = backend([
      .init(matches: { $0.url!.absoluteString.contains("files?q=") }, body: fileHit, status: 200),
      .init(matches: { $0.url!.absoluteString.contains("?fields=") },
            body: #"{"permissions":[]}"#, status: 200),
      .init(matches: { $0.httpMethod == "POST" && $0.url!.absoluteString.hasSuffix("/files/d1/permissions") },
            body: "{}", status: 200),
    ])
    #expect(try await b.share(id: "a") == ShareStatus(shared: true, nativeRef: "d1"))
    let post = transport.requests.last!
    #expect(post.httpMethod == "POST")
    let body = String(data: post.httpBody!, encoding: .utf8)!
    #expect(body.contains(#""role":"reader""#) && body.contains(#""type":"anyone""#))

    let (b2, transport2) = backend([
      .init(matches: { $0.url!.absoluteString.contains("files?q=") }, body: fileHit, status: 200),
      .init(matches: { $0.url!.absoluteString.contains("?fields=") },
            body: #"{"permissions":[{"id":"p2","type":"anyone"}]}"#, status: 200),
    ])
    #expect(try await b2.share(id: "a") == ShareStatus(shared: true, nativeRef: "d1"))
    #expect(!transport2.requests.contains { $0.httpMethod == "POST" && $0.url!.absoluteString.contains("/permissions") })
  }

  @Test func unshareDeletesAnyonePermissionOrNoOps() async throws {
    let (b, transport) = backend([
      .init(matches: { $0.url!.absoluteString.contains("files?q=") }, body: fileHit, status: 200),
      .init(matches: { $0.url!.absoluteString.contains("?fields=") },
            body: #"{"permissions":[{"id":"p2","type":"anyone"}]}"#, status: 200),
      .init(matches: { $0.httpMethod == "DELETE" }, body: "", status: 200),
    ])
    try await b.unshare(id: "a")
    let del = transport.requests.last!
    #expect(del.httpMethod == "DELETE")
    #expect(del.url!.absoluteString.hasSuffix("/files/d1/permissions/p2"))

    let (b2, transport2) = backend([
      .init(matches: { $0.url!.absoluteString.contains("files?q=") }, body: fileHit, status: 200),
      .init(matches: { $0.url!.absoluteString.contains("?fields=") },
            body: #"{"permissions":[{"id":"p1","type":"user"}]}"#, status: 200),
    ])
    try await b2.unshare(id: "a") // no anyone permission → no DELETE
    #expect(!transport2.requests.contains { $0.httpMethod == "DELETE" })
  }
}
```

- [ ] **Step 2: Run to verify it fails**

`swift test --filter AlloyStorageTests` (repo root) → FAIL: `Shareable` not found.

- [ ] **Step 3: Implement**

`swift/Sources/AlloyStorage/Core/Shareable.swift`:

```swift
/// Result of a share query/operation.
public struct ShareStatus: Sendable, Equatable {
  public let shared: Bool
  /// Backend-native handle apps embed in share links (Drive: the file id).
  /// The one sanctioned backend leak — link URL format is app policy.
  public let nativeRef: String

  public init(shared: Bool, nativeRef: String) {
    self.shared = shared
    self.nativeRef = nativeRef
  }
}

/// Optional capability: backends that can share a record via a public link.
/// Local backends deliberately do not conform. All methods take the app's
/// record id, never a backend-native id. Check with `backend as? any Shareable`.
public protocol Shareable: Sendable {
  /// Current status, or nil if the record doesn't exist in this backend.
  func shareStatus(id: String) async throws -> ShareStatus?
  /// Idempotent: sharing an already-shared record is a no-op.
  /// Throws StorageError(.notFound) for a missing record.
  @discardableResult
  func share(id: String) async throws -> ShareStatus
  /// Idempotent, like StorageBackend.delete.
  func unshare(id: String) async throws
}
```

Append to `DriveClient` (after `deleteFile`, `internal` — no `public`), a 1:1 port of the TS methods:

```swift
  /// Shareable mechanism — internal on purpose; not part of the public surface.
  func createPublicPermission(fileId: String) async throws {
    let body = try JSONSerialization.data(withJSONObject: ["role": "reader", "type": "anyone"])
    _ = try await call(
      "\(api)/files/\(fileId)/permissions", method: "POST",
      headers: ["Content-Type": "application/json"], body: body)
  }

  private struct PermissionList: Decodable {
    struct Permission: Decodable {
      let id: String
      let type: String
    }
    let permissions: [Permission]?
  }

  private func anyonePermissionId(fileId: String) async throws -> String? {
    let data = try await call("\(api)/files/\(fileId)/permissions?fields=permissions(id,type)")
    let list = try JSONDecoder().decode(PermissionList.self, from: data)
    return list.permissions?.first { $0.type == "anyone" }?.id
  }

  func hasPublicPermission(fileId: String) async throws -> Bool {
    try await anyonePermissionId(fileId: fileId) != nil
  }

  func deletePublicPermission(fileId: String) async throws {
    guard let id = try await anyonePermissionId(fileId: fileId) else { return }
    _ = try await call("\(api)/files/\(fileId)/permissions/\(id)", method: "DELETE")
  }
```

(Adjust the constant name to whatever DriveClient.swift actually uses for the API base — it is a file-private `let api`/`api` referenced by the existing methods; reuse it verbatim.)

Append to `DriveBackend.swift`:

```swift
extension DriveBackend: Shareable {
  public func shareStatus(id: String) async throws -> ShareStatus? {
    try await withFolder { folderId in
      guard let file = try await self.client.findByAlloyId(folderId: folderId, id: id) else {
        return nil
      }
      return ShareStatus(
        shared: try await self.client.hasPublicPermission(fileId: file.id), nativeRef: file.id)
    }
  }

  @discardableResult
  public func share(id: String) async throws -> ShareStatus {
    try await withFolder { folderId in
      guard let file = try await self.client.findByAlloyId(folderId: folderId, id: id) else {
        throw StorageError(category: .notFound, message: "no record '\(id)' to share")
      }
      if try await !self.client.hasPublicPermission(fileId: file.id) {
        try await self.client.createPublicPermission(fileId: file.id)
      }
      return ShareStatus(shared: true, nativeRef: file.id)
    }
  }

  public func unshare(id: String) async throws {
    try await withFolder { folderId in
      guard let file = try await self.client.findByAlloyId(folderId: folderId, id: id) else {
        return
      }
      try await self.client.deletePublicPermission(fileId: file.id)
    }
  }
}
```

(If `withFolder`'s generic signature or closure isolation needs minor adaptation for the extension — e.g. explicit `T` or `self.` capture — adapt mechanically; the semantics above are the contract. If `client` is `private` rather than internal to the file, these methods live INSIDE the actor body instead of an extension, with `// MARK: - Shareable` and `extension DriveBackend: Shareable {}` as an empty conformance marker.)

- [ ] **Step 4: Run to verify pass**

`swift build && swift test --filter AlloyStorageTests` (repo root) → all PASS, no new warnings.

- [ ] **Step 5: Commit**

```bash
git add swift/Sources/AlloyStorage swift/Tests/AlloyStorageTests
git commit -m "feat(storage): add Swift Shareable twin on DriveBackend"
```

---

### Task 4: Swift DrivePublic twin

**Files:**
- Create: `swift/Sources/AlloyStorage/Backends/Drive/DrivePublic.swift`
- Test: `swift/Tests/AlloyStorageTests/DrivePublicTests.swift`

**Interfaces:**
- Consumes: `HTTPTransport` / `URLSessionTransport`, `StorageError.fromHTTPStatus`, `ScriptedTransport`.
- Produces: `public enum DrivePublic { public static func fetchSharedFile(nativeRef: String, apiKey: String, transport: any HTTPTransport = URLSessionTransport()) async throws -> String }`.

- [ ] **Step 1: Write the failing test**

`swift/Tests/AlloyStorageTests/DrivePublicTests.swift`:

```swift
import Foundation
import Testing
@testable import AlloyStorage

/// Twin of web .../drive/drive-public.spec.ts — same URL shape and mapping.
@Suite struct DrivePublicTests {
  @Test func getsAltMediaWithKeyAndReturnsPayload() async throws {
    let transport = ScriptedTransport([
      .init(matches: { _ in true }, body: #"{"v":1}"#, status: 200)
    ])
    let text = try await DrivePublic.fetchSharedFile(
      nativeRef: "d1", apiKey: "KEY-9", transport: transport)
    #expect(text == #"{"v":1}"#)
    #expect(transport.requests[0].url!.absoluteString
      == "https://www.googleapis.com/drive/v3/files/d1?alt=media&key=KEY-9")
    #expect(transport.requests[0].value(forHTTPHeaderField: "Authorization") == nil)
  }

  @Test(arguments: [(404, StorageError.Category.notFound), (403, .auth)])
  func mapsFailureStatuses(status: Int, category: StorageError.Category) async {
    let transport = ScriptedTransport([.init(matches: { _ in true }, body: "", status: status)])
    do {
      _ = try await DrivePublic.fetchSharedFile(nativeRef: "d1", apiKey: "k", transport: transport)
      Issue.record("expected throw")
    } catch let e as StorageError {
      #expect(e.category == category)
    } catch { Issue.record("wrong error type") }
  }

  @Test func wrapsTransportFailureAsUnreachable() async {
    struct Offline: HTTPTransport {
      func send(_: URLRequest) async throws -> (Data, HTTPURLResponse) {
        throw URLError(.notConnectedToInternet)
      }
    }
    do {
      _ = try await DrivePublic.fetchSharedFile(nativeRef: "d1", apiKey: "k", transport: Offline())
      Issue.record("expected throw")
    } catch let e as StorageError {
      #expect(e.category == .unreachable)
    } catch { Issue.record("wrong error type") }
  }
}
```

- [ ] **Step 2: Run to verify it fails**

`swift test --filter AlloyStorageTests` → FAIL: `DrivePublic` not found.

- [ ] **Step 3: Implement**

`swift/Sources/AlloyStorage/Backends/Drive/DrivePublic.swift`:

```swift
import Foundation

/// The receiving side of the Shareable capability: fetch a publicly-shared
/// Drive file WITHOUT sign-in (viewer pages have no signed-in user). The
/// API key is the app's public, referrer-restricted key; Alloy stores no
/// keys. 404 → notFound (sharing revoked or bad ref); 403 → auth (key
/// invalid/restricted). Caseless-enum namespace, twin of drive-public.ts.
public enum DrivePublic {
  public static func fetchSharedFile(
    nativeRef: String,
    apiKey: String,
    transport: any HTTPTransport = URLSessionTransport()
  ) async throws -> String {
    var allowed = CharacterSet.alphanumerics
    allowed.insert(charactersIn: "-_.!~*'()")
    let encodedKey = apiKey.addingPercentEncoding(withAllowedCharacters: allowed) ?? apiKey
    let url = URL(string:
      "https://www.googleapis.com/drive/v3/files/\(nativeRef)?alt=media&key=\(encodedKey)")!
    let data: Data
    let response: HTTPURLResponse
    do {
      (data, response) = try await transport.send(URLRequest(url: url))
    } catch let e as StorageError {
      throw e
    } catch {
      throw StorageError(category: .unreachable, message: String(describing: error))
    }
    guard (200..<300).contains(response.statusCode) else {
      throw StorageError.fromHTTPStatus(response.statusCode)
    }
    return String(decoding: data, as: UTF8.self)
  }
}
```

- [ ] **Step 4: Run to verify pass**

`swift build && swift test --filter AlloyStorageTests` → all PASS, no new warnings.

- [ ] **Step 5: Commit**

```bash
git add swift/Sources/AlloyStorage swift/Tests/AlloyStorageTests
git commit -m "feat(storage): add Swift DrivePublic.fetchSharedFile twin"
```

---

### Task 5: mirroring.md + harness share rows + full verification

**Files:**
- Modify: `docs/mirroring.md` (AlloyStorage section)
- Modify: `examples/web-harness/src/app/sections/storage-section.component.ts`
- Modify: `examples/apple-harness/Sources/AlloyHarness/StorageDemoView.swift`

**Interfaces:**
- Consumes: everything above (`isShareable`, `Shareable`, `ShareStatus`; Swift `backend as? any Shareable`).
- Produces: docs + manual-QA surface; no new API.

- [ ] **Step 1: mirroring.md**

In the AlloyStorage section of `docs/mirroring.md`, add to the **Strict regime** list:

```markdown
- `ShareStatus` / `Shareable` (`shareStatus`/`share`/`unshare` in the app's
  record-id namespace; `nativeRef` is the backend-native link handle; share
  is idempotent, missing record → notFound; local backends deliberately do
  not implement it — TS `isShareable()` ↔ Swift `as? any Shareable`)
- `DrivePublic.fetchSharedFile` ↔ `fetchSharedFile` (auth-free public fetch:
  `alt=media` + API key; 404→notFound, 403→auth; injected fetch/transport)
- Drive permission wire format (create anyone-reader POST, `fields=
  permissions(id,type)` check, find-then-DELETE) — kept NON-public on both
  platforms (TS `@internal` doc, Swift `internal`), per the capability-only
  decision in the sharing spec
```

- [ ] **Step 2: Web harness share row**

In `storage-section.component.ts`: import `isShareable`, type `ShareStatus` from `@allyworld/alloy-storage`. Add signals + methods to the component class:

```ts
  readonly shareInfo = signal<ShareStatus | null>(null);

  async shareRefresh(): Promise<void> {
    if (!this.drive || !isShareable(this.drive)) return;
    try {
      this.shareInfo.set(await this.drive.shareStatus(this.recId()));
      this.driveStatus.set(this.shareInfo() ? 'share status refreshed' : 'record not on Drive yet');
    } catch (e) {
      this.driveStatus.set(this.describe(e));
    }
  }

  async shareToggle(): Promise<void> {
    if (!this.drive || !isShareable(this.drive)) return;
    try {
      if (this.shareInfo()?.shared) {
        await this.drive.unshare(this.recId());
      } else {
        await this.drive.share(this.recId());
      }
      await this.shareRefresh();
    } catch (e) {
      this.driveStatus.set(this.describe(e));
    }
  }
```

And inside the Drive card's signed-in branch (after the existing button row), add:

```html
            <div class="btn-row">
              <button (click)="shareRefresh()">Share status</button>
              <button (click)="shareToggle()">
                {{ shareInfo()?.shared ? 'Unshare' : 'Share' }}
              </button>
            </div>
            @if (shareInfo(); as info) {
              <p class="status">
                {{ info.shared ? 'shared — anyone with the link can view' : 'not shared' }}
                <code>{{ info.nativeRef }}</code>
              </p>
            }
```

Verify: `cd examples/web-harness && npx ng build` → clean.

- [ ] **Step 3: Apple harness share row**

In `StorageDemoView.swift`, add state + methods to `StorageDemoView`:

```swift
    @State private var shareInfo: ShareStatus?
```

```swift
    private func shareRefresh() async {
        guard let shareable = StorageDemo.drive as (any Shareable)? else { return }
        do {
            shareInfo = try await shareable.shareStatus(id: recID)
            driveStatus = shareInfo == nil ? "record not on Drive yet" : "share status refreshed"
        } catch { driveStatus = describe(error) }
    }

    private func shareToggle() async {
        guard let shareable = StorageDemo.drive as (any Shareable)? else { return }
        do {
            if shareInfo?.shared == true {
                try await shareable.unshare(id: recID)
            } else {
                _ = try await shareable.share(id: recID)
            }
            await shareRefresh()
        } catch { driveStatus = describe(error) }
    }
```

And in `driveCard`'s signed-in branch, after the existing button `HStack`:

```swift
                HStack(spacing: 8) {
                    demoButton("Share status") { await shareRefresh() }
                    demoButton(shareInfo?.shared == true ? "Unshare" : "Share") { await shareToggle() }
                }
                if let info = shareInfo {
                    Text(info.shared
                        ? "shared — anyone with the link can view  \(info.nativeRef)"
                        : "not shared")
                        .font(.footnote).foregroundStyle(.secondary)
                }
```

Verify: `cd examples/apple-harness && swift build` → clean.

- [ ] **Step 4: Full verification**

```bash
cd web && npm test                                    # all packages
cd .. && swift build && swift test                    # entire package, repo root
cd examples/web-harness && npx ng build               # harness compiles
cd ../apple-harness && swift build                    # harness compiles
cd ../.. && cd web && npm pack -w @allyworld/alloy-storage --dry-run   # dist only, no specs
```

All green.

- [ ] **Step 5: Commit**

```bash
git add docs/mirroring.md examples
git commit -m "docs(storage): declare Shareable mirroring; share QA in harnesses"
```

---

## After this plan

- Manual QA: sign in on either harness, Save record to Drive, Share → verify at drive.google.com that "Anyone with the link" appears; Unshare → verify it's gone. `fetchSharedFile` can be QA'd with the shared file's nativeRef + an API key.
- The AllyScore pilot migration (separate plan, AllyScore repo) then swaps the dialog's two DI tokens for one injected `Shareable` and replaces `fileIdOf`+permission calls with `shareStatus`/`share`/`unshare`.
