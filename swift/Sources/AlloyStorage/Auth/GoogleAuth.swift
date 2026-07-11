import Foundation
#if canImport(FoundationNetworking)
  import FoundationNetworking
#endif
#if canImport(AuthenticationServices)
  import AuthenticationServices
  #if canImport(UIKit)
    import UIKit
  #elseif canImport(AppKit)
    import AppKit
  #endif
#endif

private let authEndpoint = "https://accounts.google.com/o/oauth2/v2/auth"
private let tokenEndpoint = "https://oauth2.googleapis.com/token"
private let revokeEndpoint = "https://oauth2.googleapis.com/revoke"
/// Refresh this long before nominal expiry (twin of web FRESH_MARGIN_MS).
private let freshMarginSeconds: TimeInterval = 5 * 60

/// Seam over `ASWebAuthenticationSession` — the in-process analogue of the
/// web twin's page-redirect model. Returns the callback URL Google (or the
/// user, by cancelling) hands back.
/// Throws CancellationError when the user cancels the auth UI.
public protocol AuthUISession: Sendable {
  func authenticate(url: URL, callbackScheme: String) async throws -> URL
}

public struct GoogleAuthConfig: Sendable {
  /// iOS-type OAuth client id — no client secret; talks to Google directly.
  public let clientId: String
  public let scope: String
  /// e.g. "com.googleusercontent.apps.<id>" — used as both the
  /// `ASWebAuthenticationSession` callback scheme and the redirect_uri.
  public let redirectScheme: String

  public init(clientId: String, scope: String, redirectScheme: String) {
    self.clientId = clientId
    self.scope = scope
    self.redirectScheme = redirectScheme
  }
}

/// Google's snake_case token-endpoint response.
private struct GoogleTokenResponse: Decodable {
  let accessToken: String
  let refreshToken: String?
  let expiresIn: Double

  enum CodingKeys: String, CodingKey {
    case accessToken = "access_token"
    case refreshToken = "refresh_token"
    case expiresIn = "expires_in"
  }
}

/// Apple auth twin of web `GoogleAuth` (auth/google-auth.ts): authorization
/// code + PKCE, durable refresh-token persistence. Talks to Google's token
/// endpoint directly (iOS-type client, no secret) rather than through a
/// hosted token service — see mirroring.md for the recorded semantic-regime
/// differences (`signIn()` vs. `beginSignIn`/`completeSignIn`; direct Google
/// calls; 4xx-vs-5xx grant/outage split in `refresh`).
public final class GoogleAuth: AuthProvider, @unchecked Sendable {
  private let config: GoogleAuthConfig
  private let vault: any TokenVault
  private let transport: any HTTPTransport
  private let uiSession: (any AuthUISession)?
  private let now: () -> Date

  private let lock = NSLock()
  private var _state: AuthState = .signedOut

  /// `uiSession` defaults to the platform `ASWebAuthenticationSession`
  /// wrapper where available; passing `nil` explicitly means "no auth UI"
  /// (`signIn` then reports `.failed(.configurationInvalid)`).
  public init(
    config: GoogleAuthConfig,
    vault: any TokenVault = KeychainTokenVault(),
    transport: any HTTPTransport = URLSessionTransport(),
    uiSession: (any AuthUISession)? = GoogleAuth.defaultUISession(),
    now: @escaping () -> Date = { Date() }
  ) {
    self.config = config
    self.vault = vault
    self.transport = transport
    self.uiSession = uiSession
    self.now = now
  }

  public var state: AuthState {
    lock.withLock { _state }
  }

  private func setState(_ newValue: AuthState) {
    lock.withLock { _state = newValue }
  }

  /// The platform's default auth UI (`ASWebAuthenticationSession` wrapper),
  /// or `nil` where AuthenticationServices is unavailable. Used as the
  /// `init` default for `uiSession`.
  #if canImport(AuthenticationServices)
    public static func defaultUISession() -> (any AuthUISession)? { DefaultAuthUISession() }
  #else
    public static func defaultUISession() -> (any AuthUISession)? { nil }
  #endif

  public func accessToken() async -> String? {
    guard let stored = try? vault.load() else {
      setState(.signedOut)
      return nil
    }
    if now() < stored.expiresAt.addingTimeInterval(-freshMarginSeconds) {
      setState(.signedIn)
      return stored.accessToken
    }
    return await refresh(stored)
  }

