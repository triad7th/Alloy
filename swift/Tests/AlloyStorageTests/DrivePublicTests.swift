import Foundation
import Testing
@testable import AlloyStorage

/// Twin of web .../drive/drive-public.spec.ts — same URL shape and mapping.
@Suite struct DrivePublicTests {
  @Test func getsAltMediaWithKeyAndReturnsPayload() async throws {
    let transport = ScriptedTransport([
      .init(matches: { _ in true }, body: #"{"v":1}"#, status: 200)
    ])
    let text = try await DrivePublic.fetchSharedFile(
      nativeRef: "d1", apiKey: "KEY-9", transport: transport)
    #expect(text == #"{"v":1}"#)
    #expect(transport.requests[0].url!.absoluteString
      == "https://www.googleapis.com/drive/v3/files/d1?alt=media&key=KEY-9")
    #expect(transport.requests[0].value(forHTTPHeaderField: "Authorization") == nil)
  }

  @Test(arguments: [(404, StorageError.Category.notFound), (403, .auth)])
  func mapsFailureStatuses(status: Int, category: StorageError.Category) async {
    let transport = ScriptedTransport([.init(matches: { _ in true }, body: "", status: status)])
    do {
      _ = try await DrivePublic.fetchSharedFile(nativeRef: "d1", apiKey: "k", transport: transport)
      Issue.record("expected throw")
    } catch let e as StorageError {
      #expect(e.category == category)
    } catch { Issue.record("wrong error type") }
  }

  @Test func wrapsTransportFailureAsUnreachable() async {
    struct Offline: HTTPTransport {
      func send(_: URLRequest) async throws -> (Data, HTTPURLResponse) {
        throw URLError(.notConnectedToInternet)
      }
    }
    do {
      _ = try await DrivePublic.fetchSharedFile(nativeRef: "d1", apiKey: "k", transport: Offline())
      Issue.record("expected throw")
    } catch let e as StorageError {
      #expect(e.category == .unreachable)
    } catch { Issue.record("wrong error type") }
  }
}
