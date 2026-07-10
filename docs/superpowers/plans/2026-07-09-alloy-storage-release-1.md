# AlloyStorage Release 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `@allyworld/alloy-storage` + Swift `AlloyStorage` Release 1: core contracts, local replica backends, the Drive backend, and the new refresh-token auth (web token function + Apple ASWebAuthenticationSession).

**Architecture:** One package, layered: strict-mirrored core contracts (`StorageBackend`, `StorageRecord`, `AuthProvider`, `StorageError`), semantic-regime platform backends (IndexedDB / FileManager / Drive REST with injected transport), and auth edges (web auth-code+PKCE via a stateless Netlify token function; Apple PKCE via ASWebAuthenticationSession + Keychain). Spec: `docs/superpowers/specs/2026-07-09-alloy-storage-design.md`.

**Tech Stack:** Pure TypeScript (zero runtime deps, Vitest, `fake-indexeddb` devDep), Swift 6 (Foundation + Observation; CryptoKit/AuthenticationServices/Security only inside the auth platform edge), Netlify Functions (node:test).

**Scope notes:**
- The AllyScore pilot migration is a SEPARATE plan in the AllyScore repo (cross-repo). The sync engine (`SyncedStore`), `FileStorageBackend`, and Google Picker are Releases 2–3 — not in this plan.
- Everything here lands as one release train; twins ship together per `docs/mirroring.md`.

## Global Constraints

- `@allyworld/alloy-storage`: **zero runtime dependencies**, no Angular/RxJS/signals. `package.json`/`tsconfig.json` copy alloy-time's shape (ES2022, NodeNext, strict, `dist/` out, tsc `prepack`).
- Swift target `AlloyStorage`: Foundation + Observation only; AuthenticationServices/CryptoKit/Security are allowed ONLY in `Auth/` platform-edge files (document in mirroring.md).
- Web API is canonical; Swift is a mechanical port. Identical type/method/property names wherever both languages allow (mirroring.md rules).
- Time: TS uses epoch milliseconds (`number`); Swift public API uses `Date`; twin fixtures compare epoch ms.
- Tests: fixed `new Date(ms)` / `Date(timeIntervalSince1970:)` fixtures; identical values on both platforms.
- Commits: conventional style, imperative subject ≤ 72 chars.
- Run web tests from `web/`: `npm test -w @allyworld/alloy-storage`. Run Swift from repo root: `swift test --filter AlloyStorageTests`.
- The Drive wire format must stay readable by existing AllyScore data: files carry `appProperties` — new writes use keys `alloyId` + `alloySavedAt`; reads also accept legacy `allyscoreId` + `savedAt`.

## File Structure

```
web/packages/alloy-storage/
  package.json  tsconfig.json
  src/index.ts
  src/core/record.ts            StorageRecordMeta, StorageRecord
  src/core/backend.ts           StorageBackend interface
  src/core/auth.ts              AuthState, AuthProvider
  src/core/errors.ts            StorageError (+ HTTP mapping)
  src/core/errors.spec.ts
  src/backends/storage-backend.contract.ts   shared behavior suite (test-only export)
  src/backends/idb.ts           tiny IndexedDB promise helpers (internal)
  src/backends/browser-storage.ts             BrowserStorageBackend
  src/backends/browser-storage.spec.ts
  src/backends/drive/drive-client.ts           DriveClient (ported from AllyScore)
  src/backends/drive/drive-client.spec.ts
  src/backends/drive/drive-backend.ts          DriveBackend
  src/backends/drive/drive-backend.spec.ts
  src/auth/pkce.ts              PKCE verifier/challenge helpers
  src/auth/pkce.spec.ts
  src/auth/token-store.ts       StoredTokens, TokenStore, IndexedDbTokenStore, MemoryTokenStore
  src/auth/google-auth.ts       GoogleAuth (web: code flow via token service)
  src/auth/google-auth.spec.ts
swift/Sources/AlloyStorage/
  Core/StorageRecord.swift  Core/StorageBackend.swift  Core/AuthProvider.swift  Core/StorageError.swift
  Backends/LocalStorageBackend.swift
  Backends/Drive/HTTPTransport.swift  Backends/Drive/DriveClient.swift  Backends/Drive/DriveBackend.swift
  Auth/PKCE.swift  Auth/TokenVault.swift  Auth/GoogleAuth.swift
swift/Tests/AlloyStorageTests/
  StorageErrorTests.swift  LocalStorageBackendTests.swift  StorageBackendContract.swift
  DriveClientTests.swift  DriveBackendTests.swift  PKCETests.swift  GoogleAuthTests.swift
services/google-oauth/
  netlify.toml  package.json
  functions/lib/cors.mjs  functions/lib/google.mjs
  functions/token.mjs  functions/refresh.mjs
  test/oauth.test.mjs
Package.swift                  add AlloyStorage product + target + testTarget
docs/mirroring.md              add AlloyStorage section
```

Task order: TS core → Swift core → TS browser backend → Swift local backend → TS Drive client → TS Drive backend → Swift Drive twins → token service → TS auth → Swift auth → mirroring/docs.

---

### Task 1: TS package scaffold + core contracts

**Files:**
- Create: `web/packages/alloy-storage/package.json`, `web/packages/alloy-storage/tsconfig.json`
- Create: `web/packages/alloy-storage/src/core/record.ts`, `src/core/backend.ts`, `src/core/auth.ts`, `src/core/errors.ts`, `src/index.ts`
- Test: `web/packages/alloy-storage/src/core/errors.spec.ts`

**Interfaces:**
- Consumes: nothing (first task).
- Produces: `StorageRecordMeta { id: string; name: string; updatedAt: number; revision?: string }`, `StorageRecord extends StorageRecordMeta { payload: string }`, `StorageBackend { list(): Promise<StorageRecordMeta[]>; read(id: string): Promise<StorageRecord | null>; write(record: StorageRecord): Promise<StorageRecordMeta>; delete(id: string): Promise<void> }`, `AuthState = 'signedOut' | 'signedIn' | 'expired'`, `AuthProvider { accessToken(): Promise<string | null>; readonly state: AuthState }`, `StorageErrorCategory = 'auth' | 'notFound' | 'conflict' | 'unreachable' | 'quota'`, `class StorageError extends Error { category; status?; static fromHttpStatus(status: number, message?: string): StorageError }`. All exported from the package root.

- [ ] **Step 1: Scaffold the package**

