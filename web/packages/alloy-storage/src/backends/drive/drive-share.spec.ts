import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it, vi } from 'vitest';
import type { DriveClient, DriveFileMeta } from './drive-client.js';
import { isShareable } from '../../core/shareable.js';
import { BrowserStorageBackend } from '../browser-storage.js';
import { DriveBackend } from './drive-backend.js';

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
    expect(isShareable(new BrowserStorageBackend('t', new IDBFactory()))).toBe(false);
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
