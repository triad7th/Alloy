@testable import AlloyAudio
import XCTest

final class ParamRampTests: XCTestCase {
    func test_initialValueHoldsUntilFirstEvent() {
        let ramp = ParamRamp(initialValue: 0.5)
        XCTAssertEqual(ramp.value(at: 0), 0.5)
        XCTAssertEqual(ramp.value(at: 99), 0.5)
    }

    func test_setValueJumpsAtItsTime() {
        var ramp = ParamRamp()
        ramp.setValue(1, at: 2)
        XCTAssertEqual(ramp.value(at: 1.999), 0)
        XCTAssertEqual(ramp.value(at: 2), 1)
        XCTAssertEqual(ramp.value(at: 10), 1)
    }

    func test_linearRampInterpolatesFromPreviousEvent() {
        var ramp = ParamRamp()
        ramp.setValue(0, at: 1)
        ramp.linearRamp(to: 1, endingAt: 2)
        XCTAssertEqual(ramp.value(at: 1), 0)
        XCTAssertEqual(ramp.value(at: 1.5), 0.5, accuracy: 1e-9)
        XCTAssertEqual(ramp.value(at: 2), 1)
        XCTAssertEqual(ramp.value(at: 3), 1) // holds after the ramp
    }

    func test_setTargetApproachesExponentially() {
        var ramp = ParamRamp()
        ramp.setValue(1, at: 0)
        ramp.setTarget(0, startingAt: 0, timeConstant: 0.5)
        // v(t) = target + (v0 - target) * exp(-(t - t0)/tc)
        XCTAssertEqual(ramp.value(at: 0), 1, accuracy: 1e-9)
        XCTAssertEqual(ramp.value(at: 0.5), exp(-1), accuracy: 1e-9)
        XCTAssertEqual(ramp.value(at: 1.0), exp(-2), accuracy: 1e-9)
    }

    func test_setTargetStartsFromValueOfPriorSegmentAtItsStartTime() {
        var ramp = ParamRamp()
        ramp.setValue(0, at: 0)
        ramp.linearRamp(to: 0.3, endingAt: 0.005) // synth-style attack
        ramp.setTarget(0.15, startingAt: 0.005, timeConstant: 0.25) // decay to sustain
        XCTAssertEqual(ramp.value(at: 0.005), 0.3, accuracy: 1e-9)
        let expected = 0.15 + (0.3 - 0.15) * exp(-(0.255 - 0.005) / 0.25)
        XCTAssertEqual(ramp.value(at: 0.255), expected, accuracy: 1e-9)
    }

    func test_laterEventSupersedesRunningSetTarget() {
        var ramp = ParamRamp()
        ramp.setValue(1, at: 0)
        ramp.setTarget(0.5, startingAt: 0, timeConstant: 0.1)
        // Release arrives at t=1: a fresh setTarget from whatever value the
        // first one reached (the supersaw release pattern).
        let atRelease = 0.5 + (1 - 0.5) * exp(-1 / 0.1)
        ramp.setTarget(0, startingAt: 1, timeConstant: 0.01)
        XCTAssertEqual(ramp.value(at: 1), atRelease, accuracy: 1e-9)
        XCTAssertEqual(ramp.value(at: 1.01), atRelease * exp(-1), accuracy: 1e-6)
    }

    func test_snapshotThenLinearRampMirrorsSynthRelease() {
        var ramp = ParamRamp()
        ramp.setValue(0.3, at: 0)
        let current = ramp.value(at: 2)
        ramp.setValue(current, at: 2)
        ramp.linearRamp(to: 0, endingAt: 2.25)
        XCTAssertEqual(ramp.value(at: 2.125), 0.15, accuracy: 1e-9)
        XCTAssertEqual(ramp.value(at: 2.25), 0, accuracy: 1e-9)
    }

    func test_linearRampDirectlyAfterSetTargetIsNotInterpolated_pinned() {
        // Documented constraint: voices must snapshot with setValue before
        // ramping away from an active setTarget. This pins the (degenerate)
        // behavior if they don't, so a future change cannot alter it silently.
        var ramp = ParamRamp()
        ramp.setValue(1, at: 0)
        ramp.setTarget(0.5, startingAt: 0, timeConstant: 0.1)
        ramp.linearRamp(to: 0, endingAt: 1)
        // Mid-way through the ramp (t=0.5): the ramp's interpolation fraction
        // is always 0 here (the target event advances time to min(t, next)),
        // so the value is just the target curve evaluated at the query time.
        let atQueryTime = 0.5 + (1 - 0.5) * exp(-0.5 / 0.1) // target curve at t=0.5
        XCTAssertEqual(ramp.value(at: 0.5), atQueryTime, accuracy: 1e-6)
        // At/after the ramp end: snaps to the ramp target.
        XCTAssertEqual(ramp.value(at: 1), 0, accuracy: 1e-9)
    }
}
