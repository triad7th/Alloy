import type { StorageRecord, StorageRecordMeta } from './record.js';

/** One flat collection of documents (a folder / object store). Hierarchy is
 *  backend configuration, never part of this interface. */
export interface StorageBackend {
  /** Metadata only — implementations must not download payloads here. */
  list(): Promise<StorageRecordMeta[]>;
  /** null on missing id (never throws for a miss). */
  read(id: string): Promise<StorageRecord | null>;
  /** Create or replace; returns the stored metadata (with backend revision, if any). */
  write(record: StorageRecord): Promise<StorageRecordMeta>;
  /** Idempotent: deleting an absent id resolves. */
  delete(id: string): Promise<void>;
}