`web/packages/alloy-storage/package.json` (alloy-time's shape, new name/description):

```json
{
  "name": "@allyworld/alloy-storage",
  "version": "0.1.0",
  "description": "Storage abstraction + backends for the Ally app series (web twin of AlloyStorage)",
  "license": "MIT",
  "repository": { "type": "git", "url": "https://github.com/triad7th/Alloy.git" },
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": { ".": { "types": "./dist/index.d.ts", "default": "./dist/index.js" } },
  "files": ["dist"],
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "test": "vitest run",
    "prepack": "npm run build"
  },
  "devDependencies": {
    "fake-indexeddb": "^6.0.0",
    "typescript": "^5.6.0",
    "vitest": "^3.0.0"
  }
}
```

`web/packages/alloy-storage/tsconfig.json`: copy `web/packages/alloy-time/tsconfig.json` verbatim (ES2022 / NodeNext / strict / declaration / outDir dist / rootDir src, exclude `src/**/*.spec.ts`). Add `"lib": ["ES2022", "DOM"]` to compilerOptions (IndexedDB + fetch types).

Then from `web/`: run `npm install` (links the new workspace).

- [ ] **Step 2: Write the failing test**

`web/packages/alloy-storage/src/core/errors.spec.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { StorageError } from './errors';

describe('StorageError.fromHttpStatus', () => {
  // Twin fixture: swift/Tests/AlloyStorageTests/StorageErrorTests.swift uses the same table.
  const cases: Array<[number, string]> = [
    [401, 'auth'],
    [403, 'auth'],
    [404, 'notFound'],
    [409, 'conflict'],
    [412, 'conflict'],
    [429, 'quota'],
    [500, 'unreachable'],
    [503, 'unreachable'],
    [0, 'unreachable'],
  ];
  it.each(cases)('maps HTTP %i to %s', (status, category) => {
    const err = StorageError.fromHttpStatus(status);
    expect(err.category).toBe(category);
    expect(err.status).toBe(status);
    expect(err).toBeInstanceOf(Error);
  });

  it('keeps an explicit message and defaults to HTTP <status>', () => {
    expect(StorageError.fromHttpStatus(404, 'gone').message).toBe('gone');
    expect(StorageError.fromHttpStatus(500).message).toBe('HTTP 500');
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run (from `web/`): `npm test -w @allyworld/alloy-storage`
Expected: FAIL — cannot resolve `./errors`.

- [ ] **Step 4: Write the core contract files**

`src/core/record.ts`:

```ts
/** Metadata for one stored document — everything list() returns; no payload. */
export interface StorageRecordMeta {
  /** App-assigned stable identity (survives renames). */
  id: string;
  /** Human-visible filename, e.g. "settings.json". */
  name: string;
  /** Last modification, epoch milliseconds. Drives last-write-wins in the sync engine. */
  updatedAt: number;
  /** Backend-native version marker (e.g. Drive headRevisionId), when the backend has one. */
  revision?: string;
}

/** A stored document: metadata plus its whole-document payload. */
export interface StorageRecord extends StorageRecordMeta {
  payload: string;
}
```

`src/core/backend.ts`:

```ts
import type { StorageRecord, StorageRecordMeta } from './record';

/** One flat collection of documents (a folder / object store). Hierarchy is
 *  backend configuration, never part of this interface. */
export interface StorageBackend {
  /** Metadata only — implementations must not download payloads here. */
  list(): Promise<StorageRecordMeta[]>;
  /** null on missing id (never throws for a miss). */
  read(id: string): Promise<StorageRecord | null>;
  /** Create or replace; returns the stored metadata (with backend revision, if any). */
  write(record: StorageRecord): Promise<StorageRecordMeta>;
  /** Idempotent: deleting an absent id resolves. */
  delete(id: string): Promise<void>;
}
```

`src/core/auth.ts`:

```ts
export type AuthState = 'signedOut' | 'signedIn' | 'expired';

/** Auth seam for cloud backends. Implementations own token acquisition;
 *  backends only ever ask for a bearer token. */
export interface AuthProvider {
  /** A currently-valid access token, or null (signed out / refresh failed). */
  accessToken(): Promise<string | null>;
  readonly state: AuthState;
}
```

`src/core/errors.ts`:

```ts
export type StorageErrorCategory = 'auth' | 'notFound' | 'conflict' | 'unreachable' | 'quota';

/** The one error type backends throw. Apps and the sync engine react to
 *  `category`, never to raw HTTP codes. */
export class StorageError extends Error {
  constructor(
    readonly category: StorageErrorCategory,
    message: string,
    readonly status?: number
  ) {
    super(message);
    this.name = 'StorageError';
  }

  static fromHttpStatus(status: number, message?: string): StorageError {
    const category: StorageErrorCategory =
      status === 401 || status === 403
        ? 'auth'
        : status === 404
          ? 'notFound'
          : status === 409 || status === 412
            ? 'conflict'
            : status === 429
              ? 'quota'
              : 'unreachable';
    return new StorageError(category, message ?? `HTTP ${status}`, status);
  }
}
```

`src/index.ts`:

```ts
/** @allyworld/alloy-storage — storage abstraction + backends (web twin of AlloyStorage). */
export * from './core/record';
export * from './core/backend';
export * from './core/auth';
export * from './core/errors';
```

- [ ] **Step 5: Run test to verify it passes**

Run (from `web/`): `npm test -w @allyworld/alloy-storage` → PASS.
Also: `npm run build -w @allyworld/alloy-storage` → compiles clean.

- [ ] **Step 6: Commit**

```bash
git add web/packages/alloy-storage web/package-lock.json
git commit -m "feat(storage): scaffold alloy-storage with core contracts"
```

---

### Task 2: Swift core twins + Package.swift wiring

**Files:**
- Modify: `Package.swift` (add product + target + testTarget)
- Create: `swift/Sources/AlloyStorage/Core/StorageRecord.swift`, `Core/StorageBackend.swift`, `Core/AuthProvider.swift`, `Core/StorageError.swift`
- Test: `swift/Tests/AlloyStorageTests/StorageErrorTests.swift`

**Interfaces:**
- Consumes: the TS shapes from Task 1 (this is their mechanical port).
- Produces: `StorageRecordMeta`/`StorageRecord` structs (`updatedAt: Date`, `revision: String?`), `protocol StorageBackend { func list() async throws -> [StorageRecordMeta]; func read(id: String) async throws -> StorageRecord?; func write(_ record: StorageRecord) async throws -> StorageRecordMeta; func delete(id: String) async throws }`, `enum AuthState: String { case signedOut, signedIn, expired }`, `protocol AuthProvider { func accessToken() async -> String?; var state: AuthState { get } }`, `struct StorageError: Error { enum Category: String { case auth, notFound, conflict, unreachable, quota }; let category; let message; let status: Int?; static func fromHTTPStatus(_:message:) }`.

- [ ] **Step 1: Wire the target into Package.swift**

Add to `products`:

```swift
.library(name: "AlloyStorage", targets: ["AlloyStorage"]),
```

Add to `targets`:

```swift
.target(name: "AlloyStorage", path: "swift/Sources/AlloyStorage"),
.testTarget(name: "AlloyStorageTests", dependencies: ["AlloyStorage"],
            path: "swift/Tests/AlloyStorageTests"),
```

- [ ] **Step 2: Write the failing test**

`swift/Tests/AlloyStorageTests/StorageErrorTests.swift`:

```swift
import Testing
@testable import AlloyStorage

// Twin fixture: web/packages/alloy-storage/src/core/errors.spec.ts uses the same table.
@Suite struct StorageErrorTests {
  @Test(arguments: [
    (401, StorageError.Category.auth),
    (403, .auth),
    (404, .notFound),
    (409, .conflict),
    (412, .conflict),
    (429, .quota),
    (500, .unreachable),
    (503, .unreachable),
    (0, .unreachable),
  ] as [(Int, StorageError.Category)])
  func mapsHTTPStatus(status: Int, category: StorageError.Category) {
    let err = StorageError.fromHTTPStatus(status)
    #expect(err.category == category)
    #expect(err.status == status)
  }

  @Test func keepsExplicitMessageAndDefaults() {
    #expect(StorageError.fromHTTPStatus(404, message: "gone").message == "gone")
    #expect(StorageError.fromHTTPStatus(500).message == "HTTP 500")
  }
}
```

(Existing Alloy test targets use swift-testing `@Suite`/`@Test`; check `swift/Tests/AlloyTimeTests` and match whichever framework it actually uses — if it's XCTest, translate this file to XCTest style.)

- [ ] **Step 3: Run test to verify it fails**

Run (repo root): `cd swift && swift test --filter AlloyStorageTests`
Expected: FAIL — `StorageError` not found.

- [ ] **Step 4: Write the core files**

`swift/Sources/AlloyStorage/Core/StorageRecord.swift`:

```swift
import Foundation

/// Metadata for one stored document — everything list() returns; no payload.
public struct StorageRecordMeta: Sendable, Equatable {
  /// App-assigned stable identity (survives renames).
  public let id: String
  /// Human-visible filename, e.g. "settings.json".
  public let name: String
  /// Last modification. Drives last-write-wins in the sync engine.
  public let updatedAt: Date
  /// Backend-native version marker, when the backend has one.
  public let revision: String?

  public init(id: String, name: String, updatedAt: Date, revision: String? = nil) {
    self.id = id
    self.name = name
    self.updatedAt = updatedAt
    self.revision = revision
  }
}

/// A stored document: metadata plus its whole-document payload.
public struct StorageRecord: Sendable, Equatable {
  public let id: String
  public let name: String
  public let updatedAt: Date
  public let revision: String?
  public let payload: String

  public init(id: String, name: String, updatedAt: Date, revision: String? = nil, payload: String) {
    self.id = id
    self.name = name
    self.updatedAt = updatedAt
    self.revision = revision
    self.payload = payload
  }

  public var meta: StorageRecordMeta {
    StorageRecordMeta(id: id, name: name, updatedAt: updatedAt, revision: revision)
  }
}
```

`swift/Sources/AlloyStorage/Core/StorageBackend.swift`:

```swift
/// One flat collection of documents (a folder / object store). Hierarchy is
/// backend configuration, never part of this protocol.
public protocol StorageBackend: Sendable {
  /// Metadata only — implementations must not download payloads here.
  func list() async throws -> [StorageRecordMeta]
  /// nil on missing id (never throws for a miss).
  func read(id: String) async throws -> StorageRecord?
  /// Create or replace; returns the stored metadata (with backend revision, if any).
  @discardableResult
  func write(_ record: StorageRecord) async throws -> StorageRecordMeta
  /// Idempotent: deleting an absent id succeeds.
  func delete(id: String) async throws
}
```

`swift/Sources/AlloyStorage/Core/AuthProvider.swift`:

```swift
public enum AuthState: String, Sendable {
  case signedOut, signedIn, expired
}

/// Auth seam for cloud backends. Implementations own token acquisition;
/// backends only ever ask for a bearer token.
public protocol AuthProvider: Sendable {
  /// A currently-valid access token, or nil (signed out / refresh failed).
  func accessToken() async -> String?
  var state: AuthState { get }
}
```

`swift/Sources/AlloyStorage/Core/StorageError.swift`:

```swift
/// The one error type backends throw. Apps and the sync engine react to
/// `category`, never to raw HTTP codes.
public struct StorageError: Error, Equatable, Sendable {
  public enum Category: String, Sendable {
    case auth, notFound, conflict, unreachable, quota
  }

  public let category: Category
  public let message: String
  public let status: Int?

  public init(category: Category, message: String, status: Int? = nil) {
    self.category = category
    self.message = message
    self.status = status
  }

  public static func fromHTTPStatus(_ status: Int, message: String? = nil) -> StorageError {
    let category: Category =
      switch status {
      case 401, 403: .auth
      case 404: .notFound
      case 409, 412: .conflict
      case 429: .quota
      default: .unreachable
      }
    return StorageError(category: category, message: message ?? "HTTP \(status)", status: status)
  }
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd swift && swift build && swift test --filter AlloyStorageTests` → PASS (and the whole package still builds).

- [ ] **Step 6: Commit**

```bash
git add Package.swift swift/Sources/AlloyStorage swift/Tests/AlloyStorageTests
git commit -m "feat(storage): add AlloyStorage Swift core twins"
```

---

### Task 3: TS BrowserStorageBackend (IndexedDB) + shared contract suite

**Files:**
- Create: `web/packages/alloy-storage/src/backends/idb.ts`, `src/backends/storage-backend.contract.ts`, `src/backends/browser-storage.ts`
- Modify: `web/packages/alloy-storage/src/index.ts` (add export)
- Test: `web/packages/alloy-storage/src/backends/browser-storage.spec.ts`

**Interfaces:**
- Consumes: `StorageBackend`, `StorageRecord`, `StorageRecordMeta` from Task 1.
- Produces: `class BrowserStorageBackend implements StorageBackend { constructor(collection: string, idbFactory: IDBFactory = indexedDB) }`; internal `idb.ts` helpers `openDatabase(name: string, store: string, idbFactory: IDBFactory): Promise<IDBDatabase>` and `requestAsPromise<T>(req: IDBRequest<T>): Promise<T>`; test-only `describeStorageBackendContract(makeBackend: () => Promise<StorageBackend>)` reused by every backend spec (Drive included).

- [ ] **Step 1: Write the shared contract suite**

`src/backends/storage-backend.contract.ts` (imported only from `*.spec.ts` files; excluded from `dist` automatically? NO — tsconfig only excludes `*.spec.ts`, so name this file so it ships harmlessly or exclude it. Add `"src/**/*.contract.ts"` to the tsconfig `exclude` array in this step):

```ts
import { describe, expect, it } from 'vitest';
import type { StorageBackend } from '../core/backend';

/** Twin fixture: swift/Tests/AlloyStorageTests/StorageBackendContract.swift
 *  runs the same scenarios with the same instants (epoch ms). */
export function describeStorageBackendContract(makeBackend: () => Promise<StorageBackend>) {
  const T1 = 1751980000000; // 2025-07-08T12:26:40Z
  const T2 = 1751990000000;

  describe('StorageBackend contract', () => {
    it('write then read round-trips the record', async () => {
      const b = await makeBackend();
      await b.write({ id: 'a', name: 'a.json', updatedAt: T1, payload: '{"v":1}' });
      const got = await b.read('a');
      expect(got).toMatchObject({ id: 'a', name: 'a.json', updatedAt: T1, payload: '{"v":1}' });
    });

    it('read of a missing id resolves null', async () => {
      const b = await makeBackend();
      expect(await b.read('nope')).toBeNull();
    });

    it('list returns metadata only, no payload key', async () => {
      const b = await makeBackend();
      await b.write({ id: 'a', name: 'a.json', updatedAt: T1, payload: 'x' });
      await b.write({ id: 'b', name: 'b.json', updatedAt: T2, payload: 'y' });
      const metas = await b.list();
      expect(metas.map((m) => m.id).sort()).toEqual(['a', 'b']);
      for (const m of metas) expect('payload' in m).toBe(false);
    });

    it('write replaces an existing record', async () => {
      const b = await makeBackend();
      await b.write({ id: 'a', name: 'a.json', updatedAt: T1, payload: 'old' });
      await b.write({ id: 'a', name: 'renamed.json', updatedAt: T2, payload: 'new' });
      const got = await b.read('a');
      expect(got).toMatchObject({ name: 'renamed.json', updatedAt: T2, payload: 'new' });
      expect((await b.list()).length).toBe(1);
    });

    it('delete removes and is idempotent', async () => {
      const b = await makeBackend();
      await b.write({ id: 'a', name: 'a.json', updatedAt: T1, payload: 'x' });
      await b.delete('a');
      expect(await b.read('a')).toBeNull();
      await expect(b.delete('a')).resolves.toBeUndefined(); // absent id: no throw
    });
  });
}
```

- [ ] **Step 2: Write the failing spec**

`src/backends/browser-storage.spec.ts`:

```ts
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { describe } from 'vitest';
import { describeStorageBackendContract } from './storage-backend.contract';
import { BrowserStorageBackend } from './browser-storage';

describe('BrowserStorageBackend', () => {
  // A fresh IDBFactory per backend = a clean database per test.
  describeStorageBackendContract(async () => new BrowserStorageBackend('test', new IDBFactory()));
});
```

- [ ] **Step 3: Run to verify it fails**

Run (from `web/`): `npm test -w @allyworld/alloy-storage`
Expected: FAIL — cannot resolve `./browser-storage`.

- [ ] **Step 4: Implement**

`src/backends/idb.ts`:

```ts
/** Minimal promise wrappers over IndexedDB — internal to alloy-storage. */

export function requestAsPromise<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export function openDatabase(
  name: string,
  store: string,
  idbFactory: IDBFactory
): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const open = idbFactory.open(name, 1);
    open.onupgradeneeded = () => {
      if (!open.result.objectStoreNames.contains(store)) {
        open.result.createObjectStore(store, { keyPath: 'id' });
      }
    };
    open.onsuccess = () => resolve(open.result);
    open.onerror = () => reject(open.error);
  });
}
```

`src/backends/browser-storage.ts`:

```ts
import type { StorageBackend } from '../core/backend';
import type { StorageRecord, StorageRecordMeta } from '../core/record';
import { openDatabase, requestAsPromise } from './idb';

const STORE = 'records';

/** Local replica backend on IndexedDB. One database per collection
 *  (`alloy-storage.<collection>`), records keyed by id. */
export class BrowserStorageBackend implements StorageBackend {
  private db: Promise<IDBDatabase> | null = null;

  constructor(
    private readonly collection: string,
    private readonly idbFactory: IDBFactory = indexedDB
  ) {}

  private open(): Promise<IDBDatabase> {
    this.db ??= openDatabase(`alloy-storage.${this.collection}`, STORE, this.idbFactory);
    return this.db;
  }

  private async tx(mode: IDBTransactionMode): Promise<IDBObjectStore> {
    return (await this.open()).transaction(STORE, mode).objectStore(STORE);
  }

