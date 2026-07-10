import Foundation
#if canImport(FoundationNetworking)
  import FoundationNetworking
#endif

/// Injected HTTP seam — the Swift mirror of DriveClient's injected fetch.
public protocol HTTPTransport: Sendable {
  func send(_ request: URLRequest) async throws -> (Data, HTTPURLResponse)
}

public struct URLSessionTransport: HTTPTransport {
  private let session: URLSession
  public init(session: URLSession = .shared) { self.session = session }

  public func send(_ request: URLRequest) async throws -> (Data, HTTPURLResponse) {
    let (data, response) = try await session.data(for: request)
    guard let http = response as? HTTPURLResponse else {
      throw StorageError(category: .unreachable, message: "non-HTTP response")
    }
    return (data, http)
  }
}
