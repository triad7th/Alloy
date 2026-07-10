import Foundation
import Testing
@testable import AlloyStorage

/// Twin of web .../backends/drive/drive-backend.spec.ts — same T1 fixture (ms),
/// same scenarios. `DriveClient` is `final`, so these tests script HTTP at the
/// `ScriptedTransport` level (reusing the fake from DriveClientTests.swift)
/// rather than faking the client surface directly.
private let T1Ms = 1_751_980_000_000.0
private let T1 = Date(timeIntervalSince1970: T1Ms / 1000)

/// A UserDefaults suite scoped to one test. `UserDefaults` isn't Sendable, so
/// every use constructs its own fresh instance against the same suite name
/// rather than sharing one instance across the actor-isolation boundary.
private func testSuite() -> (name: String, cleanup: () -> Void) {
  let name = "alloy-storage-tests-\(UUID().uuidString)"
  return (name, { UserDefaults.standard.removePersistentDomain(forName: name) })
}

/// HTTPTransport fake used by the write-ordering test: any non-POST request
/// (folder lookups, findByAlloyId) resolves immediately with an empty file
/// list; POST (createFile) requests log start/end around an artificial delay
/// keyed off which record's name appears in the multipart body, mirroring the
/// TS spec's `createFile` mock.
private final class OrderTrackingTransport: HTTPTransport, @unchecked Sendable {
  private let lock = NSLock()
  private(set) var order: [String] = []
  private func record(_ s: String) {
    lock.lock()
    order.append(s)
    lock.unlock()
  }

