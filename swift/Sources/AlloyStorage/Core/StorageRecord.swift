import Foundation

/// Metadata for one stored document — everything list() returns; no payload.
public struct StorageRecordMeta: Sendable, Equatable {
  /// App-assigned stable identity (survives renames).
  public let id: String
  /// Human-visible filename, e.g. "settings.json".
  public let name: String
  /// Last modification. Drives last-write-wins in the sync engine.
  public let updatedAt: Date
  /// Backend-native version marker, when the backend has one.
  public let revision: String?
  /// Creation time, when known: Drive reports its own `createdTime` (and
  /// ignores one handed to write); local replicas store whatever write was
  /// given. nil = unknown — never a fabricated epoch.
  public let createdAt: Date?

  public init(
    id: String, name: String, updatedAt: Date, revision: String? = nil, createdAt: Date? = nil
  ) {
    self.id = id
    self.name = name
    self.updatedAt = updatedAt
    self.revision = revision
    self.createdAt = createdAt
  }
}

/// A stored document: metadata plus its whole-document payload.
public struct StorageRecord: Sendable, Equatable {
  public let id: String
  public let name: String
  public let updatedAt: Date
  public let revision: String?
  public let createdAt: Date?
  public let payload: String

  public init(
    id: String, name: String, updatedAt: Date, revision: String? = nil, createdAt: Date? = nil,
    payload: String
  ) {
    self.id = id
    self.name = name
    self.updatedAt = updatedAt
    self.revision = revision
    self.createdAt = createdAt
    self.payload = payload
  }

  public var meta: StorageRecordMeta {
    StorageRecordMeta(
      id: id, name: name, updatedAt: updatedAt, revision: revision, createdAt: createdAt)
  }
}
