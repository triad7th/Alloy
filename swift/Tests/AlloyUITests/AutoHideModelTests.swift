import AlloyUI
import XCTest

@MainActor
final class AutoHideModelTests: XCTestCase {
    func test_visibleByDefault_thenHidesAfterDelay() async throws {
        let model = AutoHideModel(delay: 0.05)
        XCTAssertTrue(model.visible)
        try await Task.sleep(for: .seconds(0.2))
        XCTAssertFalse(model.visible)
    }

    func test_revealRestartsTheClock() async throws {
        let model = AutoHideModel(delay: 0.05)
        try await Task.sleep(for: .seconds(0.2))
        XCTAssertFalse(model.visible)
        model.reveal()
        XCTAssertTrue(model.visible)
        try await Task.sleep(for: .seconds(0.2))
        XCTAssertFalse(model.visible)
    }

    func test_holdKeepsVisible() async throws {
        let model = AutoHideModel(delay: 0.05)
        model.setHold(true)
        try await Task.sleep(for: .seconds(0.2))
        XCTAssertTrue(model.visible)
        model.setHold(false)
        try await Task.sleep(for: .seconds(0.2))
        XCTAssertFalse(model.visible)
    }
}
