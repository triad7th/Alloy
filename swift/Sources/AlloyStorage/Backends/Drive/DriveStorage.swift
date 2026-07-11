import Foundation

/// Config for the one-call Drive stack. Twin of DriveStorageConfig in
/// drive-storage.ts — fields differ per platform exactly as GoogleAuthConfig
/// does (web: redirectUri + tokenServiceUrl; Apple: redirectScheme).
public struct DriveStorageConfig: Sendable {
  public let clientId: String
  public let redirectScheme: String
  /// Folder path find-or-created from the Drive root, e.g. "AllyWorld/AllyClock".
  public let folderPath: String
  /// Defaults to drive.file — the app sees only files it created.
  public let scope: String

  public init(
    clientId: String, redirectScheme: String, folderPath: String,
    scope: String = "https://www.googleapis.com/auth/drive.file"
  ) {
    self.clientId = clientId
    self.redirectScheme = redirectScheme
    self.folderPath = folderPath
    self.scope = scope
  }
}

/// One-call wiring of the Drive stack: GoogleAuth → DriveClient → DriveBackend.
/// The client is internal plumbing; apps keep the two objects they use.
/// Sugar, not a seal — the individual initializers remain public.
public struct DriveStorage {
  public let auth: GoogleAuth
  public let backend: DriveBackend

  /// `uiSession` mirrors `GoogleAuth.init`'s default exactly: the platform
  /// auth UI (`GoogleAuth.defaultUISession()`), not `nil` — passing `nil`
  /// explicitly here means "no auth UI," same as it does for `GoogleAuth`
  /// itself, so a caller who omits the argument still gets working sign-in.
  public init(
    config: DriveStorageConfig,
    vault: any TokenVault = KeychainTokenVault(),
    transport: any HTTPTransport = URLSessionTransport(),
    uiSession: (any AuthUISession)? = GoogleAuth.defaultUISession(),
    cache: sending UserDefaults? = .standard
  ) {
    let auth = GoogleAuth(
      config: GoogleAuthConfig(
        clientId: config.clientId, scope: config.scope, redirectScheme: config.redirectScheme),
      vault: vault, transport: transport, uiSession: uiSession)
    self.auth = auth
    self.backend = DriveBackend(
      client: DriveClient(auth: auth, transport: transport),
      folderPath: config.folderPath, cache: cache)
  }
}
