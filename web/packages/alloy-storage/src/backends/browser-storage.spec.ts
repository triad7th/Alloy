import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { describe } from 'vitest';
import { describeStorageBackendContract } from './storage-backend.contract.js';
import { BrowserStorageBackend } from './browser-storage.js';

describe('BrowserStorageBackend', () => {
  // A fresh IDBFactory per backend = a clean database per test.
  describeStorageBackendContract(async () => new BrowserStorageBackend('test', new IDBFactory()));
});
