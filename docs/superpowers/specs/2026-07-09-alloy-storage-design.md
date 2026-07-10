# AlloyStorage — storage abstraction + offline-first sync

**Date:** 2026-07-09
**Status:** Approved design, pre-implementation
**Supersedes:** the "AlloySync" placeholder row in
`2026-07-08-alloy-independence-direction.md` (renamed, scope refined).

## Purpose

Extract and generalize AllyScore's Google Drive module into a shared Alloy
library so every Ally app can persist and sync user documents — the
motivating consumer after the pilot is allyclock sharing its settings
through Google Drive.

AlloyStorage is an abstraction layer over *any* storage: browser storage,
on-disk folders, and cloud (Google Drive first), plus an offline-first sync
engine that replicates a local backend to a cloud backend.

It also fixes the two known gaps in AllyScore's current module:

1. **Reconnect pain** — the GIS browser token flow has no refresh token;
   sessions die on reload/expiry. Replaced by authorization-code flow +
   PKCE with durable refresh tokens (see Auth).
2. **No folder selection** — the Drive folder is hard-coded at root.
   Replaced by a configurable folder path plus, on web, the Google Picker.

## Decisions (settled during brainstorming)

| Question | Decision |
|---|---|
| Scope | Full sync engine (change queue, conflict resolution, retry), not just a thin Drive client |
| Name | `AlloyStorage` / `@allyworld/alloy-storage` (was "AlloySync" in the direction doc) |
| Platforms | Full twin including Drive on Apple, in the same change set |
| Web auth fix | Tiny stateless token-exchange backend (Netlify function), shared by all Ally apps |
| Folder selection | Configurable app-created folder path + Google Picker on web; `drive.file` scope kept |
| Sync model | Offline-first replica: local always authoritative for reads/writes, background sync |
| Pilot | AllyScore migrates first; allyclock settings sync is consumer #2 |
| Structure | One package, three internal layers (not split into storage + sync packages) |

Out of scope: full `drive` scope (requires Google restricted-scope CASA
assessment), moving existing files when the folder selection changes,
binary payloads, React/Windows-native targets, CRDT/field-level merge
(the `onConflict` hook leaves room for it later).

## Layout

```
web/packages/alloy-storage/        @allyworld/alloy-storage — pure TS, zero runtime deps
  src/core/                        contracts: StorageBackend, StorageRecord, AuthProvider, StorageError
  src/backends/                    browser-storage.ts, file-storage.ts, drive/
  src/sync/                        SyncedStore, change queue, conflict resolution, SyncStatus
swift/Sources/AlloyStorage/        product AlloyStorage — Foundation + Observation only
  Core/  Backends/  Sync/
services/google-oauth/             Netlify token function (new top-level dir; never packed/tagged)
```

Mirroring regimes, declared in `docs/mirroring.md` when this lands:

- **Strict regime** (identical API + twin fixtures): `core/` and `sync/`.
- **Semantic regime** (same behavior, platform-appropriate shape): the
  backends' platform edges (IndexedDB vs FileManager, `fetch` vs
  `URLSession`, GIS-code-flow vs `ASWebAuthenticationSession`, Google
  Picker — web only).

## Core contracts (strict regime)

```ts
interface StorageRecordMeta {
  id: string;            // app-assigned stable identity
  name: string;          // human-visible filename ("settings.json")
  updatedAt: number;     // epoch ms; drives last-write-wins
  revision?: string;     // backend-native version marker (e.g. Drive headRevisionId)
}

interface StorageRecord extends StorageRecordMeta {
  payload: string;       // whole-document content
}

interface StorageBackend {
  list(): Promise<StorageRecordMeta[]>;    // metadata only — no payload downloads
  read(id: string): Promise<StorageRecord | null>;
  write(record: StorageRecord): Promise<StorageRecordMeta>;
  delete(id: string): Promise<void>;
}

interface AuthProvider {
  accessToken(): Promise<string | null>;   // null = signed out / refresh failed
  readonly state: 'signedOut' | 'signedIn' | 'expired';
}
```

