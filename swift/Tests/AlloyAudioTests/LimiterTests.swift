@testable import AlloyAudio
import Foundation
import XCTest

final class LimiterTests: XCTestCase {
    private let fs = 48_000.0
    private let L = limiterLookaheadSamples

    private let twinReferenceL: [Double] = [
        0.08990523964166641, 0.08122097700834274, 0.0722651332616806, 0.06306732445955276,
        0.05365801230072975, 0.044068340212106705, 0.034330081194639206, 0.024475498124957085,
    ]
    private let twinReferenceR: [Double] = [
        0.044952619820833206, 0.04061048850417137, 0.0361325666308403, 0.03153366222977638,
        0.026829006150364876, 0.022034170106053352, 0.017165040597319603, 0.012237749062478542,
    ]

    private func sine(freq: Double, amp: Double, frames: Int, sampleRate: Double, startPhase: Double = 0) -> [Float] {
        var out = [Float](repeating: 0, count: frames)
        for i in 0..<frames {
            out[i] = Float(amp * sin(startPhase + 2 * Double.pi * freq * Double(i) / sampleRate))
        }
        return out
    }

    /// Hot-then-settling amplitude-modulated sine: continuous phase, amplitude
    /// `hotAmp` for the first `hotFrames`, `quietAmp` after.
    private func hotThenSettling(freq: Double, hotAmp: Double, hotFrames: Int, quietAmp: Double, frames: Int, sampleRate: Double) -> [Float] {
        var out = [Float](repeating: 0, count: frames)
        for i in 0..<frames {
            let amp = i < hotFrames ? hotAmp : quietAmp
            out[i] = Float(amp * sin(2 * Double.pi * freq * Double(i) / sampleRate))
        }
        return out
    }

    func testLatencyImpulseEmergesAtOutLIndexL() {
        let params = LimiterParams(ceilingDb: 0, releaseMs: 50)
        let limiter = Limiter(params: params, sampleRate: fs)
        let frames = L + 4
        var left = [Float](repeating: 0, count: frames)
        var right = [Float](repeating: 0, count: frames)
        left[0] = 1

        limiter.process(left: &left, right: &right, frames: frames)

        for i in 0..<L {
            XCTAssertEqual(left[i], 0)
        }
        XCTAssertEqual(Double(left[L]), 1, accuracy: 1e-6)
        for i in (L + 1)..<frames {
            XCTAssertEqual(left[i], 0)
        }
    }

    func testBrickwallHotChainNeverExceedsCeiling() {
        let params = LimiterParams(ceilingDb: -0.3, releaseMs: 120)
        let limiter = Limiter(params: params, sampleRate: fs)
        let ceiling = pow(10, params.ceilingDb / 20)
        let frames = 4800
        // cos() so the very first sample (i=0) is already at the full 10.0
        // peak — the hardest case for the lookahead to catch.
        var left = [Float](repeating: 0, count: frames)
        var right = [Float](repeating: 0, count: frames)
        for i in 0..<frames {
            left[i] = Float(10 * cos(2 * Double.pi * 440 * Double(i) / fs))
            right[i] = Float(10 * cos(2 * Double.pi * 440 * Double(i) / fs + 0.2))
        }

        limiter.process(left: &left, right: &right, frames: frames)

        for i in 0..<frames {
            XCTAssertLessThanOrEqual(abs(Double(left[i])), ceiling + 1e-6)
            XCTAssertLessThanOrEqual(abs(Double(right[i])), ceiling + 1e-6)
        }
    }

    func testBelowCeilingInputPassesThroughAtUnityGainAfterLatency() {
        let params = LimiterParams(ceilingDb: -0.3, releaseMs: 120)
        let limiter = Limiter(params: params, sampleRate: fs)
        let ceiling = pow(10, params.ceilingDb / 20)
        let amp = pow(10, -12.0 / 20)
        XCTAssertLessThan(amp, ceiling)
        let frames = 4800
        var left = sine(freq: 440, amp: amp, frames: frames, sampleRate: fs)
        var right = sine(freq: 440, amp: amp, frames: frames, sampleRate: fs, startPhase: 0.5)
        let originalLeft = left
        let originalRight = right

        limiter.process(left: &left, right: &right, frames: frames)

        for i in L..<frames {
            XCTAssertEqual(Double(left[i]), Double(originalLeft[i - L]), accuracy: 1e-6)
            XCTAssertEqual(Double(right[i]), Double(originalRight[i - L]), accuracy: 1e-6)
        }
    }

