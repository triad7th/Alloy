import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it } from 'vitest';
import { describeStorageBackendContract } from './storage-backend.contract.js';
import { BrowserStorageBackend } from './browser-storage.js';

describe('BrowserStorageBackend', () => {
  // A fresh IDBFactory per backend = a clean database per test.
  describeStorageBackendContract(async () => new BrowserStorageBackend('test', new IDBFactory()));

  it('retries opening the database after a failed open', async () => {
    const real = new IDBFactory();
    let failNext = true;
    const flaky = {
      open(name: string, version?: number) {
        if (failNext) {
          failNext = false;
          throw new DOMException('simulated open failure', 'UnknownError');
        }
        return real.open(name, version);
      },
    } as IDBFactory;

    const b = new BrowserStorageBackend('test', flaky);
    await expect(b.read('a')).rejects.toThrow('simulated open failure');
    // The failed open must not be cached: the same instance retries and succeeds.
    expect(await b.read('a')).toBeNull();
  });
});
