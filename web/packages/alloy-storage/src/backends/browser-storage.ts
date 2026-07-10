import type { StorageBackend } from '../core/backend.js';
import type { StorageRecord, StorageRecordMeta } from '../core/record.js';
import { openDatabase, requestAsPromise } from './idb.js';

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
