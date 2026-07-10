export type StorageErrorCategory = 'auth' | 'notFound' | 'conflict' | 'unreachable' | 'quota';

/** The one error type backends throw. Apps and the sync engine react to
 *  `category`, never to raw HTTP codes. */
export class StorageError extends Error {
  constructor(
    readonly category: StorageErrorCategory,
    message: string,
    readonly status?: number
  ) {
    super(message);
    this.name = 'StorageError';
  }

  static fromHttpStatus(status: number, message?: string): StorageError {
    const category: StorageErrorCategory =
      status === 401 || status === 403
        ? 'auth'
        : status === 404
          ? 'notFound'
          : status === 409 || status === 412
            ? 'conflict'
            : status === 429
              ? 'quota'
              : 'unreachable';
    return new StorageError(category, message ?? `HTTP ${status}`, status);
  }
}
