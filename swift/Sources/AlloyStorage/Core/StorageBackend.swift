/// One flat collection of documents (a folder / object store). Hierarchy is
/// backend configuration, never part of this protocol.
public protocol StorageBackend: Sendable {
  /// Metadata only — implementations must not download payloads here.
  func list() async throws -> [StorageRecordMeta]
  /// nil on missing id (never throws for a miss).
  func read(id: String) async throws -> StorageRecord?
  /// Create or replace; returns the stored metadata (with backend revision, if any).
  @discardableResult
  func write(_ record: StorageRecord) async throws -> StorageRecordMeta
  /// Idempotent: deleting an absent id succeeds.
  func delete(id: String) async throws
}
