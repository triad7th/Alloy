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
      { id: 'd4', name: 'c.json', appProperties: { alloyId: 'c', alloySavedAt: 'garbage' } },
    ]);
    const b = new DriveBackend(fakeClient({ listFiles } as Partial<DriveClient>), 'App', memStorage());
    expect(await b.list()).toEqual([
      { id: 'a', name: 'a.json', updatedAt: T1, revision: 'r1' },
      { id: 'b', name: 'b.allyscore', updatedAt: T1 },
      { id: 'c', name: 'c.json', updatedAt: 0 }, // unparseable savedAt → 0, not NaN (twin of Swift)
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
