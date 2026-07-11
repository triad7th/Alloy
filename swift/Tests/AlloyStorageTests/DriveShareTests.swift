import Foundation
import Testing
@testable import AlloyStorage

/// Twin of web .../drive/drive-share.spec.ts + the drive-client permission
/// wire tests — same scenarios at the transport level.
@Suite struct DriveShareTests {
  private let fileHit =
    #"{"files":[{"id":"d1","name":"a.json","appProperties":{"alloyId":"a"}}]}"#
  private let fileMiss = #"{"files":[]}"#

  private func backend(_ entries: [ScriptedTransport.Entry]) -> (DriveBackend, ScriptedTransport) {
    let transport = ScriptedTransport(entries)
    let client = DriveClient(auth: StubAuth(token: "tok"), transport: transport)
    let suite = UserDefaults(suiteName: "alloy-share-tests-\(UUID().uuidString)")
    suite?.set("folder1", forKey: "alloy-storage.folderId.App")
    return (DriveBackend(client: client, folderPath: "App", cache: suite), transport)
  }

  @Test func localBackendIsNotShareable() {
    let dir = FileManager.default.temporaryDirectory
      .appendingPathComponent("share-\(UUID().uuidString)")
    let local: any StorageBackend = LocalStorageBackend(collection: "t", directory: dir)
    #expect(local as? any Shareable == nil)
    let (drive, _) = backend([])
    #expect((drive as any StorageBackend) as? any Shareable != nil)
  }

  @Test func shareStatusNilForMissingRecord() async throws {
    let (b, _) = backend([
      .init(matches: { $0.url!.absoluteString.contains("files?q=") }, body: fileMiss, status: 200)
    ])
    #expect(try await b.shareStatus(id: "missing") == nil)
  }

  @Test func shareStatusReportsSharedWithNativeRef() async throws {
    let (b, transport) = backend([
      .init(matches: { $0.url!.absoluteString.contains("files?q=") }, body: fileHit, status: 200),
      .init(matches: { $0.url!.absoluteString.contains("/permissions?fields=") },
            body: #"{"permissions":[{"id":"p2","type":"anyone"}]}"#, status: 200),
    ])
    #expect(try await b.shareStatus(id: "a") == ShareStatus(shared: true, nativeRef: "d1"))
    let permURL = transport.requests.last!.url!.absoluteString
    #expect(permURL.contains("/files/d1/permissions?fields=permissions(id,type)"))
  }

  @Test func shareOnMissingRecordThrowsNotFound() async {
    let (b, _) = backend([
      .init(matches: { $0.url!.absoluteString.contains("files?q=") }, body: fileMiss, status: 200)
    ])
    do {
      _ = try await b.share(id: "missing")
      Issue.record("expected notFound")
    } catch let e as StorageError {
      #expect(e.category == .notFound)
    } catch { Issue.record("wrong error type") }
  }

  @Test func shareCreatesOnceAndIsIdempotent() async throws {
    let (b, transport) = backend([
      .init(matches: { $0.url!.absoluteString.contains("files?q=") }, body: fileHit, status: 200),
      .init(matches: { $0.url!.absoluteString.contains("?fields=") },
            body: #"{"permissions":[]}"#, status: 200),
      .init(matches: { $0.httpMethod == "POST" && $0.url!.absoluteString.hasSuffix("/files/d1/permissions") },
            body: "{}", status: 200),
    ])
    #expect(try await b.share(id: "a") == ShareStatus(shared: true, nativeRef: "d1"))
    let post = transport.requests.last!
    #expect(post.httpMethod == "POST")
    let body = String(data: post.httpBody!, encoding: .utf8)!
    #expect(body.contains(#""role":"reader""#) && body.contains(#""type":"anyone""#))

    let (b2, transport2) = backend([
      .init(matches: { $0.url!.absoluteString.contains("files?q=") }, body: fileHit, status: 200),
      .init(matches: { $0.url!.absoluteString.contains("?fields=") },
            body: #"{"permissions":[{"id":"p2","type":"anyone"}]}"#, status: 200),
    ])
    #expect(try await b2.share(id: "a") == ShareStatus(shared: true, nativeRef: "d1"))
    #expect(!transport2.requests.contains { $0.httpMethod == "POST" && $0.url!.absoluteString.contains("/permissions") })
  }

  @Test func unshareDeletesAnyonePermissionOrNoOps() async throws {
    let (b, transport) = backend([
      .init(matches: { $0.url!.absoluteString.contains("files?q=") }, body: fileHit, status: 200),
      .init(matches: { $0.url!.absoluteString.contains("?fields=") },
            body: #"{"permissions":[{"id":"p2","type":"anyone"}]}"#, status: 200),
      .init(matches: { $0.httpMethod == "DELETE" }, body: "", status: 200),
    ])
    try await b.unshare(id: "a")
    let del = transport.requests.last!
    #expect(del.httpMethod == "DELETE")
    #expect(del.url!.absoluteString.hasSuffix("/files/d1/permissions/p2"))

    let (b2, transport2) = backend([
      .init(matches: { $0.url!.absoluteString.contains("files?q=") }, body: fileHit, status: 200),
      .init(matches: { $0.url!.absoluteString.contains("?fields=") },
            body: #"{"permissions":[{"id":"p1","type":"user"}]}"#, status: 200),
    ])
    try await b2.unshare(id: "a") // no anyone permission → no DELETE
    #expect(!transport2.requests.contains { $0.httpMethod == "DELETE" })
  }
}
