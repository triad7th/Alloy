@testable import AlloyAudio
import Foundation
import XCTest

final class DelayTests: XCTestCase {
    private let fs = 48_000.0

    private let twinDelayL: [Double] = [0, 0, 0, 0, 0, 0, 0, 0]
    private let twinDelayR: [Double] = [
        0, 0, 0, 0, 0.15199999511241913, 0.09120000153779984, 0.05471999943256378, 0.03283200040459633,
    ]

    private func delaySamples(_ params: DelayParams) -> Int {
        max(1, Int(((params.timeMs / 1000) * fs).rounded()))
    }

    private func sine(freq: Double, amp: Double, frames: Int) -> [Float] {
        var out = [Float](repeating: 0, count: frames)
        for i in 0..<frames {
            out[i] = Float(amp * sin(2 * Double.pi * freq * Double(i) / fs))
        }
        return out
    }

    func testFirstEchoTimingStereo() {
        let params = DelayParams(mode: .stereo, timeMs: 10, feedback: 0.5, damping: 0.4)
        let d = delaySamples(params)
        let delay = Delay(params: params, sampleRate: fs)
        let frames = d + 5
        var inL = [Float](repeating: 0, count: frames)
        var inR = [Float](repeating: 0, count: frames)
        inL[0] = 1
        var outL = [Float](repeating: 0, count: frames)
        var outR = [Float](repeating: 0, count: frames)
        delay.process(inL: &inL, inR: &inR, outL: &outL, outR: &outR, frames: frames)

        for i in 0..<d {
            XCTAssertLessThan(abs(outL[i]), 1e-9)
        }
        XCTAssertEqual(Double(outL[d]), 1, accuracy: 1e-6)
    }

    func testFeedbackDecayPureFeedback() {
        let params = DelayParams(mode: .stereo, timeMs: 10, feedback: 0.6, damping: 1)
        let d = delaySamples(params)
        let delay = Delay(params: params, sampleRate: fs)
        let frames = 3 * d + 5
        var inL = [Float](repeating: 0, count: frames)
        var inR = [Float](repeating: 0, count: frames)
        inL[0] = 1
        var outL = [Float](repeating: 0, count: frames)
        var outR = [Float](repeating: 0, count: frames)
        delay.process(inL: &inL, inR: &inR, outL: &outL, outR: &outR, frames: frames)

        let peak1 = Double(outL[d])
        let peak2 = Double(outL[2 * d])
        let peak3 = Double(outL[3 * d])
        XCTAssertEqual(peak1, 1, accuracy: 1e-6)
        XCTAssertEqual(peak2 / peak1, params.feedback, accuracy: 1e-3)
        XCTAssertEqual(peak3 / peak2, params.feedback, accuracy: 1e-3)
    }

    func testPingPongCrossing() {
        let params = DelayParams(mode: .pingpong, timeMs: 10, feedback: 0.5, damping: 0.4)
        let d = delaySamples(params)
        let delay = Delay(params: params, sampleRate: fs)
        let frames = 2 * d + 5
        var inL = [Float](repeating: 0, count: frames)
        var inR = [Float](repeating: 0, count: frames)
        inL[0] = 1
        var outL = [Float](repeating: 0, count: frames)
        var outR = [Float](repeating: 0, count: frames)
        delay.process(inL: &inL, inR: &inR, outL: &outL, outR: &outR, frames: frames)

        // First echo lands on L (the direct, undamped tap of the input).
        XCTAssertEqual(Double(outL[d]), 1, accuracy: 1e-6)
        XCTAssertLessThan(abs(outR[d]), 1e-9)

        // Second echo, fed back through R's line, crosses to the R channel.
        XCTAssertGreaterThan(abs(outR[2 * d]), 1e-6)
        XCTAssertLessThan(abs(outL[2 * d]), 1e-9)
    }

