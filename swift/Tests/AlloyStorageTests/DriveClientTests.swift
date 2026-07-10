import Foundation
import Testing
@testable import AlloyStorage

struct StubAuth: AuthProvider {
  let token: String?
  var state: AuthState { token == nil ? .signedOut : .signedIn }
  func accessToken() async -> String? { token }
}

/// Scripted HTTP fake: each entry matches on URL substring (+ optional method).
final class ScriptedTransport: HTTPTransport, @unchecked Sendable {
  struct Entry { let matches: (URLRequest) -> Bool; let body: String; let status: Int }
  var entries: [Entry]
  var requests: [URLRequest] = []
  init(_ entries: [Entry]) { self.entries = entries }

  func send(_ request: URLRequest) async throws -> (Data, HTTPURLResponse) {
    requests.append(request)
    guard let entry = entries.first(where: { $0.matches(request) }) else {
      throw StorageError(category: .unreachable, message: "unscripted: \(request.url!)")
    }
    let response = HTTPURLResponse(
      url: request.url!, statusCode: entry.status, httpVersion: nil, headerFields: nil)!
    return (Data(entry.body.utf8), response)
  }
}

@Suite struct DriveClientTests {
  @Test func throwsAuthWhenSignedOut() async {
    let client = DriveClient(auth: StubAuth(token: nil), transport: ScriptedTransport([]))
    await #expect(throws: StorageError.self) { try await client.listFiles(folderId: "f1") }
    do { _ = try await client.listFiles(folderId: "f1") }
    catch let e as StorageError { #expect(e.category == .auth && e.status == 401) }
    catch { Issue.record("wrong error type") }
  }

  @Test func mapsNonOKThroughFromHTTPStatus() async {
    let transport = ScriptedTransport([.init(matches: { _ in true }, body: "", status: 429)])
    let client = DriveClient(auth: StubAuth(token: "tok"), transport: transport)
    do { _ = try await client.listFiles(folderId: "f1") }
    catch let e as StorageError { #expect(e.category == .quota) }
    catch { Issue.record("wrong error type") }
  }

  @Test func resolveFolderPathFindOrCreatesEachSegment() async throws {
    let transport = ScriptedTransport([
      .init(matches: { r in
        let u = r.url!.absoluteString
        return u.contains("files?q=") && u.contains("AllyWorld") && !u.contains("AllyClock")
      }, body: #"{"files":[{"id":"p1"}]}"#, status: 200),
      .init(matches: { r in r.url!.absoluteString.contains("AllyClock") && r.httpMethod != "POST" },
            body: #"{"files":[]}"#, status: 200),
      .init(matches: { r in r.httpMethod == "POST" }, body: #"{"id":"c1"}"#, status: 200),
    ])
    let client = DriveClient(auth: StubAuth(token: "tok"), transport: transport)
    let id = try await client.resolveFolderPath("AllyWorld/AllyClock")
    #expect(id == "c1")
    let post = transport.requests.first { $0.httpMethod == "POST" }
    let body = String(data: post!.httpBody!, encoding: .utf8)!
    #expect(body.contains(#""parents":["p1"]"#) && body.contains(#""name":"AllyClock""#))
  }

  @Test func listFilesRequestsMetadataFieldsOnly() async throws {
    let transport = ScriptedTransport([
      .init(matches: { _ in true }, body: #"{"files":[{"id":"x","name":"a.json"}]}"#, status: 200)
    ])
    let client = DriveClient(auth: StubAuth(token: "tok"), transport: transport)
    _ = try await client.listFiles(folderId: "f1")
    let url = transport.requests[0].url!.absoluteString
    #expect(url.contains("fields=files(id,name,appProperties,headRevisionId)"))
    #expect(!url.contains("alt=media"))
  }

  @Test func findByAlloyIdMatchesBothKeys() async throws {
    let transport = ScriptedTransport([
      .init(matches: { _ in true }, body: #"{"files":[{"id":"x","name":"a"}]}"#, status: 200)
    ])
    let client = DriveClient(auth: StubAuth(token: "tok"), transport: transport)
    _ = try await client.findByAlloyId(folderId: "f1", id: "id9")
    let q = transport.requests[0].url!.absoluteString.removingPercentEncoding!
    #expect(q.contains("key='alloyId' and value='id9'"))
    #expect(q.contains("key='allyscoreId' and value='id9'"))
    #expect(q.contains(" or "))
  }

  @Test func encodesNonASCIIQueryCharactersLikeEncodeURIComponent() async throws {
    let transport = ScriptedTransport([
      .init(matches: { _ in true }, body: #"{"files":[{"id":"f1"}]}"#, status: 200)
    ])
    let client = DriveClient(auth: StubAuth(token: "tok"), transport: transport)
    _ = try await client.resolveFolderPath("café")
    let url = transport.requests[0].url!.absoluteString
    // The exact bytes TS encodeURIComponent produces: only ASCII
    // A-Za-z0-9 -_.!~*'() pass through unencoded, so é → %C3%A9.
    #expect(url.contains("caf%C3%A9"))
  }
}