  /// Twin of the web `refresh()` state machine, with one recorded deviation:
  /// the web token service normalizes Google's error into a single 401, so
  /// it keys off `status === 401`; Swift talks to Google directly, where a
  /// rejected grant (e.g. invalid_grant) comes back as a 400, so the
  /// "rejected vs. outage" split here is `4xx` vs. everything else (5xx,
  /// thrown transport error).
  private func refresh(_ stored: StoredTokens) async -> String? {
    guard let refreshToken = stored.refreshToken else {
      setState(.expired)
      return nil
    }
    let request = tokenRequest([
      ("grant_type", "refresh_token"),
      ("refresh_token", refreshToken),
      ("client_id", config.clientId),
    ])
    let data: Data
    let response: HTTPURLResponse
    do {
      (data, response) = try await transport.send(request)
    } catch {
      // Network / transport failure: keep the refresh token for next attempt.
      setState(.expired)
      return nil
    }
    guard (200..<300).contains(response.statusCode) else {
      if (400..<500).contains(response.statusCode) {
        // Google refused the grant (revoked/stale) — a new sign-in is required.
        try? vault.clear()
      }
      // Any other non-OK status (5xx...) is a service/Google outage, not a
      // rejected grant, so the refresh token is kept for the next attempt.
      setState(.expired)
      return nil
    }
    guard let decoded = try? JSONDecoder().decode(GoogleTokenResponse.self, from: data) else {
      setState(.expired)
      return nil
    }
    let next = StoredTokens(
      accessToken: decoded.accessToken,
      expiresAt: now().addingTimeInterval(decoded.expiresIn),
      refreshToken: stored.refreshToken)
    try? vault.save(next)
    setState(.signedIn)
    return next.accessToken
  }

  /// Self-contained sign-in: runs the UI session in-process (no page
  /// reload), then exchanges the returned code for tokens. Twin of web
  /// `beginSignIn` + `completeSignIn` collapsed into one call, since
  /// `ASWebAuthenticationSession` returns the callback URL directly instead
  /// of requiring a redirect page.
  public func signIn() async -> SignInResult {
    guard let uiSession else {
      return .failed(
        reason: .configurationInvalid,
        detail: "no auth UI session available on this platform", status: nil)
    }

    let verifier = PKCE.generateCodeVerifier()
    let challenge = PKCE.codeChallenge(verifier)
    let requestState = String(PKCE.generateCodeVerifier().prefix(32))
    let redirectUri = "\(config.redirectScheme):/oauth"

    var authComponents = URLComponents(string: authEndpoint)!
    authComponents.queryItems = [
      URLQueryItem(name: "client_id", value: config.clientId),
      URLQueryItem(name: "redirect_uri", value: redirectUri),
      URLQueryItem(name: "response_type", value: "code"),
      URLQueryItem(name: "scope", value: config.scope),
      URLQueryItem(name: "code_challenge", value: challenge),
      URLQueryItem(name: "code_challenge_method", value: "S256"),
      URLQueryItem(name: "access_type", value: "offline"), // ask for a refresh token
      URLQueryItem(name: "prompt", value: "consent"), // Google only reissues refresh tokens on consent
      URLQueryItem(name: "state", value: requestState),
    ]
    guard let authURL = authComponents.url else {
      return .failed(reason: .configurationInvalid, detail: "could not build auth URL", status: nil)
    }

    let callbackURL: URL
    do {
      callbackURL = try await uiSession.authenticate(url: authURL, callbackScheme: config.redirectScheme)
    } catch is CancellationError {
      return .cancelled
    } catch {
      return .failed(
        reason: .configurationInvalid,
        detail: "auth UI failed: \(String(describing: error))", status: nil)
    }

    guard
      let callbackComponents = URLComponents(url: callbackURL, resolvingAgainstBaseURL: false),
      let code = callbackComponents.queryItems?.first(where: { $0.name == "code" })?.value
    else {
      return .failed(reason: .stateMismatch, detail: "no code in callback URL", status: nil)
    }
    guard callbackComponents.queryItems?.first(where: { $0.name == "state" })?.value == requestState
    else {
      return .failed(reason: .stateMismatch, detail: "state parameter mismatch", status: nil)
    }

    let request = tokenRequest([
      ("grant_type", "authorization_code"),
      ("code", code),
      ("code_verifier", verifier),
      ("client_id", config.clientId),
      ("redirect_uri", redirectUri),
    ])

    let data: Data
    let response: HTTPURLResponse
    do {
      (data, response) = try await transport.send(request)
    } catch {
      return .failed(
        reason: .exchangeFailed,
        detail: "token exchange unreachable: \(String(describing: error))", status: nil)
    }
    guard (200..<300).contains(response.statusCode) else {
      return .failed(
        reason: .exchangeFailed, detail: "Google rejected the exchange",
        status: response.statusCode)
    }
    guard let decoded = try? JSONDecoder().decode(GoogleTokenResponse.self, from: data) else {
      return .failed(
        reason: .exchangeFailed, detail: "undecodable token response",
        status: response.statusCode)
    }

    let tokens = StoredTokens(
      accessToken: decoded.accessToken,
      expiresAt: now().addingTimeInterval(decoded.expiresIn),
      refreshToken: decoded.refreshToken)
    do {
      try vault.save(tokens)
    } catch {
      return .failed(
        reason: .vaultFailed, detail: String(describing: error), status: nil)
    }
    setState(.signedIn)
    return .success
  }

