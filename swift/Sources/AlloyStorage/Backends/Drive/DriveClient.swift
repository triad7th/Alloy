import Foundation

private let api = "https://www.googleapis.com/drive/v3"
private let upload = "https://www.googleapis.com/upload/drive/v3"
private let folderMime = "application/vnd.google-apps.folder"
private let boundary = "alloy-storage-multipart"

public struct DriveFileMeta: Sendable, Equatable, Decodable {
  public let id: String
  public let name: String
  public let headRevisionId: String?
  public let appProperties: [String: String]?
}

/// Full-metadata file lists (listFiles / findByAlloyId): requires `name`.
private struct FileList: Decodable { let files: [DriveFileMeta]? }
/// id-only response shape, used by findFolder (`fields=files(id)`).
private struct FolderIdEntry: Decodable { let id: String }
private struct FolderIdList: Decodable { let files: [FolderIdEntry]? }
private struct IdOnly: Decodable { let id: String }

/// Thin typed wrapper over the handful of Drive v3 calls AllyScore uses.
/// All requests carry the bearer token from `auth`; non-2xx → StorageError.
/// Twin of web .../backends/drive/drive-client.ts.
public final class DriveClient: Sendable {
  private let auth: any AuthProvider
  private let transport: any HTTPTransport

  public init(auth: any AuthProvider, transport: any HTTPTransport = URLSessionTransport()) {
    self.auth = auth
    self.transport = transport
  }

  private func call(
    _ urlString: String, method: String = "GET",
    headers: [String: String] = [:], body: Data? = nil
  ) async throws -> Data {
    guard let token = await auth.accessToken() else {
      throw StorageError.fromHTTPStatus(401, message: "Not signed in")
    }
    var request = URLRequest(url: URL(string: urlString)!)
    request.httpMethod = method
    request.httpBody = body
    for (k, v) in headers { request.setValue(v, forHTTPHeaderField: k) }
    request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
    let data: Data
    let response: HTTPURLResponse
    do {
      (data, response) = try await transport.send(request)
    } catch let error as StorageError {
      throw error
    } catch {
      throw StorageError(category: .unreachable, message: String(describing: error))
    }
    guard (200..<300).contains(response.statusCode) else {
      throw StorageError.fromHTTPStatus(response.statusCode)
    }
    return data
  }

