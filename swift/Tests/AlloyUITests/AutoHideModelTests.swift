@testable import AlloyUI
import SwiftUI
import XCTest

@available(iOS 26.0, macOS 26.0, tvOS 26.0, watchOS 26.0, *)
@MainActor
final class AutoHideModelTests: XCTestCase {
    private func tick(_ seconds: Double) async {
        try? await Task.sleep(for: .seconds(seconds))
    }

    private func waitUntilHidden(
        _ model: AutoHideModel,
        file: StaticString = #filePath,
        line: UInt = #line
    ) async {
        let deadline = ContinuousClock.now + .seconds(2)
        while model.effectivelyVisible, ContinuousClock.now < deadline {
            await tick(0.01)
        }
        XCTAssertFalse(model.effectivelyVisible, file: file, line: line)
    }

    func test_visibleOnInitThenHidesAfterDelay() async {
        let model = AutoHideModel(delay: 0.05)
        XCTAssertTrue(model.effectivelyVisible)
        await waitUntilHidden(model)
    }

    func test_revealRestartsTheClock() async {
        let model = AutoHideModel(delay: 0.05)
        await waitUntilHidden(model)
        model.reveal()
        XCTAssertTrue(model.effectivelyVisible)
        await waitUntilHidden(model)
    }

    func test_suppressedHidesImmediatelyAndBlocksReveal() async {
        let model = AutoHideModel(delay: 10)
        model.suppressed = true
        XCTAssertFalse(model.effectivelyVisible)
        model.reveal() // web revealBlocked parity: no-op while suppressed
        XCTAssertFalse(model.effectivelyVisible)
    }

    func test_unsuppressRevealsAndRearms() async {
        let model = AutoHideModel(delay: 0.05)
        model.suppressed = true
        await tick(0.15) // timer may fire while suppressed; irrelevant
        model.suppressed = false
        XCTAssertTrue(model.effectivelyVisible) // revealed on lift
        await waitUntilHidden(model) // re-armed and hid again
    }

    func test_chromeAutoHidesModifierApplies() {
        let model = AutoHideModel(delay: 10)
        _ = Text("chrome").chromeAutoHides(model)
    }

    func test_holdStillPreventsHiding() async {
        let model = AutoHideModel(delay: 0.05)
        model.setHold(true)
        await tick(0.15)
        XCTAssertTrue(model.effectivelyVisible)
        model.setHold(false)
        await waitUntilHidden(model)
    }
}
