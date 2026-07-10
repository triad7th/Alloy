import Foundation
import Testing
@testable import AlloyStorage

@Suite struct LocalStorageBackendTests {
  @Test func satisfiesContract() async throws {
    try await runStorageBackendContract {
      let dir = FileManager.default.temporaryDirectory
        .appendingPathComponent("alloy-storage-tests-\(UUID().uuidString)")
      return LocalStorageBackend(collection: "test", directory: dir)
    }
  }
}
