@testable import AlloyAudio
import Foundation
import XCTest

final class RotarySpeakerTests: XCTestCase {
    private let fs = 48_000.0

    private let twinReferenceL: [Double] = [
        -0.5976319909095764, -0.609201192855835, -0.6187569499015808, -0.6262661218643188,
        -0.6317020654678345, -0.6350451707839966, -0.6362826824188232, -0.6354088187217712,
    ]
    private let twinReferenceR: [Double] = [
        -0.3396499752998352, -0.34659186005592346, -0.352377325296402, -0.3569888174533844,
        -0.3604126572608948, -0.3626391291618347, -0.3636625111103058, -0.3634810447692871,
    ]

    private func sine(freq: Double, amp: Double, frames: Int, sampleRate: Double) -> [Float] {
        var out = [Float](repeating: 0, count: frames)
        for i in 0..<frames {
            out[i] = Float(amp * sin(2 * Double.pi * freq * Double(i) / sampleRate))
        }
        return out
    }

    private func rms(_ values: [Float], start: Int, length: Int) -> Double {
        var sumSq = 0.0
        for i in start..<(start + length) {
            sumSq += Double(values[i]) * Double(values[i])
        }
        return (sumSq / Double(length)).squareRoot()
    }

    func testMixZeroIsAPerfectBypass() {
        let params = RotaryParams(speed: .fast, depth: 0.7, mix: 0)
        let rotary = RotarySpeaker(params: params, sampleRate: fs)
        var left = sine(freq: 440, amp: 0.5, frames: 256, sampleRate: fs)
        var right = sine(freq: 660, amp: 0.4, frames: 256, sampleRate: fs)
        let originalLeft = left
        let originalRight = right
        rotary.process(left: &left, right: &right, frames: 256)
        for i in 0..<256 {
            XCTAssertEqual(left[i], originalLeft[i])
            XCTAssertEqual(right[i], originalRight[i])
        }
    }

    func testDepthZeroMixOneCollapsesToTheMonoSumOnBothChannels() {
        let params = RotaryParams(speed: .fast, depth: 0, mix: 1)
        let rotary = RotarySpeaker(params: params, sampleRate: fs)
        let frames = 1024
        // Small amplitudes keep |m| < 2^-7, so Float output storage quantizes
        // by less than half an ulp = 2^-31 — well inside the 1e-9 budget. The
        // double-precision path itself reconstructs m to ~1e-16 (low + (m - low)).
        var left = sine(freq: 440, amp: 0.006, frames: frames, sampleRate: fs)
        var right = sine(freq: 330, amp: 0.005, frames: frames, sampleRate: fs)
        let originalLeft = left
        let originalRight = right
        rotary.process(left: &left, right: &right, frames: frames)
        for i in 0..<frames {
            // Unity-center gains: wet = 1*high + 1*low = m per channel. The
            // two channels run the identical computation, so they are
            // bit-equal; each matches the mono sum m within 1e-9.
            let m = (Double(originalLeft[i]) + Double(originalRight[i])) / 2
            XCTAssertEqual(left[i], right[i])
            XCTAssertLessThanOrEqual(abs(Double(left[i]) - m), 1e-9)
        }
    }

    func testAntiPhasePanProbeFastHornRotorAlternatesLoudChannel() {
        let params = RotaryParams(speed: .fast, depth: 1, mix: 1)
        let rotary = RotarySpeaker(params: params, sampleRate: fs)
        // DC-free high-band input: 2 kHz sine, well above the 800 Hz crossover.
        let halfCycle = Int(fs / 6.6 / 2) // half-cycle of the fast horn rotor ~ 3636 frames
        let frames = 2 * halfCycle
        var left = sine(freq: 2000, amp: 0.5, frames: frames, sampleRate: fs)
        var right = left
        rotary.process(left: &left, right: &right, frames: frames)

        // hornPhase starts at 0: sin >= 0 across the first half-cycle (L gain
        // 1+depth*sin >= 1 >= R gain), sin <= 0 across the second (reversed).
        let rmsL1 = rms(left, start: 0, length: halfCycle)
        let rmsR1 = rms(right, start: 0, length: halfCycle)
        let rmsL2 = rms(left, start: halfCycle, length: halfCycle)
        let rmsR2 = rms(right, start: halfCycle, length: halfCycle)
        XCTAssertGreaterThan(rmsL1, rmsR1)
        XCTAssertGreaterThan(rmsR2, rmsL2)
    }

