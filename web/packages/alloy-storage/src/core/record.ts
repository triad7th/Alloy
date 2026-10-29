/** Metadata for one stored document — everything list() returns; no payload. */
export interface StorageRecordMeta {
  /** App-assigned stable identity (survives renames). */
  id: string;
  /** Human-visible filename, e.g. "settings.json". */
  name: string;
  /** Last modification, epoch milliseconds. Drives last-write-wins in the sync engine. */
  updatedAt: number;
  /** Backend-native version marker (e.g. Drive headRevisionId), when the backend has one. */
  revision?: string;
  /** Creation time, epoch milliseconds, when known: Drive reports its own
   *  `createdTime` (and ignores one handed to write); local replicas store
   *  whatever write was given. Absent = unknown — never a fabricated 0. */
  createdAt?: number;
}

/** A stored document: metadata plus its whole-document payload. */
export interface StorageRecord extends StorageRecordMeta {
  payload: string;
}