    func testStereoLinkAppliesTheSameGainToBothChannels() {
        let params = LimiterParams(ceilingDb: -6, releaseMs: 80)
        let limiter = Limiter(params: params, sampleRate: fs)
        let frames = 4800
        var left = sine(freq: 440, amp: 0.9, frames: frames, sampleRate: fs)
        var right = sine(freq: 440, amp: 0.05, frames: frames, sampleRate: fs)
        let originalLeft = left
        let originalRight = right

        limiter.process(left: &left, right: &right, frames: frames)

        var checked = 0
        for i in (L + 200)..<frames {
            let inL = Double(originalLeft[i - L])
            let inR = Double(originalRight[i - L])
            if abs(inL) > 0.05 && abs(inR) > 0.001 {
                let gainL = Double(left[i]) / inL
                let gainR = Double(right[i]) / inR
                XCTAssertLessThanOrEqual(abs(gainL - gainR), 1e-6)
                checked += 1
            }
        }
        XCTAssertGreaterThan(checked, 0)
    }

    func testReleaseRecoversTowardUnityWithinFiveXReleaseMs() {
        // Single process() call over burst+quiet so the L-sample output delay
        // stays trivial to reason about: output[i + L] is the (possibly
        // gained) version of input[i], for every i, regardless of which
        // "phase" i falls in — no separate calls whose flush periods mix
        // burst tail into a window nominally indexed against the quiet
        // signal.
        let params = LimiterParams(ceilingDb: -6, releaseMs: 80)
        let limiter = Limiter(params: params, sampleRate: fs)
        let burstFrames = 9600
        let quietFrames = 20_000
        let totalFrames = burstFrames + quietFrames
        let quietAmp = pow(10, -40.0 / 20)
        var left = [Float](repeating: 0, count: totalFrames)
        var right = [Float](repeating: 0, count: totalFrames)
        for i in 0..<totalFrames {
            let amp = i < burstFrames ? 0.9 : quietAmp
            let v = Float(amp * sin(2 * Double.pi * 440 * Double(i) / fs))
            left[i] = v
            right[i] = v
        }
        let original = left
        limiter.process(left: &left, right: &right, frames: totalFrames)

        func peakRatio(inputStart: Int, length: Int) -> Double {
            var peakOut: Double = 0
            var peakIn: Double = 0
            for i in inputStart..<(inputStart + length) {
                peakOut = max(peakOut, abs(Double(left[i + L])))
                peakIn = max(peakIn, abs(Double(original[i])))
            }
            return peakOut / peakIn
        }

        // Right at the burst/quiet boundary: still heavily limited (gain << 1).
        let earlyRatio = peakRatio(inputStart: burstFrames, length: 50)
        // 5 x releaseMs (80ms) = 400ms = 19,200 frames into the quiet
        // passage: gain has recovered to unity.
        let lateRatio = peakRatio(inputStart: burstFrames + 19_200 - 50, length: 100)
        XCTAssertLessThan(earlyRatio, 0.9)
        XCTAssertGreaterThan(lateRatio, 0.99)
    }

    func testPerSampleSmoothingDuringReleaseHasNoZipperSteps() {
        // DC (constant) levels on both sides of the transition: the only way
        // an output sample can differ from its predecessor deep inside
        // either constant region is a change in gain, not the waveform's own
        // slope — isolating exactly what per-sample release smoothness
        // means.
        let params = LimiterParams(ceilingDb: -6, releaseMs: 80)
        let limiter = Limiter(params: params, sampleRate: fs)
        let burstFrames = 4800
        let quietFrames = 2000
        let totalFrames = burstFrames + quietFrames
        var left = [Float](repeating: 0, count: totalFrames)
        var right = [Float](repeating: 0, count: totalFrames)
        for i in 0..<burstFrames {
            left[i] = 0.9
            right[i] = 0.9
        }
        for i in burstFrames..<totalFrames {
            left[i] = 0.05
            right[i] = 0.05
        }

        limiter.process(left: &left, right: &right, frames: totalFrames)

        // Output index burstFrames + L is the single legitimate
        // discontinuity (the delayed input itself steps from 0.9 to 0.05
        // there). Everything strictly after that is constant-input territory
        // where gain is still releasing toward unity — exactly the window
        // the zipper guard targets.
        let windowStart = burstFrames + L + 1
        let windowEnd = totalFrames - 1
        var maxStep: Double = 0
        for i in windowStart..<windowEnd {
            maxStep = max(maxStep, abs(Double(left[i]) - Double(left[i - 1])))
        }
        // A control-rate (16-sample) stepped implementation would produce
        // jumps on the order of the full gain delta every 16 samples;
        // per-sample one-pole release keeps consecutive steps far smaller
        // than that.
        XCTAssertLessThan(maxStep, 0.001)
    }