- The unit is a **document** (whole-payload read/write), not a KV byte
  store. Whole-document last-write-wins keeps conflicts tractable and fits
  both settings JSON and `.allyscore` files.
- A backend instance is scoped to **one flat collection** (folder). No
  hierarchy in the interface; hierarchy is backend configuration.
- Errors form a shared hierarchy — `StorageError` with categories `auth`,
  `notFound`, `conflict`, `unreachable`, `quota` — so the engine and apps
  react to categories, not HTTP codes.
- Swift twin: same shapes as `Sendable` structs/protocols, `async throws`.

## Backends (semantic-regime edges)

**BrowserStorageBackend (web) / LocalStorageBackend (Apple)** — the local
replicas, also usable standalone with no cloud. Web: IndexedDB, one object
store per collection. Apple: files under
`Application Support/<bundle-id>/<collection>/` via FileManager with an
in-memory index (not UserDefaults — documents are files).

**FileStorageBackend** — user-visible on-disk folders. Web: File System
Access API via `showDirectoryPicker()` — Chromium-only, capability-detected,
not polyfilled (this is how "local storage on Windows" is served: through
Chrome/Edge). Apple: user-chosen folder via NSOpenPanel/document picker,
persisted as a security-scoped bookmark.

**DriveBackend** — AllyScore's `DriveClient` ported nearly as-is: thin
typed wrapper over Drive v3 REST, injected `fetch` on web / injected
`URLSession`-shaped seam on Swift, same method surface on both. Record
mapping is unchanged from AllyScore: one record = one Drive file; `id` and
`updatedAt` ride in `appProperties` (generalized key names `alloyId` /
`alloySavedAt`, with the legacy `allyscoreId` read path preserved so
existing user data needs no migration). Changes vs. today: `list()` returns
metadata only; errors map to `StorageError`; the folder is a constructor
parameter, not a hard-coded name.

## Auth

Scope stays `drive.file` (non-sensitive; app sees only files it created or
the user granted via Picker).

**Web — authorization-code flow + PKCE.** The SPA obtains a one-time code
from Google, posts it to `services/google-oauth`, and receives access +
refresh tokens. The refresh token persists in IndexedDB; refresh happens
proactively ~5 minutes before expiry while the app is open. Sign-out
revokes and wipes. This removes the GIS silent-token dance entirely and is
the reconnect fix: sessions survive reloads and days away.

`services/google-oauth` is a stateless Netlify function (~50 lines, no
database): `POST /token` exchanges code→tokens using the client secret
held in a Netlify env var; `POST /refresh` exchanges refresh→access. One
deployment serves all Ally apps, with an env-configured allowlist of
redirect origins. Request volumes stay under the Netlify free tier by
orders of magnitude.
Availability note: if the function is down, new sign-ins/refreshes fail
web-wide (already-issued access tokens keep working ≤1h; Apple is
unaffected). Accepted risk for a stateless CDN function.

**Apple — `ASWebAuthenticationSession` + PKCE** with an iOS-type OAuth
client (no client secret, no backend, no third-party SDK). Refresh token
in the Keychain.

Both sides implement `AuthProvider`. Consequences to plan for: the web
OAuth client switches from GIS token flow to code flow — one-time
re-consent for existing users, and redirect URIs must be registered in the
Google Cloud console for every app origin.

## Sync engine (strict regime)

`SyncedStore` implements `StorageBackend` (indistinguishable to app code)
and wraps `local` (replica — authoritative for all reads and writes,
instant, never waits on the network) and `remote` (Drive).