  async list(): Promise<StorageRecordMeta[]> {
    const all = await requestAsPromise(
      (await this.tx('readonly')).getAll() as IDBRequest<StorageRecord[]>
    );
    return all.map(({ id, name, updatedAt, revision }) =>
      revision === undefined ? { id, name, updatedAt } : { id, name, updatedAt, revision }
    );
  }

  async read(id: string): Promise<StorageRecord | null> {
    const got = await requestAsPromise(
      (await this.tx('readonly')).get(id) as IDBRequest<StorageRecord | undefined>
    );
    return got ?? null;
  }

  async write(record: StorageRecord): Promise<StorageRecordMeta> {
    await requestAsPromise((await this.tx('readwrite')).put(record));
    const { id, name, updatedAt, revision } = record;
    return revision === undefined ? { id, name, updatedAt } : { id, name, updatedAt, revision };
  }

  async delete(id: string): Promise<void> {
    await requestAsPromise((await this.tx('readwrite')).delete(id));
  }
}
```

Add to `src/index.ts`:

```ts
export * from './backends/browser-storage';
```

And add `"src/**/*.contract.ts"` to the `exclude` array of `web/packages/alloy-storage/tsconfig.json`.

- [ ] **Step 5: Run to verify pass**

`npm test -w @allyworld/alloy-storage` → PASS. `npm run build -w @allyworld/alloy-storage` → clean, and `dist/` contains no `storage-backend.contract.*`.

- [ ] **Step 6: Commit**

```bash
git add web/packages/alloy-storage
git commit -m "feat(storage): add BrowserStorageBackend and backend contract suite"
```

---

### Task 4: Swift LocalStorageBackend (FileManager) + contract twin

**Files:**
- Create: `swift/Sources/AlloyStorage/Backends/LocalStorageBackend.swift`
- Test: `swift/Tests/AlloyStorageTests/StorageBackendContract.swift`, `swift/Tests/AlloyStorageTests/LocalStorageBackendTests.swift`

**Interfaces:**
- Consumes: `StorageBackend`, `StorageRecord`, `StorageRecordMeta`, `StorageError` from Task 2.
- Produces: `final class LocalStorageBackend: StorageBackend` with `init(collection: String, directory: URL? = nil)` — default directory `FileManager.default.urls(for: .applicationSupportDirectory...)/<bundle-id or "Alloy">/<collection>`; test-only `func runStorageBackendContract(_ make: () async throws -> any StorageBackend)`.

- [ ] **Step 1: Write the contract twin + failing test**

`swift/Tests/AlloyStorageTests/StorageBackendContract.swift` — same scenarios and instants as the TS contract (T1 = 1751980000000 ms, T2 = 1751990000000 ms):

```swift
import Foundation
import Testing
@testable import AlloyStorage

/// Twin of web .../backends/storage-backend.contract.ts — same scenarios, same instants.
let contractT1 = Date(timeIntervalSince1970: 1_751_980_000)
let contractT2 = Date(timeIntervalSince1970: 1_751_990_000)

