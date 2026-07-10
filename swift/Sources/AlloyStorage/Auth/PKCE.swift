import CryptoKit
import Foundation

/// PKCE helpers (RFC 7636, S256). Caseless-enum namespace, twin of auth/pkce.ts.
public enum PKCE {
  static func base64url(_ data: Data) -> String {
    data.base64EncodedString()
      .replacingOccurrences(of: "+", with: "-")
      .replacingOccurrences(of: "/", with: "_")
      .replacingOccurrences(of: "=", with: "")
  }

  /// 48 random bytes → 64 base64url chars.
  public static func generateCodeVerifier() -> String {
    var bytes = [UInt8](repeating: 0, count: 48)
    for i in bytes.indices { bytes[i] = UInt8.random(in: 0...255) }
    return base64url(Data(bytes))
  }

  /// S256 challenge: base64url(SHA-256(verifier)).
  public static func codeChallenge(_ verifier: String) -> String {
    base64url(Data(SHA256.hash(data: Data(verifier.utf8))))
  }
}
