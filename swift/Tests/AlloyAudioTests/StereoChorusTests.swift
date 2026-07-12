@testable import AlloyAudio
import XCTest

final class StereoChorusTests: XCTestCase {
    private let fs = 48_000.0

    private let twinReferenceL: [Double] = [
        -0.23429641127586365, -0.2546550929546356, -0.27417752146720886, -0.2928009629249573,
        -0.31046581268310547, -0.32711538672447205, -0.34269648790359497, -0.3571593761444092,
    ]
    private let twinReferenceR: [Double] = [
        -0.21921847760677338, -0.24005915224552155, -0.2601032257080078, -0.2792840600013733,
        -0.2975378930568695, -0.31480398774147034, -0.3310249447822571, -0.346146821975708,
    ]

    private func sine(freq: Double, amp: Double, frames: Int, sampleRate: Double) -> [Float] {
        var out = [Float](repeating: 0, count: frames)
        for i in 0..<frames {
            out[i] = Float(amp * sin(2 * Double.pi * freq * Double(i) / sampleRate))
        }
        return out
    }

    func testMixZeroIsAPerfectBypass() {
        let params = ChorusParams(mode: .chorus, rateHz: 0.8, depthMs: 3, mix: 0)
        let chorus = StereoChorus(params: params, sampleRate: fs)
        var left = sine(freq: 440, amp: 0.5, frames: 256, sampleRate: fs)
        var right = sine(freq: 440, amp: 0.5, frames: 256, sampleRate: fs)
        let originalLeft = left
        let originalRight = right
        chorus.process(left: &left, right: &right, frames: 256)
        for i in 0..<256 {
            XCTAssertEqual(left[i], originalLeft[i])
            XCTAssertEqual(right[i], originalRight[i])
        }
    }

    func testWidensAMonoSource() {
        let params = ChorusParams(mode: .chorus, rateHz: 0.8, depthMs: 3, mix: 0.5)
        let chorus = StereoChorus(params: params, sampleRate: fs)
        let mono = sine(freq: 440, amp: 1, frames: 4800, sampleRate: fs)
        var left = mono
        var right = mono
        chorus.process(left: &left, right: &right, frames: 4800)
        var maxDiff = 0.0
        for i in 1000..<4800 {
            maxDiff = max(maxDiff, abs(Double(left[i]) - Double(right[i])))
        }
        XCTAssertGreaterThan(maxDiff, 0.01)
    }

    func testDelayBoundsForAnImpulse() {
        let depthMs = 3.0
        let params = ChorusParams(mode: .chorus, rateHz: 1.3, depthMs: depthMs, mix: 1)
        let chorus = StereoChorus(params: params, sampleRate: fs)
        let frames = 550 // stays inside the (7 + 3 + 2)ms = 12ms delay buffer, no wraparound
        var left = [Float](repeating: 0, count: frames)
        var right = [Float](repeating: 0, count: frames)
        left[0] = 1
        right[0] = 1
        chorus.process(left: &left, right: &right, frames: frames)

        var nonzeroIndices: [Int] = []
        for i in 0..<frames where left[i] != 0 || right[i] != 0 {
            nonzeroIndices.append(i)
        }
        XCTAssertGreaterThan(nonzeroIndices.count, 0)
        let minFrame = (7 - depthMs - 0.1) / 1000 * fs
        let maxFrame = (7 + depthMs + 0.1) / 1000 * fs
        for idx in nonzeroIndices {
            XCTAssertGreaterThanOrEqual(Double(idx), minFrame)
            XCTAssertLessThanOrEqual(Double(idx), maxFrame)
        }
    }

