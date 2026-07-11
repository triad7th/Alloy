/** Result of a share query/operation. */
export interface ShareStatus {
  shared: boolean;
  /** Backend-native handle apps embed in share links (Drive: the file id).
   *  The one sanctioned backend leak — link URL format is app policy. */
  nativeRef: string;
}

/** Optional capability: backends that can share a record via a public link.
 *  Local backends deliberately do not implement it. All methods take the
 *  app's record id, never a backend-native id. */
export interface Shareable {
  /** Current status, or null if the record doesn't exist in this backend. */
  shareStatus(id: string): Promise<ShareStatus | null>;
  /** Idempotent: sharing an already-shared record is a no-op.
   *  Throws StorageError('notFound') for a missing record. */
  share(id: string): Promise<ShareStatus>;
  /** Idempotent, like StorageBackend.delete. */
  unshare(id: string): Promise<void>;
}

export function isShareable(value: unknown): value is Shareable {
  const v = value as Partial<Shareable> | null;
  return (
    typeof v?.shareStatus === 'function' &&
    typeof v?.share === 'function' &&
    typeof v?.unshare === 'function'
  );
}
