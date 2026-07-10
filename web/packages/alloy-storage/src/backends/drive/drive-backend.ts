import type { StorageBackend } from '../../core/backend.js';
import type { StorageRecord, StorageRecordMeta } from '../../core/record.js';
import { StorageError } from '../../core/errors.js';
import type { DriveClient, DriveFileMeta } from './drive-client.js';

const CACHE_PREFIX = 'alloy-storage.folderId.';

function defaultStorage(): Storage | null {
  return typeof localStorage !== 'undefined' ? localStorage : null;
}

function toMeta(file: DriveFileMeta): StorageRecordMeta | null {
  const p = file.appProperties ?? {};
  const id = p['alloyId'] ?? p['allyscoreId'];
  if (!id) return null; // not ours — a foreign file sharing the folder
  const raw = Number(p['alloySavedAt'] ?? p['savedAt'] ?? 0);
  const updatedAt = Number.isFinite(raw) ? raw : 0;
  const meta: StorageRecordMeta = { id, name: file.name, updatedAt };
  return file.headRevisionId ? { ...meta, revision: file.headRevisionId } : meta;
}

/** StorageBackend on the user's own Google Drive (drive.file scope), scoped to
 *  one folder path. Folder id caching + 404 re-resolve and per-id write chains
 *  are ported from AllyScore's DriveScoreStore. */
export class DriveBackend implements StorageBackend {
  private folderId: string | null = null;
  private folderPromise: Promise<string> | null = null;
  /** Per-id promise chains: a later write always lands after earlier ones. */
  private readonly writeChains = new Map<string, Promise<unknown>>();

  constructor(
    private readonly client: DriveClient,
    private readonly folderPath: string,
    private readonly cache: Storage | null = defaultStorage()
  ) {}

  private get cacheKey(): string {
    return CACHE_PREFIX + this.folderPath;
  }

  private ensureFolder(): Promise<string> {
    if (this.folderId) return Promise.resolve(this.folderId);
    this.folderPromise ??= this.resolveFolder().finally(() => {
      this.folderPromise = null; // a rejected resolve may retry later
    });
    return this.folderPromise;
  }

  private async resolveFolder(): Promise<string> {
    const cached = this.cache?.getItem(this.cacheKey) ?? null;
    if (cached) {
      this.folderId = cached;
      return cached;
    }
    const id = await this.client.resolveFolderPath(this.folderPath);
    this.folderId = id;
    this.cache?.setItem(this.cacheKey, id);
    return id;
  }

  private async withFolder<T>(fn: (folderId: string) => Promise<T>): Promise<T> {
    const id = await this.ensureFolder();
    try {
      return await fn(id);
    } catch (e) {
      if (e instanceof StorageError && e.status === 404) {
        // The cached folder was deleted/moved out of reach: re-resolve once.
        this.folderId = null;
        this.cache?.removeItem(this.cacheKey);
        return fn(await this.ensureFolder());
      }
      throw e;
    }
  }

  async list(): Promise<StorageRecordMeta[]> {
    return this.withFolder(async (folderId) => {
      const files = await this.client.listFiles(folderId);
      return files.map(toMeta).filter((m): m is StorageRecordMeta => m !== null);
    });
  }

  async read(id: string): Promise<StorageRecord | null> {
    return this.withFolder(async (folderId) => {
      const file = await this.client.findByAlloyId(folderId, id);
      if (!file) return null;
      const meta = toMeta(file);
      if (!meta) return null;
      const payload = await this.client.downloadFile(file.id);
      return { ...meta, payload };
    });
  }

  write(record: StorageRecord): Promise<StorageRecordMeta> {
    const prev = this.writeChains.get(record.id) ?? Promise.resolve();
    const next = prev.catch(() => undefined).then(() => this.writeOnce(record));
    this.writeChains.set(record.id, next);
    return next;
  }

  private async writeOnce(record: StorageRecord): Promise<StorageRecordMeta> {
    return this.withFolder(async (folderId) => {
      const name = record.name.replace(/[\\/:*?"<>|]/g, '-');
      const props = { alloyId: record.id, alloySavedAt: String(record.updatedAt) };
      const existing = await this.client.findByAlloyId(folderId, record.id);
      if (existing) await this.client.updateFile(existing.id, record.payload, props, name);
      else await this.client.createFile(folderId, name, props, record.payload);
      return { id: record.id, name, updatedAt: record.updatedAt };
    });
  }

  async delete(id: string): Promise<void> {
    return this.withFolder(async (folderId) => {
      const file = await this.client.findByAlloyId(folderId, id);
      if (file) await this.client.deleteFile(file.id);
    });
  }
}
