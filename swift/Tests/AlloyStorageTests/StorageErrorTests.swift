@testable import AlloyStorage
import XCTest

// Twin fixture: web/packages/alloy-storage/src/core/errors.spec.ts uses the same table.
final class StorageErrorTests: XCTestCase {
  func test_mapsHTTPStatus() {
    let testCases: [(Int, StorageError.Category)] = [
      (401, .auth),
      (403, .auth),
      (404, .notFound),
      (409, .conflict),
      (412, .conflict),
      (429, .quota),
      (500, .unreachable),
      (503, .unreachable),
      (0, .unreachable),
    ]

    for (status, expectedCategory) in testCases {
      let err = StorageError.fromHTTPStatus(status)
      XCTAssertEqual(err.category, expectedCategory, "Status \(status) should map to \(expectedCategory)")
      XCTAssertEqual(err.status, status)
    }
  }

  func test_keepsExplicitMessageAndDefaults() {
    let err1 = StorageError.fromHTTPStatus(404, message: "gone")
    XCTAssertEqual(err1.message, "gone")

    let err2 = StorageError.fromHTTPStatus(500)
    XCTAssertEqual(err2.message, "HTTP 500")
  }
}
