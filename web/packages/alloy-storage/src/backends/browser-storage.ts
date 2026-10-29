import type { StorageBackend } from '../core/backend.js';
import type { StorageRecord, StorageRecordMeta } from '../core/record.js';
import { openDatabase, requestAsPromise } from './idb.js';

const STORE = 'records';

/** The record's metadata with optional fields present only when set. */
function toMeta({ id, name, updatedAt, revision, createdAt }: StorageRecord): StorageRecordMeta {
  const meta: StorageRecordMeta = { id, name, updatedAt };
  if (revision !== undefined) meta.revision = revision;
  if (createdAt !== undefined) meta.createdAt = createdAt;
  return meta;
}

/** Local replica backend on IndexedDB. One database per collection
 *  (`alloy-storage.<collection>`), records keyed by id. */
export class BrowserStorageBackend implements StorageBackend {
  private db: Promise<IDBDatabase> | null = null;

  constructor(
    private readonly collection: string,
    private readonly idbFactory: IDBFactory = indexedDB
  ) {}

  private open(): Promise<IDBDatabase> {
    this.db ??= openDatabase(`alloy-storage.${this.collection}`, STORE, this.idbFactory).catch((e) => {
      this.db = null; // a failed open may be retried on the next call
      throw e;
    });
    return this.db;
  }

  private async tx(mode: IDBTransactionMode): Promise<IDBObjectStore> {
    return (await this.open()).transaction(STORE, mode).objectStore(STORE);
  }

  async list(): Promise<StorageRecordMeta[]> {
    const all = await requestAsPromise(
      (await this.tx('readonly')).getAll() as IDBRequest<StorageRecord[]>
    );
    return all.map(toMeta);
  }

  async read(id: string): Promise<StorageRecord | null> {
    const got = await requestAsPromise(
      (await this.tx('readonly')).get(id) as IDBRequest<StorageRecord | undefined>
    );
    return got ?? null;
  }

  async write(record: StorageRecord): Promise<StorageRecordMeta> {
    await requestAsPromise((await this.tx('readwrite')).put(record));
    return toMeta(record);
  }

  async delete(id: string): Promise<void> {
    await requestAsPromise((await this.tx('readwrite')).delete(id));
  }
}
