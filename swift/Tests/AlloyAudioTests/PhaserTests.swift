@testable import AlloyAudio
import Foundation
import XCTest

final class PhaserTests: XCTestCase {
    private let fs = 48_000.0

    private let twinReferenceL: [Double] = [
        -0.6855601072311401, -0.701745867729187, -0.7152063846588135, -0.726597249507904,
        -0.7353339195251465, -0.7417957782745361, -0.7456986904144287, -0.7471609711647034,
    ]
    private let twinReferenceR: [Double] = [
        -0.6780648827552795, -0.6947558522224426, -0.7091800570487976, -0.7212420701980591,
        -0.7309039235115051, -0.738163948059082, -0.7429497838020325, -0.7452953457832336,
    ]

    private func sine(freq: Double, amp: Double, frames: Int, sampleRate: Double) -> [Float] {
        var out = [Float](repeating: 0, count: frames)
        for i in 0..<frames {
            out[i] = Float(amp * sin(2 * Double.pi * freq * Double(i) / sampleRate))
        }
        return out
    }

    private func noise(seed: UInt32, amp: Double, frames: Int) -> [Float] {
        let prng = DspPrng(seed: seed)
        var out = [Float](repeating: 0, count: frames)
        for i in 0..<frames {
            out[i] = Float((prng.next() * 2 - 1) * amp)
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
        let params = PhaserParams(stages: 4, rateHz: 0.9, depth: 0.8, feedback: 0.5, mix: 0)
        let phaser = Phaser(params: params, sampleRate: fs)
        var left = sine(freq: 440, amp: 0.5, frames: 256, sampleRate: fs)
        var right = sine(freq: 440, amp: 0.5, frames: 256, sampleRate: fs)
        let originalLeft = left
        let originalRight = right
        phaser.process(left: &left, right: &right, frames: 256)
        for i in 0..<256 {
            XCTAssertEqual(left[i], originalLeft[i])
            XCTAssertEqual(right[i], originalRight[i])
        }
    }

    func testNotchMotionProbeRmsDiffersBetweenWindowsOneSecondApart() {
        let params = PhaserParams(stages: 4, rateHz: 0.5, depth: 1, feedback: 0, mix: 0.5)
        let phaser = Phaser(params: params, sampleRate: fs)
        let totalFrames = 48_000 + 4800 // second window starts exactly 1s after the first
        let dryLeft = noise(seed: 1234, amp: 0.5, frames: totalFrames)
        var left = dryLeft
        var right = dryLeft
        phaser.process(left: &left, right: &right, frames: totalFrames)

        // diff[i] = out[i] - dry[i] = mix * (allpass(x)[i] - x[i]). The
        // allpass chain output alone is energy-preserving (broadband RMS
        // constant no matter where the sweep sits), but |AP(w) - 1| =
        // 2|sin(phi(w)/2)| is NOT flat — it tracks the swept phase response,
        // so this difference signal's RMS moves as the notches move.
        var wet = [Float](repeating: 0, count: totalFrames)
        for i in 0..<totalFrames {
            wet[i] = left[i] - dryLeft[i]
        }

        let window1Rms = rms(wet, start: 0, length: 4800)
        let window2Rms = rms(wet, start: 48_000, length: 4800)
        let relDiff = abs(window1Rms - window2Rms) / max(window1Rms, window2Rms)
        XCTAssertGreaterThan(relDiff, 0.05)
    }

    func testStagesEightDiffersFromStagesFour() {
        let input = noise(seed: 77, amp: 0.5, frames: 2048)

        let phaser4 = Phaser(params: PhaserParams(stages: 4, rateHz: 0.9, depth: 0.8, feedback: 0.3, mix: 0.7), sampleRate: fs)
        var left4 = input
        var right4 = input
        phaser4.process(left: &left4, right: &right4, frames: 2048)

        let phaser8 = Phaser(params: PhaserParams(stages: 8, rateHz: 0.9, depth: 0.8, feedback: 0.3, mix: 0.7), sampleRate: fs)
        var left8 = input
        var right8 = input
        phaser8.process(left: &left8, right: &right8, frames: 2048)

        var maxDiff: Double = 0
        for i in 0..<2048 {
            maxDiff = max(maxDiff, abs(Double(left4[i]) - Double(left8[i])), abs(Double(right4[i]) - Double(right8[i])))
        }
        XCTAssertGreaterThan(maxDiff, 0.01)
    }

    func testFeedbackZeroPointEightOutputStaysBounded() {
        let params = PhaserParams(stages: 4, rateHz: 0.9, depth: 0.8, feedback: 0.8, mix: 0.7)
        let phaser = Phaser(params: params, sampleRate: fs)
        let frames = 48_000
        var left = sine(freq: 440, amp: 0.5, frames: frames, sampleRate: fs)
        var right = sine(freq: 440, amp: 0.5, frames: frames, sampleRate: fs)
        phaser.process(left: &left, right: &right, frames: frames)
        var peak: Double = 0
        for i in 0..<frames {
            peak = max(peak, abs(Double(left[i])), abs(Double(right[i])))
        }
        XCTAssertLessThan(peak, 4)
    }

    func testResetRestoresInitialStateExactly() {
        let params = PhaserParams(stages: 8, rateHz: 1.1, depth: 0.6, feedback: 0.4, mix: 0.5)
        let phaser = Phaser(params: params, sampleRate: fs)
        let input = sine(freq: 330, amp: 0.6, frames: 512, sampleRate: fs)

        var leftA = input
        var rightA = input
        phaser.process(left: &leftA, right: &rightA, frames: 512)

        phaser.reset()

        var leftB = input
        var rightB = input
        phaser.process(left: &leftB, right: &rightB, frames: 512)

        for i in 0..<512 {
            XCTAssertEqual(leftB[i], leftA[i])
            XCTAssertEqual(rightB[i], rightA[i])
        }
    }

    func testValidateInsertEnforcesPhaserBoundsIncludingStages() {
        XCTAssertEqual(validateInsert(.phaser(PhaserParams(stages: 4, rateHz: 1, depth: 0.5, feedback: 0.3, mix: 0.5))), [])
        XCTAssertEqual(validateInsert(.phaser(PhaserParams(stages: 8, rateHz: 1, depth: 0.5, feedback: 0.3, mix: 0.5))), [])
        XCTAssertFalse(validateInsert(.phaser(PhaserParams(stages: 5, rateHz: 1, depth: 0.5, feedback: 0.3, mix: 0.5))).isEmpty)
        XCTAssertFalse(validateInsert(.phaser(PhaserParams(stages: 4, rateHz: 0, depth: 0.5, feedback: 0.3, mix: 0.5))).isEmpty)
        XCTAssertFalse(validateInsert(.phaser(PhaserParams(stages: 4, rateHz: 10.1, depth: 0.5, feedback: 0.3, mix: 0.5))).isEmpty)
        XCTAssertFalse(validateInsert(.phaser(PhaserParams(stages: 4, rateHz: 1, depth: -0.1, feedback: 0.3, mix: 0.5))).isEmpty)
        XCTAssertFalse(validateInsert(.phaser(PhaserParams(stages: 4, rateHz: 1, depth: 1.1, feedback: 0.3, mix: 0.5))).isEmpty)
        XCTAssertFalse(validateInsert(.phaser(PhaserParams(stages: 4, rateHz: 1, depth: 0.5, feedback: -0.1, mix: 0.5))).isEmpty)
        XCTAssertFalse(validateInsert(.phaser(PhaserParams(stages: 4, rateHz: 1, depth: 0.5, feedback: 0.91, mix: 0.5))).isEmpty)
        XCTAssertFalse(validateInsert(.phaser(PhaserParams(stages: 4, rateHz: 1, depth: 0.5, feedback: 0.3, mix: -0.1))).isEmpty)
        XCTAssertFalse(validateInsert(.phaser(PhaserParams(stages: 4, rateHz: 1, depth: 0.5, feedback: 0.3, mix: 1.1))).isEmpty)
    }

    func testPhaserInsertJsonPinDecodesAndValidatesClean() throws {
        // Same JSON string as the TS spec ('phaser insert JSON pin: parses
        // and validates clean').
        let json = #"{ "kind": "phaser", "phaser": { "stages": 8, "rateHz": 1.2, "depth": 0.6, "feedback": 0.4, "mix": 0.5 } }"#
        let insert = try JSONDecoder().decode(InsertSpec.self, from: Data(json.utf8))
        XCTAssertEqual(validateInsert(insert), [])
        guard case let .phaser(phaser) = insert else {
            return XCTFail("expected a phaser insert")
        }
        XCTAssertEqual(phaser.stages, 8)
        XCTAssertEqual(phaser.rateHz, 1.2)
        XCTAssertEqual(phaser.depth, 0.6)
        XCTAssertEqual(phaser.feedback, 0.4)
        XCTAssertEqual(phaser.mix, 0.5)
    }

    func testMatchesTwinReference() {
        let params = PhaserParams(stages: 4, rateHz: 0.9, depth: 0.8, feedback: 0.5, mix: 0.5)
        let phaser = Phaser(params: params, sampleRate: fs)
        let warmupFrames = 512
        let captureFrames = 8
        let totalFrames = warmupFrames + captureFrames
        let input = sine(freq: 440, amp: 0.5, frames: totalFrames, sampleRate: fs)
        var left = input
        var right = input
        phaser.process(left: &left, right: &right, frames: totalFrames)
        XCTAssertEqual(twinReferenceL.count, 8)
        XCTAssertEqual(twinReferenceR.count, 8)
        for i in 0..<8 {
            XCTAssertEqual(Double(left[warmupFrames + i]), twinReferenceL[i], accuracy: 1e-6)
            XCTAssertEqual(Double(right[warmupFrames + i]), twinReferenceR[i], accuracy: 1e-6)
        }
    }
}
