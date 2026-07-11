@testable import AlloyAudio
import XCTest

final class TremoloAutoPanTests: XCTestCase {
    private let fs = 48_000.0

    private let twinReferenceL: [Double] = [
        -0.24551498889923096, -0.25025153160095215, -0.25415417551994324, -0.25721076130867004,
        -0.25941193103790283, -0.2607511281967163, -0.2612246572971344, -0.2608318030834198,
    ]
    private let twinReferenceR: [Double] = [
        -0.15161016583442688, -0.1546478569507599, -0.15717428922653198, -0.15918081998825073,
        -0.16066047549247742, -0.16160807013511658, -0.16202014684677124, -0.16189506649971008,
    ]

    private func sine(freq: Double, amp: Double, frames: Int, sampleRate: Double) -> [Float] {
        var out = [Float](repeating: 0, count: frames)
        for i in 0..<frames {
            out[i] = Float(amp * sin(2 * Double.pi * freq * Double(i) / sampleRate))
        }
        return out
    }

    func testSpreadZeroKeepsLAndRExactlyIdentical() {
        let params = TremoloParams(rateHz: 3, depth: 0.6, spread: 0)
        let tremolo = TremoloAutoPan(params: params, sampleRate: fs)
        let mono = sine(freq: 220, amp: 0.7, frames: 1000, sampleRate: fs)
        var left = mono
        var right = mono
        tremolo.process(left: &left, right: &right, frames: 1000)
        for i in 0..<1000 {
            XCTAssertEqual(left[i], right[i])
        }
    }

    func testSpreadOneIsAntiPhaseAtQuarterPoints() {
        // rate 1 Hz at fs 1000 => phase advances by exactly 1/1000 per
        // sample, so phase == i / 1000 for sample i (hand-computable
        // quarter points).
        let params = TremoloParams(rateHz: 1, depth: 1, spread: 1)
        let tremolo = TremoloAutoPan(params: params, sampleRate: 1000)
        let frames = 1000
        var left = [Float](repeating: 1, count: frames)
        var right = [Float](repeating: 1, count: frames)
        tremolo.process(left: &left, right: &right, frames: frames)

        // phase 0.25 (index 250): gainL = 1 - (0.5 + 0.5*sin(pi/2)) = 0 (min),
        // gainR = 1 - (0.5 + 0.5*sin(pi/2 + pi)) = 1 (max).
        XCTAssertEqual(Double(left[250]), 0, accuracy: 1e-6)
        XCTAssertEqual(Double(right[250]), 1, accuracy: 1e-6)

        // phase 0.75 (index 750): gainL = 1 - (0.5 + 0.5*sin(3pi/2)) = 1 (max),
        // gainR = 1 - (0.5 + 0.5*sin(3pi/2 + pi)) = 0 (min).
        XCTAssertEqual(Double(left[750]), 1, accuracy: 1e-6)
        XCTAssertEqual(Double(right[750]), 0, accuracy: 1e-6)
    }

    func testDepthZeroIsAnExactBypass() {
        let params = TremoloParams(rateHz: 4.2, depth: 0, spread: 0.5)
        let tremolo = TremoloAutoPan(params: params, sampleRate: fs)
        var left = sine(freq: 440, amp: 0.5, frames: 512, sampleRate: fs)
        var right = sine(freq: 330, amp: 0.4, frames: 512, sampleRate: fs)
        let originalLeft = left
        let originalRight = right
        tremolo.process(left: &left, right: &right, frames: 512)
        for i in 0..<512 {
            XCTAssertEqual(left[i], originalLeft[i])
            XCTAssertEqual(right[i], originalRight[i])
        }
    }

    func testResetRestoresInitialStateExactly() {
        let params = TremoloParams(rateHz: 2.7, depth: 0.5, spread: 0.3)
        let tremolo = TremoloAutoPan(params: params, sampleRate: fs)
        let input = sine(freq: 330, amp: 0.6, frames: 512, sampleRate: fs)

        var leftA = input
        var rightA = input
        tremolo.process(left: &leftA, right: &rightA, frames: 512)

        tremolo.reset()

        var leftB = input
        var rightB = input
        tremolo.process(left: &leftB, right: &rightB, frames: 512)

        for i in 0..<512 {
            XCTAssertEqual(leftB[i], leftA[i])
            XCTAssertEqual(rightB[i], rightA[i])
        }
    }

    func testValidateInsertEnforcesTremoloBounds() {
        XCTAssertFalse(validateInsert(.tremolo(TremoloParams(rateHz: 0, depth: 0.5, spread: 0.5))).isEmpty)
        XCTAssertFalse(validateInsert(.tremolo(TremoloParams(rateHz: 41, depth: 0.5, spread: 0.5))).isEmpty)
        XCTAssertFalse(validateInsert(.tremolo(TremoloParams(rateHz: 5, depth: -0.1, spread: 0.5))).isEmpty)
        XCTAssertFalse(validateInsert(.tremolo(TremoloParams(rateHz: 5, depth: 1.1, spread: 0.5))).isEmpty)
        XCTAssertFalse(validateInsert(.tremolo(TremoloParams(rateHz: 5, depth: 0.5, spread: -0.1))).isEmpty)
        XCTAssertFalse(validateInsert(.tremolo(TremoloParams(rateHz: 5, depth: 0.5, spread: 1.1))).isEmpty)
        XCTAssertEqual(validateInsert(.tremolo(TremoloParams(rateHz: 5, depth: 0.5, spread: 0.5))), [])
    }

    func testMatchesTwinReference() {
        let params = TremoloParams(rateHz: 5.5, depth: 0.7, spread: 0.5)
        let tremolo = TremoloAutoPan(params: params, sampleRate: fs)
        let warmupFrames = 512
        let captureFrames = 8
        let totalFrames = warmupFrames + captureFrames
        let input = sine(freq: 440, amp: 0.5, frames: totalFrames, sampleRate: fs)
        var left = input
        var right = input
        tremolo.process(left: &left, right: &right, frames: totalFrames)
        XCTAssertEqual(twinReferenceL.count, 8)
        XCTAssertEqual(twinReferenceR.count, 8)
        for i in 0..<8 {
            XCTAssertEqual(Double(left[warmupFrames + i]), twinReferenceL[i], accuracy: 1e-6)
            XCTAssertEqual(Double(right[warmupFrames + i]), twinReferenceR[i], accuracy: 1e-6)
        }
    }
}