    func testDampingAttenuatesBeyondPureFeedback() {
        let params = DelayParams(mode: .stereo, timeMs: 10, feedback: 0.6, damping: 0.4)
        let d = delaySamples(params)
        let delay = Delay(params: params, sampleRate: fs)
        let frames = 2 * d + 5
        var inL = [Float](repeating: 0, count: frames)
        var inR = [Float](repeating: 0, count: frames)
        inL[0] = 1
        var outL = [Float](repeating: 0, count: frames)
        var outR = [Float](repeating: 0, count: frames)
        delay.process(inL: &inL, inR: &inR, outL: &outL, outR: &outR, frames: frames)

        let peak1 = Double(outL[d])
        let peak2 = Double(outL[2 * d])
        XCTAssertLessThan(peak2 / peak1, params.feedback)
        XCTAssertGreaterThan(peak2 / peak1, 0)
    }

    func testDeterminismTwoFreshInstancesBitIdentical() {
        let params = DelayParams(mode: .pingpong, timeMs: 15, feedback: 0.5, damping: 0.5)
        let frames = 4000
        let inL = sine(freq: 330, amp: 0.6, frames: frames)
        let inR = sine(freq: 330, amp: 0.6, frames: frames)
        let a = Delay(params: params, sampleRate: fs)
        let b = Delay(params: params, sampleRate: fs)
        var inLa = inL
        var inRa = inR
        var inLb = inL
        var inRb = inR
        var outLa = [Float](repeating: 0, count: frames)
        var outRa = [Float](repeating: 0, count: frames)
        var outLb = [Float](repeating: 0, count: frames)
        var outRb = [Float](repeating: 0, count: frames)
        a.process(inL: &inLa, inR: &inRa, outL: &outLa, outR: &outRa, frames: frames)
        b.process(inL: &inLb, inR: &inRb, outL: &outLb, outR: &outRb, frames: frames)
        for i in 0..<frames {
            XCTAssertEqual(outLb[i], outLa[i])
            XCTAssertEqual(outRb[i], outRa[i])
        }
    }

    func testResetRestoresInitialStateExactly() {
        let params = DelayParams(mode: .pingpong, timeMs: 15, feedback: 0.5, damping: 0.5)
        let delay = Delay(params: params, sampleRate: fs)
        let frames = 4000
        let input = sine(freq: 330, amp: 0.6, frames: frames)

        var inLa = input
        var inRa = input
        var outLa = [Float](repeating: 0, count: frames)
        var outRa = [Float](repeating: 0, count: frames)
        delay.process(inL: &inLa, inR: &inRa, outL: &outLa, outR: &outRa, frames: frames)

        delay.reset()

        var inLb = input
        var inRb = input
        var outLb = [Float](repeating: 0, count: frames)
        var outRb = [Float](repeating: 0, count: frames)
        delay.process(inL: &inLb, inR: &inRb, outL: &outLb, outR: &outRb, frames: frames)

        for i in 0..<frames {
            XCTAssertEqual(outLb[i], outLa[i])
            XCTAssertEqual(outRb[i], outRa[i])
        }
    }

    func testMatchesTwinReference() {
        let params = defaultMasterConfig.delay
        let d = delaySamples(params)
        let delay = Delay(params: params, sampleRate: fs)
        let frames = 2 * d + 8
        var inL = [Float](repeating: 0, count: frames)
        var inR = [Float](repeating: 0, count: frames)
        inL[0] = 1
        var outL = [Float](repeating: 0, count: frames)
        var outR = [Float](repeating: 0, count: frames)
        delay.process(inL: &inL, inR: &inR, outL: &outL, outR: &outR, frames: frames)

        let start = 2 * d - 4
        XCTAssertEqual(twinDelayL.count, 8)
        XCTAssertEqual(twinDelayR.count, 8)
        for i in 0..<8 {
            XCTAssertEqual(Double(outL[start + i]), twinDelayL[i], accuracy: 1e-6)
            XCTAssertEqual(Double(outR[start + i]), twinDelayR[i], accuracy: 1e-6)
        }
    }
}
