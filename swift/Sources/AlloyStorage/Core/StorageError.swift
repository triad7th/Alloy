/// The one error type backends throw. Apps and the sync engine react to
/// `category`, never to raw HTTP codes.
public struct StorageError: Error, Equatable, Sendable {
  public enum Category: String, Sendable {
    case auth, notFound, conflict, unreachable, quota
  }

  public let category: Category
  public let message: String
  public let status: Int?

  public init(category: Category, message: String, status: Int? = nil) {
    self.category = category
    self.message = message
    self.status = status
  }

  public static func fromHTTPStatus(_ status: Int, message: String? = nil) -> StorageError {
    let category: Category =
      switch status {
      case 401, 403: .auth
      case 404: .notFound
      case 409, 412: .conflict
      case 429: .quota
      default: .unreachable
      }
    return StorageError(category: category, message: message ?? "HTTP \(status)", status: status)
  }
}