- **Change queue:** every local write/delete appends
  `{recordId, op, queuedAt}`, persisted in the local backend so pending
  changes survive restarts. Entries dedupe per record — N rapid edits
  collapse to one pending upload of the latest state (generalizes
  AllyScore's per-id save chains).
- **Sync cycle** — triggered on startup, local write, periodic timer while
  online, and connectivity regained; jittered exponential backoff on
  failure:
  1. **Push:** drain the queue to remote.
  2. **Pull:** `remote.list()` metadata diff; fetch payloads only for
     records whose `updatedAt`/`revision` differ from local.
  3. **Conflict** (both sides changed since last sync): last-write-wins by
     `updatedAt`; the losing version is preserved as a conflict-copy
     record (`"settings (conflict 2026-07-09).json"`), never silently
     discarded. An optional per-store `onConflict` hook lets an app merge
     instead; v1 apps take LWW.
- **Observability:** `SyncStatus` — `state: idle | syncing | offline |
  authRequired | error`, `pendingCount`, `lastSyncAt`. Swift: Observation.
  TS: subscribe callback (no RxJS/signals in core); the Angular layer wraps
  it in a signal. Replaces AllyScore's `DriveStatus` notices.
- **Determinism:** injected clock and injected scheduler (the `TimeMachine`
  storage-injection pattern scaled up), so both platforms replay identical
  sync scenarios against identical fixtures.

## Folder selection

`DriveBackend` accepts a folder **path** (e.g. `AllyWorld/AllyClock`),
find-or-creating each segment; the resolved folder id is cached with
AllyScore's existing 404-recovery (re-resolve once when the cached id
vanishes). Apps expose the path in their settings UI.

Web additionally gets a thin **Google Picker wrapper** in the platform-edge
layer: picking any existing folder grants `drive.file` access to it, and
the backend then stores the picked folder id. Changing folders is a
**re-point, not a move** — existing files stay where they are; the
conflict-copy machinery makes accidental re-points non-destructive.

Two apps pointed at the same folder can share records — the
allyclock-shares-settings scenario.

## AllyScore migration (pilot)

- `packages/persistence/src/drive/` is deleted.
- `DriveScoreStore` becomes a ~40-line adapter mapping `ScoreStore` onto a
  `SyncedStore`; score serialization stays in `@allyscore/io`.
- `GoogleAuthService` shrinks to an Angular signal wrapper around the
  library's web auth provider.
- `SwitchingScoreStore` / `StorageModeService` largely dissolve:
  "browser vs drive" becomes "plain local backend vs synced store".
- Drive file format unchanged → existing users' data works as-is; the one
  visible change is a single re-consent (code-flow switch).
- AllyScore's existing drive specs port into the library as its test seed.
  Per the cross-repo rule, AllyScore's suites stay green as the regression
  net for the extraction.

## Testing

- **Twin tests (strict):** core + sync engine run identical fixtures on
  both platforms — fixed epoch-ms instants, scripted backend responses,
  injected clock — asserting identical outcomes. Must-cover scenarios:
  interleaved offline edits, conflict-copy naming, queue collapse under
  rapid edits, 401 mid-sync, cached-folder 404 recovery.
- **Backend tests (per platform):** Drive via fake `fetch`/`URLSession`;
  IndexedDB via fake-indexeddb in Vitest; FileManager via temp dirs.
- **Token function:** small unit test of both endpoints with a mocked
  Google token endpoint.
- **Manual QA:** `examples/` harnesses (web + macOS) gain a storage demo
  exercising the real OAuth dance, Picker, and cross-device sync — the
  parts unit tests cannot reach.

## Release order

One package, incremental releases; pilot-then-fanout per the independence
direction:

1. Core contracts + local backends + DriveBackend + new auth (web token
   backend + Apple auth) → **AllyScore pilots** (this alone fixes
   reconnects).
2. Sync engine → AllyScore switches to `SyncedStore` (offline-first).
3. Folder selection (path config + web Picker).
4. **allyclock settings sync** (web + iOS) — consumer #2.

Each release updates `docs/mirroring.md`'s AlloyStorage section and runs
both suites, tagged via `tools/release.mjs` as usual.
