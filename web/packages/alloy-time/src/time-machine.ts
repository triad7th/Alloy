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
