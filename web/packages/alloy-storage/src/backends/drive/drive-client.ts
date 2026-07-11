import type { AuthProvider } from '../../core/auth.js';
import { StorageError } from '../../core/errors.js';

const API = 'https://www.googleapis.com/drive/v3';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3';
const FOLDER_MIME = 'application/vnd.google-apps.folder';
const BOUNDARY = 'alloy-storage-multipart';

export interface DriveFileMeta {
  id: string;
  name: string;
  headRevisionId?: string;
  appProperties?: Record<string, string>;
}

/** Thin typed wrapper over the handful of Drive v3 calls AllyScore uses.
 *  All requests carry the AuthProvider bearer token; non-OK → StorageError. */
export class DriveClient {
  constructor(
    private readonly auth: AuthProvider,
    // Bound: calling this.fetchFn(...) would otherwise invoke window.fetch
    // with `this` = DriveClient → "Illegal invocation" in browsers.
    private readonly fetchFn: typeof fetch = fetch.bind(globalThis)
  ) {}

  private async call(url: string, init: RequestInit = {}): Promise<Response> {
    const token = await this.auth.accessToken();
    if (token === null) throw StorageError.fromHttpStatus(401, 'Not signed in');
    let res: Response;
    try {
      res = await this.fetchFn(url, {
        ...init,
        headers: {
          ...((init.headers as Record<string, string>) ?? {}),
          Authorization: `Bearer ${token}`,
        },
      });
    } catch (err) {
      throw new StorageError('unreachable', String(err));
    }
    if (!res.ok) throw StorageError.fromHttpStatus(res.status);
    return res;
  }

  private multipart(
    meta: object,
    content: string
  ): { headers: Record<string, string>; body: string } {
    return {
      headers: { 'Content-Type': `multipart/related; boundary=${BOUNDARY}` },
      body:
        `--${BOUNDARY}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n` +
        `${JSON.stringify(meta)}\r\n` +
        `--${BOUNDARY}\r\nContent-Type: application/json\r\n\r\n` +
        `${content}\r\n--${BOUNDARY}--`,
    };
  }

  /** Percent-encode a Drive query, quotes included: encodeURIComponent leaves
   *  ' unencoded (RFC 3986 sub-delim) but %27 is always wire-valid, and one
   *  consistent encoder beats three ad-hoc ones. */
  private encodeQuery(raw: string): string {
    return encodeURIComponent(raw).replace(/'/g, '%27');
  }

  /** Escape a value interpolated into a Drive `q` string literal: backslash
   *  first (so the escaping backslash itself isn't re-escaped), then quote. */
  private escapeQueryValue(raw: string): string {
    return raw.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  }

  private async findFolder(name: string, parentId: string | null): Promise<string | null> {
    const parent = parentId ? ` and '${parentId}' in parents` : '';
    const q = this.encodeQuery(
      `name='${this.escapeQueryValue(name)}' and mimeType='${FOLDER_MIME}' and trashed=false${parent}`
    );
    const res = await this.call(`${API}/files?q=${q}&fields=files(id)`);
    const body = (await res.json()) as { files?: Array<{ id: string }> };
    return body.files?.[0]?.id ?? null;
  }

  private async createFolder(name: string, parentId: string | null): Promise<string> {
    const res = await this.call(`${API}/files?fields=id`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name,
        mimeType: FOLDER_MIME,
        ...(parentId ? { parents: [parentId] } : {}),
      }),
    });
    return ((await res.json()) as { id: string }).id;
  }

  /** Find-or-create every segment of "A/B/C"; returns the leaf folder id. */
  async resolveFolderPath(path: string): Promise<string> {
    let parentId: string | null = null;
    for (const segment of path.split('/').filter((s) => s.length > 0)) {
      parentId =
        (await this.findFolder(segment, parentId)) ?? (await this.createFolder(segment, parentId));
    }
    if (parentId === null) throw new StorageError('notFound', `empty folder path: '${path}'`);
    return parentId;
  }

  async listFiles(folderId: string): Promise<DriveFileMeta[]> {
    const q = this.encodeQuery(`'${folderId}' in parents and trashed=false`);
    const res = await this.call(
      `${API}/files?q=${q}&fields=files(id,name,appProperties,headRevisionId)&pageSize=1000`
    );
    return ((await res.json()) as { files?: DriveFileMeta[] }).files ?? [];
  }

  async findByAlloyId(folderId: string, id: string): Promise<DriveFileMeta | null> {
    const escapedId = this.escapeQueryValue(id);
    const q = this.encodeQuery(
      `'${folderId}' in parents and trashed=false and ` +
        `(appProperties has { key='alloyId' and value='${escapedId}' } or ` +
        `appProperties has { key='allyscoreId' and value='${escapedId}' })`
    );
    const res = await this.call(
      `${API}/files?q=${q}&fields=files(id,name,appProperties,headRevisionId)`
    );
    return ((await res.json()) as { files?: DriveFileMeta[] }).files?.[0] ?? null;
  }

  async createFile(
    folderId: string,
    name: string,
    appProperties: Record<string, string>,
    content: string
  ): Promise<string> {
    const { headers, body } = this.multipart({ name, parents: [folderId], appProperties }, content);
    const res = await this.call(`${UPLOAD}/files?uploadType=multipart&fields=id`, {
      method: 'POST',
      headers,
      body,
    });
    return ((await res.json()) as { id: string }).id;
  }

  async updateFile(
    fileId: string,
    content: string,
    appProperties: Record<string, string>,
    name: string
  ): Promise<void> {
    const { headers, body } = this.multipart({ name, appProperties }, content);
    await this.call(`${UPLOAD}/files/${fileId}?uploadType=multipart&fields=id`, {
      method: 'PATCH',
      headers,
      body,
    });
  }

  async downloadFile(fileId: string): Promise<string> {
    const res = await this.call(`${API}/files/${fileId}?alt=media`);
    return res.text();
  }

  async deleteFile(fileId: string): Promise<void> {
    await this.call(`${API}/files/${fileId}`, { method: 'DELETE' });
  }

  /** @internal Shareable mechanism — not part of the supported public surface. */
  async createPublicPermission(fileId: string): Promise<void> {
    await this.call(`${API}/files/${fileId}/permissions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: 'reader', type: 'anyone' }),
    });
  }

  private async anyonePermissionId(fileId: string): Promise<string | null> {
    const res = await this.call(`${API}/files/${fileId}/permissions?fields=permissions(id,type)`);
    const body = (await res.json()) as { permissions?: Array<{ id: string; type: string }> };
    return body.permissions?.find((p) => p.type === 'anyone')?.id ?? null;
  }

  /** @internal Shareable mechanism — not part of the supported public surface. */
  async hasPublicPermission(fileId: string): Promise<boolean> {
    return (await this.anyonePermissionId(fileId)) !== null;
  }

  /** @internal Shareable mechanism — not part of the supported public surface. */
  async deletePublicPermission(fileId: string): Promise<void> {
    const id = await this.anyonePermissionId(fileId);
    if (id) await this.call(`${API}/files/${fileId}/permissions/${id}`, { method: 'DELETE' });
  }
}