  /// The exact unreserved set of JS encodeURIComponent: ASCII alphanumerics
  /// plus -_.!~*'() — CharacterSet.alphanumerics would wrongly pass Unicode
  /// letters/digits (é, CJK, Cyrillic) through unencoded.
  private static let queryAllowed = CharacterSet(
    charactersIn: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_.!~*'()")

  /// Percent-encode a Drive query, quotes included (twin of TS encodeQuery:
  /// encodeURIComponent leaves ' unencoded, then one pass replaces it — %27
  /// is always wire-valid).
  private func encodeQuery(_ raw: String) -> String {
    raw.addingPercentEncoding(withAllowedCharacters: Self.queryAllowed)!
      .replacingOccurrences(of: "'", with: "%27")
  }

  /// Escape a value interpolated into a Drive `q` string literal: backslash
  /// first (so the escaping backslash itself isn't re-escaped), then quote.
  /// Twin of TS escapeQueryValue.
  private func escapeQueryValue(_ raw: String) -> String {
    raw.replacingOccurrences(of: "\\", with: "\\\\")
      .replacingOccurrences(of: "'", with: "\\'")
  }

  private func multipart(meta: [String: Any], content: String) -> (
    headers: [String: String], body: Data
  ) {
    let metaJson = try! JSONSerialization.data(withJSONObject: meta)
    let body =
      "--\(boundary)\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n"
      + String(data: metaJson, encoding: .utf8)!
      + "\r\n--\(boundary)\r\nContent-Type: application/json\r\n\r\n"
      + "\(content)\r\n--\(boundary)--"
    return (["Content-Type": "multipart/related; boundary=\(boundary)"], Data(body.utf8))
  }

  private func jsonBody(_ dict: [String: Any]) -> Data {
    try! JSONSerialization.data(withJSONObject: dict)
  }

  private func findFolder(name: String, parentId: String?) async throws -> String? {
    let parent = parentId.map { " and '\($0)' in parents" } ?? ""
    let q = encodeQuery(
      "name='\(escapeQueryValue(name))' and mimeType='\(folderMime)' and trashed=false\(parent)")
    let data = try await call("\(api)/files?q=\(q)&fields=files(id)")
    return try JSONDecoder().decode(FolderIdList.self, from: data).files?.first?.id
  }

  private func createFolder(name: String, parentId: String?) async throws -> String {
    var meta: [String: Any] = ["name": name, "mimeType": folderMime]
    if let parentId { meta["parents"] = [parentId] }
    let data = try await call(
      "\(api)/files?fields=id", method: "POST",
      headers: ["Content-Type": "application/json"], body: jsonBody(meta))
    return try JSONDecoder().decode(IdOnly.self, from: data).id
  }

  /// Find-or-create every segment of "A/B/C"; returns the leaf folder id.
  public func resolveFolderPath(_ path: String) async throws -> String {
    var parentId: String?
    for segment in path.split(separator: "/", omittingEmptySubsequences: true) {
      let name = String(segment)
      if let found = try await findFolder(name: name, parentId: parentId) {
        parentId = found
      } else {
        parentId = try await createFolder(name: name, parentId: parentId)
      }
    }
    guard let result = parentId else {
      throw StorageError(category: .notFound, message: "empty folder path: '\(path)'")
    }
    return result
  }

  public func listFiles(folderId: String) async throws -> [DriveFileMeta] {
    let q = encodeQuery("'\(folderId)' in parents and trashed=false")
    let data = try await call(
      "\(api)/files?q=\(q)&fields=files(id,name,appProperties,headRevisionId)&pageSize=1000")
    return try JSONDecoder().decode(FileList.self, from: data).files ?? []
  }

  public func findByAlloyId(folderId: String, id: String) async throws -> DriveFileMeta? {
    let escapedId = escapeQueryValue(id)
    let q = encodeQuery(
      "'\(folderId)' in parents and trashed=false and "
        + "(appProperties has { key='alloyId' and value='\(escapedId)' } or "
        + "appProperties has { key='allyscoreId' and value='\(escapedId)' })")
    let data = try await call(
      "\(api)/files?q=\(q)&fields=files(id,name,appProperties,headRevisionId)")
    return try JSONDecoder().decode(FileList.self, from: data).files?.first
  }

  public func createFile(
    folderId: String, name: String, appProperties: [String: String], content: String
  ) async throws -> String {
    let (headers, body) = multipart(
      meta: ["name": name, "parents": [folderId], "appProperties": appProperties], content: content)
    let data = try await call(
      "\(upload)/files?uploadType=multipart&fields=id", method: "POST", headers: headers, body: body)
    return try JSONDecoder().decode(IdOnly.self, from: data).id
  }

  public func updateFile(
    fileId: String, content: String, appProperties: [String: String], name: String
  ) async throws {
    let (headers, body) = multipart(meta: ["name": name, "appProperties": appProperties], content: content)
    _ = try await call(
      "\(upload)/files/\(fileId)?uploadType=multipart&fields=id", method: "PATCH", headers: headers,
      body: body)
  }

  public func downloadFile(fileId: String) async throws -> String {
    let data = try await call("\(api)/files/\(fileId)?alt=media")
    // Lenient decode (U+FFFD for invalid bytes) — parity with TS res.text(),
    // which never throws and never drops content.
    return String(decoding: data, as: UTF8.self)
  }

  public func deleteFile(fileId: String) async throws {
    _ = try await call("\(api)/files/\(fileId)", method: "DELETE")
  }

  /// Shareable mechanism — internal on purpose; not part of the public surface.
  /// Twin of TS DriveClient.createPublicPermission.
  func createPublicPermission(fileId: String) async throws {
    let body = try! JSONSerialization.data(withJSONObject: ["role": "reader", "type": "anyone"])
    _ = try await call(
      "\(api)/files/\(fileId)/permissions", method: "POST",
      headers: ["Content-Type": "application/json"], body: body)
  }

  private struct PermissionList: Decodable {
    struct Permission: Decodable {
      let id: String
      let type: String
    }
    let permissions: [Permission]?
  }

  private func anyonePermissionId(fileId: String) async throws -> String? {
    let data = try await call("\(api)/files/\(fileId)/permissions?fields=permissions(id,type)")
    let list = try JSONDecoder().decode(PermissionList.self, from: data)
    return list.permissions?.first { $0.type == "anyone" }?.id
  }

  /// Twin of TS DriveClient.hasPublicPermission.
  func hasPublicPermission(fileId: String) async throws -> Bool {
    try await anyonePermissionId(fileId: fileId) != nil
  }

  /// Twin of TS DriveClient.deletePublicPermission.
  func deletePublicPermission(fileId: String) async throws {
    guard let id = try await anyonePermissionId(fileId: fileId) else { return }
    _ = try await call("\(api)/files/\(fileId)/permissions/\(id)", method: "DELETE")
  }
}
