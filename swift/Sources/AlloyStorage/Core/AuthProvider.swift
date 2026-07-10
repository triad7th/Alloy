public enum AuthState: String, Sendable {
  case signedOut, signedIn, expired
}

/// Auth seam for cloud backends. Implementations own token acquisition;
/// backends only ever ask for a bearer token.
public protocol AuthProvider: Sendable {
  /// A currently-valid access token, or nil (signed out / refresh failed).
  func accessToken() async -> String?
  var state: AuthState { get }
}