func runStorageBackendContract(_ make: () async throws -> any StorageBackend) async throws {
  // write then read round-trips
  var b = try await make()
  try await b.write(StorageRecord(id: "a", name: "a.json", updatedAt: contractT1, payload: #"{"v":1}"#))
  var got = try await b.read(id: "a")
  #expect(got?.id == "a" && got?.name == "a.json" && got?.payload == #"{"v":1}"#)
  #expect(got?.updatedAt == contractT1)

  // read of a missing id resolves nil
  b = try await make()
  #expect(try await b.read(id: "nope") == nil)

  // list returns metadata for every record
  b = try await make()
  try await b.write(StorageRecord(id: "a", name: "a.json", updatedAt: contractT1, payload: "x"))
  try await b.write(StorageRecord(id: "b", name: "b.json", updatedAt: contractT2, payload: "y"))
  let metas = try await b.list()
  #expect(metas.map(\.id).sorted() == ["a", "b"])

  // write replaces an existing record
  b = try await make()
  try await b.write(StorageRecord(id: "a", name: "a.json", updatedAt: contractT1, payload: "old"))
  try await b.write(StorageRecord(id: "a", name: "renamed.json", updatedAt: contractT2, payload: "new"))
  got = try await b.read(id: "a")
  #expect(got?.name == "renamed.json" && got?.payload == "new" && got?.updatedAt == contractT2)
  #expect(try await b.list().count == 1)

  // delete removes and is idempotent
  b = try await make()
  try await b.write(StorageRecord(id: "a", name: "a.json", updatedAt: contractT1, payload: "x"))
  try await b.delete(id: "a")
  #expect(try await b.read(id: "a") == nil)
  try await b.delete(id: "a") // absent id: no throw
}
```

`swift/Tests/AlloyStorageTests/LocalStorageBackendTests.swift`:

```swift
import Foundation
import Testing
@testable import AlloyStorage

@Suite struct LocalStorageBackendTests {
  @Test func satisfiesContract() async throws {
    try await runStorageBackendContract {
      let dir = FileManager.default.temporaryDirectory
        .appendingPathComponent("alloy-storage-tests-\(UUID().uuidString)")
      return LocalStorageBackend(collection: "test", directory: dir)
    }
  }
}
```

- [ ] **Step 2: Run to verify it fails**

`cd swift && swift test --filter AlloyStorageTests` → FAIL: `LocalStorageBackend` not found.

- [ ] **Step 3: Implement**

`swift/Sources/AlloyStorage/Backends/LocalStorageBackend.swift`:

```swift
import Foundation

/// Local replica backend on the file system: one JSON file per record under
/// `<directory>/<collection>/`. Default directory is Application Support.
public final class LocalStorageBackend: StorageBackend, @unchecked Sendable {
  private struct Stored: Codable {
    let id: String
    let name: String
    let updatedAtMs: Double
    let revision: String?
    let payload: String
  }

  private let folder: URL
  private let queue = DispatchQueue(label: "alloy-storage.local")

  public init(collection: String, directory: URL? = nil) {
    let base = directory
      ?? FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        .appendingPathComponent(Bundle.main.bundleIdentifier ?? "Alloy")
    self.folder = base.appendingPathComponent(collection, isDirectory: true)
  }

  private func fileURL(for id: String) -> URL {
    // Percent-encode so any id is a safe single-component filename.
    let safe = id.addingPercentEncoding(withAllowedCharacters: .alphanumerics) ?? id
    return folder.appendingPathComponent("\(safe).json")
  }

  private func ensureFolder() throws {
    try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
  }

  private func decode(_ url: URL) throws -> StorageRecord {
    let stored = try JSONDecoder().decode(Stored.self, from: Data(contentsOf: url))
    return StorageRecord(
      id: stored.id,
      name: stored.name,
      updatedAt: Date(timeIntervalSince1970: stored.updatedAtMs / 1000),
      revision: stored.revision,
      payload: stored.payload
    )
  }

  public func list() async throws -> [StorageRecordMeta] {
    try queue.sync {
      guard FileManager.default.fileExists(atPath: folder.path) else { return [] }
      let files = try FileManager.default.contentsOfDirectory(at: folder, includingPropertiesForKeys: nil)
      return try files.filter { $0.pathExtension == "json" }.map { try decode($0).meta }
    }
  }

  public func read(id: String) async throws -> StorageRecord? {
    try queue.sync {
      let url = fileURL(for: id)
      guard FileManager.default.fileExists(atPath: url.path) else { return nil }
      return try decode(url)
    }
  }

  @discardableResult
  public func write(_ record: StorageRecord) async throws -> StorageRecordMeta {
    try queue.sync {
      try ensureFolder()
      let stored = Stored(
        id: record.id,
        name: record.name,
        updatedAtMs: record.updatedAt.timeIntervalSince1970 * 1000,
        revision: record.revision,
        payload: record.payload
      )
      try JSONEncoder().encode(stored).write(to: fileURL(for: record.id), options: .atomic)
      return record.meta
    }
  }

  public func delete(id: String) async throws {
    try queue.sync {
      let url = fileURL(for: id)
      guard FileManager.default.fileExists(atPath: url.path) else { return }
      try FileManager.default.removeItem(at: url)
    }
  }
}
```

- [ ] **Step 4: Run to verify pass**

`cd swift && swift test --filter AlloyStorageTests` → PASS.

- [ ] **Step 5: Commit**

```bash
git add swift/Sources/AlloyStorage/Backends swift/Tests/AlloyStorageTests
git commit -m "feat(storage): add Swift LocalStorageBackend with contract twin"
```

---

### Task 5: TS DriveClient (port from AllyScore, generalized)

**Files:**
- Create: `web/packages/alloy-storage/src/backends/drive/drive-client.ts`
- Test: `web/packages/alloy-storage/src/backends/drive/drive-client.spec.ts`

**Interfaces:**
- Consumes: `AuthProvider`, `StorageError` from Task 1.
- Produces: `interface DriveFileMeta { id: string; name: string; headRevisionId?: string; appProperties?: Record<string, string> }` and `class DriveClient { constructor(auth: AuthProvider, fetchFn?: typeof fetch); resolveFolderPath(path: string): Promise<string>; listFiles(folderId: string): Promise<DriveFileMeta[]>; findByAlloyId(folderId: string, id: string): Promise<DriveFileMeta | null>; createFile(folderId, name, appProperties, content): Promise<string>; updateFile(fileId, content, appProperties, name): Promise<void>; downloadFile(fileId): Promise<string>; deleteFile(fileId): Promise<void> }`.
- Port source: `/Volumes/AllyDrive/Storage/Repos/AllyScore/packages/persistence/src/drive/drive-client.ts` (and its spec). Changes from the source are listed in Step 3; everything not listed ports verbatim.

- [ ] **Step 1: Write the failing spec**

`src/backends/drive/drive-client.spec.ts` — a scripted-fetch fake, plus assertions on the exact URLs/queries sent (port the assertions style from AllyScore's `drive-client.spec.ts`, which you should read first):

```ts
import { describe, expect, it } from 'vitest';
import type { AuthProvider } from '../../core/auth';
import { StorageError } from '../../core/errors';
import { DriveClient } from './drive-client';

const auth: AuthProvider = { accessToken: async () => 'tok', state: 'signedIn' };
const noAuth: AuthProvider = { accessToken: async () => null, state: 'signedOut' };

type Scripted = { match: (url: string, init?: RequestInit) => boolean; response: unknown; status?: number };

function fakeFetch(script: Scripted[], calls: Array<{ url: string; init?: RequestInit }> = []) {
  const fn: typeof fetch = async (input, init) => {
    const url = String(input);
    calls.push({ url, init });
    const hit = script.find((s) => s.match(url, init));
    if (!hit) throw new Error(`unscripted fetch: ${url}`);
    return new Response(
      typeof hit.response === 'string' ? hit.response : JSON.stringify(hit.response),
      { status: hit.status ?? 200 }
    );
  };
  return fn;
}

describe('DriveClient', () => {
  it('throws StorageError(auth) when signed out', async () => {
    const client = new DriveClient(noAuth, fakeFetch([]));
    await expect(client.listFiles('f1')).rejects.toMatchObject({ category: 'auth', status: 401 });
  });

  it('maps non-OK responses through StorageError.fromHttpStatus', async () => {
    const client = new DriveClient(auth, fakeFetch([{ match: () => true, response: '', status: 429 }]));
    const err = await client.listFiles('f1').catch((e) => e);
    expect(err).toBeInstanceOf(StorageError);
    expect(err.category).toBe('quota');
  });

  it('resolveFolderPath find-or-creates each segment under its parent', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const client = new DriveClient(
      auth,
      fakeFetch(
        [
          // "AllyWorld" exists at root…
          { match: (u) => u.includes('files?q=') && u.includes(encodeURIComponent("name='AllyWorld'")) && !u.includes('AllyClock'), response: { files: [{ id: 'p1' }] } },
          // …"AllyClock" under it does not…
          { match: (u) => u.includes('files?q=') && u.includes(encodeURIComponent("name='AllyClock'")), response: { files: [] } },
          // …so it gets created with parent p1.
          { match: (u, i) => u.endsWith('/files?fields=id') && i?.method === 'POST', response: { id: 'c1' } },
        ],
        calls
      )
    );
    expect(await client.resolveFolderPath('AllyWorld/AllyClock')).toBe('c1');
    const post = calls.find((c) => c.init?.method === 'POST');
    expect(JSON.parse(String(post?.init?.body))).toMatchObject({ name: 'AllyClock', parents: ['p1'] });
  });

  it('listFiles requests metadata fields only', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const client = new DriveClient(
      auth,
      fakeFetch([{ match: () => true, response: { files: [{ id: 'x', name: 'a.json' }] } }], calls)
    );
    await client.listFiles('f1');
    expect(calls[0].url).toContain('fields=files(id,name,appProperties,headRevisionId)');
    expect(calls[0].url).not.toContain('alt=media');
  });

  it('findByAlloyId matches alloyId or legacy allyscoreId', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const client = new DriveClient(
      auth,
      fakeFetch([{ match: () => true, response: { files: [{ id: 'x', name: 'a' }] } }], calls)
    );
    await client.findByAlloyId('f1', 'id9');
    const q = decodeURIComponent(calls[0].url);
    expect(q).toContain("key='alloyId' and value='id9'");
    expect(q).toContain("key='allyscoreId' and value='id9'");
    expect(q).toContain(' or ');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

`npm test -w @allyworld/alloy-storage` → FAIL: cannot resolve `./drive-client`.

- [ ] **Step 3: Implement by porting**

Read `/Volumes/AllyDrive/Storage/Repos/AllyScore/packages/persistence/src/drive/drive-client.ts` and port it into `src/backends/drive/drive-client.ts` with EXACTLY these changes (everything else — `call()`, `multipart()`, `encodeQuery()`, the API/UPLOAD constants, bound-fetch default — ports verbatim):

1. `constructor(private readonly auth: AuthProvider, ...)` — `AuthProvider` from `../../core/auth` replaces `DriveAuth`.
2. Delete `DriveApiError`; every failure goes through `StorageError`: signed-out → `throw StorageError.fromHttpStatus(401, 'Not signed in')`; non-OK response → `throw StorageError.fromHttpStatus(res.status)`. Network-level `fetchFn` rejections wrap as `new StorageError('unreachable', String(err))`.
3. `BOUNDARY` becomes `'alloy-storage-multipart'`.
4. Replace `findFolder(name)` / `createFolder(name)` with parent-aware privates and add the path walker:

```ts
private async findFolder(name: string, parentId: string | null): Promise<string | null> {
  const parent = parentId ? ` and '${parentId}' in parents` : '';
  const q = this.encodeQuery(
    `name='${name}' and mimeType='${FOLDER_MIME}' and trashed=false${parent}`
  );
  const res = await this.call(`${API}/files?q=${q}&fields=files(id)`);
  const body = (await res.json()) as { files?: Array<{ id: string }> };
  return body.files?.[0]?.id ?? null;
}

private async createFolder(name: string, parentId: string | null): Promise<string> {
  const res = await this.call(`${API}/files?fields=id`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name,
      mimeType: FOLDER_MIME,
      ...(parentId ? { parents: [parentId] } : {}),
    }),
  });
  return ((await res.json()) as { id: string }).id;
}

/** Find-or-create every segment of "A/B/C"; returns the leaf folder id. */
async resolveFolderPath(path: string): Promise<string> {
  let parentId: string | null = null;
  for (const segment of path.split('/').filter((s) => s.length > 0)) {
    parentId =
      (await this.findFolder(segment, parentId)) ?? (await this.createFolder(segment, parentId));
  }
  if (parentId === null) throw new StorageError('notFound', `empty folder path: '${path}'`);
  return parentId;
}
```

5. `listFiles` requests `fields=files(id,name,appProperties,headRevisionId)` (adds `headRevisionId`, still `pageSize=1000`); `DriveFileMeta` gains `headRevisionId?: string`.
6. `findByScoreId` becomes `findByAlloyId(folderId, id)` with the dual-key query and the same fields as `listFiles`:

```ts
const q = this.encodeQuery(
  `'${folderId}' in parents and trashed=false and ` +
    `(appProperties has { key='alloyId' and value='${id}' } or ` +
    `appProperties has { key='allyscoreId' and value='${id}' })`
);
```

7. `createFile` / `updateFile` / `downloadFile` / `deleteFile` port verbatim (signatures unchanged).

- [ ] **Step 4: Run to verify pass**

`npm test -w @allyworld/alloy-storage` → PASS.

- [ ] **Step 5: Commit**

```bash
git add web/packages/alloy-storage/src/backends/drive
git commit -m "feat(storage): port DriveClient with folder paths and StorageError"
```

---

### Task 6: TS DriveBackend

**Files:**
- Create: `web/packages/alloy-storage/src/backends/drive/drive-backend.ts`
- Modify: `web/packages/alloy-storage/src/index.ts` (export drive-client + drive-backend)
- Test: `web/packages/alloy-storage/src/backends/drive/drive-backend.spec.ts`

**Interfaces:**
- Consumes: `DriveClient`, `DriveFileMeta` (Task 5); `StorageBackend`, `StorageRecord(Meta)`, `StorageError` (Task 1).
- Produces: `class DriveBackend implements StorageBackend { constructor(client: DriveClient, folderPath: string, cache: Storage | null = defaultLocalStorage) }`. Behavior later tasks/plans rely on: folder-id caching under key `alloy-storage.folderId.<folderPath>` with one 404 re-resolve (AllyScore's recovery pattern), per-id write chains (later save always lands after earlier ones), legacy `allyscoreId`/`savedAt` reads, new writes use `alloyId`/`alloySavedAt`.
- Port source for the folder logic: `/Volumes/AllyDrive/Storage/Repos/AllyScore/packages/persistence/src/drive/drive-score-store.ts` (`ensureFolder`/`resolveFolder`/`withFolder` and the `saveChains` map).

- [ ] **Step 1: Write the failing spec**

`src/backends/drive/drive-backend.spec.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import type { DriveClient, DriveFileMeta } from './drive-client';
import { StorageError } from '../../core/errors';
import { DriveBackend } from './drive-backend';

const T1 = 1751980000000;

/** In-memory fake of the DriveClient surface DriveBackend uses. */
function fakeClient(overrides: Partial<DriveClient> = {}): DriveClient {
  const base = {
    resolveFolderPath: vi.fn(async () => 'folder1'),
    listFiles: vi.fn(async (): Promise<DriveFileMeta[]> => []),
    findByAlloyId: vi.fn(async () => null),
    createFile: vi.fn(async () => 'file1'),
    updateFile: vi.fn(async () => undefined),
    downloadFile: vi.fn(async () => 'payload'),
    deleteFile: vi.fn(async () => undefined),
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

describe('DriveBackend', () => {
  it('resolves the folder path once and caches the id', async () => {
    const client = fakeClient();
    const cache = memStorage();
    const b = new DriveBackend(client, 'AllyWorld/App', cache);
    await b.list();
    await b.list();
    expect(client.resolveFolderPath).toHaveBeenCalledTimes(1);
    expect(cache.getItem('alloy-storage.folderId.AllyWorld/App')).toBe('folder1');
  });

  it('re-resolves once when the cached folder 404s', async () => {
    const listFiles = vi
      .fn()
      .mockRejectedValueOnce(StorageError.fromHttpStatus(404))
      .mockResolvedValue([]);
    const client = fakeClient({ listFiles } as Partial<DriveClient>);
    const cache = memStorage();
    cache.setItem('alloy-storage.folderId.App', 'stale');
    const b = new DriveBackend(client, 'App', cache);
    expect(await b.list()).toEqual([]);
    expect(client.resolveFolderPath).toHaveBeenCalledTimes(1); // stale cache replaced
    expect(listFiles).toHaveBeenCalledTimes(2);
  });

  it('maps Drive files to metas, accepting legacy keys and skipping foreign files', async () => {
    const listFiles = vi.fn(async (): Promise<DriveFileMeta[]> => [
      { id: 'd1', name: 'a.json', headRevisionId: 'r1', appProperties: { alloyId: 'a', alloySavedAt: String(T1) } },
      { id: 'd2', name: 'b.allyscore', appProperties: { allyscoreId: 'b', savedAt: String(T1) } },
      { id: 'd3', name: 'stranger.txt' }, // no alloy identity → skipped
    ]);
    const b = new DriveBackend(fakeClient({ listFiles } as Partial<DriveClient>), 'App', memStorage());
    expect(await b.list()).toEqual([
      { id: 'a', name: 'a.json', updatedAt: T1, revision: 'r1' },
      { id: 'b', name: 'b.allyscore', updatedAt: T1 },
    ]);
  });

  it('write creates when absent, updates when present, sanitizing the filename', async () => {
    const client = fakeClient();
    const b = new DriveBackend(client, 'App', memStorage());
    await b.write({ id: 'a', name: 'bad/name.json', updatedAt: T1, payload: 'p' });
    expect(client.createFile).toHaveBeenCalledWith(
      'folder1',
      'bad-name.json',
      { alloyId: 'a', alloySavedAt: String(T1) },
      'p'
    );

    const meta: DriveFileMeta = { id: 'd1', name: 'a.json', appProperties: { alloyId: 'a' } };
    const client2 = fakeClient({ findByAlloyId: vi.fn(async () => meta) } as Partial<DriveClient>);
    const b2 = new DriveBackend(client2, 'App', memStorage());
    await b2.write({ id: 'a', name: 'a.json', updatedAt: T1, payload: 'p2' });
    expect(client2.updateFile).toHaveBeenCalledWith('d1', 'p2', { alloyId: 'a', alloySavedAt: String(T1) }, 'a.json');
  });

  it('read returns null on miss; delete is idempotent', async () => {
    const b = new DriveBackend(fakeClient(), 'App', memStorage());
    expect(await b.read('missing')).toBeNull();
    await expect(b.delete('missing')).resolves.toBeUndefined();
  });

  it('serializes writes per id (later save lands after earlier)', async () => {
    const order: string[] = [];
    const createFile = vi.fn(async (_f: string, name: string) => {
      order.push(`start:${name}`);
      await new Promise((r) => setTimeout(r, name === 'first.json' ? 20 : 0));
      order.push(`end:${name}`);
      return 'f';
    });
    const client = fakeClient({ createFile } as Partial<DriveClient>);
    const b = new DriveBackend(client, 'App', memStorage());
    await Promise.all([
      b.write({ id: 'a', name: 'first.json', updatedAt: T1, payload: '1' }),
      b.write({ id: 'a', name: 'second.json', updatedAt: T1, payload: '2' }),
    ]);
    expect(order).toEqual(['start:first.json', 'end:first.json', 'start:second.json', 'end:second.json']);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

`npm test -w @allyworld/alloy-storage` → FAIL: cannot resolve `./drive-backend`.

- [ ] **Step 3: Implement**

`src/backends/drive/drive-backend.ts`:

```ts
import type { StorageBackend } from '../../core/backend';
import type { StorageRecord, StorageRecordMeta } from '../../core/record';
import { StorageError } from '../../core/errors';
import type { DriveClient, DriveFileMeta } from './drive-client';

const CACHE_PREFIX = 'alloy-storage.folderId.';

function defaultStorage(): Storage | null {
  return typeof localStorage !== 'undefined' ? localStorage : null;
}

function toMeta(file: DriveFileMeta): StorageRecordMeta | null {
  const p = file.appProperties ?? {};
  const id = p['alloyId'] ?? p['allyscoreId'];
  if (!id) return null; // not ours — a foreign file sharing the folder
  const updatedAt = Number(p['alloySavedAt'] ?? p['savedAt'] ?? 0);
  const meta: StorageRecordMeta = { id, name: file.name, updatedAt };
  return file.headRevisionId ? { ...meta, revision: file.headRevisionId } : meta;
}

/** StorageBackend on the user's own Google Drive (drive.file scope), scoped to
 *  one folder path. Folder id caching + 404 re-resolve and per-id write chains
 *  are ported from AllyScore's DriveScoreStore. */
export class DriveBackend implements StorageBackend {
  private folderId: string | null = null;
  private folderPromise: Promise<string> | null = null;
  /** Per-id promise chains: a later write always lands after earlier ones. */
  private readonly writeChains = new Map<string, Promise<unknown>>();

  constructor(
    private readonly client: DriveClient,
    private readonly folderPath: string,
    private readonly cache: Storage | null = defaultStorage()
  ) {}

  private get cacheKey(): string {
    return CACHE_PREFIX + this.folderPath;
  }

  private ensureFolder(): Promise<string> {
    if (this.folderId) return Promise.resolve(this.folderId);
    this.folderPromise ??= this.resolveFolder().finally(() => {
      this.folderPromise = null; // a rejected resolve may retry later
    });
    return this.folderPromise;
  }

  private async resolveFolder(): Promise<string> {
    const cached = this.cache?.getItem(this.cacheKey) ?? null;
    if (cached) {
      this.folderId = cached;
      return cached;
    }
    const id = await this.client.resolveFolderPath(this.folderPath);
    this.folderId = id;
    this.cache?.setItem(this.cacheKey, id);
    return id;
  }

  private async withFolder<T>(fn: (folderId: string) => Promise<T>): Promise<T> {
    const id = await this.ensureFolder();
    try {
      return await fn(id);
    } catch (e) {
      if (e instanceof StorageError && e.status === 404) {
        // The cached folder was deleted/moved out of reach: re-resolve once.
        this.folderId = null;
        this.cache?.removeItem(this.cacheKey);
        return fn(await this.ensureFolder());
      }
      throw e;
    }
  }

  async list(): Promise<StorageRecordMeta[]> {
    return this.withFolder(async (folderId) => {
      const files = await this.client.listFiles(folderId);
      return files.map(toMeta).filter((m): m is StorageRecordMeta => m !== null);
    });
  }

  async read(id: string): Promise<StorageRecord | null> {
    return this.withFolder(async (folderId) => {
      const file = await this.client.findByAlloyId(folderId, id);
      if (!file) return null;
      const meta = toMeta(file);
      if (!meta) return null;
      const payload = await this.client.downloadFile(file.id);
      return { ...meta, payload };
    });
  }

  write(record: StorageRecord): Promise<StorageRecordMeta> {
    const prev = this.writeChains.get(record.id) ?? Promise.resolve();
    const next = prev.catch(() => undefined).then(() => this.writeOnce(record));
    this.writeChains.set(record.id, next);
    return next;
  }

  private async writeOnce(record: StorageRecord): Promise<StorageRecordMeta> {
    return this.withFolder(async (folderId) => {
      const name = record.name.replace(/[\\/:*?"<>|]/g, '-');
      const props = { alloyId: record.id, alloySavedAt: String(record.updatedAt) };
      const existing = await this.client.findByAlloyId(folderId, record.id);
      if (existing) await this.client.updateFile(existing.id, record.payload, props, name);
      else await this.client.createFile(folderId, name, props, record.payload);
      return { id: record.id, name, updatedAt: record.updatedAt };
    });
  }

  async delete(id: string): Promise<void> {
    return this.withFolder(async (folderId) => {
      const file = await this.client.findByAlloyId(folderId, id);
      if (file) await this.client.deleteFile(file.id);
    });
  }
}
```

Add to `src/index.ts`:

```ts
export * from './backends/drive/drive-client';
export * from './backends/drive/drive-backend';
```

- [ ] **Step 4: Run to verify pass**

`npm test -w @allyworld/alloy-storage` → PASS. Build stays clean.

- [ ] **Step 5: Commit**

```bash
git add web/packages/alloy-storage
git commit -m "feat(storage): add DriveBackend with folder cache and write chains"
```

---

### Task 7: Swift Drive twins (HTTPTransport, DriveClient, DriveBackend)

**Files:**
- Create: `swift/Sources/AlloyStorage/Backends/Drive/HTTPTransport.swift`, `Backends/Drive/DriveClient.swift`, `Backends/Drive/DriveBackend.swift`
- Test: `swift/Tests/AlloyStorageTests/DriveClientTests.swift`, `swift/Tests/AlloyStorageTests/DriveBackendTests.swift`

**Interfaces:**
- Consumes: Task 2 core types; TS Task 5/6 as the canonical shapes to mirror.
- Produces:

```swift
public protocol HTTPTransport: Sendable {
  func send(_ request: URLRequest) async throws -> (Data, HTTPURLResponse)
}
public struct URLSessionTransport: HTTPTransport { public init(session: URLSession = .shared) }

public struct DriveFileMeta: Sendable, Equatable {
  public let id: String; public let name: String
  public let headRevisionId: String?; public let appProperties: [String: String]?
}
public final class DriveClient: Sendable {
  public init(auth: any AuthProvider, transport: any HTTPTransport = URLSessionTransport())
  public func resolveFolderPath(_ path: String) async throws -> String
  public func listFiles(folderId: String) async throws -> [DriveFileMeta]
  public func findByAlloyId(folderId: String, id: String) async throws -> DriveFileMeta?
  public func createFile(folderId: String, name: String, appProperties: [String: String], content: String) async throws -> String
  public func updateFile(fileId: String, content: String, appProperties: [String: String], name: String) async throws
  public func downloadFile(fileId: String) async throws -> String
  public func deleteFile(fileId: String) async throws
}
public final class DriveBackend: StorageBackend {
  public init(client: DriveClient, folderPath: String, cache: UserDefaults? = .standard)
}
```

- [ ] **Step 1: Write the failing tests**

Mirror the TS specs from Tasks 5–6 scenario-for-scenario with a `ScriptedTransport`. `swift/Tests/AlloyStorageTests/DriveClientTests.swift`:

```swift
import Foundation
import Testing
@testable import AlloyStorage

struct StubAuth: AuthProvider {
  let token: String?
  var state: AuthState { token == nil ? .signedOut : .signedIn }
  func accessToken() async -> String? { token }
}

/// Scripted HTTP fake: each entry matches on URL substring (+ optional method).
final class ScriptedTransport: HTTPTransport, @unchecked Sendable {
  struct Entry { let matches: (URLRequest) -> Bool; let body: String; let status: Int }
  var entries: [Entry]
  var requests: [URLRequest] = []
  init(_ entries: [Entry]) { self.entries = entries }

  func send(_ request: URLRequest) async throws -> (Data, HTTPURLResponse) {
    requests.append(request)
    guard let entry = entries.first(where: { $0.matches(request) }) else {
      throw StorageError(category: .unreachable, message: "unscripted: \(request.url!)")
    }
    let response = HTTPURLResponse(
      url: request.url!, statusCode: entry.status, httpVersion: nil, headerFields: nil)!
    return (Data(entry.body.utf8), response)
  }
}

@Suite struct DriveClientTests {
  @Test func throwsAuthWhenSignedOut() async {
    let client = DriveClient(auth: StubAuth(token: nil), transport: ScriptedTransport([]))
    await #expect(throws: StorageError.self) { try await client.listFiles(folderId: "f1") }
    do { _ = try await client.listFiles(folderId: "f1") }
    catch let e as StorageError { #expect(e.category == .auth && e.status == 401) }
    catch { Issue.record("wrong error type") }
  }

  @Test func mapsNonOKThroughFromHTTPStatus() async {
    let transport = ScriptedTransport([.init(matches: { _ in true }, body: "", status: 429)])
    let client = DriveClient(auth: StubAuth(token: "tok"), transport: transport)
    do { _ = try await client.listFiles(folderId: "f1") }
    catch let e as StorageError { #expect(e.category == .quota) }
    catch { Issue.record("wrong error type") }
  }

  @Test func resolveFolderPathFindOrCreatesEachSegment() async throws {
    let transport = ScriptedTransport([
      .init(matches: { r in
        let u = r.url!.absoluteString
        return u.contains("files?q=") && u.contains("AllyWorld") && !u.contains("AllyClock")
      }, body: #"{"files":[{"id":"p1"}]}"#, status: 200),
      .init(matches: { r in r.url!.absoluteString.contains("AllyClock") && r.httpMethod != "POST" },
            body: #"{"files":[]}"#, status: 200),
      .init(matches: { r in r.httpMethod == "POST" }, body: #"{"id":"c1"}"#, status: 200),
    ])
    let client = DriveClient(auth: StubAuth(token: "tok"), transport: transport)
    let id = try await client.resolveFolderPath("AllyWorld/AllyClock")
    #expect(id == "c1")
    let post = transport.requests.first { $0.httpMethod == "POST" }
    let body = String(data: post!.httpBody!, encoding: .utf8)!
    #expect(body.contains(#""parents":["p1"]"#) && body.contains(#""name":"AllyClock""#))
  }

  @Test func listFilesRequestsMetadataFieldsOnly() async throws {
    let transport = ScriptedTransport([
      .init(matches: { _ in true }, body: #"{"files":[{"id":"x","name":"a.json"}]}"#, status: 200)
    ])
    let client = DriveClient(auth: StubAuth(token: "tok"), transport: transport)
    _ = try await client.listFiles(folderId: "f1")
    let url = transport.requests[0].url!.absoluteString
    #expect(url.contains("fields=files(id,name,appProperties,headRevisionId)"))
    #expect(!url.contains("alt=media"))
  }

  @Test func findByAlloyIdMatchesBothKeys() async throws {
    let transport = ScriptedTransport([
      .init(matches: { _ in true }, body: #"{"files":[{"id":"x","name":"a"}]}"#, status: 200)
    ])
    let client = DriveClient(auth: StubAuth(token: "tok"), transport: transport)
    _ = try await client.findByAlloyId(folderId: "f1", id: "id9")
    let q = transport.requests[0].url!.absoluteString.removingPercentEncoding!
    #expect(q.contains("key='alloyId' and value='id9'"))
    #expect(q.contains("key='allyscoreId' and value='id9'"))
    #expect(q.contains(" or "))
  }
}
```

`swift/Tests/AlloyStorageTests/DriveBackendTests.swift` mirrors the TS DriveBackend spec: folder resolved once and cached (use `UserDefaults(suiteName: "alloy-storage-tests-<uuid>")`, remove in defer), 404 re-resolve, legacy-key mapping + foreign-file skip (same `T1` fixture ms), create-vs-update with filename sanitizing, nil read / idempotent delete. Fake the client at the transport level (script `files?q=` responses) — `DriveClient` is final, so DriveBackend tests script the same `ScriptedTransport` rather than subclass the client. Assert cache key `"alloy-storage.folderId.<path>"` lands in the suite defaults.

- [ ] **Step 2: Run to verify fails**

`cd swift && swift test --filter AlloyStorageTests` → FAIL: `DriveClient` not found.

- [ ] **Step 3: Implement**

`HTTPTransport.swift`:

```swift
import Foundation
#if canImport(FoundationNetworking)
  import FoundationNetworking
#endif

/// Injected HTTP seam — the Swift mirror of DriveClient's injected fetch.
public protocol HTTPTransport: Sendable {
  func send(_ request: URLRequest) async throws -> (Data, HTTPURLResponse)
}

public struct URLSessionTransport: HTTPTransport {
  private let session: URLSession
  public init(session: URLSession = .shared) { self.session = session }

  public func send(_ request: URLRequest) async throws -> (Data, HTTPURLResponse) {
    let (data, response) = try await session.data(for: request)
    guard let http = response as? HTTPURLResponse else {
      throw StorageError(category: .unreachable, message: "non-HTTP response")
    }
    return (data, http)
  }
}
```

`DriveClient.swift` — mechanical port of the TS client (same constants, same call flow, same query strings). Key skeleton (fill the remaining methods by translating the TS file 1:1):

```swift
import Foundation

private let api = "https://www.googleapis.com/drive/v3"
private let upload = "https://www.googleapis.com/upload/drive/v3"
private let folderMime = "application/vnd.google-apps.folder"
private let boundary = "alloy-storage-multipart"

public struct DriveFileMeta: Sendable, Equatable, Decodable {
  public let id: String
  public let name: String
  public let headRevisionId: String?
  public let appProperties: [String: String]?
}

private struct FileList: Decodable { let files: [DriveFileMeta]? }
private struct IdOnly: Decodable { let id: String }

public final class DriveClient: @unchecked Sendable {
  private let auth: any AuthProvider
  private let transport: any HTTPTransport

  public init(auth: any AuthProvider, transport: any HTTPTransport = URLSessionTransport()) {
    self.auth = auth
    self.transport = transport
  }

  private func call(
    _ urlString: String, method: String = "GET",
    headers: [String: String] = [:], body: Data? = nil
  ) async throws -> Data {
    guard let token = await auth.accessToken() else {
      throw StorageError.fromHTTPStatus(401, message: "Not signed in")
    }
    var request = URLRequest(url: URL(string: urlString)!)
    request.httpMethod = method
    request.httpBody = body
    for (k, v) in headers { request.setValue(v, forHTTPHeaderField: k) }
    request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
    let (data, response) = try await transport.send(request)
    guard (200..<300).contains(response.statusCode) else {
      throw StorageError.fromHTTPStatus(response.statusCode)
    }
    return data
  }

  /// Percent-encode a Drive query, quotes included (twin of TS encodeQuery).
  private func encodeQuery(_ raw: String) -> String {
    var allowed = CharacterSet.alphanumerics
    allowed.insert(charactersIn: "-_.!~*()")
    return raw.addingPercentEncoding(withAllowedCharacters: allowed)!
      .replacingOccurrences(of: "'", with: "%27")
  }

  private func multipart(meta: [String: Any], content: String) -> (headers: [String: String], body: Data) {
    let metaJson = try! JSONSerialization.data(withJSONObject: meta)
    let body =
      "--\(boundary)\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n"
      + String(data: metaJson, encoding: .utf8)!
      + "\r\n--\(boundary)\r\nContent-Type: application/json\r\n\r\n"
      + "\(content)\r\n--\(boundary)--"
    return (["Content-Type": "multipart/related; boundary=\(boundary)"], Data(body.utf8))
  }

  // findFolder / createFolder / resolveFolderPath / listFiles / findByAlloyId /
  // createFile / updateFile / downloadFile / deleteFile: translate each TS
  // method 1:1 from web/packages/alloy-storage/src/backends/drive/drive-client.ts,
  // decoding with FileList / IdOnly via JSONDecoder.
}
```

`DriveBackend.swift` — port of the TS DriveBackend as an `actor`-free final class guarded by a serial `DispatchQueue`-less design: use an internal `actor State` OR simply mark the class `@unchecked Sendable` and mirror the TS logic directly (folderId memo, folderPromise → an in-flight `Task<String, Error>`, per-id write chains as `[String: Task<StorageRecordMeta, Never>]`). Cache in `UserDefaults` under `"alloy-storage.folderId.<folderPath>"` — the Swift stand-in for the TS `Storage` seam (`cache: UserDefaults? = .standard`; pass a suite in tests, nil disables caching). `toMeta` mirrors the TS function including the legacy `allyscoreId`/`savedAt` fallback and foreign-file skip; `updatedAt` decodes ms → `Date(timeIntervalSince1970: ms / 1000)`; writes send `alloyId` + `alloySavedAt` (ms as string). Filename sanitizing: `record.name.replacingOccurrences(of: #"[\\/:*?"<>|]"#, with: "-", options: .regularExpression)`.

- [ ] **Step 4: Run to verify pass**

`cd swift && swift build && swift test --filter AlloyStorageTests` → PASS.

- [ ] **Step 5: Commit**

```bash
git add swift/Sources/AlloyStorage swift/Tests/AlloyStorageTests
git commit -m "feat(storage): add Swift Drive twins behind HTTPTransport seam"
```

---

### Task 8: services/google-oauth token function

**Files:**
- Create: `services/google-oauth/netlify.toml`, `services/google-oauth/package.json`, `functions/lib/cors.mjs`, `functions/lib/google.mjs`, `functions/token.mjs`, `functions/refresh.mjs`
- Test: `services/google-oauth/test/oauth.test.mjs`

**Interfaces:**
- Consumes: nothing from the library (standalone deliverable).
- Produces (HTTP contract that Task 9's `GoogleAuth` calls):
  - `POST /token` body `{ "code": string, "codeVerifier": string, "redirectUri": string }` → `200 { "accessToken": string, "refreshToken": string, "expiresIn": number }`
  - `POST /refresh` body `{ "refreshToken": string }` → `200 { "accessToken": string, "expiresIn": number }`
  - Errors: `400` bad body, `401` Google rejected the grant, `403` disallowed Origin. CORS: allowed origins from env `ALLOWED_ORIGINS` (comma-separated), echoing `Access-Control-Allow-Origin`; `OPTIONS` preflight → `204`.
  - Env: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `ALLOWED_ORIGINS`.

- [ ] **Step 1: Scaffold**

`services/google-oauth/package.json`:

```json
{
  "name": "google-oauth-service",
  "private": true,
  "type": "module",
  "scripts": { "test": "node --test test/" }
}
```

`services/google-oauth/netlify.toml`:

```toml
# Stateless Google OAuth token exchange shared by the Ally web apps.
# Env (set in the Netlify UI): GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, ALLOWED_ORIGINS.
[build]
  publish = "public"

[functions]
  directory = "functions"
```

Also create an empty `services/google-oauth/public/.gitkeep` (Netlify requires a publish dir).

- [ ] **Step 2: Write the failing tests**

`services/google-oauth/test/oauth.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.GOOGLE_CLIENT_ID = 'cid';
process.env.GOOGLE_CLIENT_SECRET = 'secret';
process.env.ALLOWED_ORIGINS = 'https://score.example,https://clock.example';

const { default: token } = await import('../functions/token.mjs');
const { default: refresh } = await import('../functions/refresh.mjs');

function req(path, { method = 'POST', origin = 'https://score.example', body } = {}) {
  return new Request(`https://oauth.example${path}`, {
    method,
    headers: { origin, 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function mockGoogle(response, status = 200) {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    return new Response(JSON.stringify(response), { status });
  };
  return calls;
}

test('token: exchanges a code, forwarding secret and PKCE verifier', async () => {
  const calls = mockGoogle({ access_token: 'at', refresh_token: 'rt', expires_in: 3599 });
  const res = await token(req('/token', { body: { code: 'c1', codeVerifier: 'v1', redirectUri: 'https://score.example/cb' } }));
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { accessToken: 'at', refreshToken: 'rt', expiresIn: 3599 });
  assert.equal(res.headers.get('access-control-allow-origin'), 'https://score.example');
  const sent = new URLSearchParams(calls[0].init.body);
  assert.equal(calls[0].url, 'https://oauth2.googleapis.com/token');
  assert.equal(sent.get('grant_type'), 'authorization_code');
  assert.equal(sent.get('code'), 'c1');
  assert.equal(sent.get('code_verifier'), 'v1');
  assert.equal(sent.get('client_secret'), 'secret');
});

test('refresh: exchanges a refresh token', async () => {
  mockGoogle({ access_token: 'at2', expires_in: 3599 });
  const res = await refresh(req('/refresh', { body: { refreshToken: 'rt' } }));
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { accessToken: 'at2', expiresIn: 3599 });
});

test('rejects a disallowed origin with 403', async () => {
  mockGoogle({});
  const res = await token(req('/token', { origin: 'https://evil.example', body: { code: 'c' } }));
  assert.equal(res.status, 403);
});

test('maps a Google rejection to 401', async () => {
  mockGoogle({ error: 'invalid_grant' }, 400);
  const res = await refresh(req('/refresh', { body: { refreshToken: 'stale' } }));
  assert.equal(res.status, 401);
});

test('handles OPTIONS preflight with 204 + CORS headers', async () => {
  const res = await token(req('/token', { method: 'OPTIONS' }));
  assert.equal(res.status, 204);
  assert.equal(res.headers.get('access-control-allow-origin'), 'https://score.example');
  assert.equal(res.headers.get('access-control-allow-headers'), 'content-type');
});

test('rejects a missing/invalid body with 400', async () => {
  mockGoogle({});
  const res = await token(req('/token', { body: {} }));
  assert.equal(res.status, 400);
});
```

- [ ] **Step 3: Run to verify fails**

Run (from `services/google-oauth/`): `npm test` → FAIL: cannot find `../functions/token.mjs`.

- [ ] **Step 4: Implement**

`functions/lib/cors.mjs`:

```js
/** Origin allowlist from ALLOWED_ORIGINS (comma-separated). Returns CORS
 *  headers for an allowed origin, or null for a disallowed one. */
export function corsHeaders(request) {
  const origin = request.headers.get('origin') ?? '';
  const allowed = (process.env.ALLOWED_ORIGINS ?? '').split(',').map((s) => s.trim());
  if (!allowed.includes(origin)) return null;
  return {
    'access-control-allow-origin': origin,
    'access-control-allow-methods': 'POST, OPTIONS',
    'access-control-allow-headers': 'content-type',
  };
}

/** Shared preflight/deny/parse plumbing; onBody does the real work. */
export async function handle(request, onBody) {
  const cors = corsHeaders(request);
  if (!cors) return new Response('forbidden origin', { status: 403 });
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  if (request.method !== 'POST') return new Response('method not allowed', { status: 405, headers: cors });
  let body;
  try {
    body = await request.json();
  } catch {
    return new Response('invalid JSON', { status: 400, headers: cors });
  }
  const result = await onBody(body);
  return new Response(JSON.stringify(result.body), {
    status: result.status,
    headers: { ...cors, 'content-type': 'application/json' },
  });
}
```

`functions/lib/google.mjs`:

```js
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';

/** POST x-www-form-urlencoded params to Google's token endpoint.
 *  Google rejections (invalid_grant etc.) surface as { status: 401 }. */
export async function exchange(params) {
  const res = await fetch(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      ...params,
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
    }).toString(),
  });
  const json = await res.json();
  if (!res.ok || json.error) return { status: 401, body: { error: json.error ?? 'exchange failed' } };
  return { status: 200, body: json };
}
```

`functions/token.mjs`:

```js
import { handle } from './lib/cors.mjs';
import { exchange } from './lib/google.mjs';

export default async (request) =>
  handle(request, async (body) => {
    const { code, codeVerifier, redirectUri } = body ?? {};
    if (!code || !codeVerifier || !redirectUri) {
      return { status: 400, body: { error: 'code, codeVerifier, redirectUri required' } };
    }
    const result = await exchange({
      grant_type: 'authorization_code',
      code,
      code_verifier: codeVerifier,
      redirect_uri: redirectUri,
    });
    if (result.status !== 200) return result;
    const { access_token, refresh_token, expires_in } = result.body;
    return {
      status: 200,
      body: { accessToken: access_token, refreshToken: refresh_token, expiresIn: expires_in },
    };
  });

export const config = { path: '/token' };
```

`functions/refresh.mjs`:

```js
import { handle } from './lib/cors.mjs';
import { exchange } from './lib/google.mjs';

export default async (request) =>
  handle(request, async (body) => {
    const { refreshToken } = body ?? {};
    if (!refreshToken) return { status: 400, body: { error: 'refreshToken required' } };
    const result = await exchange({ grant_type: 'refresh_token', refresh_token: refreshToken });
    if (result.status !== 200) return result;
    const { access_token, expires_in } = result.body;
    return { status: 200, body: { accessToken: access_token, expiresIn: expires_in } };
  });

export const config = { path: '/refresh' };
```

- [ ] **Step 5: Run to verify pass**

`cd services/google-oauth && npm test` → all PASS.

- [ ] **Step 6: Commit**

```bash
git add services/google-oauth
git commit -m "feat(services): add stateless google-oauth token function"
```

---

### Task 9: TS web auth — PKCE, TokenStore, GoogleAuth

**Files:**
- Create: `web/packages/alloy-storage/src/auth/pkce.ts`, `src/auth/token-store.ts`, `src/auth/google-auth.ts`
- Modify: `web/packages/alloy-storage/src/index.ts` (export all three)
- Test: `src/auth/pkce.spec.ts`, `src/auth/google-auth.spec.ts`

**Interfaces:**
- Consumes: `AuthProvider`, `AuthState` (Task 1); `openDatabase`/`requestAsPromise` (Task 3); the token-service HTTP contract (Task 8).
- Produces:

```ts
// pkce.ts
generateCodeVerifier(random?: (len: number) => Uint8Array): string        // 64-char base64url
codeChallenge(verifier: string): Promise<string>                           // base64url(SHA-256)
// token-store.ts
interface StoredTokens { accessToken: string; expiresAt: number; refreshToken: string | null }
interface TokenStore { load(): Promise<StoredTokens | null>; save(t: StoredTokens): Promise<void>; clear(): Promise<void> }
class MemoryTokenStore implements TokenStore
class IndexedDbTokenStore implements TokenStore   // db 'alloy-storage.auth', store 'tokens', key 'google'
// google-auth.ts
interface GoogleAuthConfig { clientId: string; scope: string; redirectUri: string; tokenServiceUrl: string }
interface GoogleAuthDeps { tokenStore?: TokenStore; fetchFn?: typeof fetch; now?: () => number; navigate?: (url: string) => void; session?: Storage }
class GoogleAuth implements AuthProvider {
  constructor(config: GoogleAuthConfig, deps?: GoogleAuthDeps)
  readonly state: AuthState
  beginSignIn(): Promise<void>                       // → navigates to Google's consent page
  completeSignIn(callbackUrl: string): Promise<boolean>  // app calls on the redirect page
  accessToken(): Promise<string | null>
  signOut(): Promise<void>
}
```

- [ ] **Step 1: Write the failing PKCE spec**

`src/auth/pkce.spec.ts`:

```ts
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
```

- [ ] **Step 2: Run to verify fails, then implement pkce.ts**

`npm test -w @allyworld/alloy-storage` → FAIL. Then `src/auth/pkce.ts`:

```ts
function base64url(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

const defaultRandom = (len: number): Uint8Array => crypto.getRandomValues(new Uint8Array(len));

/** 48 random bytes → 64 base64url chars (RFC 7636 §4.1 allows 43–128). */
export function generateCodeVerifier(random: (len: number) => Uint8Array = defaultRandom): string {
  return base64url(random(48));
}

/** S256 challenge: base64url(SHA-256(verifier)). */
export async function codeChallenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return base64url(new Uint8Array(digest));
}
```

Run again → PKCE tests PASS. (Vitest runs in Node ≥20: `crypto.subtle` and `btoa` are global.)

- [ ] **Step 3: Write token-store.ts (small enough to skip its own spec — it is exercised by the GoogleAuth spec via MemoryTokenStore and by an IndexedDbTokenStore round-trip test inside google-auth.spec.ts)**

```ts
import { openDatabase, requestAsPromise } from '../backends/idb';

export interface StoredTokens {
  accessToken: string;
  /** Epoch ms when accessToken stops being valid. */
  expiresAt: number;
  refreshToken: string | null;
}

/** Persistence seam for GoogleAuth — IndexedDB in the app, memory in tests. */
export interface TokenStore {
  load(): Promise<StoredTokens | null>;
  save(tokens: StoredTokens): Promise<void>;
  clear(): Promise<void>;
}

export class MemoryTokenStore implements TokenStore {
  private tokens: StoredTokens | null = null;
  async load(): Promise<StoredTokens | null> {
    return this.tokens;
  }
  async save(tokens: StoredTokens): Promise<void> {
    this.tokens = tokens;
  }
  async clear(): Promise<void> {
    this.tokens = null;
  }
}

const KEY = 'google';

export class IndexedDbTokenStore implements TokenStore {
  private db: Promise<IDBDatabase> | null = null;

  constructor(private readonly idbFactory: IDBFactory = indexedDB) {}

  private open(): Promise<IDBDatabase> {
    this.db ??= openDatabase('alloy-storage.auth', 'tokens', this.idbFactory);
    return this.db;
  }

  private async store(mode: IDBTransactionMode): Promise<IDBObjectStore> {
    return (await this.open()).transaction('tokens', mode).objectStore('tokens');
  }

  async load(): Promise<StoredTokens | null> {
    const got = await requestAsPromise(
      (await this.store('readonly')).get(KEY) as IDBRequest<{ tokens: StoredTokens } | undefined>
    );
    return got?.tokens ?? null;
  }

  async save(tokens: StoredTokens): Promise<void> {
    await requestAsPromise((await this.store('readwrite')).put({ id: KEY, tokens }));
  }

  async clear(): Promise<void> {
    await requestAsPromise((await this.store('readwrite')).delete(KEY));
  }
}
```

- [ ] **Step 4: Write the failing GoogleAuth spec**

`src/auth/google-auth.spec.ts`:

```ts
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it } from 'vitest';
import { GoogleAuth, type GoogleAuthConfig } from './google-auth';
import { IndexedDbTokenStore, MemoryTokenStore, type StoredTokens } from './token-store';

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

    const ok = await a.completeSignIn(`https://app.example/oauth?code=c1&state=${state}`);
    expect(ok).toBe(true);
    expect(a.state).toBe('signedIn');
    const sent = JSON.parse(String(calls[0].init?.body));
    expect(calls[0].url).toBe('https://oauth.example/token');
    expect(sent.code).toBe('c1');
    expect(typeof sent.codeVerifier).toBe('string');
    expect(sent.redirectUri).toBe(config.redirectUri);
    expect((await tokenStore.load())?.refreshToken).toBe('rt');
  });

  it('completeSignIn rejects a state mismatch without exchanging', async () => {
    const { fn, calls } = jsonFetch(() => ({ status: 200, body: {} }));
    const session = fakeSession();
    const { setup } = auth({ fetch: fn, session });
    const a = await setup();
    await a.beginSignIn();
    expect(await a.completeSignIn('https://app.example/oauth?code=c1&state=WRONG')).toBe(false);
    expect(calls.length).toBe(0);
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
```

- [ ] **Step 5: Run to verify fails, then implement google-auth.ts**

```ts
import type { AuthProvider, AuthState } from '../core/auth';
import { codeChallenge, generateCodeVerifier } from './pkce';
import { IndexedDbTokenStore, type StoredTokens, type TokenStore } from './token-store';

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

  /** Call on the redirect page. Returns false on state mismatch / missing code. */
  async completeSignIn(callbackUrl: string): Promise<boolean> {
    const pending = this.session.getItem(SESSION_KEY);
    this.session.removeItem(SESSION_KEY);
    if (!pending) return false;
    const { verifier, state } = JSON.parse(pending) as { verifier: string; state: string };
    const params = new URL(callbackUrl).searchParams;
    const code = params.get('code');
    if (!code || params.get('state') !== state) return false;
    const res = await this.post('/token', {
      code,
      codeVerifier: verifier,
      redirectUri: this.config.redirectUri,
    });
    if (!res) return false;
    await this.tokenStore.save({
      accessToken: res.accessToken,
      expiresAt: this.now() + res.expiresIn * 1000,
      refreshToken: res.refreshToken ?? null,
    });
    this._state = 'signedIn';
    return true;
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
    let res: { accessToken: string; expiresIn: number } | null | 'rejected';
    try {
      res = await this.post('/refresh', { refreshToken: stored.refreshToken });
      if (res === null) res = 'rejected';
    } catch {
      // Network failure: keep the refresh token for the next attempt.
      this._state = 'expired';
      return null;
    }
    if (res === 'rejected') {
      // Google refused the grant (revoked/stale) — a new sign-in is required.
      await this.tokenStore.clear();
      this._state = 'expired';
      return null;
    }
    const next: StoredTokens = {
      accessToken: res.accessToken,
      expiresAt: this.now() + res.expiresIn * 1000,
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
        await this.fetchFn(
          `https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(token)}`,
          { method: 'POST' }
        );
      } catch {
        /* revoke is best-effort */
      }
    }
    await this.tokenStore.clear();
    this._state = 'signedOut';
  }

  /** POST JSON to the token service; null = non-OK response. Network errors throw. */
  private async post(
    path: string,
    body: object
  ): Promise<{ accessToken: string; refreshToken?: string; expiresIn: number } | null> {
    const res = await this.fetchFn(`${this.config.tokenServiceUrl}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) return null;
    return (await res.json()) as { accessToken: string; refreshToken?: string; expiresIn: number };
  }
}
```

Add to `src/index.ts`:

```ts
export * from './auth/pkce';
export * from './auth/token-store';
export * from './auth/google-auth';
```

- [ ] **Step 6: Run to verify pass**

`npm test -w @allyworld/alloy-storage` → PASS; `npm run build -w @allyworld/alloy-storage` → clean.

- [ ] **Step 7: Commit**

```bash
git add web/packages/alloy-storage
git commit -m "feat(storage): add web GoogleAuth with PKCE and durable refresh"
```

---

### Task 10: Swift auth twins — PKCE, TokenVault, GoogleAuth

**Files:**
- Create: `swift/Sources/AlloyStorage/Auth/PKCE.swift`, `Auth/TokenVault.swift`, `Auth/GoogleAuth.swift`
- Test: `swift/Tests/AlloyStorageTests/PKCETests.swift`, `swift/Tests/AlloyStorageTests/GoogleAuthTests.swift`

**Interfaces:**
- Consumes: `AuthProvider`, `AuthState` (Task 2); `HTTPTransport` (Task 7).
- Produces:

```swift
public enum PKCE {                              // caseless-enum namespace (mirroring.md rule)
  public static func generateCodeVerifier() -> String
  public static func codeChallenge(_ verifier: String) -> String
}
public struct StoredTokens: Codable, Equatable, Sendable {
  public let accessToken: String
  public let expiresAt: Date
  public let refreshToken: String?
}
public protocol TokenVault: Sendable {          // Swift twin of TokenStore
  func load() throws -> StoredTokens?
  func save(_ tokens: StoredTokens) throws
  func clear() throws
}
public final class MemoryTokenVault: TokenVault
public final class KeychainTokenVault: TokenVault   // kSecClassGenericPassword, service "alloy-storage.google"
public protocol AuthUISession: Sendable {       // seam over ASWebAuthenticationSession
  func authenticate(url: URL, callbackScheme: String) async throws -> URL
}
public struct GoogleAuthConfig: Sendable {
  public let clientId: String        // iOS-type client — no secret, talks to Google directly
  public let scope: String
  public let redirectScheme: String  // e.g. "com.googleusercontent.apps.<id>"
}
public final class GoogleAuth: AuthProvider {
  public init(config: GoogleAuthConfig, vault: any TokenVault = KeychainTokenVault(),
              transport: any HTTPTransport = URLSessionTransport(),
              uiSession: (any AuthUISession)? = nil, now: @escaping () -> Date = { Date() })
  public var state: AuthState { get }
  public func signIn() async -> Bool            // self-contained: runs the UI session + exchange
  public func accessToken() async -> String?
  public func signOut()
}
```

Semantic-regime differences from the web twin, to record in mirroring.md: `signIn()` replaces `beginSignIn`/`completeSignIn` (no page reload on Apple — `ASWebAuthenticationSession` returns the callback URL in-process); token exchange goes straight to `https://oauth2.googleapis.com/token` with no client secret (iOS-type OAuth client); `CryptoKit`/`AuthenticationServices`/`Security` imports are confined to these three files.

- [ ] **Step 1: Write the failing PKCE test**

`swift/Tests/AlloyStorageTests/PKCETests.swift`:

```swift
import Testing
@testable import AlloyStorage

@Suite struct PKCETests {
  @Test func matchesRFC7636AppendixBVector() {
    // Twin fixture: web .../auth/pkce.spec.ts
    #expect(
      PKCE.codeChallenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk")
        == "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM")
  }

  @Test func generatesUniqueBase64urlVerifiers() {
    let a = PKCE.generateCodeVerifier()
    let b = PKCE.generateCodeVerifier()
    #expect(a.count == 64 && a != b)
    #expect(a.allSatisfy { $0.isLetter || $0.isNumber || $0 == "-" || $0 == "_" })
  }
}
```

- [ ] **Step 2: Run to verify fails, then implement PKCE.swift**

```swift
import CryptoKit
import Foundation

/// PKCE helpers (RFC 7636, S256). Caseless-enum namespace, twin of auth/pkce.ts.
public enum PKCE {
  static func base64url(_ data: Data) -> String {
    data.base64EncodedString()
      .replacingOccurrences(of: "+", with: "-")
      .replacingOccurrences(of: "/", with: "_")
      .replacingOccurrences(of: "=", with: "")
  }

  /// 48 random bytes → 64 base64url chars.
  public static func generateCodeVerifier() -> String {
    var bytes = [UInt8](repeating: 0, count: 48)
    for i in bytes.indices { bytes[i] = UInt8.random(in: 0...255) }
    return base64url(Data(bytes))
  }

  /// S256 challenge: base64url(SHA-256(verifier)).
  public static func codeChallenge(_ verifier: String) -> String {
    base64url(Data(SHA256.hash(data: Data(verifier.utf8))))
  }
}
```

`swift test --filter PKCETests` → PASS.

- [ ] **Step 3: Write the failing GoogleAuth tests**

`swift/Tests/AlloyStorageTests/GoogleAuthTests.swift` — mirror the web GoogleAuth spec scenarios that make sense without a page-redirect model, using `MemoryTokenVault`, `ScriptedTransport` (Task 7), a fixed `now`, and a stub `AuthUISession`:

```swift
import Foundation
import Testing
@testable import AlloyStorage

private let nowFixed = Date(timeIntervalSince1970: 1_751_980_000) // twin NOW = 1751980000000 ms

private func makeAuth(
  stored: StoredTokens? = nil,
  transport: ScriptedTransport = ScriptedTransport([]),
  uiSession: (any AuthUISession)? = nil
) -> (GoogleAuth, MemoryTokenVault) {
  let vault = MemoryTokenVault()
  if let stored { try! vault.save(stored) }
  let config = GoogleAuthConfig(
    clientId: "cid", scope: "https://www.googleapis.com/auth/drive.file",
    redirectScheme: "com.example.app")
  return (GoogleAuth(config: config, vault: vault, transport: transport,
                     uiSession: uiSession, now: { nowFixed }), vault)
}

@Suite struct GoogleAuthTests {
  @Test func returnsFreshStoredTokenWithoutNetwork() async {
    let transport = ScriptedTransport([]) // any request would throw "unscripted"
    let (auth, _) = makeAuth(
      stored: StoredTokens(accessToken: "at", expiresAt: nowFixed.addingTimeInterval(3600), refreshToken: "rt"),
      transport: transport)
    #expect(await auth.accessToken() == "at")
    #expect(auth.state == .signedIn)
    #expect(transport.requests.isEmpty)
  }

  @Test func refreshesWithinFiveMinuteMarginAndPersists() async throws {
    let transport = ScriptedTransport([
      .init(matches: { $0.url!.absoluteString.contains("oauth2.googleapis.com/token") },
            body: #"{"access_token":"at2","expires_in":3599}"#, status: 200)
    ])
    let (auth, vault) = makeAuth(
      stored: StoredTokens(accessToken: "at", expiresAt: nowFixed.addingTimeInterval(60), refreshToken: "rt"),
      transport: transport)
    #expect(await auth.accessToken() == "at2")
    let sent = String(data: transport.requests[0].httpBody!, encoding: .utf8)!
    #expect(sent.contains("grant_type=refresh_token") && sent.contains("refresh_token=rt"))
    let saved = try vault.load()
    #expect(saved?.accessToken == "at2" && saved?.refreshToken == "rt")
    #expect(saved?.expiresAt == nowFixed.addingTimeInterval(3599))
  }

  @Test func rejectedRefreshClearsVaultAndReportsExpired() async throws {
    let transport = ScriptedTransport([
      .init(matches: { _ in true }, body: #"{"error":"invalid_grant"}"#, status: 400)
    ])
    let (auth, vault) = makeAuth(
      stored: StoredTokens(accessToken: "at", expiresAt: nowFixed.addingTimeInterval(-1), refreshToken: "stale"),
      transport: transport)
    #expect(await auth.accessToken() == nil)
    #expect(auth.state == .expired)
    #expect(try vault.load() == nil)
  }

  @Test func networkFailedRefreshKeepsRefreshToken() async throws {
    struct Offline: HTTPTransport {
      func send(_: URLRequest) async throws -> (Data, HTTPURLResponse) { throw URLError(.notConnectedToInternet) }
    }
    let vault = MemoryTokenVault()
    try vault.save(StoredTokens(accessToken: "at", expiresAt: nowFixed.addingTimeInterval(-1), refreshToken: "rt"))
    let config = GoogleAuthConfig(clientId: "cid", scope: "s", redirectScheme: "r")
    let auth = GoogleAuth(config: config, vault: vault, transport: Offline(), uiSession: nil, now: { nowFixed })
    #expect(await auth.accessToken() == nil)
    #expect(auth.state == .expired)
    #expect(try vault.load()?.refreshToken == "rt")
  }

  @Test func signInRunsUISessionThenExchangesCode() async throws {
    struct StubUI: AuthUISession {
      func authenticate(url: URL, callbackScheme: String) async throws -> URL {
        // Echo back the state Google would return, plus a code.
        let state = URLComponents(url: url, resolvingAgainstBaseURL: false)!
          .queryItems!.first { $0.name == "state" }!.value!
        return URL(string: "\(callbackScheme)://oauth?code=c1&state=\(state)")!
      }
    }
    let transport = ScriptedTransport([
      .init(matches: { $0.httpMethod == "POST" },
            body: #"{"access_token":"at","refresh_token":"rt","expires_in":3599}"#, status: 200)
    ])
    let (auth, vault) = makeAuth(transport: transport, uiSession: StubUI())
    #expect(await auth.signIn())
    #expect(auth.state == .signedIn)
    let sent = String(data: transport.requests[0].httpBody!, encoding: .utf8)!
    #expect(sent.contains("grant_type=authorization_code") && sent.contains("code=c1")
            && sent.contains("code_verifier="))
    #expect(!sent.contains("client_secret"))
    #expect(try vault.load()?.refreshToken == "rt")
  }

  @Test func signOutClearsVaultAndState() async throws {
    let (auth, vault) = makeAuth(
      stored: StoredTokens(accessToken: "at", expiresAt: nowFixed.addingTimeInterval(3600), refreshToken: "rt"))
    _ = await auth.accessToken()
    auth.signOut()
    #expect(auth.state == .signedOut)
    #expect(try vault.load() == nil)
    #expect(await auth.accessToken() == nil)
  }
}
```

- [ ] **Step 4: Run to verify fails, then implement**

`TokenVault.swift`: `StoredTokens` as declared in Interfaces; `MemoryTokenVault` (a lock-guarded optional); `KeychainTokenVault` using `SecItemCopyMatching`/`SecItemAdd`/`SecItemDelete` with `kSecClassGenericPassword`, `kSecAttrService = "alloy-storage.google"`, JSON-encoded `StoredTokens` as the item data (wrap in `#if canImport(Security)` — on other platforms it throws `StorageError(category: .unreachable, message: "keychain unavailable")`).

`GoogleAuth.swift` mirrors the web class' internal logic exactly (5-minute `freshMargin`, refresh state machine identical to Task 9's `refresh()`, including "rejected grant clears the vault / network error keeps it"), except the semantic-regime differences already declared in Interfaces:

- `signIn()` builds the same auth URL as the web (`client_id`, `redirect_uri: "\(config.redirectScheme):/oauth"`, `response_type=code`, `scope`, S256 challenge, `access_type=offline`, `prompt=consent`, random `state`), runs `uiSession.authenticate(url:callbackScheme:)`, validates the returned `state`, then POSTs `grant_type=authorization_code&code=…&code_verifier=…&client_id=…&redirect_uri=…` (form-encoded, no secret) to `https://oauth2.googleapis.com/token`.
- `refresh` POSTs `grant_type=refresh_token&refresh_token=…&client_id=…` to the same endpoint; Google's snake_case response (`access_token`, `expires_in`, optional `refresh_token`) decodes via a private `Codable` struct.
- `signOut()` clears the vault and state synchronously, and fires a detached best-effort revoke request (`POST https://oauth2.googleapis.com/revoke?token=…` with the refresh token, falling back to the access token) — the twin of the web `signOut`; failures are ignored.
- The default `uiSession` (when the init parameter is nil) is a `DefaultAuthUISession` wrapping `ASWebAuthenticationSession` inside `#if canImport(AuthenticationServices)` (with `prefersEphemeralWebBrowserSession = false` and a `presentationContextProvider` that returns the key window); on platforms without it, `signIn()` returns false.

- [ ] **Step 5: Run to verify pass**

`cd swift && swift build && swift test --filter AlloyStorageTests` → PASS (all suites).

- [ ] **Step 6: Commit**

```bash
git add swift/Sources/AlloyStorage/Auth swift/Tests/AlloyStorageTests
git commit -m "feat(storage): add Swift GoogleAuth with PKCE and Keychain vault"
```

---

### Task 11: mirroring.md + README + full-suite verification

**Files:**
- Modify: `docs/mirroring.md` (new AlloyStorage section), `README.md` (add AlloyStorage to the library table/list, if the README enumerates libraries)

**Interfaces:**
- Consumes: everything above (this task documents the shipped shape).
- Produces: the binding twin-contract entry future changes must obey.

- [ ] **Step 1: Add the AlloyStorage section to docs/mirroring.md**

Append after the existing library sections, matching the document's voice:

```markdown
## AlloyStorage

Storage abstraction + backends (`@allyworld/alloy-storage` ↔ `AlloyStorage`).

**Strict regime** (identical API, twin fixtures — the backend contract suite and
the StorageError table run the same scenarios and instants on both platforms):

- `StorageRecordMeta` / `StorageRecord` (TS `updatedAt: number` epoch ms ↔ Swift
  `updatedAt: Date` — the platform-time rule above)
- `StorageBackend` (`list`/`read`/`write`/`delete`; list is metadata-only,
  read misses resolve null/nil, delete is idempotent)
- `AuthProvider` + `AuthState`
- `StorageError` with `fromHttpStatus` ↔ `fromHTTPStatus` mapping
  (401/403→auth, 404→notFound, 409/412→conflict, 429→quota, else unreachable)
- `DriveClient` method surface + Drive query strings; `DriveBackend` semantics
  (folder-path resolution, id cache + one 404 re-resolve, per-id write chains,
  `alloyId`/`alloySavedAt` writes with legacy `allyscoreId`/`savedAt` reads)
- `PKCE` helpers (RFC 7636 vector as the twin fixture)
- `GoogleAuth` refresh state machine (5-minute proactive margin; rejected grant
  clears stored tokens → `expired`; network failure keeps the refresh token)

**Semantic regime** (same behavior, platform-appropriate shape):

- Transport seam: TS injected `fetch` ↔ Swift `HTTPTransport`/`URLSessionTransport`
- Local replica: `BrowserStorageBackend` (IndexedDB) ↔ `LocalStorageBackend`
  (FileManager under Application Support)
- Folder-id cache: TS `Storage` (localStorage) ↔ Swift `UserDefaults`
- Token persistence: `TokenStore`/`IndexedDbTokenStore` ↔ `TokenVault`/`KeychainTokenVault`
- Sign-in shape: web `beginSignIn()`/`completeSignIn(callbackUrl)` (page
  redirect via the shared `services/google-oauth` token function — web needs a
  confidential client) ↔ Apple `signIn()` (in-process
  `ASWebAuthenticationSession`, iOS-type client, no backend, no secret)
- `CryptoKit`/`AuthenticationServices`/`Security` imports are confined to
  `Auth/`; everything else stays Foundation + Observation.
```

- [ ] **Step 2: Update README.md**

Read `README.md`; wherever it lists the libraries (AlloyTime/AlloyUI/AlloyAudio), add one line: `AlloyStorage / @allyworld/alloy-storage — storage abstraction (browser, file system, Google Drive) with pluggable auth; sync engine arrives in a later release.`

- [ ] **Step 3: Full verification**

```bash
cd web && npm ci && npm test          # all packages, not just alloy-storage
cd .. && cd swift && swift build && swift test   # entire package
cd ../services/google-oauth && npm test
```

All three suites green. Also confirm packing works: `cd web && npm pack -w @allyworld/alloy-storage --dry-run` → tarball contains `dist/`, no `*.contract.*`, no specs.

- [ ] **Step 4: Commit**

```bash
git add docs/mirroring.md README.md
git commit -m "docs: declare AlloyStorage mirroring regimes"
```

---

## After this plan

- **AllyScore pilot migration** — separate plan in the AllyScore repo: replace `packages/persistence/src/drive/` + `GoogleAuthService` with `@allyworld/alloy-storage` (npm `file:` link during development), register the code-flow redirect URI, deploy `services/google-oauth`, keep AllyScore's suites green.
- **Release** — via `/alloy-release` (`node tools/release.mjs`) once the pilot is validated; alloy-storage rides the release train like alloy-time.
- **Releases 2–3** — sync engine (`SyncedStore`), `FileStorageBackend`, Google Picker: planned separately per the spec's release order.
