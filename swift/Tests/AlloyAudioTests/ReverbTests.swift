@testable import AlloyAudio
import Foundation
import XCTest

final class ReverbTests: XCTestCase {
    private let fs = 48_000.0

    private let twinReverbL: [Double] = [
        -0.13816002011299133, -0.14837245643138885, -0.15830713510513306, -0.1681739240884781,
        -0.17760393023490906, -0.18658016622066498, -0.19507570564746857, -0.20310428738594055,
    ]
    private let twinReverbR: [Double] = [
        -0.2664816975593567, -0.27564600110054016, -0.2845517694950104, -0.2928687632083893,
        -0.30044007301330566, -0.30745768547058105, -0.3139910101890564, -0.3200846016407013,
    ]

    private func makeReverb() -> Reverb {
        Reverb(params: defaultMasterConfig.reverb, sampleRate: fs)
    }

    private func sine(freq: Double, amp: Double, frames: Int) -> [Float] {
        var out = [Float](repeating: 0, count: frames)
        for i in 0..<frames {
            out[i] = Float(amp * sin(2 * Double.pi * freq * Double(i) / fs))
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

    func testSilenceInSilenceOutExactly0() {
        let reverb = makeReverb()
        let frames = 4096
        var inL = [Float](repeating: 0, count: frames)
        var inR = [Float](repeating: 0, count: frames)
        var outL = [Float](repeating: 0, count: frames)
        var outR = [Float](repeating: 0, count: frames)
        reverb.process(inL: &inL, inR: &inR, outL: &outL, outR: &outR, frames: frames)
        for i in 0..<frames {
            XCTAssertEqual(outL[i], 0)
            XCTAssertEqual(outR[i], 0)
        }
    }

    func testImpulseEnergyDecaysBoundedTailRmsBelowThreshold() {
        let reverb = makeReverb()
        let frames = 96_000
        var inL = [Float](repeating: 0, count: frames)
        var inR = [Float](repeating: 0, count: frames)
        inL[0] = 1
        inR[0] = 1
        var outL = [Float](repeating: 0, count: frames)
        var outR = [Float](repeating: 0, count: frames)
        reverb.process(inL: &inL, inR: &inR, outL: &outL, outR: &outR, frames: frames)

        let earlyRms = rms(outL, start: 0, length: 4800)
        let tailRms = rms(outL, start: 91_200, length: 4800)
        XCTAssertGreaterThan(earlyRms, tailRms)
        XCTAssertLessThan(tailRms, 1e-3)

        for i in 0..<frames {
            XCTAssertTrue(outL[i].isFinite)
            XCTAssertTrue(outR[i].isFinite)
            XCTAssertLessThan(abs(outL[i]), 10)
            XCTAssertLessThan(abs(outR[i]), 10)
        }
    }

    func testStereoDecorrelation() {
        let reverb = makeReverb()
        let frames = 8000
        var inL = [Float](repeating: 0, count: frames)
        var inR = [Float](repeating: 0, count: frames)
        inL[0] = 1
        inR[0] = 1
        var outL = [Float](repeating: 0, count: frames)
        var outR = [Float](repeating: 0, count: frames)
        reverb.process(inL: &inL, inR: &inR, outL: &outL, outR: &outR, frames: frames)

        var identical = true
        for i in 0..<frames {
            if outL[i] != outR[i] {
                identical = false
                break
            }
        }
        XCTAssertFalse(identical)
    }

    func testDeterminismTwoFreshInstancesBitIdentical() {
        let frames = 4000
        let inL = sine(freq: 330, amp: 0.6, frames: frames)
        let inR = sine(freq: 330, amp: 0.6, frames: frames)
        let a = makeReverb()
        let b = makeReverb()
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
        let reverb = makeReverb()
        let frames = 4000
        let input = sine(freq: 330, amp: 0.6, frames: frames)

        var inLa = input
        var inRa = input
        var outLa = [Float](repeating: 0, count: frames)
        var outRa = [Float](repeating: 0, count: frames)
        reverb.process(inL: &inLa, inR: &inRa, outL: &outLa, outR: &outRa, frames: frames)

        reverb.reset()

        var inLb = input
        var inRb = input
        var outLb = [Float](repeating: 0, count: frames)
        var outRb = [Float](repeating: 0, count: frames)
        reverb.process(inL: &inLb, inR: &inRb, outL: &outLb, outR: &outRb, frames: frames)

        for i in 0..<frames {
            XCTAssertEqual(outLb[i], outLa[i])
            XCTAssertEqual(outRb[i], outRa[i])
        }
    }

    func testMatchesTwinReference() {
        let reverb = makeReverb()
        let warmupFrames = 4000
        let captureFrames = 8
        let totalFrames = warmupFrames + captureFrames
        var inL = sine(freq: 220, amp: 0.5, frames: totalFrames)
        var inR = sine(freq: 220, amp: 0.5, frames: totalFrames)
        var outL = [Float](repeating: 0, count: totalFrames)
        var outR = [Float](repeating: 0, count: totalFrames)
        reverb.process(inL: &inL, inR: &inR, outL: &outL, outR: &outR, frames: totalFrames)
        XCTAssertEqual(twinReverbL.count, 8)
        XCTAssertEqual(twinReverbR.count, 8)
        for i in 0..<8 {
            XCTAssertEqual(Double(outL[warmupFrames + i]), twinReverbL[i], accuracy: 1e-6)
            XCTAssertEqual(Double(outR[warmupFrames + i]), twinReverbR[i], accuracy: 1e-6)
        }
    }
}
