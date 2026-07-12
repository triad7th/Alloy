@testable import AlloyAudio
import Foundation
import XCTest

final class CompressorTests: XCTestCase {
    private let fs = 48_000.0

    private let twinReferenceL: [Double] = [
        5.5357342753530655e-15, 0.01805964484810829, 0.03605939820408821, 0.053939562290906906,
        0.07164084911346436, 0.0891045406460762, 0.10627273470163345, 0.12308848649263382,
    ]
    private let twinReferenceR: [Double] = [
        2.7678671376765327e-15, 0.009029822424054146, 0.018029699102044106, 0.026969781145453453,
        0.03582042455673218, 0.0445522703230381, 0.05313636735081673, 0.06154424324631691,
    ]

    private func sine(freq: Double, amp: Double, frames: Int, sampleRate: Double, startPhase: Double = 0) -> [Float] {
        var out = [Float](repeating: 0, count: frames)
        for i in 0..<frames {
            out[i] = Float(amp * sin(startPhase + 2 * Double.pi * freq * Double(i) / sampleRate))
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

    func testBelowThresholdInputIsANearBypass() {
        // -40 dBFS sine, threshold -20 dB: env is bounded above by the input
        // amplitude (0.01), so envDb <= -40 always < thresholdDb, over is
        // always 0, and with makeupDb 0 the gain resolves to exactly 1 at
        // every control tick (including the very first, using the init env).
        let params = CompressorParams(thresholdDb: -20, ratio: 4, attackMs: 5, releaseMs: 80, makeupDb: 0)
        let compressor = Compressor(params: params, sampleRate: fs)
        let amp = pow(10, -40.0 / 20)
        let frames = 9600
        var left = sine(freq: 440, amp: amp, frames: frames, sampleRate: fs)
        var right = sine(freq: 440, amp: amp, frames: frames, sampleRate: fs)
        let originalLeft = left
        let originalRight = right
        compressor.process(left: &left, right: &right, frames: frames)
        for i in 0..<frames {
            XCTAssertLessThanOrEqual(abs(Double(left[i]) - Double(originalLeft[i])), 1e-6)
            XCTAssertLessThanOrEqual(abs(Double(right[i]) - Double(originalRight[i])), 1e-6)
        }
    }

    func testLoudSignalIsCompressed() {
        let params = CompressorParams(thresholdDb: -20, ratio: 4, attackMs: 5, releaseMs: 80, makeupDb: 0)
        let compressed = Compressor(params: params, sampleRate: fs)
        let neutralParams = CompressorParams(thresholdDb: -20, ratio: 1, attackMs: 5, releaseMs: 80, makeupDb: 0)
        let neutral = Compressor(params: neutralParams, sampleRate: fs)
        let frames = 48_000
        var left = sine(freq: 440, amp: 1.0, frames: frames, sampleRate: fs)
        var leftNeutral = left
        var right = left
        var rightNeutral = left
        compressed.process(left: &left, right: &right, frames: frames)
        neutral.process(left: &leftNeutral, right: &rightNeutral, frames: frames)

        let start = 24_000
        let length = 9600
        let outRms = rms(left, start: start, length: length)
        let dryRms = rms(leftNeutral, start: start, length: length)
        let reductionDb = 20 * log10(dryRms / outRms)
        // Measured ~14.34 dB: the detector tracks the rectified sine's
        // smoothed envelope, which sits below the 0 dBFS peak, so the
        // realized reduction is a bit under the naive 15 dB estimate —
        // well within the +-2 dB band.
        XCTAssertGreaterThan(reductionDb, 13)
        XCTAssertLessThan(reductionDb, 17)
    }

    func testAttackPassesNearUnityGainRightAfterAStep() {
        let params = CompressorParams(thresholdDb: -20, ratio: 4, attackMs: 50, releaseMs: 80, makeupDb: 0)
        let compressor = Compressor(params: params, sampleRate: fs)
        let silenceFrames = 2400
        let burstFrames = 2400
        let totalFrames = silenceFrames + burstFrames
        var left = [Float](repeating: 0, count: totalFrames)
        let burst = sine(freq: 440, amp: 1.0, frames: burstFrames, sampleRate: fs)
        for i in 0..<burstFrames {
            left[silenceFrames + i] = burst[i]
        }
        var right = left

        compressor.process(left: &left, right: &right, frames: totalFrames)

        var earlyPeak: Double = 0
        for i in silenceFrames..<(silenceFrames + 48) {
            earlyPeak = max(earlyPeak, abs(Double(left[i])))
        }
        var steadyPeak: Double = 0
        for i in (silenceFrames + 2000)..<(silenceFrames + 2200) {
            steadyPeak = max(steadyPeak, abs(Double(left[i])))
        }
        XCTAssertGreaterThan(earlyPeak, steadyPeak)
        XCTAssertGreaterThan(earlyPeak, 0.9)
    }

    func testReleaseRecoversTowardUnityWithinFiveXReleaseMs() {
        let params = CompressorParams(thresholdDb: -20, ratio: 4, attackMs: 5, releaseMs: 80, makeupDb: 0)
        let compressor = Compressor(params: params, sampleRate: fs)
        let burstFrames = 9600
        var burst = sine(freq: 440, amp: 1.0, frames: burstFrames, sampleRate: fs)
        var burstR = burst
        compressor.process(left: &burst, right: &burstR, frames: burstFrames)

        let quietAmp = pow(10, -40.0 / 20)
        let quietFrames = 20_000
        let quietStartPhase = 2 * Double.pi * 440 * Double(burstFrames) / fs
        let quietOriginal = sine(freq: 440, amp: quietAmp, frames: quietFrames, sampleRate: fs, startPhase: quietStartPhase)
        var quiet = quietOriginal
        var quietRight = quietOriginal
        compressor.process(left: &quiet, right: &quietRight, frames: quietFrames)

        func peakRatio(start: Int, length: Int) -> Double {
            var peakOut: Double = 0
            var peakIn: Double = 0
            for i in start..<(start + length) {
                peakOut = max(peakOut, abs(Double(quiet[i])))
                peakIn = max(peakIn, abs(Double(quietOriginal[i])))
            }
            return peakOut / peakIn
        }

        let earlyRatio = peakRatio(start: 0, length: 50)
        // 5 x releaseMs (80ms) = 400ms = 19,200 frames: gain has recovered.
        let lateRatio = peakRatio(start: 19_200 - 50, length: 100)
        XCTAssertLessThan(earlyRatio, 0.5)
        XCTAssertGreaterThan(lateRatio, 0.99)
    }

    func testMakeupGainAppliesBelowThreshold() {
        let params = CompressorParams(thresholdDb: -20, ratio: 4, attackMs: 5, releaseMs: 80, makeupDb: 6)
        let compressor = Compressor(params: params, sampleRate: fs)
        let amp = pow(10, -40.0 / 20)
        let frames = 9600
        var left = sine(freq: 440, amp: amp, frames: frames, sampleRate: fs)
        var right = left
        let originalLeft = left
        compressor.process(left: &left, right: &right, frames: frames)

        let expectedGain = pow(10, 6.0 / 20)
        for i in 100..<frames {
            if abs(Double(originalLeft[i])) > 1e-6 {
                let relDiff = abs(Double(left[i]) / Double(originalLeft[i]) - expectedGain) / expectedGain
                XCTAssertLessThan(relDiff, 1e-3)
            }
        }
    }

    func testStereoLinkAppliesTheSameGainToBothChannels() {
        let params = CompressorParams(thresholdDb: -20, ratio: 4, attackMs: 5, releaseMs: 80, makeupDb: 0)
        let compressor = Compressor(params: params, sampleRate: fs)
        let frames = 9600
        var left = sine(freq: 440, amp: 0.9, frames: frames, sampleRate: fs)
        var right = sine(freq: 440, amp: 0.05, frames: frames, sampleRate: fs)
        let originalLeft = left
        let originalRight = right
        compressor.process(left: &left, right: &right, frames: frames)

        for i in 200..<frames {
            if abs(Double(originalLeft[i])) > 0.01 && abs(Double(originalRight[i])) > 0.001 {
                let gainL = Double(left[i]) / Double(originalLeft[i])
                let gainR = Double(right[i]) / Double(originalRight[i])
                XCTAssertLessThanOrEqual(abs(gainL - gainR), 1e-6)
            }
        }
    }

    func testResetRestoresInitialStateExactly() {
        let params = CompressorParams(thresholdDb: -18, ratio: 6, attackMs: 10, releaseMs: 120, makeupDb: 4)
        let compressor = Compressor(params: params, sampleRate: fs)
        let input = sine(freq: 330, amp: 0.8, frames: 2048, sampleRate: fs)

        var leftA = input
        var rightA = input
        compressor.process(left: &leftA, right: &rightA, frames: 2048)

        compressor.reset()

        var leftB = input
        var rightB = input
        compressor.process(left: &leftB, right: &rightB, frames: 2048)

        for i in 0..<2048 {
            XCTAssertEqual(leftB[i], leftA[i])
            XCTAssertEqual(rightB[i], rightA[i])
        }
    }

    func testValidateInsertEnforcesCompressorBounds() {
        let base = CompressorParams(thresholdDb: -18, ratio: 4, attackMs: 5, releaseMs: 80, makeupDb: 3)
        XCTAssertEqual(validateInsert(.compressor(base)), [])

        var p = base
        p.thresholdDb = -60.1
        XCTAssertFalse(validateInsert(.compressor(p)).isEmpty)
        p = base
        p.thresholdDb = 0.1
        XCTAssertFalse(validateInsert(.compressor(p)).isEmpty)
        p = base
        p.ratio = 0.9
        XCTAssertFalse(validateInsert(.compressor(p)).isEmpty)
        p = base
        p.ratio = 20.1
        XCTAssertFalse(validateInsert(.compressor(p)).isEmpty)
        p = base
        p.attackMs = 0
        XCTAssertFalse(validateInsert(.compressor(p)).isEmpty)
        p = base
        p.attackMs = 100.1
        XCTAssertFalse(validateInsert(.compressor(p)).isEmpty)
        p = base
        p.releaseMs = 0
        XCTAssertFalse(validateInsert(.compressor(p)).isEmpty)
        p = base
        p.releaseMs = 1000.1
        XCTAssertFalse(validateInsert(.compressor(p)).isEmpty)
        p = base
        p.makeupDb = -0.1
        XCTAssertFalse(validateInsert(.compressor(p)).isEmpty)
        p = base
        p.makeupDb = 24.1
        XCTAssertFalse(validateInsert(.compressor(p)).isEmpty)
    }

    func testCompressorInsertJsonPinDecodesAndValidatesClean() throws {
        // Same JSON string as the TS spec ('compressor insert JSON pin:
        // parses and validates clean').
        let json = #"{ "kind": "compressor", "compressor": { "thresholdDb": -18, "ratio": 4, "attackMs": 5, "releaseMs": 80, "makeupDb": 3 } }"#
        let insert = try JSONDecoder().decode(InsertSpec.self, from: Data(json.utf8))
        XCTAssertEqual(validateInsert(insert), [])
        guard case let .compressor(compressor) = insert else {
            return XCTFail("expected a compressor insert")
        }
        XCTAssertEqual(compressor.thresholdDb, -18)
        XCTAssertEqual(compressor.ratio, 4)
        XCTAssertEqual(compressor.attackMs, 5)
        XCTAssertEqual(compressor.releaseMs, 80)
        XCTAssertEqual(compressor.makeupDb, 3)
    }

    func testMatchesTwinReference() {
        let params = CompressorParams(thresholdDb: -18, ratio: 4, attackMs: 5, releaseMs: 80, makeupDb: 3)
        let compressor = Compressor(params: params, sampleRate: fs)
        let warmupFrames = 4800
        let captureFrames = 8
        let totalFrames = warmupFrames + captureFrames
        var left = sine(freq: 440, amp: 0.9, frames: totalFrames, sampleRate: fs)
        var right = sine(freq: 440, amp: 0.45, frames: totalFrames, sampleRate: fs)
        compressor.process(left: &left, right: &right, frames: totalFrames)
        XCTAssertEqual(twinReferenceL.count, 8)
        XCTAssertEqual(twinReferenceR.count, 8)
        for i in 0..<8 {
            XCTAssertEqual(Double(left[warmupFrames + i]), twinReferenceL[i], accuracy: 1e-6)
            XCTAssertEqual(Double(right[warmupFrames + i]), twinReferenceR[i], accuracy: 1e-6)
        }
    }
}