  /// Clears the vault and state synchronously, then fires a detached
  /// best-effort revoke request (refresh token if present, else access
  /// token) whose failure is ignored — twin of the web `signOut`.
  public func signOut() {
    let stored = try? vault.load()
    try? vault.clear()
    setState(.signedOut)
    guard let stored else { return }
    let token = stored.refreshToken ?? stored.accessToken
    let transport = self.transport
    Task.detached {
      var components = URLComponents(string: revokeEndpoint)!
      components.queryItems = [URLQueryItem(name: "token", value: token)]
      guard let url = components.url else { return }
      var request = URLRequest(url: url)
      request.httpMethod = "POST"
      _ = try? await transport.send(request)
    }
  }

  private func tokenRequest(_ params: [(String, String)]) -> URLRequest {
    var request = URLRequest(url: URL(string: tokenEndpoint)!)
    request.httpMethod = "POST"
    request.setValue("application/x-www-form-urlencoded", forHTTPHeaderField: "Content-Type")
    request.httpBody = formBody(params)
    return request
  }

  private func formBody(_ params: [(String, String)]) -> Data {
    var allowed = CharacterSet.alphanumerics
    allowed.insert(charactersIn: "-._~")
    let encoded = params.map { key, value in
      "\(key)=\(value.addingPercentEncoding(withAllowedCharacters: allowed) ?? value)"
    }
    return Data(encoded.joined(separator: "&").utf8)
  }
}

#if canImport(AuthenticationServices)
  /// Default `AuthUISession`, wrapping `ASWebAuthenticationSession`.
  final class DefaultAuthUISession: NSObject, AuthUISession, @unchecked Sendable {
    private var currentSession: ASWebAuthenticationSession?

    func authenticate(url: URL, callbackScheme: String) async throws -> URL {
      try await withCheckedThrowingContinuation { continuation in
        let session = ASWebAuthenticationSession(
          url: url, callbackURLScheme: callbackScheme
        ) { [weak self] callbackURL, error in
          self?.currentSession = nil
          if let callbackURL {
            continuation.resume(returning: callbackURL)
          } else if let error, (error as? ASWebAuthenticationSessionError)?.code == .canceledLogin {
            continuation.resume(throwing: CancellationError())
          } else if let error {
            continuation.resume(throwing: error)
          } else {
            // No URL and no error: treat as user cancel.
            continuation.resume(throwing: CancellationError())
          }
        }
        session.prefersEphemeralWebBrowserSession = false
        session.presentationContextProvider = AuthPresentationContextProvider.shared
        currentSession = session
        // start() must run on the main thread: ASWebAuthenticationSession
        // synchronously queries presentationAnchor(for:) as part of a "dry
        // run" on whatever thread called start(), and that method assumes
        // it's already on the main actor. authenticate(url:callbackScheme:)
        // is called from arbitrary Tasks (e.g. a SwiftUI button action),
        // which do not inherit MainActor by default — an off-main start()
        // crashes instead of hopping.
        DispatchQueue.main.async {
          session.start()
        }
      }
    }
  }

  /// Presentation anchor: the key window on whichever platform has one.
  /// `presentationAnchor` is declared `nonisolated` and hops to the main
  /// actor internally via `assumeIsolated` — safe only because
  /// `DefaultAuthUISession.authenticate` forces `session.start()` onto the
  /// main thread; `ASWebAuthenticationSession` queries this method
  /// synchronously from whatever thread `start()` is called on, not
  /// necessarily the main thread. `assumeIsolated` traps if that
  /// invariant is ever broken — it does not hop.
  private final class AuthPresentationContextProvider: NSObject,
    ASWebAuthenticationPresentationContextProviding, @unchecked Sendable
  {
    nonisolated override init() { super.init() }
    nonisolated static let shared = AuthPresentationContextProvider()

    nonisolated func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
      MainActor.assumeIsolated {
        #if canImport(UIKit)
          return UIApplication.shared.connectedScenes
            .compactMap { ($0 as? UIWindowScene)?.keyWindow }
            .first ?? ASPresentationAnchor()
        #elseif canImport(AppKit)
          return NSApplication.shared.keyWindow ?? ASPresentationAnchor()
        #else
          return ASPresentationAnchor()
        #endif
      }
    }
  }
#endif
