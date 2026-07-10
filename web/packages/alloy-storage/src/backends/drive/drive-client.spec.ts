import { describe, expect, it } from 'vitest';
import type { AuthProvider } from '../../core/auth';
import { StorageError } from '../../core/errors';
import { DriveClient } from './drive-client';

const auth: AuthProvider = { accessToken: async () => 'tok', state: 'signedIn' };
const noAuth: AuthProvider = { accessToken: async () => null, state: 'signedOut' };

type Scripted = { match: (url: string, init?: RequestInit) => boolean; response: unknown; status?: number };

function fakeFetch(script: Scripted[], calls: Array<{ url: string; init?: RequestInit }> = []) {
  const fn: typeof fetch = async (input, init) => {
    const url = String(input);
    calls.push({ url, init });
    const hit = script.find((s) => s.match(url, init));
    if (!hit) throw new Error(`unscripted fetch: ${url}`);
    return new Response(
      typeof hit.response === 'string' ? hit.response : JSON.stringify(hit.response),
      { status: hit.status ?? 200 }
    );
  };
  return fn;
}

describe('DriveClient', () => {
  it('throws StorageError(auth) when signed out', async () => {
    const client = new DriveClient(noAuth, fakeFetch([]));
    await expect(client.listFiles('f1')).rejects.toMatchObject({ category: 'auth', status: 401 });
  });

  it('maps non-OK responses through StorageError.fromHttpStatus', async () => {
    const client = new DriveClient(auth, fakeFetch([{ match: () => true, response: '', status: 429 }]));
    const err = await client.listFiles('f1').catch((e) => e);
    expect(err).toBeInstanceOf(StorageError);
    expect(err.category).toBe('quota');
  });

  it('resolveFolderPath find-or-creates each segment under its parent', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const client = new DriveClient(
      auth,
      fakeFetch(
        [
          // "AllyWorld" exists at root… (encodeQuery double-encodes quotes to %27,
          // so match against the wire-encoded literal rather than encodeURIComponent's
          // single-encoded output, which never appears in the real URL)
          { match: (u) => u.includes('files?q=') && u.includes("name%3D%27AllyWorld%27") && !u.includes('AllyClock'), response: { files: [{ id: 'p1' }] } },
          // …"AllyClock" under it does not…
          { match: (u) => u.includes('files?q=') && u.includes("name%3D%27AllyClock%27"), response: { files: [] } },
          // …so it gets created with parent p1.
          { match: (u, i) => u.endsWith('/files?fields=id') && i?.method === 'POST', response: { id: 'c1' } },
        ],
        calls
      )
    );
    expect(await client.resolveFolderPath('AllyWorld/AllyClock')).toBe('c1');
    const post = calls.find((c) => c.init?.method === 'POST');
    expect(JSON.parse(String(post?.init?.body))).toMatchObject({ name: 'AllyClock', parents: ['p1'] });
  });

  it('listFiles requests metadata fields only', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const client = new DriveClient(
      auth,
      fakeFetch([{ match: () => true, response: { files: [{ id: 'x', name: 'a.json' }] } }], calls)
    );
    await client.listFiles('f1');
    expect(calls[0].url).toContain('fields=files(id,name,appProperties,headRevisionId)');
    expect(calls[0].url).not.toContain('alt=media');
  });

  it('findByAlloyId matches alloyId or legacy allyscoreId', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const client = new DriveClient(
      auth,
      fakeFetch([{ match: () => true, response: { files: [{ id: 'x', name: 'a' }] } }], calls)
    );
    await client.findByAlloyId('f1', 'id9');
    const q = decodeURIComponent(calls[0].url);
    expect(q).toContain("key='alloyId' and value='id9'");
    expect(q).toContain("key='allyscoreId' and value='id9'");
    expect(q).toContain(' or ');
  });
});
