import { openDatabase, requestAsPromise } from '../backends/idb.js';

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
    this.db ??= openDatabase('alloy-storage.auth', 'tokens', this.idbFactory).catch((e) => {
      this.db = null; // a failed open may be retried on the next call
      throw e;
    });
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
