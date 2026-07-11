import Foundation

/// Shared percent-encoding allowed-set for the Drive backend, used by both
/// DriveClient (query values) and DrivePublic (API key + native ref).
enum PercentEncoding {
  /// The exact unreserved set of JS encodeURIComponent: ASCII alphanumerics
  /// plus -_.!~*'() — CharacterSet.alphanumerics would wrongly pass Unicode
  /// letters/digits (é, CJK, Cyrillic) through unencoded.
  static let encodeURIComponentAllowed = CharacterSet(
    charactersIn: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_.!~*'()")
}
