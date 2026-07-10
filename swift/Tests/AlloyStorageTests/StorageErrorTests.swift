import Testing
@testable import AlloyStorage

// Twin fixture: web/packages/alloy-storage/src/core/errors.spec.ts uses the same table.
@Suite struct StorageErrorTests {
  @Test(arguments: [
    (401, StorageError.Category.auth),
    (403, .auth),
    (404, .notFound),
    (409, .conflict),
    (412, .conflict),
    (429, .quota),
    (500, .unreachable),
    (503, .unreachable),
    (0, .unreachable),
  ] as [(Int, StorageError.Category)])
  func mapsHTTPStatus(status: Int, category: StorageError.Category) {
    let err = StorageError.fromHTTPStatus(status)
    #expect(err.category == category)
    #expect(err.status == status)
  }

  @Test func keepsExplicitMessageAndDefaults() {
    #expect(StorageError.fromHTTPStatus(404, message: "gone").message == "gone")
    #expect(StorageError.fromHTTPStatus(500).message == "HTTP 500")
  }
}
