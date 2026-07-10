import Foundation

/// Local replica backend on the file system: one JSON file per record under
/// `<directory>/<collection>/`. Default directory is Application Support.
public actor LocalStorageBackend: StorageBackend {
  private struct Stored: Codable {
    let id: String
    let name: String
    let updatedAtMs: Double
    let revision: String?
    let payload: String
  }

  private let folder: URL

  public init(collection: String, directory: URL? = nil) {
    let base = directory
      ?? FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        .appendingPathComponent(Bundle.main.bundleIdentifier ?? "Alloy")
    self.folder = base.appendingPathComponent(collection, isDirectory: true)
  }

  private func fileURL(for id: String) -> URL {
    // Percent-encode so any id is a safe single-component filename.
    let safe = id.addingPercentEncoding(withAllowedCharacters: .alphanumerics) ?? id
    return folder.appendingPathComponent("\(safe).json")
  }

  private func ensureFolder() throws {
    try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
  }

  private func decode(_ url: URL) throws -> StorageRecord {
    let stored = try JSONDecoder().decode(Stored.self, from: Data(contentsOf: url))
    return StorageRecord(
      id: stored.id,
      name: stored.name,
      updatedAt: Date(timeIntervalSince1970: stored.updatedAtMs / 1000),
      revision: stored.revision,
      payload: stored.payload
    )
  }

  public func list() async throws -> [StorageRecordMeta] {
    guard FileManager.default.fileExists(atPath: folder.path) else { return [] }
    let files = try FileManager.default.contentsOfDirectory(at: folder, includingPropertiesForKeys: nil)
    return try files.filter { $0.pathExtension == "json" }.map { try decode($0).meta }
  }

  public func read(id: String) async throws -> StorageRecord? {
    let url = fileURL(for: id)
    guard FileManager.default.fileExists(atPath: url.path) else { return nil }
    return try decode(url)
  }

  @discardableResult
  public func write(_ record: StorageRecord) async throws -> StorageRecordMeta {
    try ensureFolder()
    let stored = Stored(
      id: record.id,
      name: record.name,
      updatedAtMs: record.updatedAt.timeIntervalSince1970 * 1000,
      revision: record.revision,
      payload: record.payload
    )
    try JSONEncoder().encode(stored).write(to: fileURL(for: record.id), options: .atomic)
    return record.meta
  }

  public func delete(id: String) async throws {
    let url = fileURL(for: id)
    guard FileManager.default.fileExists(atPath: url.path) else { return }
    try FileManager.default.removeItem(at: url)
  }
}
