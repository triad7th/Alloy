import { describe, expect, it } from 'vitest';
import { StorageError } from '../../core/errors.js';
import { fetchSharedFile } from './drive-public.js';

/** Twin fixture: swift/Tests/AlloyStorageTests/DrivePublicTests.swift. */
function fakeFetch(status: number, body: string, calls: string[] = []): typeof fetch {
  return async (input) => {
    calls.push(String(input));
    return new Response(body, { status });
  };
}

describe('fetchSharedFile', () => {
  it('GETs alt=media with the API key and returns the payload', async () => {
    const calls: string[] = [];
    const text = await fetchSharedFile('d1', 'KEY-9', fakeFetch(200, '{"v":1}', calls));
    expect(text).toBe('{"v":1}');
    expect(calls[0]).toBe('https://www.googleapis.com/drive/v3/files/d1?alt=media&key=KEY-9');
  });

  it('percent-encodes a crafted nativeRef so it cannot redirect the request', async () => {
    const calls: string[] = [];
    await fetchSharedFile('d1/../evil?x=', 'k', fakeFetch(200, '', calls));
    expect(calls[0]).toBe(
      'https://www.googleapis.com/drive/v3/files/d1%2F..%2Fevil%3Fx%3D?alt=media&key=k'
    );
  });

  it('maps 404 to notFound (sharing revoked) and 403 to auth (bad API key)', async () => {
    await expect(fetchSharedFile('d1', 'k', fakeFetch(404, ''))).rejects.toMatchObject({
      category: 'notFound',
    });
    await expect(fetchSharedFile('d1', 'k', fakeFetch(403, ''))).rejects.toMatchObject({
      category: 'auth',
    });
  });

  it('wraps network failures as unreachable', async () => {
    const failing: typeof fetch = async () => {
      throw new TypeError('offline');
    };
    const err = await fetchSharedFile('d1', 'k', failing).catch((e) => e);
    expect(err).toBeInstanceOf(StorageError);
    expect(err.category).toBe('unreachable');
  });
});