  func send(_ request: URLRequest) async throws -> (Data, HTTPURLResponse) {
    let response = HTTPURLResponse(
      url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!
    guard request.httpMethod == "POST",
      let bodyData = request.httpBody,
      let bodyText = String(data: bodyData, encoding: .utf8)
    else {
      return (Data(#"{"files":[]}"#.utf8), response)
    }
    let name = bodyText.contains("first.json") ? "first.json" : "second.json"
    record("start:\(name)")
    if name == "first.json" { try await Task.sleep(nanoseconds: 20_000_000) }
    record("end:\(name)")
    return (Data(#"{"id":"f"}"#.utf8), response)
  }
}

@Suite struct DriveBackendTests {
  @Test func resolvesFolderPathOnceAndCachesTheId() async throws {
    let (suite, cleanup) = testSuite()
    defer { cleanup() }
    let transport = ScriptedTransport([
      .init(
        matches: { r in
          let u = r.url!.absoluteString
          return u.contains("mimeType") && u.contains("AllyWorld") && !u.contains("App")
        }, body: #"{"files":[{"id":"pAllyWorld"}]}"#, status: 200),
      .init(
        matches: { r in
          let u = r.url!.absoluteString
          return u.contains("mimeType") && u.contains("App")
        }, body: #"{"files":[{"id":"folder1"}]}"#, status: 200),
      .init(
        matches: { r in
          let u = r.url!.absoluteString
          return u.contains("folder1") && !u.contains("mimeType")
        }, body: #"{"files":[]}"#, status: 200),
    ])
    let client = DriveClient(auth: StubAuth(token: "tok"), transport: transport)
    let backend = DriveBackend(
      client: client, folderPath: "AllyWorld/App", cache: UserDefaults(suiteName: suite))
    _ = try await backend.list()
    _ = try await backend.list()

    let folderLookups = transport.requests.filter { $0.url!.absoluteString.contains("mimeType") }
    #expect(folderLookups.count == 2)  // AllyWorld + App, resolved exactly once
    #expect(
      UserDefaults(suiteName: suite)!.string(forKey: "alloy-storage.folderId.AllyWorld/App")
        == "folder1")
  }

  @Test func reResolvesOnceWhenTheCachedFolder404s() async throws {
    let (suite, cleanup) = testSuite()
    defer { cleanup() }
    UserDefaults(suiteName: suite)!.set("stale", forKey: "alloy-storage.folderId.App")
    let transport = ScriptedTransport([
      .init(matches: { r in r.url!.absoluteString.contains("stale") }, body: "", status: 404),
      .init(
        matches: { r in
          let u = r.url!.absoluteString
          return u.contains("mimeType") && u.contains("App")
        }, body: #"{"files":[{"id":"folderNew"}]}"#, status: 200),
      .init(
        matches: { r in
          let u = r.url!.absoluteString
          return u.contains("folderNew") && !u.contains("mimeType")
        }, body: #"{"files":[]}"#, status: 200),
    ])
    let client = DriveClient(auth: StubAuth(token: "tok"), transport: transport)
    let backend = DriveBackend(client: client, folderPath: "App", cache: UserDefaults(suiteName: suite))
    let result = try await backend.list()
    #expect(result == [])

    let staleRequests = transport.requests.filter { $0.url!.absoluteString.contains("stale") }
    let resolveRequests = transport.requests.filter { $0.url!.absoluteString.contains("mimeType") }
    #expect(staleRequests.count == 1)
    #expect(resolveRequests.count == 1)  // resolveFolderPath called exactly once
  }

  @Test func mapsFilesToMetasAcceptingLegacyKeysAndSkippingForeignFiles() async throws {
    let (suite, cleanup) = testSuite()
    defer { cleanup() }
    UserDefaults(suiteName: suite)!.set("folder1", forKey: "alloy-storage.folderId.App")
    let listBody = """
      {"files":[
        {"id":"d1","name":"a.json","headRevisionId":"r1","appProperties":{"alloyId":"a","alloySavedAt":"\(Int(T1Ms))"}},
        {"id":"d2","name":"b.allyscore","appProperties":{"allyscoreId":"b","savedAt":"\(Int(T1Ms))"}},
        {"id":"d3","name":"stranger.txt"}
      ]}
      """
    let transport = ScriptedTransport([.init(matches: { _ in true }, body: listBody, status: 200)])
    let client = DriveClient(auth: StubAuth(token: "tok"), transport: transport)
    let backend = DriveBackend(client: client, folderPath: "App", cache: UserDefaults(suiteName: suite))
    let metas = try await backend.list()
    #expect(
      metas == [
        StorageRecordMeta(id: "a", name: "a.json", updatedAt: T1, revision: "r1"),
        StorageRecordMeta(id: "b", name: "b.allyscore", updatedAt: T1),
      ])
  }

  @Test func writeCreatesWhenAbsentUpdatesWhenPresentSanitizingTheFilename() async throws {
    let (suite, cleanup) = testSuite()
    defer { cleanup() }
    UserDefaults(suiteName: suite)!.set("folder1", forKey: "alloy-storage.folderId.App")

    // No existing file → createFile.
    let createTransport = ScriptedTransport([
      .init(matches: { $0.httpMethod != "POST" }, body: #"{"files":[]}"#, status: 200),
      .init(matches: { $0.httpMethod == "POST" }, body: #"{"id":"file1"}"#, status: 200),
    ])
    let createClient = DriveClient(auth: StubAuth(token: "tok"), transport: createTransport)
    let createBackend = DriveBackend(
      client: createClient, folderPath: "App", cache: UserDefaults(suiteName: suite))
    _ = try await createBackend.write(
      StorageRecord(id: "a", name: "bad/name.json", updatedAt: T1, payload: "p"))
    let createPost = createTransport.requests.first { $0.httpMethod == "POST" }!
    let createBody = String(data: createPost.httpBody!, encoding: .utf8)!
    #expect(createPost.url!.absoluteString.contains("uploadType=multipart"))
    #expect(createBody.contains(#""name":"bad-name.json""#))
    #expect(createBody.contains(#""parents":["folder1"]"#))
    #expect(createBody.contains(#""alloyId":"a""#))
    #expect(createBody.contains(#""alloySavedAt":"\#(Int(T1Ms))""#))
    #expect(createBody.contains("\r\np\r\n--alloy-storage-multipart--"))

    // Existing file → updateFile.
    let (suite2, cleanup2) = testSuite()
    defer { cleanup2() }
    UserDefaults(suiteName: suite2)!.set("folder1", forKey: "alloy-storage.folderId.App")
    let updateTransport = ScriptedTransport([
      .init(
        matches: { $0.httpMethod != "PATCH" },
        body: #"{"files":[{"id":"d1","name":"a.json","appProperties":{"alloyId":"a"}}]}"#,
        status: 200),
      .init(matches: { $0.httpMethod == "PATCH" }, body: #"{"id":"d1"}"#, status: 200),
    ])
    let updateClient = DriveClient(auth: StubAuth(token: "tok"), transport: updateTransport)
    let updateBackend = DriveBackend(
      client: updateClient, folderPath: "App", cache: UserDefaults(suiteName: suite2))
    _ = try await updateBackend.write(
      StorageRecord(id: "a", name: "a.json", updatedAt: T1, payload: "p2"))
    let patch = updateTransport.requests.first { $0.httpMethod == "PATCH" }!
    #expect(patch.url!.absoluteString.contains("/files/d1"))
    let patchBody = String(data: patch.httpBody!, encoding: .utf8)!
    #expect(patchBody.contains(#""name":"a.json""#))
    #expect(patchBody.contains(#""alloyId":"a""#))
    #expect(patchBody.contains(#""alloySavedAt":"\#(Int(T1Ms))""#))
    #expect(patchBody.contains("\r\np2\r\n--alloy-storage-multipart--"))
  }

  @Test func readReturnsNilOnMissDeleteIsIdempotent() async throws {
    let (suite, cleanup) = testSuite()
    defer { cleanup() }
    UserDefaults(suiteName: suite)!.set("folder1", forKey: "alloy-storage.folderId.App")
    let transport = ScriptedTransport([.init(matches: { _ in true }, body: #"{"files":[]}"#, status: 200)])
    let client = DriveClient(auth: StubAuth(token: "tok"), transport: transport)
    let backend = DriveBackend(client: client, folderPath: "App", cache: UserDefaults(suiteName: suite))
    #expect(try await backend.read(id: "missing") == nil)
    try await backend.delete(id: "missing")  // no throw
  }

  @Test func serializesWritesPerId() async throws {
    let (suite, cleanup) = testSuite()
    defer { cleanup() }
    UserDefaults(suiteName: suite)!.set("folder1", forKey: "alloy-storage.folderId.App")
    let transport = OrderTrackingTransport()
    let client = DriveClient(auth: StubAuth(token: "tok"), transport: transport)
    let backend = DriveBackend(client: client, folderPath: "App", cache: UserDefaults(suiteName: suite))

    async let first: StorageRecordMeta = backend.write(
      StorageRecord(id: "a", name: "first.json", updatedAt: T1, payload: "1"))
    // Chain registration for "first" happens-before its HTTP call (both run
    // inside the same actor-isolated synchronous prologue), so waiting for
    // the transport to log anything guarantees "first" has already joined
    // the per-id write chain before "second" is dispatched. Without this
    // barrier, two independently-scheduled async-let child tasks are not
    // guaranteed to enter the actor in declaration order.
    while transport.order.isEmpty { try await Task.sleep(nanoseconds: 1_000_000) }
    async let second: StorageRecordMeta = backend.write(
      StorageRecord(id: "a", name: "second.json", updatedAt: T1, payload: "2"))
    _ = try await (first, second)

    #expect(transport.order == ["start:first.json", "end:first.json", "start:second.json", "end:second.json"])
  }
}