    func testDeterminismSameInputProcessedTwiceProducesIdenticalOutput() {
        let params = LimiterParams(ceilingDb: -1, releaseMs: 100)
        let frames = 3000
        let left = hotThenSettling(freq: 440, hotAmp: 4, hotFrames: 500, quietAmp: 0.3, frames: frames, sampleRate: fs)
        let right = hotThenSettling(freq: 440, hotAmp: 4, hotFrames: 500, quietAmp: 0.3, frames: frames, sampleRate: fs)

        let limiterA = Limiter(params: params, sampleRate: fs)
        var leftA = left
        var rightA = right
        limiterA.process(left: &leftA, right: &rightA, frames: frames)

        let limiterB = Limiter(params: params, sampleRate: fs)
        var leftB = left
        var rightB = right
        limiterB.process(left: &leftB, right: &rightB, frames: frames)

        for i in 0..<frames {
            XCTAssertEqual(leftB[i], leftA[i])
            XCTAssertEqual(rightB[i], rightA[i])
        }
    }

    func testResetRestoresInitialStateExactly() {
        let params = LimiterParams(ceilingDb: -1, releaseMs: 100)
        let limiter = Limiter(params: params, sampleRate: fs)
        let frames = 3000
        let left = hotThenSettling(freq: 440, hotAmp: 4, hotFrames: 500, quietAmp: 0.3, frames: frames, sampleRate: fs)
        let right = hotThenSettling(freq: 440, hotAmp: 4, hotFrames: 500, quietAmp: 0.3, frames: frames, sampleRate: fs)

        var leftA = left
        var rightA = right
        limiter.process(left: &leftA, right: &rightA, frames: frames)

        limiter.reset()

        var leftB = left
        var rightB = right
        limiter.process(left: &leftB, right: &rightB, frames: frames)

        for i in 0..<frames {
            XCTAssertEqual(leftB[i], leftA[i])
            XCTAssertEqual(rightB[i], rightA[i])
        }
    }

    func testLatencySamplesReturnsLimiterLookaheadSamples() {
        let limiter = Limiter(params: LimiterParams(ceilingDb: -0.3, releaseMs: 120), sampleRate: fs)
        XCTAssertEqual(limiter.latencySamples, limiterLookaheadSamples)
    }

    func testMatchesTwinReference() {
        let params = defaultMasterConfig.limiter
        let limiter = Limiter(params: params, sampleRate: fs)
        let warmupFrames = 4800
        let captureFrames = 8
        let totalFrames = warmupFrames + captureFrames
        var left = hotThenSettling(freq: 440, hotAmp: 5, hotFrames: 1000, quietAmp: 0.3, frames: totalFrames, sampleRate: fs)
        var right = hotThenSettling(freq: 440, hotAmp: 2.5, hotFrames: 1000, quietAmp: 0.15, frames: totalFrames, sampleRate: fs)
        limiter.process(left: &left, right: &right, frames: totalFrames)
        XCTAssertEqual(twinReferenceL.count, 8)
        XCTAssertEqual(twinReferenceR.count, 8)
        for i in 0..<8 {
            XCTAssertEqual(Double(left[warmupFrames + i]), twinReferenceL[i], accuracy: 1e-6)
            XCTAssertEqual(Double(right[warmupFrames + i]), twinReferenceR[i], accuracy: 1e-6)
        }
    }
}
