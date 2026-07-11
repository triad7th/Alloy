import Foundation

private let cachePrefix = "alloy-storage.folderId."

/// Map one Drive file's metadata to a StorageRecordMeta, accepting the legacy
/// AllyScore keys (`allyscoreId`/`savedAt`) and skipping files that carry
/// neither — a foreign file sharing the folder. Twin of TS `toMeta`.
private func toMeta(_ file: DriveFileMeta) -> StorageRecordMeta? {
  let props = file.appProperties ?? [:]
  guard let id = props["alloyId"] ?? props["allyscoreId"], !id.isEmpty else { return nil }
  let updatedAtMs = Double(props["alloySavedAt"] ?? props["savedAt"] ?? "0") ?? 0
  return StorageRecordMeta(
    id: id, name: file.name,
    updatedAt: Date(timeIntervalSince1970: updatedAtMs / 1000),
    revision: file.headRevisionId
  )
}

/// StorageBackend on the user's own Google Drive (drive.file scope), scoped to
/// one folder path. Folder id caching + 404 re-resolve and per-id write
/// chains are ported from AllyScore's DriveScoreStore, via TS DriveBackend.
///
/// Implemented as an actor (the concurrency-safety precedent set by
/// LocalStorageBackend) rather than TS's class + bare Promise fields: the
/// folder-id memo, in-flight resolve, and per-id write chains are all mutable
/// state shared across concurrent calls, and an actor gives that isolation
/// for free instead of hand-rolled locking.
public actor DriveBackend: StorageBackend {
  private let client: DriveClient
  private let folderPath: String
  // UserDefaults is thread-safe in practice but Foundation marks its Sendable
  // conformance unavailable in Swift 6 mode; opt this stored property out of
  // actor-isolation checking rather than fight that upstream annotation.
  private nonisolated(unsafe) let cache: UserDefaults?

  private var folderId: String?
  /// In-flight folder resolution: the actor twin of TS's `folderPromise`.
  private var folderTask: Task<String, Error>?
  /// Per-id write chains: a later write always lands after the earlier one
  /// for the same id, and an earlier write's failure must not fail the later
  /// write (mirrors TS `writeChains` + `.catch(() => undefined)`).
  private var writeChains: [String: Task<StorageRecordMeta, Error>] = [:]

  public init(client: DriveClient, folderPath: String, cache: UserDefaults? = .standard) {
    self.client = client
    self.folderPath = folderPath
    self.cache = cache
  }

  private var cacheKey: String { cachePrefix + folderPath }

  private func ensureFolder() async throws -> String {
    if let folderId { return folderId }
    if let existing = folderTask {
      return try await existing.value
    }
    // Clearing happens inside the task closure so it settles exactly once,
    // when the task itself resolves — mirroring TS's `.finally`. A per-awaiter
    // `defer` here would instead run once per awaiter: actor reentrancy lets a
    // late awaiter of a FAILED task null out a NEWER in-flight task, letting
    // two callers both think no resolution is in flight and both re-resolve.
    let task = Task<String, Error> {
      defer { self.folderTask = nil }
      return try await self.resolveFolder()
    }
    folderTask = task
    return try await task.value
  }

  private func resolveFolder() async throws -> String {
    if let cached = cache?.string(forKey: cacheKey), !cached.isEmpty {
      folderId = cached
      return cached
    }
    let id = try await client.resolveFolderPath(folderPath)
    folderId = id
    cache?.set(id, forKey: cacheKey)
    return id
  }

  private func withFolder<T>(_ fn: (String) async throws -> T) async throws -> T {
    let id = try await ensureFolder()
    do {
      return try await fn(id)
    } catch let error as StorageError where error.status == 404 {
      // The cached folder was deleted/moved out of reach: re-resolve once.
      folderId = nil
      cache?.removeObject(forKey: cacheKey)
      return try await fn(try await ensureFolder())
    }
  }

  public func list() async throws -> [StorageRecordMeta] {
    try await withFolder { folderId in
      let files = try await self.client.listFiles(folderId: folderId)
      return files.compactMap(toMeta)
    }
  }

  public func read(id: String) async throws -> StorageRecord? {
    try await withFolder { folderId in
      guard let file = try await self.client.findByAlloyId(folderId: folderId, id: id) else {
        return nil
      }
      guard let meta = toMeta(file) else { return nil }
      let payload = try await self.client.downloadFile(fileId: file.id)
      return StorageRecord(
        id: meta.id, name: meta.name, updatedAt: meta.updatedAt, revision: meta.revision,
        payload: payload)
    }
  }

  @discardableResult
  public func write(_ record: StorageRecord) async throws -> StorageRecordMeta {
    let previous = writeChains[record.id]
    let next = Task<StorageRecordMeta, Error> {
      if let previous { _ = try? await previous.value }
      return try await self.writeOnce(record)
    }
    writeChains[record.id] = next
    return try await next.value
  }

  private func writeOnce(_ record: StorageRecord) async throws -> StorageRecordMeta {
    try await withFolder { folderId in
      let name = record.name.replacingOccurrences(
        of: #"[\\/:*?"<>|]"#, with: "-", options: .regularExpression)
      let updatedAtMs = Int(record.updatedAt.timeIntervalSince1970 * 1000)
      let props = ["alloyId": record.id, "alloySavedAt": String(updatedAtMs)]
      if let existing = try await self.client.findByAlloyId(folderId: folderId, id: record.id) {
        try await self.client.updateFile(
          fileId: existing.id, content: record.payload, appProperties: props, name: name)
      } else {
        _ = try await self.client.createFile(
          folderId: folderId, name: name, appProperties: props, content: record.payload)
      }
      return StorageRecordMeta(id: record.id, name: name, updatedAt: record.updatedAt)
    }
  }

  public func delete(id: String) async throws {
    try await withFolder { folderId in
      if let file = try await self.client.findByAlloyId(folderId: folderId, id: id) {
        try await self.client.deleteFile(fileId: file.id)
      }
    }
  }
}

/// Twin of TS `DriveBackend implements Shareable`.
extension DriveBackend: Shareable {
  public func shareStatus(id: String) async throws -> ShareStatus? {
    try await withFolder { folderId in
      guard let file = try await self.client.findByAlloyId(folderId: folderId, id: id) else {
        return nil
      }
      return ShareStatus(
        shared: try await self.client.hasPublicPermission(fileId: file.id), nativeRef: file.id)
    }
  }

  @discardableResult
  public func share(id: String) async throws -> ShareStatus {
    try await withFolder { folderId in
      guard let file = try await self.client.findByAlloyId(folderId: folderId, id: id) else {
        throw StorageError(category: .notFound, message: "no record '\(id)' to share")
      }
      if try await !self.client.hasPublicPermission(fileId: file.id) {
        try await self.client.createPublicPermission(fileId: file.id)
      }
      return ShareStatus(shared: true, nativeRef: file.id)
    }
  }

  public func unshare(id: String) async throws {
    try await withFolder { folderId in
      guard let file = try await self.client.findByAlloyId(folderId: folderId, id: id) else {
        return
      }
      try await self.client.deletePublicPermission(fileId: file.id)
    }
  }
}
