import { describe, expect, it } from 'vitest';
import type { StorageBackend } from '../core/backend.js';

/** Twin fixture: swift/Tests/AlloyStorageTests/StorageBackendContract.swift
 *  runs the same scenarios with the same instants (epoch ms). */
export function describeStorageBackendContract(makeBackend: () => Promise<StorageBackend>) {
  const T1 = 1751980000000; // 2025-07-08T12:26:40Z
  const T2 = 1751990000000;

  describe('StorageBackend contract', () => {
    it('write then read round-trips the record', async () => {
      const b = await makeBackend();
      await b.write({ id: 'a', name: 'a.json', updatedAt: T1, payload: '{"v":1}' });
      const got = await b.read('a');
      expect(got).toMatchObject({ id: 'a', name: 'a.json', updatedAt: T1, payload: '{"v":1}' });
    });

    it('read of a missing id resolves null', async () => {
      const b = await makeBackend();
      expect(await b.read('nope')).toBeNull();
    });

    it('list returns metadata only, no payload key', async () => {
      const b = await makeBackend();
      await b.write({ id: 'a', name: 'a.json', updatedAt: T1, payload: 'x' });
      await b.write({ id: 'b', name: 'b.json', updatedAt: T2, payload: 'y' });
      const metas = await b.list();
      expect(metas.map((m) => m.id).sort()).toEqual(['a', 'b']);
      for (const m of metas) expect('payload' in m).toBe(false);
    });

    it('write replaces an existing record', async () => {
      const b = await makeBackend();
      await b.write({ id: 'a', name: 'a.json', updatedAt: T1, payload: 'old' });
      await b.write({ id: 'a', name: 'renamed.json', updatedAt: T2, payload: 'new' });
      const got = await b.read('a');
      expect(got).toMatchObject({ name: 'renamed.json', updatedAt: T2, payload: 'new' });
      expect((await b.list()).length).toBe(1);
    });

    it('delete removes and is idempotent', async () => {
      const b = await makeBackend();
      await b.write({ id: 'a', name: 'a.json', updatedAt: T1, payload: 'x' });
      await b.delete('a');
      expect(await b.read('a')).toBeNull();
      await expect(b.delete('a')).resolves.toBeUndefined(); // absent id: no throw
    });
  });
}
