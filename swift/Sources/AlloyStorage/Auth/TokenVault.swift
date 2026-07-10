import Foundation
#if canImport(Security)
  import Security
#endif

/// Tokens as persisted by a `TokenVault`. Swift twin of the web `StoredTokens`
/// shape (auth/token-store.ts) — `expiresAt` is a `Date` here rather than
/// epoch-ms, matching Swift idiom for the rest of the package.
public struct StoredTokens: Codable, Equatable, Sendable {
  public let accessToken: String
  public let expiresAt: Date
  public let refreshToken: String?

  public init(accessToken: String, expiresAt: Date, refreshToken: String?) {
    self.accessToken = accessToken
    self.expiresAt = expiresAt
    self.refreshToken = refreshToken
  }
}

/// Persistence seam for GoogleAuth. Swift twin of the web `TokenStore`.
public protocol TokenVault: Sendable {
  func load() throws -> StoredTokens?
  func save(_ tokens: StoredTokens) throws
  func clear() throws
}

/// In-memory vault — the twin of the web `MemoryTokenStore`, used by tests.
public final class MemoryTokenVault: TokenVault, @unchecked Sendable {
  private let lock = NSLock()
  private var tokens: StoredTokens?

  public init(_ initial: StoredTokens? = nil) {
    self.tokens = initial
  }

  public func load() throws -> StoredTokens? {
    lock.withLock { tokens }
  }

  public func save(_ tokens: StoredTokens) throws {
    lock.withLock { self.tokens = tokens }
  }

  public func clear() throws {
    lock.withLock { tokens = nil }
  }
}

/// Durable vault backed by the platform Keychain
/// (`kSecClassGenericPassword`, service "alloy-storage.google"). The item's
/// data is the JSON encoding of `StoredTokens` — durable persistence, the
/// twin of the web `IndexedDbTokenStore`.
public final class KeychainTokenVault: TokenVault, @unchecked Sendable {
  private static let service = "alloy-storage.google"
  private static let account = "tokens"
  private let lock = NSLock()

  public init() {}

  public func load() throws -> StoredTokens? {
    #if canImport(Security)
      return try lock.withLock {
        var query = Self.baseQuery
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne

        var item: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &item)
        if status == errSecItemNotFound { return nil }
        guard status == errSecSuccess, let data = item as? Data else {
          throw StorageError(category: .unreachable, message: "keychain load failed (\(status))")
        }
        return try JSONDecoder().decode(StoredTokens.self, from: data)
      }
    #else
      throw StorageError(category: .unreachable, message: "keychain unavailable")
    #endif
  }

  public func save(_ tokens: StoredTokens) throws {
    #if canImport(Security)
      try lock.withLock {
        let data = try JSONEncoder().encode(tokens)
        // Replace-or-add: delete any existing item first, then add fresh —
        // simpler and just as correct as SecItemUpdate for a single item.
        SecItemDelete(Self.baseQuery as CFDictionary)
        var attrs = Self.baseQuery
        attrs[kSecValueData as String] = data
        attrs[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlock
        let status = SecItemAdd(attrs as CFDictionary, nil)
        guard status == errSecSuccess else {
          throw StorageError(category: .unreachable, message: "keychain save failed (\(status))")
        }
      }
    #else
      throw StorageError(category: .unreachable, message: "keychain unavailable")
    #endif
  }

  public func clear() throws {
    #if canImport(Security)
      try lock.withLock {
        let status = SecItemDelete(Self.baseQuery as CFDictionary)
        guard status == errSecSuccess || status == errSecItemNotFound else {
          throw StorageError(category: .unreachable, message: "keychain clear failed (\(status))")
        }
      }
    #else
      throw StorageError(category: .unreachable, message: "keychain unavailable")
    #endif
  }

  #if canImport(Security)
    private static var baseQuery: [String: Any] {
      [
        kSecClass as String: kSecClassGenericPassword,
        kSecAttrService as String: service,
        kSecAttrAccount as String: account,
      ]
    }
  #endif
}
