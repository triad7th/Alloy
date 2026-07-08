# AlloyTime Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Scaffold Alloy's dual-ecosystem packaging, extract AlloyTime (zone catalog, zone metadata, zone formatting, TimeMachine) from allyclock, and switch allyclock to consume it on both platforms.

**Architecture:** Alloy hosts a Swift package (manifest at repo root — SPM requires that for git-URL consumption — with sources under `swift/`) and an npm workspace under `web/`. AlloyTime ships as mirrored twins: `@allyworld/alloy-time` (pure TS) and the `AlloyTime` Swift product. allyclock consumes the Swift side by git URL + tag and the web side by GitHub-release tarball URL (npm cannot install a git subdirectory). Moved code keeps its existing tests; allyclock keeps thin wrappers/shims so app-internal imports barely change.

**Tech Stack:** Swift 6 / swift-tools 6.0 (Foundation + Observation only), TypeScript 5 strict ESM (zero runtime deps), Vitest, Node ≥ 20, GitHub CLI for releases.

## Global Constraints

- `Ally<Noun>` names are apps; `Alloy*` names are libraries.
- Web API is canonical; Swift mirrors it. Twins ship together, never half-updated (docs/mirroring.md).
- Swift sources: Foundation + Observation only. TS sources: zero runtime dependencies, no Angular, no DOM globals (Intl is allowed — it is ECMAScript; storage is injected).
- Swift platforms: `.iOS(.v17), .tvOS(.v17), .watchOS(.v10), .macOS(.v14)` (AllyClockCore's floor).
- U+2212 (−) for negative offsets in display strings; ASCII hyphen in fixed-offset zone IDS (`"-08:00"`).
- Two-space indent, final newlines, single quotes in TS.
- allyclock regression net: `npm run test:web`, `npm run build:web` (repo root), and the iOS suite via XcodeBuildMCP `test_sim` (9 tests, includes pixel snapshots) must stay green after the swap.
- localStorage/UserDefaults keys used by allyclock today (`allyclock.clock.mock`, `allyclock.clock.tz`) must keep working — users' persisted Time Machine state survives the migration.
- Repos on disk: Alloy = `/Volumes/AllyDrive/Storage/Repos/Alloy`, allyclock = `/Volumes/AllyDrive/Storage/Repos/allyclock`.
- Conventional commits. Tasks 1–12 commit in Alloy; Tasks 13–14 commit in allyclock.

---

### Task 1: Swift package scaffold

**Files:**
- Create: `Package.swift` (Alloy repo ROOT — not `swift/Package.swift`; SPM resolves git dependencies only from a root manifest)
- Create: `swift/Sources/AlloyTime/AlloyTime.swift`
- Create: `swift/Tests/AlloyTimeTests/PackageSmokeTests.swift`
- Create: `.gitignore`

**Interfaces:**
- Produces: Swift product `AlloyTime` that later tasks add sources to; `swift build` / `swift test` runnable from repo root.

- [ ] **Step 1: Write the manifest and smoke test**

`Package.swift`:
```swift
// swift-tools-version: 6.0
import PackageDescription

let package = Package(
  name: "Alloy",
  platforms: [.iOS(.v17), .tvOS(.v17), .watchOS(.v10), .macOS(.v14)],
  products: [
    .library(name: "AlloyTime", targets: ["AlloyTime"]),
  ],
  targets: [
    .target(name: "AlloyTime", path: "swift/Sources/AlloyTime"),
    .testTarget(name: "AlloyTimeTests", dependencies: ["AlloyTime"],
                path: "swift/Tests/AlloyTimeTests"),
  ]
)
```

`swift/Sources/AlloyTime/AlloyTime.swift`:
```swift
// AlloyTime — time/zone/TimeMachine models shared across the Ally apps.
// Mirrored twin of @allyworld/alloy-time (web/packages/alloy-time).
```

`swift/Tests/AlloyTimeTests/PackageSmokeTests.swift`:
```swift
import AlloyTime
import XCTest

final class PackageSmokeTests: XCTestCase {
    func test_packageBuildsAndLinks() { XCTAssertTrue(true) }
}
```

`.gitignore`:
```
.build/
.swiftpm/
node_modules/
dist/
*.tgz
.DS_Store
```

- [ ] **Step 2: Run tests, expect pass**

Run: `cd /Volumes/AllyDrive/Storage/Repos/Alloy && swift test`
Expected: `Executed 1 test, with 0 failures`

- [ ] **Step 3: Commit**

```bash
git add -A && git commit -m "feat(swift): Alloy package scaffold with AlloyTime product"
```

---

### Task 2: npm workspace scaffold

**Files:**
- Create: `web/package.json` (workspace root)
- Create: `web/packages/alloy-time/package.json`
- Create: `web/packages/alloy-time/tsconfig.json`
- Create: `web/packages/alloy-time/src/index.ts`
- Create: `web/packages/alloy-time/src/index.spec.ts`

**Interfaces:**
- Produces: `@allyworld/alloy-time` package; `npm test` / `npm run build` from `web/`; `dist/index.js` + `.d.ts` output that Task 12 packs into the release tarball.

- [ ] **Step 1: Write the workspace and package manifests**

`web/package.json`:
```json
{
  "name": "alloy-web",
  "private": true,
  "workspaces": ["packages/*"],
  "scripts": {
    "build": "npm run build --workspaces",
    "test": "npm run test --workspaces"
  },
  "engines": { "node": ">=20" }
}
```

`web/packages/alloy-time/package.json`:
```json
{
  "name": "@allyworld/alloy-time",
  "version": "0.1.0",
  "description": "Time/zone/TimeMachine models for the Ally app series (web twin of AlloyTime)",
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
    "typescript": "^5.6.0",
    "vitest": "^3.0.0"
  }
}
```

`web/packages/alloy-time/tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "declaration": true,
    "outDir": "dist",
    "rootDir": "src",
    "skipLibCheck": true
  },
  "include": ["src/**/*.ts"],
  "exclude": ["src/**/*.spec.ts"]
}
```

`src/index.ts` (placeholder export so the package builds; later tasks replace it):
```ts
export const ALLOY_TIME = 'alloy-time';
```

`src/index.spec.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { ALLOY_TIME } from './index';

describe('package', () => {
  it('builds and links', () => {
    expect(ALLOY_TIME).toBe('alloy-time');
  });
});
```

- [ ] **Step 2: Install and run**

Run: `cd /Volumes/AllyDrive/Storage/Repos/Alloy/web && npm install && npm test && npm run build`
Expected: vitest 1 passed; `packages/alloy-time/dist/index.js` and `index.d.ts` exist.

- [ ] **Step 3: Commit**

```bash
git add -A && git commit -m "feat(web): npm workspace scaffold with @allyworld/alloy-time"
```

---

### Task 3: TS zone-catalog module (moved from allyclock)

**Files:**
- Create: `web/packages/alloy-time/src/zone-catalog.ts`
- Create: `web/packages/alloy-time/src/zone-catalog.spec.ts`
- Modify: `web/packages/alloy-time/src/index.ts`

**Interfaces:**
- Produces (exact, used by Tasks 4/6 and by allyclock's shims):
  `interface TimeZoneOption { id: string; label: string; offset: number }`,
  `buildTimeZones(localZone: string): string[]`,
  `zoneOffsetMinutes(timeZone: string, at: Date): number`,
  `formatOffset(min: number): string`,
  `buildTimeZoneOptions(localZone: string, at: Date): TimeZoneOption[]`,
  `buildSpecialZones(): TimeZoneOption[]`.

- [ ] **Step 1: Move the module**

Copy `/Volumes/AllyDrive/Storage/Repos/allyclock/apps/web/src/app/core/zone-catalog.ts` to `src/zone-catalog.ts` **verbatim, with exactly two deletions**: remove line 1 (`import { Injectable } from '@angular/core';`) and remove the entire `@Injectable ... class ZoneCatalog` block at the bottom (the app-side caching service stays in allyclock — Task 13). Everything between (`TimeZoneOption`, `FALLBACK_TIME_ZONES`, `buildTimeZones`, `zoneOffsetMinutes`, `formatOffset`, `buildTimeZoneOptions`, `buildSpecialZones`) is unchanged.

Copy `/Volumes/AllyDrive/Storage/Repos/allyclock/apps/web/src/app/core/zone-catalog.spec.ts` to `src/zone-catalog.spec.ts`, changing only the import path to `'./zone-catalog'` and adding `import { describe, it, expect } from 'vitest';` if not already present.

Replace `src/index.ts` content:
```ts
export * from './zone-catalog';
```
Delete `src/index.spec.ts` (the smoke test has served its purpose).

- [ ] **Step 2: Run tests**

Run: `cd web && npm test`
Expected: zone-catalog specs pass (same assertions that passed in allyclock).

- [ ] **Step 3: Commit**

```bash
git add -A && git commit -m "feat(web): zone-catalog module extracted from allyclock"
```

---

### Task 4: TS zone-time module (moved from allyclock)

**Files:**
- Create: `web/packages/alloy-time/src/zone-time.ts`
- Create: `web/packages/alloy-time/src/zone-time.spec.ts`
- Modify: `web/packages/alloy-time/src/index.ts`

**Interfaces:**
- Produces: `interface WallClock { year; month; day; hour; minute: number }`,
  `wallClockInZone(instant: Date, zone: string): WallClock`,
  `instantFromWallClock(w: WallClock, zone: string): Date`,
  `wallClockToInput(w: WallClock): string`,
  `inputToWallClock(value: string): WallClock | null`.

- [ ] **Step 1: Move the module**

Copy `apps/web/src/app/core/zone-time.ts` → `src/zone-time.ts` verbatim; the only change is the first line: `import { zoneOffsetMinutes } from './zone-catalog';` (path unchanged in spelling, but verify it resolves in the new home). Copy `apps/web/src/app/core/zone-time.spec.ts` → `src/zone-time.spec.ts` with the import path updated to `'./zone-time'`.

Append to `src/index.ts`:
```ts
export * from './zone-time';
```

- [ ] **Step 2: Run tests** — `cd web && npm test`, expect all pass.

- [ ] **Step 3: Commit** — `git add -A && git commit -m "feat(web): zone-time module extracted from allyclock"`

---

### Task 5: TS zone-country table (moved; becomes the source of truth)

**Files:**
- Create: `web/packages/alloy-time/src/zone-country.ts`
- Create: `web/packages/alloy-time/src/zone-country.spec.ts`
- Modify: `web/packages/alloy-time/src/index.ts`

**Interfaces:**
- Produces: `ZONE_COUNTRY: Readonly<Record<string, string>>`, `countryCodeForZone(zone: string): string | null`. Task 10's generator reads this file; Task 11 pins its entry count.

- [ ] **Step 1: Move the module**

Copy `apps/web/src/app/core/zone-country.ts` → `src/zone-country.ts` verbatim (it is already pure; keep the AUTO-GENERATED header, and change its regeneration note to: `// Regenerate the Swift twin with: node tools/generate-zone-country.mjs`). Copy `zone-country.spec.ts` alongside with import path `'./zone-country'`.

Append to `src/index.ts`:
```ts
export * from './zone-country';
```

- [ ] **Step 2: Run tests** — `cd web && npm test`, expect pass.
- [ ] **Step 3: Commit** — `git add -A && git commit -m "feat(web): zone-country table extracted from allyclock (TS is source of truth)"`

---

### Task 6: TS zone-format module (zoneCity/compactOffset/gmtOffset moved from allyclock's clock-formatter)

**Files:**
- Create: `web/packages/alloy-time/src/zone-format.ts`
- Create: `web/packages/alloy-time/src/zone-format.spec.ts`
- Modify: `web/packages/alloy-time/src/index.ts`

**Interfaces:**
- Produces: `zoneCity(timeZone: string, abbreviate: boolean): string`,
  `compactOffset(date: Date, timeZone: string): string`,
  `gmtOffset(date: Date, timeZone: string): string`.
  allyclock's `clock-formatter.ts` re-exports these (Task 13); Swift twin is Task 9.

- [ ] **Step 1: Create the module from clock-formatter.ts**

From `/Volumes/AllyDrive/Storage/Repos/allyclock/apps/web/src/app/features/faces/fullscreen/clock-formatter.ts`, move these three functions **verbatim with their doc comments** into `src/zone-format.ts`: `gmtOffset` (lines 46–53), `compactOffset` (lines 55–65), `zoneCity` (lines 67–80). Add the single import they need:
```ts
import { zoneOffsetMinutes } from './zone-catalog';
```
(`bigTime`, `precise`, `dateTZ`, `dateParts` are face formatting and stay in allyclock.)

- [ ] **Step 2: Move their tests**

From `clock-formatter.spec.ts`, move the `describe('gmtOffset')`, `describe('compactOffset')`, and `describe('zoneCity')` blocks (lines 52–123) verbatim into `src/zone-format.spec.ts` with header:
```ts
import { describe, expect, it } from 'vitest';
import { compactOffset, gmtOffset, zoneCity } from './zone-format';
```
Include any fixture constants from the top of `clock-formatter.spec.ts` that those blocks reference (check lines 1–14 of the source spec and copy what is used).

Append to `src/index.ts`:
```ts
export * from './zone-format';
```

- [ ] **Step 3: Run tests** — `cd web && npm test`, expect pass.
- [ ] **Step 4: Commit** — `git add -A && git commit -m "feat(web): zone-format module (zoneCity, compactOffset, gmtOffset)"`

---

### Task 7: TS TimeMachine model (extracted from allyclock's ClockService)

**Files:**
- Create: `web/packages/alloy-time/src/time-machine.ts`
- Create: `web/packages/alloy-time/src/time-machine.spec.ts`
- Modify: `web/packages/alloy-time/src/index.ts`

**Interfaces:**
- Produces (exact — allyclock's ClockService wraps this in Task 13; Swift twin in Task 9):
```ts
export interface TimeMachineStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}
export interface TimeMachineOptions {
  localZone: string;
  storage?: TimeMachineStorage | null; // default null (in-memory only)
  namespace?: string;                  // storage-key prefix, default 'ally'
  isUsableZone?: (id: string) => boolean;
}
export class TimeMachine {
  constructor(options: TimeMachineOptions); // restores persisted state
  get mock(): Date | null;
  get mockTimeZone(): string | null;
  get isMocked(): boolean;
  now(realNow: Date): Date;      // mock ?? realNow
  timeZone(): string;            // mockTimeZone ?? localZone
  setMock(date: Date): void;
  clearMock(): void;
  setTimeZone(zone: string): void; // zone === localZone ⇒ clearTimeZone()
  clearTimeZone(): void;
}
```
Storage keys: `` `${namespace}.clock.mock` `` (ISO 8601 string) and `` `${namespace}.clock.tz` ``. allyclock passes `namespace: 'allyclock'` so existing user data keeps working.

- [ ] **Step 1: Write the failing tests**

`src/time-machine.spec.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { TimeMachine, TimeMachineStorage } from './time-machine';

class MemoryStorage implements TimeMachineStorage {
  readonly map = new Map<string, string>();
  getItem(k: string) { return this.map.get(k) ?? null; }
  setItem(k: string, v: string) { this.map.set(k, v); }
  removeItem(k: string) { this.map.delete(k); }
}

const LOCAL = 'America/Los_Angeles';
const INSTANT = new Date(1768480496000); // 2026-01-15T12:34:56Z — twin fixture

describe('TimeMachine', () => {
  it('is live by default', () => {
    const tm = new TimeMachine({ localZone: LOCAL });
    const real = new Date(1700000000000);
    expect(tm.mock).toBeNull();
    expect(tm.isMocked).toBe(false);
    expect(tm.now(real)).toBe(real);
    expect(tm.timeZone()).toBe(LOCAL);
  });

  it('freezes at the mock instant and clears back to live', () => {
    const tm = new TimeMachine({ localZone: LOCAL });
    tm.setMock(INSTANT);
    expect(tm.now(new Date())).toEqual(INSTANT);
    expect(tm.isMocked).toBe(true);
    tm.clearMock();
    expect(tm.mock).toBeNull();
    expect(tm.isMocked).toBe(false);
  });

  it('overrides the zone; selecting the local zone means live', () => {
    const tm = new TimeMachine({ localZone: LOCAL });
    tm.setTimeZone('Asia/Seoul');
    expect(tm.timeZone()).toBe('Asia/Seoul');
    expect(tm.isMocked).toBe(true);
    tm.setTimeZone(LOCAL); // local ⇒ not a mock
    expect(tm.mockTimeZone).toBeNull();
    expect(tm.isMocked).toBe(false);
  });

  it('persists and restores mock + zone under the namespace', () => {
    const storage = new MemoryStorage();
    const a = new TimeMachine({ localZone: LOCAL, storage, namespace: 'allyclock' });
    a.setMock(INSTANT);
    a.setTimeZone('Asia/Seoul');
    expect(storage.map.get('allyclock.clock.mock')).toBe(INSTANT.toISOString());
    expect(storage.map.get('allyclock.clock.tz')).toBe('Asia/Seoul');
    const b = new TimeMachine({ localZone: LOCAL, storage, namespace: 'allyclock' });
    expect(b.mock).toEqual(INSTANT);
    expect(b.mockTimeZone).toBe('Asia/Seoul');
    a.clearMock();
    a.clearTimeZone();
    expect(storage.map.size).toBe(0);
  });

  it('ignores invalid persisted values', () => {
    const storage = new MemoryStorage();
    storage.map.set('ally.clock.mock', 'not-a-date');
    storage.map.set('ally.clock.tz', 'Not/A_Zone');
    const tm = new TimeMachine({ localZone: LOCAL, storage });
    expect(tm.mock).toBeNull();
    expect(tm.mockTimeZone).toBeNull();
  });

  it('survives a throwing storage (private browsing)', () => {
    const broken: TimeMachineStorage = {
      getItem() { throw new Error('nope'); },
      setItem() { throw new Error('nope'); },
      removeItem() { throw new Error('nope'); },
    };
    const tm = new TimeMachine({ localZone: LOCAL, storage: broken });
    tm.setMock(INSTANT); // must not throw; in-memory value still applies
    expect(tm.now(new Date())).toEqual(INSTANT);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd web && npm test`
Expected: FAIL — `./time-machine` module not found.

- [ ] **Step 3: Implement**

`src/time-machine.ts`:
```ts
// Time Machine model: an optional frozen instant + optional zone override that
// every Ally face can read instead of the real clock. Pure model — the app
// wraps it in its own reactive layer (Angular signals / SwiftUI Observation).
// Mirrored twin of AlloyTime's TimeMachine.

export interface TimeMachineStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface TimeMachineOptions {
  localZone: string;
  storage?: TimeMachineStorage | null;
  namespace?: string;
  isUsableZone?: (id: string) => boolean;
}

// A zone is usable only if Intl accepts it (stale persisted values are ignored).
function intlAcceptsZone(id: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: id });
    return true;
  } catch {
    return false;
  }
}

export class TimeMachine {
  private readonly localZone: string;
  private readonly storage: TimeMachineStorage | null;
  private readonly mockKey: string;
  private readonly tzKey: string;
  private mockNow: Date | null = null;
  private mockZone: string | null = null;

  constructor(options: TimeMachineOptions) {
    this.localZone = options.localZone;
    this.storage = options.storage ?? null;
    const ns = options.namespace ?? 'ally';
    this.mockKey = `${ns}.clock.mock`;
    this.tzKey = `${ns}.clock.tz`;
    const usable = options.isUsableZone ?? intlAcceptsZone;

    const storedMock = this.read(this.mockKey);
    if (storedMock) {
      const date = new Date(storedMock);
      if (!isNaN(date.getTime())) this.mockNow = date;
    }
    const storedZone = this.read(this.tzKey);
    if (storedZone && usable(storedZone)) this.mockZone = storedZone;
  }

  get mock(): Date | null { return this.mockNow; }
  get mockTimeZone(): string | null { return this.mockZone; }
  get isMocked(): boolean { return this.mockNow !== null || this.mockZone !== null; }

  now(realNow: Date): Date { return this.mockNow ?? realNow; }
  timeZone(): string { return this.mockZone ?? this.localZone; }

  setMock(date: Date): void {
    this.mockNow = date;
    this.write(this.mockKey, date.toISOString());
  }

  clearMock(): void {
    this.mockNow = null;
    this.remove(this.mockKey);
  }

  // Selecting the device's local zone is "follow local", not a mock.
  setTimeZone(zone: string): void {
    if (zone === this.localZone) {
      this.clearTimeZone();
      return;
    }
    this.mockZone = zone;
    this.write(this.tzKey, zone);
  }

  clearTimeZone(): void {
    this.mockZone = null;
    this.remove(this.tzKey);
  }

  // Storage may be absent or throwing (private browsing); in-memory state wins.
  private read(key: string): string | null {
    try { return this.storage?.getItem(key) ?? null; } catch { return null; }
  }
  private write(key: string, value: string): void {
    try { this.storage?.setItem(key, value); } catch { /* keep in-memory */ }
  }
  private remove(key: string): void {
    try { this.storage?.removeItem(key); } catch { /* keep in-memory */ }
  }
}
```

Append to `src/index.ts`:
```ts
export * from './time-machine';
```

- [ ] **Step 4: Run tests** — `cd web && npm test`, expect all pass.
- [ ] **Step 5: Commit** — `git add -A && git commit -m "feat(web): TimeMachine model extracted from allyclock ClockService"`

---

### Task 8: Swift ZoneCatalog + ZoneCountry (moved from AllyClockCore)

**Files:**
- Create: `swift/Sources/AlloyTime/ZoneCatalog.swift`
- Create: `swift/Sources/AlloyTime/ZoneCountry.swift`
- Create: `swift/Tests/AlloyTimeTests/ZoneCatalogTests.swift`
- Create: `swift/Tests/AlloyTimeTests/ZoneCountryTests.swift`

**Interfaces:**
- Produces: `TimeZoneOption` struct; `ZoneCatalog.buildTimeZones/zoneOffsetMinutes/formatOffset/buildOptions/buildSpecialZones/resolve`; `ZoneCountry.table` + `ZoneCountry.country(for:)` — exactly the API AllyClockCore exports today, so allyclock's call sites only change their `import`.

- [ ] **Step 1: Move sources and tests verbatim**

Copy from `/Volumes/AllyDrive/Storage/Repos/allyclock/packages/AllyClockCore/`:
- `Sources/AllyClockCore/Zones/ZoneCatalog.swift` → `swift/Sources/AlloyTime/ZoneCatalog.swift` (unchanged; it already includes `TimeZoneOption`)
- `Sources/AllyClockCore/Zones/ZoneCountry.swift` → `swift/Sources/AlloyTime/ZoneCountry.swift` (unchanged for now; Task 10 makes it generated)
- `Tests/AllyClockCoreTests/ZoneCatalogTests.swift` → `swift/Tests/AlloyTimeTests/ZoneCatalogTests.swift`, changing `@testable import AllyClockCore` / `import AllyClockCore` to `import AlloyTime`
- `Tests/AllyClockCoreTests/ZoneCountryTests.swift` → `swift/Tests/AlloyTimeTests/ZoneCountryTests.swift`, same import change

(Cross-repo `git mv` is impossible; a plain copy is expected. allyclock deletes its copies in Task 14.)

- [ ] **Step 2: Run tests** — `swift test` from Alloy root. Expected: all pass.
- [ ] **Step 3: Commit** — `git add -A && git commit -m "feat(swift): ZoneCatalog + ZoneCountry moved from AllyClockCore"`

---

### Task 9: Swift ZoneFormat + TimeMachine (mirrors of Tasks 6–7)

**Files:**
- Create: `swift/Sources/AlloyTime/ZoneFormat.swift`
- Create: `swift/Sources/AlloyTime/TimeMachine.swift`
- Create: `swift/Tests/AlloyTimeTests/ZoneFormatTests.swift`
- Create: `swift/Tests/AlloyTimeTests/TimeMachineTests.swift`

**Interfaces:**
- Produces: `ZoneFormat.zoneCity(_:abbreviate:)`, `ZoneFormat.compactOffset(_:timeZone:)` + string-id overload `ZoneFormat.compactOffset(_:zone:)`, `ZoneFormat.gmtOffset(_:timeZone:)`; `TimeMachine` class + `TimeMachineStorage` protocol (UserDefaults conforms). Task 14 points AllyClockCore/app code at these.

- [ ] **Step 1: Write the failing twin tests**

`swift/Tests/AlloyTimeTests/ZoneFormatTests.swift` — same fixtures as the TS `zone-format.spec.ts`:
```swift
import AlloyTime
import XCTest

final class ZoneFormatTests: XCTestCase {
    // 2026-01-15T12:34:56Z — the twin fixture instant.
    private let instant = Date(timeIntervalSince1970: 1_768_480_496)
    private func zone(_ id: String) -> TimeZone { ZoneCatalog.resolve(id)! }

    func test_compactOffset_wholeHours() {
        XCTAssertEqual(ZoneFormat.compactOffset(instant, timeZone: zone("America/Los_Angeles")), "\u{2212}8")
        XCTAssertEqual(ZoneFormat.compactOffset(instant, timeZone: zone("Asia/Seoul")), "+9")
        XCTAssertEqual(ZoneFormat.compactOffset(instant, timeZone: zone("UTC")), "+0")
    }

    func test_compactOffset_subHour() {
        XCTAssertEqual(ZoneFormat.compactOffset(instant, timeZone: zone("Asia/Kolkata")), "+5:30")
        XCTAssertEqual(ZoneFormat.compactOffset(instant, zone: "-03:30"), "\u{2212}3:30")
    }

    func test_gmtOffset() {
        XCTAssertEqual(ZoneFormat.gmtOffset(instant, timeZone: zone("America/Los_Angeles")), "GMT\u{2212}08:00")
        XCTAssertEqual(ZoneFormat.gmtOffset(instant, timeZone: zone("UTC")), "GMT+00:00")
        XCTAssertEqual(ZoneFormat.gmtOffset(instant, timeZone: zone("Asia/Kolkata")), "GMT+05:30")
    }

    func test_zoneCity() {
        XCTAssertEqual(ZoneFormat.zoneCity("America/Los_Angeles", abbreviate: false), "LOS ANGELES")
        XCTAssertEqual(ZoneFormat.zoneCity("America/Los_Angeles", abbreviate: true), "LA")
        XCTAssertEqual(ZoneFormat.zoneCity("Europe/London", abbreviate: true), "LON")
        XCTAssertEqual(ZoneFormat.zoneCity("America/Argentina/Buenos_Aires", abbreviate: true), "BA")
        XCTAssertEqual(ZoneFormat.zoneCity("UTC", abbreviate: true), "UTC")
        XCTAssertEqual(ZoneFormat.zoneCity("+05:30", abbreviate: true), "")
    }
}
```

`swift/Tests/AlloyTimeTests/TimeMachineTests.swift` — mirror of `time-machine.spec.ts`:
```swift
import AlloyTime
import XCTest

private final class MemoryStorage: TimeMachineStorage {
    var map: [String: String] = [:]
    func getItem(_ key: String) -> String? { map[key] }
    func setItem(_ key: String, _ value: String) { map[key] = value }
    func removeItem(_ key: String) { map[key] = nil }
}

final class TimeMachineTests: XCTestCase {
    private let local = "America/Los_Angeles"
    private let instant = Date(timeIntervalSince1970: 1_768_480_496)

    func test_liveByDefault() {
        let tm = TimeMachine(localZone: local, storage: nil)
        let real = Date(timeIntervalSince1970: 1_700_000_000)
        XCTAssertNil(tm.mock)
        XCTAssertFalse(tm.isMocked)
        XCTAssertEqual(tm.now(real), real)
        XCTAssertEqual(tm.timeZone(), local)
    }

    func test_mockFreezesAndClears() {
        let tm = TimeMachine(localZone: local, storage: nil)
        tm.setMock(instant)
        XCTAssertEqual(tm.now(Date()), instant)
        XCTAssertTrue(tm.isMocked)
        tm.clearMock()
        XCTAssertNil(tm.mock)
        XCTAssertFalse(tm.isMocked)
    }

    func test_zoneOverride_localMeansLive() {
        let tm = TimeMachine(localZone: local, storage: nil)
        tm.setTimeZone("Asia/Seoul")
        XCTAssertEqual(tm.timeZone(), "Asia/Seoul")
        XCTAssertTrue(tm.isMocked)
        tm.setTimeZone(local)
        XCTAssertNil(tm.mockTimeZone)
        XCTAssertFalse(tm.isMocked)
    }

    func test_persistsAndRestores() {
        let storage = MemoryStorage()
        let a = TimeMachine(localZone: local, storage: storage, namespace: "allyclock")
        a.setMock(instant)
        a.setTimeZone("Asia/Seoul")
        XCTAssertNotNil(storage.map["allyclock.clock.mock"])
        XCTAssertEqual(storage.map["allyclock.clock.tz"], "Asia/Seoul")
        let b = TimeMachine(localZone: local, storage: storage, namespace: "allyclock")
        XCTAssertEqual(b.mock, instant)
        XCTAssertEqual(b.mockTimeZone, "Asia/Seoul")
        a.clearMock()
        a.clearTimeZone()
        XCTAssertTrue(storage.map.isEmpty)
    }

    func test_ignoresInvalidPersistedValues() {
        let storage = MemoryStorage()
        storage.map["ally.clock.mock"] = "not-a-date"
        storage.map["ally.clock.tz"] = "Not/A_Zone"
        let tm = TimeMachine(localZone: local, storage: storage)
        XCTAssertNil(tm.mock)
        XCTAssertNil(tm.mockTimeZone)
    }
}
```

- [ ] **Step 2: Run to verify failure** — `swift test`. Expected: FAIL, `ZoneFormat`/`TimeMachine` not found.

- [ ] **Step 3: Implement ZoneFormat**

`swift/Sources/AlloyTime/ZoneFormat.swift` — move `compactOffset` and `zoneCity` **verbatim** from AllyClockCore's `Sources/AllyClockCore/Clock/TimeFormatting.swift` (lines 65–85), renamed under a new namespace, and port `gmtOffset` from the web:
```swift
import Foundation

/// Zone-derived display strings. Mirrored twin of `zone-format.ts`.
public enum ZoneFormat {
    /// Sign + hours, with ":mm" only when the zone is off a whole hour.
    /// Uses U+2212 MINUS for negatives, matching the apps.
    public static func compactOffset(_ date: Date, timeZone: TimeZone) -> String {
        let minutes = timeZone.secondsFromGMT(for: date) / 60
        let sign = minutes < 0 ? "\u{2212}" : "+"
        let abs = Swift.abs(minutes)
        let h = abs / 60, m = abs % 60
        return m == 0 ? "\(sign)\(h)" : "\(sign)\(h):\(String(format: "%02d", m))"
    }

    /// String-id variant (web-mirrored signature); unresolvable ids read +0,
    /// matching the web's bare-"GMT" fallback.
    public static func compactOffset(_ date: Date, zone id: String) -> String {
        compactOffset(date, timeZone: ZoneCatalog.resolve(id) ?? TimeZone(secondsFromGMT: 0)!)
    }

    /// "GMT+05:30" / "GMT−08:00" (U+2212), the web's longOffset rendering.
    public static func gmtOffset(_ date: Date, timeZone: TimeZone) -> String {
        let minutes = timeZone.secondsFromGMT(for: date) / 60
        let sign = minutes < 0 ? "\u{2212}" : "+"
        let abs = Swift.abs(minutes)
        return String(format: "GMT%@%02d:%02d", sign, abs / 60, abs % 60)
    }

    /// City label from an IANA id: last path segment, underscores spaced,
    /// uppercased. `abbreviate` collapses multi-word to initials, single word to
    /// first three letters. Fixed-offset ids ("+05:30") have no city.
    public static func zoneCity(_ ianaId: String, abbreviate: Bool) -> String {
        if ianaId.range(of: "^[+\u{2212}-]\\d", options: .regularExpression) != nil { return "" }
        let city = (ianaId.split(separator: "/").last.map(String.init) ?? ianaId)
            .replacingOccurrences(of: "_", with: " ")
        if !abbreviate { return city.uppercased() }
        let words = city.split(whereSeparator: { $0 == " " || $0 == "-" }).map(String.init)
        let label = words.count > 1 ? words.map { String($0.prefix(1)) }.joined()
                                    : String(city.prefix(3))
        return label.uppercased()
    }
}
```

- [ ] **Step 4: Implement TimeMachine**

`swift/Sources/AlloyTime/TimeMachine.swift`:
```swift
import Foundation
import Observation

/// Key-value store the TimeMachine persists into. UserDefaults conforms; tests
/// inject a dictionary. Mirrors the TS `TimeMachineStorage`.
public protocol TimeMachineStorage: AnyObject {
    func getItem(_ key: String) -> String?
    func setItem(_ key: String, _ value: String)
    func removeItem(_ key: String)
}

extension UserDefaults: TimeMachineStorage {
    public func getItem(_ key: String) -> String? { string(forKey: key) }
    public func setItem(_ key: String, _ value: String) { set(value, forKey: key) }
    public func removeItem(_ key: String) { removeObject(forKey: key) }
}

/// Time Machine model: an optional frozen instant + optional zone override that
/// every Ally face can read instead of the real clock. Pure model — apps layer
/// their own ticking/reactivity on top. Mirrored twin of `time-machine.ts`.
@Observable
public final class TimeMachine {
    public private(set) var mock: Date?
    public private(set) var mockTimeZone: String?

    private let localZone: String
    private let storage: TimeMachineStorage?
    private let mockKey: String
    private let tzKey: String
    private static let iso = ISO8601DateFormatter()

    public init(localZone: String = TimeZone.current.identifier,
                storage: TimeMachineStorage? = UserDefaults.standard,
                namespace: String = "ally",
                isUsableZone: ((String) -> Bool)? = nil)
    {
        self.localZone = localZone
        self.storage = storage
        mockKey = "\(namespace).clock.mock"
        tzKey = "\(namespace).clock.tz"
        let usable = isUsableZone ?? { ZoneCatalog.resolve($0) != nil }

        if let stored = storage?.getItem(mockKey),
           let date = Self.parseISO(stored) { mock = date }
        if let zone = storage?.getItem(tzKey), usable(zone) { mockTimeZone = zone }
    }

    public var isMocked: Bool { mock != nil || mockTimeZone != nil }
    public func now(_ realNow: Date) -> Date { mock ?? realNow }
    public func timeZone() -> String { mockTimeZone ?? localZone }

    public func setMock(_ date: Date) {
        mock = date
        storage?.setItem(mockKey, Self.iso.string(from: date))
    }

    public func clearMock() {
        mock = nil
        storage?.removeItem(mockKey)
    }

    /// Selecting the device's local zone is "follow local", not a mock.
    public func setTimeZone(_ zone: String) {
        if zone == localZone {
            clearTimeZone()
            return
        }
        mockTimeZone = zone
        storage?.setItem(tzKey, zone)
    }

    public func clearTimeZone() {
        mockTimeZone = nil
        storage?.removeItem(tzKey)
    }

    /// ISO 8601 with or without fractional seconds (JS `toISOString()` includes
    /// milliseconds; the plain formatter does not parse them).
    private static func parseISO(_ s: String) -> Date? {
        if let d = iso.date(from: s) { return d }
        let fractional = ISO8601DateFormatter()
        fractional.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return fractional.date(from: s)
    }
}
```

- [ ] **Step 5: Run tests** — `swift test`. Expected: all pass (fixture instant has 0 ms, so both ISO forms round-trip).
- [ ] **Step 6: Commit** — `git add -A && git commit -m "feat(swift): ZoneFormat + TimeMachine twins"`

---

### Task 10: zone-country generator (TS → Swift)

**Files:**
- Create: `tools/generate-zone-country.mjs`
- Modify: `swift/Sources/AlloyTime/ZoneCountry.swift` (now generated)

**Interfaces:**
- Produces: `node tools/generate-zone-country.mjs` regenerates the Swift table from the TS source. The emitted file keeps the exact public API `ZoneCountry.table` / `ZoneCountry.country(for:)`.

- [ ] **Step 1: Write the generator**

`tools/generate-zone-country.mjs`:
```js
#!/usr/bin/env node
// Emit swift/Sources/AlloyTime/ZoneCountry.swift from the TS source of truth.
// The TS table (web/packages/alloy-time/src/zone-country.ts) is canonical;
// never edit the Swift file by hand.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const source = readFileSync(join(root, 'web/packages/alloy-time/src/zone-country.ts'), 'utf8');

const entries = [...source.matchAll(/'([^']+)':\s*'([a-z-]+)'/g)].map((m) => [m[1], m[2]]);
if (entries.length < 300) throw new Error(`suspiciously few entries: ${entries.length}`);

const rows = entries.map(([zone, cc]) => `        "${zone}": "${cc}",`).join('\n');
const swift = `// AUTO-GENERATED by tools/generate-zone-country.mjs from
// web/packages/alloy-time/src/zone-country.ts (${entries.length} entries).
// The TS table is the source of truth — do not edit this file by hand.
import Foundation

/// IANA zone id → primary ISO 3166-1 alpha-2 country code (lowercase), the
/// semantic key the flag layer renders. Mirrored twin of \`ZONE_COUNTRY\`.
public enum ZoneCountry {
    /// nil when the zone has no single country (UTC, Etc/*, fixed offsets) —
    /// callers render the neutral globe fallback.
    public static func country(for zone: String) -> String? { table[zone] }

    public static let table: [String: String] = [
${rows}
    ]
}
`;
writeFileSync(join(root, 'swift/Sources/AlloyTime/ZoneCountry.swift'), swift);
console.log(`wrote ${entries.length} entries`);
```

- [ ] **Step 2: Run it and diff**

Run: `node tools/generate-zone-country.mjs && swift test`
Expected: "wrote N entries" where N matches the old hand-copied table; all Swift tests still pass (`ZoneCountryTests` exercises the same lookups). If `git diff swift/Sources/AlloyTime/ZoneCountry.swift` shows entry differences (not just formatting), STOP and investigate — the tables were supposed to be identical.

- [ ] **Step 3: Add the agreement count to both test suites**

Compute the count: `node tools/generate-zone-country.mjs` prints it. Append to `web/packages/alloy-time/src/zone-country.spec.ts`:
```ts
it('has the twin-agreed entry count', () => {
  expect(Object.keys(ZONE_COUNTRY).length).toBe(N); // N from the generator output
});
```
Append to `swift/Tests/AlloyTimeTests/ZoneCountryTests.swift`:
```swift
func test_twinAgreedEntryCount() {
    XCTAssertEqual(ZoneCountry.table.count, N) // N from the generator output
}
```
(Replace `N` with the printed number in both. When the table changes, the generator's printed count is the single number to update in the two tests.)

- [ ] **Step 4: Run both suites** — `swift test` and `cd web && npm test`. Expected: all pass.
- [ ] **Step 5: Commit** — `git add -A && git commit -m "feat(tools): zone-country TS→Swift generator + twin count tests"`

---

### Task 11: Docs alignment

**Files:**
- Modify: `docs/mirroring.md`
- Modify: `README.md`
- Modify: `CLAUDE.md`

- [ ] **Step 1: Record the conventions this implementation locked in**

In `docs/mirroring.md`, add under "Naming" table rows:

| Concept | TypeScript | Swift |
|---------|------------|-------|
| Module file | `zone-format.ts` | caseless `enum ZoneFormat` namespace |
| Zone parameter | zone-id `string` | `TimeZone` primary + `zone id: String` overload via `ZoneCatalog.resolve` |

And under "Idiom boundaries" append: "TS modules of free functions map to Swift caseless-enum namespaces with identical member names."

In `README.md`, change AlloyTime's status from "phase 1 — in design" to "0.1.0 — zone catalog, zone metadata, zone formatting, TimeMachine". In `CLAUDE.md`, delete the "(Scaffolding pending …)" parenthetical — the commands are real now.

- [ ] **Step 2: Commit** — `git add -A && git commit -m "docs: record mirroring conventions locked by AlloyTime"`

---

### Task 12: Tag 0.1.0 and publish the web tarball release

**Files:** none (release artifacts only)

**Interfaces:**
- Produces: git tag `0.1.0` (SPM consumes it) and release asset `https://github.com/triad7th/Alloy/releases/download/0.1.0/allyworld-alloy-time-0.1.0.tgz` (npm consumes it). Tasks 13–14 depend on both existing.

- [ ] **Step 1: Push, pack, release**

```bash
cd /Volumes/AllyDrive/Storage/Repos/Alloy
git push origin main
cd web/packages/alloy-time && npm pack   # runs prepack → tsc build; emits allyworld-alloy-time-0.1.0.tgz
cd /Volumes/AllyDrive/Storage/Repos/Alloy
gh release create 0.1.0 web/packages/alloy-time/allyworld-alloy-time-0.1.0.tgz \
  --title "AlloyTime 0.1.0" \
  --notes "First release: zone catalog, zone metadata, zone formatting, TimeMachine — TS + Swift twins."
rm web/packages/alloy-time/*.tgz
```
(`gh release create 0.1.0` creates the git tag `0.1.0` on HEAD; SPM accepts bare-semver tags.)

- [ ] **Step 2: Verify both consumption paths resolve**

```bash
curl -sIL https://github.com/triad7th/Alloy/releases/download/0.1.0/allyworld-alloy-time-0.1.0.tgz | head -1   # expect HTTP/2 200
git ls-remote --tags https://github.com/triad7th/Alloy.git | grep 0.1.0                                        # expect the tag
```

---

### Task 13: allyclock web consumes @allyworld/alloy-time

Work in `/Volumes/AllyDrive/Storage/Repos/allyclock`. Public behavior must not change; `clock.service.spec.ts` and all other web specs must pass **unmodified** (public API and storage keys are identical).

**Files:**
- Modify: `apps/web/package.json`
- Rewrite as shim: `apps/web/src/app/core/zone-catalog.ts`
- Rewrite as shim: `apps/web/src/app/core/zone-time.ts`
- Rewrite as shim: `apps/web/src/app/core/zone-country.ts`
- Modify: `apps/web/src/app/core/clock.service.ts`
- Modify: `apps/web/src/app/features/faces/fullscreen/clock-formatter.ts`
- Modify: `apps/web/src/app/features/faces/fullscreen/clock-formatter.spec.ts`
- Delete: `apps/web/src/app/core/zone-catalog.spec.ts`, `zone-time.spec.ts`, `zone-country.spec.ts` (they moved to Alloy)

**Interfaces:**
- Consumes: everything Tasks 3–7 exported, at the exact names listed there.

- [ ] **Step 1: Add the dependency**

In `apps/web/package.json` `dependencies`:
```json
"@allyworld/alloy-time": "https://github.com/triad7th/Alloy/releases/download/0.1.0/allyworld-alloy-time-0.1.0.tgz"
```
Run: `npm --prefix apps/web install` (NOT at the repo root — root is orchestration-only). Expected: lockfile updates, `node_modules/@allyworld/alloy-time/dist/index.js` exists.

- [ ] **Step 2: Shim the moved core modules**

`apps/web/src/app/core/zone-catalog.ts` becomes:
```ts
import { Injectable } from '@angular/core';
import { buildTimeZoneOptions, TimeZoneOption } from '@allyworld/alloy-time';

// Pure zone API lives in @allyworld/alloy-time; this file re-exports it so
// app-internal `@core/zone-catalog` imports keep working, and keeps the
// app-side caching service (the full-IANA Intl scan is slow on the web).
export {
  buildSpecialZones,
  buildTimeZoneOptions,
  buildTimeZones,
  formatOffset,
  zoneOffsetMinutes,
} from '@allyworld/alloy-time';
export type { TimeZoneOption } from '@allyworld/alloy-time';

// App-wide cached zone catalog: the full-IANA scan runs once. Consumers (Time
// Machine, Settings picker) read the same list.
@Injectable({ providedIn: 'root' })
export class ZoneCatalog {
  private cached: TimeZoneOption[] | null = null;

  options(): TimeZoneOption[] {
    if (!this.cached) {
      const local = Intl.DateTimeFormat().resolvedOptions().timeZone;
      this.cached = buildTimeZoneOptions(local, new Date());
    }
    return this.cached;
  }
}
```

`apps/web/src/app/core/zone-time.ts` becomes:
```ts
// Moved to @allyworld/alloy-time; re-exported so `@core/zone-time` keeps working.
export {
  instantFromWallClock,
  inputToWallClock,
  wallClockInZone,
  wallClockToInput,
} from '@allyworld/alloy-time';
export type { WallClock } from '@allyworld/alloy-time';
```

`apps/web/src/app/core/zone-country.ts` becomes:
```ts
// Moved to @allyworld/alloy-time; re-exported so `@core/zone-country` keeps working.
export { countryCodeForZone, ZONE_COUNTRY } from '@allyworld/alloy-time';
```

- [ ] **Step 3: Rewire ClockService onto TimeMachine**

Replace `apps/web/src/app/core/clock.service.ts` with:
```ts
import { Injectable, OnDestroy, computed, signal } from '@angular/core';
import { TimeMachine } from '@allyworld/alloy-time';

const TICK_MS = 33; // ~30fps, matching the iOS TimelineView interval

// Signals adapter over the shared TimeMachine model (@allyworld/alloy-time):
// the model owns mock state, persistence, and restore validation; this service
// adds the ticking real clock and Angular reactivity.
@Injectable({
  providedIn: 'root',
})
export class ClockService implements OnDestroy {
  private readonly machine = new TimeMachine({
    localZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    storage: safeLocalStorage(),
    namespace: 'allyclock', // preserves the pre-Alloy storage keys
  });

  // Real wall-clock time, ticking ~30fps.
  private readonly realNow = signal(new Date());

  // Reactive mirrors of the machine's mock state.
  private readonly mockNow = signal<Date | null>(this.machine.mock);
  private readonly mockTimeZone = signal<string | null>(this.machine.mockTimeZone);

  // The time every face observes: the mocked instant if set, otherwise live.
  readonly now = computed(() => this.mockNow() ?? this.realNow());

  // The active zone every "primary" face uses: the mocked zone if set, else local.
  readonly timeZone = computed(() => this.mockTimeZone() ?? this.machine.timeZone());

  // Whether the Time Machine is currently overriding the clock (time or zone).
  readonly isMocked = computed(() => this.mockNow() !== null || this.mockTimeZone() !== null);

  // The current mock instant, or null when live.
  readonly mock = this.mockNow.asReadonly();

  // The current mocked zone, or null when following local (for rollback).
  readonly mockTz = this.mockTimeZone.asReadonly();

  private readonly intervalId = setInterval(() => this.realNow.set(new Date()), TICK_MS);

  // Freeze the clock at the given instant.
  setMock(date: Date): void {
    this.machine.setMock(date);
    this.mockNow.set(this.machine.mock);
  }

  // Return to live time.
  clearMock(): void {
    this.machine.clearMock();
    this.mockNow.set(null);
  }

  // Override the active zone; selecting the local zone means "follow local".
  setTimeZone(tz: string): void {
    this.machine.setTimeZone(tz);
    this.mockTimeZone.set(this.machine.mockTimeZone);
  }

  // Return to the device's local zone.
  clearTimeZone(): void {
    this.machine.clearTimeZone();
    this.mockTimeZone.set(null);
  }

  ngOnDestroy(): void {
    clearInterval(this.intervalId);
  }
}

// localStorage when available; null in restricted contexts (SSR, some private
// modes throw on ACCESS, not just on write).
function safeLocalStorage(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}
```
(`Storage` structurally satisfies `TimeMachineStorage` — same three methods.)

- [ ] **Step 4: Slim clock-formatter to face-only formatting**

In `apps/web/src/app/features/faces/fullscreen/clock-formatter.ts`: delete the `gmtOffset`, `compactOffset`, and `zoneCity` function bodies and the `import { zoneOffsetMinutes } from '@core/zone-catalog';` line; add at the top:
```ts
import { compactOffset, gmtOffset } from '@allyworld/alloy-time';

// zoneCity/compactOffset/gmtOffset moved to @allyworld/alloy-time; re-exported
// for this file's existing consumers (world-cards card, settings).
export { compactOffset, gmtOffset, zoneCity } from '@allyworld/alloy-time';
```
`bigTime`, `precise`, `dateTZ`, `dateParts` stay; `dateTZ` and `dateParts` now call the imported `gmtOffset`/`compactOffset`.

In `clock-formatter.spec.ts`: delete the `describe('gmtOffset')`, `describe('compactOffset')`, `describe('zoneCity')` blocks (those tests moved to Alloy in Task 6); keep `bigTime`/`precise`/`dateTZ`/`dateParts` blocks (dateTZ/dateParts still exercise the re-exported functions end-to-end).

- [ ] **Step 5: Delete moved core specs**

```bash
git rm apps/web/src/app/core/zone-catalog.spec.ts apps/web/src/app/core/zone-time.spec.ts apps/web/src/app/core/zone-country.spec.ts
```

- [ ] **Step 6: Verify**

Run from allyclock root: `npm run test:web && npm run build:web`
Expected: every remaining spec passes **unmodified** (especially `clock.service.spec.ts`); production build succeeds.

- [ ] **Step 7: Commit**

```bash
git add -A && git commit -m "refactor(web): consume @allyworld/alloy-time for zone + TimeMachine models"
```

---

### Task 14: allyclock iOS consumes AlloyTime

Work in `/Volumes/AllyDrive/Storage/Repos/allyclock`. The snapshot suite (pixel references) must pass unchanged — no rendering differences are expected.

**Files:**
- Modify: `packages/AllyClockCore/Package.swift`
- Delete: `packages/AllyClockCore/Sources/AllyClockCore/Zones/` (both files)
- Delete: `packages/AllyClockCore/Tests/AllyClockCoreTests/ZoneCatalogTests.swift`, `ZoneCountryTests.swift`
- Modify: `packages/AllyClockCore/Sources/AllyClockCore/Clock/TimeFormatting.swift`
- Modify: `packages/AllyClockCore/Tests/AllyClockCoreTests/TimeFormattingTests.swift`
- Modify: `apps/ios/AllyClock.xcodeproj/project.pbxproj`
- Modify (import lines only): `apps/ios/AllyClock/Faces/FullscreenFaceView.swift`, `apps/ios/AllyClock/Shared/FlagView.swift`, `apps/ios/AllyClock/Shared/ZonePickerView.swift`, `apps/ios/AllyClockTests/FlagResolutionTests.swift`, `apps/ios/AllyClockTests/FaceSnapshotTests.swift`, plus any other file `grep -rl "ZoneCatalog\|ZoneCountry\|zoneCity" apps/ios packages` surfaces.

**Interfaces:**
- Consumes: `AlloyTime` product — `ZoneCatalog`, `ZoneCountry`, `ZoneFormat`, `TimeZoneOption` (Tasks 8–9), pinned `from: "0.1.0"`.

- [ ] **Step 1: AllyClockCore depends on Alloy**

`packages/AllyClockCore/Package.swift` becomes:
```swift
// swift-tools-version: 6.0
import PackageDescription

let package = Package(
  name: "AllyClockCore",
  platforms: [.iOS(.v17), .tvOS(.v17), .watchOS(.v10), .macOS(.v14)],
  products: [
    .library(name: "AllyClockCore", targets: ["AllyClockCore"]),
  ],
  dependencies: [
    .package(url: "https://github.com/triad7th/Alloy.git", from: "0.1.0"),
  ],
  targets: [
    .target(name: "AllyClockCore",
            dependencies: [.product(name: "AlloyTime", package: "Alloy")]),
    .testTarget(name: "AllyClockCoreTests", dependencies: ["AllyClockCore"]),
  ]
)
```

- [ ] **Step 2: Delete the moved sources/tests; slim TimeFormatting**

```bash
git rm -r packages/AllyClockCore/Sources/AllyClockCore/Zones
git rm packages/AllyClockCore/Tests/AllyClockCoreTests/ZoneCatalogTests.swift \
       packages/AllyClockCore/Tests/AllyClockCoreTests/ZoneCountryTests.swift
```
In `TimeFormatting.swift`: add `import AlloyTime` under `import Foundation`; delete the `compactOffset` and `zoneCity` functions (lines 63–85); in `dateParts`, change `gmt: compactOffset(date, timeZone: timeZone)` to `gmt: ZoneFormat.compactOffset(date, timeZone: timeZone)`. In `TimeFormattingTests.swift`: delete test methods covering `compactOffset`/`zoneCity` (they moved to Alloy's `ZoneFormatTests`); keep `bigTime`/`dateParts` tests, adding `import AlloyTime` only if the file references moved symbols directly.

- [ ] **Step 3: Add the Alloy package to the Xcode project**

In `apps/ios/AllyClock.xcodeproj/project.pbxproj` (follow the existing SnapshotTesting remote-package precedent — ids `AC0000000000000000000161`–`165` — and this repo's `AC…01NN` id convention):

1. In `XCRemoteSwiftPackageReference` section add:
```
		AC0000000000000000000170 /* XCRemoteSwiftPackageReference "Alloy" */ = {
			isa = XCRemoteSwiftPackageReference;
			repositoryURL = "https://github.com/triad7th/Alloy.git";
			requirement = {
				kind = upToNextMajorVersion;
				minimumVersion = 0.1.0;
			};
		};
```
2. In `XCSwiftPackageProductDependency` section add:
```
		AC0000000000000000000171 /* AlloyTime */ = {
			isa = XCSwiftPackageProductDependency;
			package = AC0000000000000000000170 /* XCRemoteSwiftPackageReference "Alloy" */;
			productName = AlloyTime;
		};
```
3. Add `AC0000000000000000000170` to the `packageReferences` list of the `PBXProject` object (next to the SnapshotTesting reference).
4. Add `AC0000000000000000000171 /* AlloyTime */` to the **AllyClock app target's** `packageProductDependencies` list.
5. In `PBXBuildFile` section add, and reference it from the app target's Frameworks build phase `files` list:
```
		AC0000000000000000000172 /* AlloyTime in Frameworks */ = {isa = PBXBuildFile; productRef = AC0000000000000000000171 /* AlloyTime */; };
```

- [ ] **Step 4: Update imports and call sites mechanically**

Run `grep -rn "ZoneCatalog\|ZoneCountry\|TimeFormatting.zoneCity" apps/ios packages/AllyClockCore --include="*.swift"` and for each app/test file: add `import AlloyTime` after the existing `import AllyClockCore`, and rename `TimeFormatting.zoneCity(...)` → `ZoneFormat.zoneCity(...)`. Known call sites: `FullscreenFaceView.swift` (`ZoneCatalog.resolve`, `TimeFormatting.zoneCity`, `ZoneCountry.country`), `FlagView.swift` (`ZoneCountry.country`), `ZonePickerView.swift` (`ZoneCatalog.buildOptions`/`buildSpecialZones`), `FlagResolutionTests.swift` (`ZoneCountry.table`), `FaceSnapshotTests.swift` (only if it references moved symbols).

- [ ] **Step 5: Verify with the full iOS suite**

Resolve packages and run tests via XcodeBuildMCP (`session_show_defaults` first if a fresh session, then `test_sim`), or:
`cd apps/ios && xcodebuild -project AllyClock.xcodeproj -scheme AllyClock -destination 'platform=iOS Simulator,name=iPhone 17' test`
Expected: all 9 tests pass, **including unchanged pixel snapshots**. Also `cd packages/AllyClockCore && swift test` for the package suite.

- [ ] **Step 6: Update allyclock docs**

Root `CLAUDE.md` "Project Overview": note that shared time models live in the Alloy repo (`github.com/triad7th/Alloy`) and `packages/AllyClockCore` now holds only face-config/dimension logic. Same note in `apps/ios/CLAUDE.md`'s App Overview bullet about AllyClockCore.

- [ ] **Step 7: Commit**

```bash
git add -A && git commit -m "refactor(ios): consume AlloyTime for zone catalog, metadata, and formatting"
```

---

## Final verification (after Task 14)

- Alloy: `swift test` and `cd web && npm test` — all green.
- allyclock: `npm run test:web && npm run build:web` green; iOS `test_sim` 9/9 green with unchanged snapshot references; app boots in the simulator (`build_run_sim`) and the Fullscreen face renders with zone/flag/GMT intact.
- `git -C /Volumes/AllyDrive/Storage/Repos/allyclock grep -l "ZONE_COUNTRY\|buildSpecialZones" -- apps/web/src` returns only the shim files.