    func testEnsembleModeDiffersFromChorusMode() {
        let rateHz = 0.9
        let depthMs = 4.0
        let mix = 0.6
        let input = sine(freq: 220, amp: 0.5, frames: 2048, sampleRate: fs)

        let chorus = StereoChorus(params: ChorusParams(mode: .chorus, rateHz: rateHz, depthMs: depthMs, mix: mix), sampleRate: fs)
        var chorusLeft = input
        var chorusRight = input
        chorus.process(left: &chorusLeft, right: &chorusRight, frames: 2048)

        let ensemble = StereoChorus(params: ChorusParams(mode: .ensemble, rateHz: rateHz, depthMs: depthMs, mix: mix), sampleRate: fs)
        var ensembleLeft = input
        var ensembleRight = input
        ensemble.process(left: &ensembleLeft, right: &ensembleRight, frames: 2048)

        var maxDiff = 0.0
        for i in 0..<2048 {
            maxDiff = max(maxDiff, abs(Double(chorusLeft[i]) - Double(ensembleLeft[i])))
            maxDiff = max(maxDiff, abs(Double(chorusRight[i]) - Double(ensembleRight[i])))
        }
        XCTAssertGreaterThan(maxDiff, 0.01)
    }

    func testResetRestoresInitialStateExactly() {
        let params = ChorusParams(mode: .ensemble, rateHz: 1.1, depthMs: 2, mix: 0.4)
        let chorus = StereoChorus(params: params, sampleRate: fs)
        let input = sine(freq: 330, amp: 0.6, frames: 512, sampleRate: fs)

        var leftA = input
        var rightA = input
        chorus.process(left: &leftA, right: &rightA, frames: 512)

        chorus.reset()

        var leftB = input
        var rightB = input
        chorus.process(left: &leftB, right: &rightB, frames: 512)

        for i in 0..<512 {
            XCTAssertEqual(leftB[i], leftA[i])
            XCTAssertEqual(rightB[i], rightA[i])
        }
    }

    func testValidateInsertEnforcesChorusBounds() {
        XCTAssertFalse(validateInsert(.chorus(ChorusParams(mode: .chorus, rateHz: 0, depthMs: 3, mix: 0.5))).isEmpty)
        XCTAssertFalse(validateInsert(.chorus(ChorusParams(mode: .chorus, rateHz: 1, depthMs: 25, mix: 0.5))).isEmpty)
        XCTAssertFalse(validateInsert(.chorus(ChorusParams(mode: .chorus, rateHz: 1, depthMs: 3, mix: 1.5))).isEmpty)
        XCTAssertEqual(validateInsert(.chorus(ChorusParams(mode: .chorus, rateHz: 1, depthMs: 3, mix: 0.5))), [])
    }

    func testValidateInsertRejectsAChorusDepthMsBeyondBaseDelayMs() {
        // depthMs > baseDelayMs makes (baseDelayMs - depthMs) negative for
        // part of the LFO cycle, i.e. the tap would have to read ahead of
        // the write head. depthMs == baseDelayMs is the causal boundary
        // (delay bottoms out at exactly 0) and must still pass.
        XCTAssertFalse(
            validateInsert(.chorus(ChorusParams(mode: .chorus, rateHz: 1, depthMs: baseDelayMs + 1, mix: 0.5))).isEmpty
        )
        XCTAssertEqual(
            validateInsert(.chorus(ChorusParams(mode: .chorus, rateHz: 1, depthMs: baseDelayMs, mix: 0.5))), []
        )
    }

    func testMatchesTwinReference() {
        let params = ChorusParams(mode: .chorus, rateHz: 1.2, depthMs: 2.5, mix: 0.6)
        let chorus = StereoChorus(params: params, sampleRate: fs)
        let warmupFrames = 512
        let captureFrames = 8
        let totalFrames = warmupFrames + captureFrames
        let input = sine(freq: 440, amp: 0.5, frames: totalFrames, sampleRate: fs)
        var left = input
        var right = input
        chorus.process(left: &left, right: &right, frames: totalFrames)
        XCTAssertEqual(twinReferenceL.count, 8)
        XCTAssertEqual(twinReferenceR.count, 8)
        for i in 0..<8 {
            XCTAssertEqual(Double(left[warmupFrames + i]), twinReferenceL[i], accuracy: 1e-6)
            XCTAssertEqual(Double(right[warmupFrames + i]), twinReferenceR[i], accuracy: 1e-6)
        }
    }
}