    func testSlowDiffersFromFastForTheSameInput() {
        let input = sine(freq: 440, amp: 0.5, frames: 24_000, sampleRate: fs)

        let slow = RotarySpeaker(params: RotaryParams(speed: .slow, depth: 0.7, mix: 1), sampleRate: fs)
        var leftSlow = input
        var rightSlow = input
        slow.process(left: &leftSlow, right: &rightSlow, frames: 24_000)

        let fast = RotarySpeaker(params: RotaryParams(speed: .fast, depth: 0.7, mix: 1), sampleRate: fs)
        var leftFast = input
        var rightFast = input
        fast.process(left: &leftFast, right: &rightFast, frames: 24_000)

        var maxDiff: Double = 0
        for i in 0..<24_000 {
            maxDiff = max(maxDiff, abs(Double(leftSlow[i]) - Double(leftFast[i])), abs(Double(rightSlow[i]) - Double(rightFast[i])))
        }
        XCTAssertGreaterThan(maxDiff, 0.01)
    }

    func testResetRestoresInitialStateExactly() {
        let params = RotaryParams(speed: .fast, depth: 0.6, mix: 0.8)
        let rotary = RotarySpeaker(params: params, sampleRate: fs)
        let input = sine(freq: 330, amp: 0.6, frames: 512, sampleRate: fs)

        var leftA = input
        var rightA = input
        rotary.process(left: &leftA, right: &rightA, frames: 512)

        rotary.reset()

        var leftB = input
        var rightB = input
        rotary.process(left: &leftB, right: &rightB, frames: 512)

        for i in 0..<512 {
            XCTAssertEqual(leftB[i], leftA[i])
            XCTAssertEqual(rightB[i], rightA[i])
        }
    }

    func testValidateInsertEnforcesRotaryBounds() {
        // RotarySpeed is structurally valid in Swift (Codable decode rejects
        // unknown strings — see testUnknownSpeedFailsToDecode); only depth and
        // mix have runtime bounds here.
        XCTAssertEqual(validateInsert(.rotary(RotaryParams(speed: .fast, depth: 0.5, mix: 0.5))), [])
        XCTAssertEqual(validateInsert(.rotary(RotaryParams(speed: .slow, depth: 0.5, mix: 0.5))), [])
        XCTAssertFalse(validateInsert(.rotary(RotaryParams(speed: .fast, depth: -0.1, mix: 0.5))).isEmpty)
        XCTAssertFalse(validateInsert(.rotary(RotaryParams(speed: .fast, depth: 1.1, mix: 0.5))).isEmpty)
        XCTAssertFalse(validateInsert(.rotary(RotaryParams(speed: .fast, depth: 0.5, mix: -0.1))).isEmpty)
        XCTAssertFalse(validateInsert(.rotary(RotaryParams(speed: .fast, depth: 0.5, mix: 1.1))).isEmpty)
    }

    func testUnknownSpeedFailsToDecode() {
        // TS twin covers this through validateInsert (speed 'medium' rejected);
        // Swift rejects structurally at decode time.
        let json = #"{ "kind": "rotary", "rotary": { "speed": "medium", "depth": 0.5, "mix": 0.6 } }"#
        XCTAssertThrowsError(try JSONDecoder().decode(InsertSpec.self, from: Data(json.utf8)))
    }

    func testRotaryInsertJsonPinDecodesAndValidatesClean() throws {
        // Same JSON string as the TS spec ('rotary insert JSON pin: parses
        // and validates clean').
        let json = #"{ "kind": "rotary", "rotary": { "speed": "fast", "depth": 0.5, "mix": 0.6 } }"#
        let insert = try JSONDecoder().decode(InsertSpec.self, from: Data(json.utf8))
        XCTAssertEqual(validateInsert(insert), [])
        guard case let .rotary(rotary) = insert else {
            return XCTFail("expected a rotary insert")
        }
        XCTAssertEqual(rotary.speed, .fast)
        XCTAssertEqual(rotary.depth, 0.5)
        XCTAssertEqual(rotary.mix, 0.6)
    }

    func testMatchesTwinReference() {
        let params = RotaryParams(speed: .fast, depth: 0.7, mix: 1)
        let rotary = RotarySpeaker(params: params, sampleRate: fs)
        let warmupFrames = 512
        let captureFrames = 8
        let totalFrames = warmupFrames + captureFrames
        let input = sine(freq: 440, amp: 0.5, frames: totalFrames, sampleRate: fs)
        var left = input
        var right = input
        rotary.process(left: &left, right: &right, frames: totalFrames)
        XCTAssertEqual(twinReferenceL.count, 8)
        XCTAssertEqual(twinReferenceR.count, 8)
        for i in 0..<8 {
            XCTAssertEqual(Double(left[warmupFrames + i]), twinReferenceL[i], accuracy: 1e-6)
            XCTAssertEqual(Double(right[warmupFrames + i]), twinReferenceR[i], accuracy: 1e-6)
        }
    }
}
