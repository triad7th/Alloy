#if canImport(Security)
  import Foundation
  import Testing
  @testable import AlloyStorage

  @Suite struct KeychainTokenVaultTests {
    /// One full round-trip against a scratch service name — never touches
    /// the real "alloy-storage.google" entry, and cleans up after itself.
    @Test func roundTripsThroughTheKeychain() throws {
      let vault = KeychainTokenVault(service: "alloy-storage.tests.\(UUID().uuidString)")
      defer { try? vault.clear() }

      // Empty service → nil, not an error.
      #expect(try vault.load() == nil)

      // save → load returns the same tokens (Date survives JSON round-trip
      // exactly when built from a whole-second epoch value).
      let first = StoredTokens(
        accessToken: "at1",
        expiresAt: Date(timeIntervalSince1970: 1_751_980_000),
        refreshToken: "rt1")
      try vault.save(first)
      #expect(try vault.load() == first)

      // Saving different tokens exercises the delete-then-add update path.
      let second = StoredTokens(
        accessToken: "at2",
        expiresAt: Date(timeIntervalSince1970: 1_751_983_600),
        refreshToken: nil)
      try vault.save(second)
      #expect(try vault.load() == second)

      // clear → gone; clearing again stays idempotent.
      try vault.clear()
      #expect(try vault.load() == nil)
      try vault.clear()
    }
  }
#endif
