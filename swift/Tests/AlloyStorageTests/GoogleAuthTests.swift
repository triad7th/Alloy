import Foundation
import Testing
@testable import AlloyStorage

private let nowFixed = Date(timeIntervalSince1970: 1_751_980_000) // twin NOW = 1751980000000 ms

private func makeAuth(
  stored: StoredTokens? = nil,
  transport: ScriptedTransport = ScriptedTransport([]),
  uiSession: (any AuthUISession)? = nil
) -> (GoogleAuth, MemoryTokenVault) {
  let vault = MemoryTokenVault()
  if let stored { try! vault.save(stored) }
  let config = GoogleAuthConfig(
    clientId: "cid", scope: "https://www.googleapis.com/auth/drive.file",
    redirectScheme: "com.example.app")
  return (GoogleAuth(config: config, vault: vault, transport: transport,
                     uiSession: uiSession, now: { nowFixed }), vault)
}

@Suite struct GoogleAuthTests {
  @Test func returnsFreshStoredTokenWithoutNetwork() async {
    let transport = ScriptedTransport([]) // any request would throw "unscripted"
    let (auth, _) = makeAuth(
      stored: StoredTokens(accessToken: "at", expiresAt: nowFixed.addingTimeInterval(3600), refreshToken: "rt"),
      transport: transport)
    #expect(await auth.accessToken() == "at")
    #expect(auth.state == .signedIn)
    #expect(transport.requests.isEmpty)
  }

  @Test func refreshesWithinFiveMinuteMarginAndPersists() async throws {
    let transport = ScriptedTransport([
      .init(matches: { $0.url!.absoluteString.contains("oauth2.googleapis.com/token") },
            body: #"{"access_token":"at2","expires_in":3599}"#, status: 200)
    ])
    let (auth, vault) = makeAuth(
      stored: StoredTokens(accessToken: "at", expiresAt: nowFixed.addingTimeInterval(60), refreshToken: "rt"),
      transport: transport)
    #expect(await auth.accessToken() == "at2")
    let sent = String(data: transport.requests[0].httpBody!, encoding: .utf8)!
    #expect(sent.contains("grant_type=refresh_token") && sent.contains("refresh_token=rt"))
    let saved = try vault.load()
    #expect(saved?.accessToken == "at2" && saved?.refreshToken == "rt")
    #expect(saved?.expiresAt == nowFixed.addingTimeInterval(3599))
  }

  @Test func rejectedRefreshClearsVaultAndReportsExpired() async throws {
    let transport = ScriptedTransport([
      .init(matches: { _ in true }, body: #"{"error":"invalid_grant"}"#, status: 400)
    ])
    let (auth, vault) = makeAuth(
      stored: StoredTokens(accessToken: "at", expiresAt: nowFixed.addingTimeInterval(-1), refreshToken: "stale"),
      transport: transport)
    #expect(await auth.accessToken() == nil)
    #expect(auth.state == .expired)
    #expect(try vault.load() == nil)
  }

  @Test func networkFailedRefreshKeepsRefreshToken() async throws {
    struct Offline: HTTPTransport {
      func send(_: URLRequest) async throws -> (Data, HTTPURLResponse) { throw URLError(.notConnectedToInternet) }
    }
    let vault = MemoryTokenVault()
    try vault.save(StoredTokens(accessToken: "at", expiresAt: nowFixed.addingTimeInterval(-1), refreshToken: "rt"))
    let config = GoogleAuthConfig(clientId: "cid", scope: "s", redirectScheme: "r")
    let auth = GoogleAuth(config: config, vault: vault, transport: Offline(), uiSession: nil, now: { nowFixed })
    #expect(await auth.accessToken() == nil)
    #expect(auth.state == .expired)
    #expect(try vault.load()?.refreshToken == "rt")
  }

  /// Controller amendment: a Google 5xx (service outage) is distinct from a
  /// rejected grant (4xx) — the refresh token must survive for the next
  /// attempt, same as a thrown transport error.
  @Test func outageRefreshKeepsRefreshToken() async throws {
    let transport = ScriptedTransport([
      .init(matches: { _ in true }, body: #"{"error":"internal"}"#, status: 503)
    ])
    let (auth, vault) = makeAuth(
      stored: StoredTokens(accessToken: "at", expiresAt: nowFixed.addingTimeInterval(-1), refreshToken: "rt"),
      transport: transport)
    #expect(await auth.accessToken() == nil)
    #expect(auth.state == .expired)
    #expect(try vault.load()?.refreshToken == "rt")
  }

  @Test func signInRunsUISessionThenExchangesCode() async throws {
    struct StubUI: AuthUISession {
      func authenticate(url: URL, callbackScheme: String) async throws -> URL {
        // Echo back the state Google would return, plus a code.
        let state = URLComponents(url: url, resolvingAgainstBaseURL: false)!
          .queryItems!.first { $0.name == "state" }!.value!
        return URL(string: "\(callbackScheme)://oauth?code=c1&state=\(state)")!
      }
    }
    let transport = ScriptedTransport([
      .init(matches: { $0.httpMethod == "POST" },
            body: #"{"access_token":"at","refresh_token":"rt","expires_in":3599}"#, status: 200)
    ])
    let (auth, vault) = makeAuth(transport: transport, uiSession: StubUI())
    #expect(await auth.signIn())
    #expect(auth.state == .signedIn)
    let sent = String(data: transport.requests[0].httpBody!, encoding: .utf8)!
    #expect(sent.contains("grant_type=authorization_code") && sent.contains("code=c1")
            && sent.contains("code_verifier="))
    #expect(!sent.contains("client_secret"))
    #expect(try vault.load()?.refreshToken == "rt")
  }

  @Test func signOutClearsVaultAndState() async throws {
    let (auth, vault) = makeAuth(
      stored: StoredTokens(accessToken: "at", expiresAt: nowFixed.addingTimeInterval(3600), refreshToken: "rt"))
    _ = await auth.accessToken()
    auth.signOut()
    #expect(auth.state == .signedOut)
    #expect(try vault.load() == nil)
    #expect(await auth.accessToken() == nil)
  }
}
