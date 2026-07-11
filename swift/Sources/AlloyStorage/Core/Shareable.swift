/// Result of a share query/operation.
public struct ShareStatus: Sendable, Equatable {
  public let shared: Bool
  /// Backend-native handle apps embed in share links (Drive: the file id).
  /// The one sanctioned backend leak — link URL format is app policy.
  public let nativeRef: String

  public init(shared: Bool, nativeRef: String) {
    self.shared = shared
    self.nativeRef = nativeRef
  }
}

/// Optional capability: backends that can share a record via a public link.
/// Local backends deliberately do not conform. All methods take the app's
/// record id, never a backend-native id. Check with `backend as? any Shareable`.
public protocol Shareable: Sendable {
  /// Current status, or nil if the record doesn't exist in this backend.
  func shareStatus(id: String) async throws -> ShareStatus?
  /// Idempotent: sharing an already-shared record is a no-op.
  /// Throws StorageError(.notFound) for a missing record.
  @discardableResult
  func share(id: String) async throws -> ShareStatus
  /// Idempotent, like StorageBackend.delete.
  func unshare(id: String) async throws
}
