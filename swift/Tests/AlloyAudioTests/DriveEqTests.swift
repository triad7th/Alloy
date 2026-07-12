@testable import AlloyAudio
import Foundation
import XCTest

final class DriveEqTests: XCTestCase {
    private let fs = 48_000.0

    private let twinReferenceL: [Double] = [
        -0.7378411889076233, -0.7547575235366821, -0.7704368233680725, -0.7848948240280151,
        -0.798133373260498, -0.8101407885551453, -0.8208932280540466, -0.8303543329238892,
    ]
    private let twinReferenceR: [Double] = [
        -0.7378411889076233, -0.7547575235366821, -0.7704368233680725, -0.7848948240280151,
        -0.798133373260498, -0.8101407885551453, -0.8208932280540466, -0.8303543329238892,
    ]

    private let neutral = DriveEqParams(drive: 0, lowDb: 0, midDb: 0, highDb: 0, levelDb: 0)

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

    func testNeutralIsNotABypassButExactlyTanhOfInput() {
        // A small-amplitude probe keeps float32 storage quantization of
        // tanh(x) far below the 1e-12 budget (same trick as rotary's
        // depth-0/mix-1 test): at amp 1e-5 the float32 ULP is ~1e-12, half
        // a ULP is well inside the assertion.
        let eq = DriveEq(params: neutral, sampleRate: fs)
        let amp = 1e-5
        let frames = 256
        let input = sine(freq: 97, amp: amp, frames: frames, sampleRate: fs)
        var left = input
        var right = input
        eq.process(left: &left, right: &right, frames: frames)
        for i in 0..<frames {
            let expected = tanh(Double(input[i]))
            XCTAssertLessThanOrEqual(abs(Double(left[i]) - expected), 1e-12)
            XCTAssertLessThanOrEqual(abs(Double(right[i]) - expected), 1e-12)
        }
    }

    func testDriveOneSaturatesAPointNineAmplitudeSine() {
        var params = neutral
        params.drive = 1
        let eq = DriveEq(params: params, sampleRate: fs)
        let frames = 4800
        let input = sine(freq: 440, amp: 0.9, frames: frames, sampleRate: fs)
        var left = input
        var right = input
        eq.process(left: &left, right: &right, frames: frames)

        var peakIn: Double = 0
        var peakOut: Double = 0
        var maxDiff: Double = 0
        for i in 0..<frames {
            peakIn = max(peakIn, abs(Double(input[i])))
            peakOut = max(peakOut, abs(Double(left[i])))
            maxDiff = max(maxDiff, abs(Double(left[i]) - Double(input[i])))
        }
        // Without saturation, preGain=5 would grow the peak to ~4.5 (5x).
        // tanh clamps it close to unity instead — measured ratio ~1.111.
        XCTAssertLessThan(peakOut, peakIn * 1.2)
        XCTAssertGreaterThan(maxDiff, 0.1)
        XCTAssertEqual(left, right)
    }

    func testLowShelfBoostsLowFrequencyFarMoreThanHighFrequency() {
        var boosted = neutral
        boosted.lowDb = 12
        let frames = 9600
        let warmup = 4800

        let neutral100 = DriveEq(params: neutral, sampleRate: fs)
        let boosted100 = DriveEq(params: boosted, sampleRate: fs)
        let in100 = sine(freq: 100, amp: 0.5, frames: frames, sampleRate: fs)
        var outNeutral100 = in100
        var outBoosted100 = in100
        var scratch = in100
        neutral100.process(left: &outNeutral100, right: &scratch, frames: frames)
        scratch = in100
        boosted100.process(left: &outBoosted100, right: &scratch, frames: frames)
        let ratio100 = rms(outBoosted100, start: warmup, length: frames - warmup) / rms(outNeutral100, start: warmup, length: frames - warmup)

        let neutral5k = DriveEq(params: neutral, sampleRate: fs)
        let boosted5k = DriveEq(params: boosted, sampleRate: fs)
        let in5k = sine(freq: 5000, amp: 0.5, frames: frames, sampleRate: fs)
        var outNeutral5k = in5k
        var outBoosted5k = in5k
        scratch = in5k
        neutral5k.process(left: &outNeutral5k, right: &scratch, frames: frames)
        scratch = in5k
        boosted5k.process(left: &outBoosted5k, right: &scratch, frames: frames)
        let ratio5k = rms(outBoosted5k, start: warmup, length: frames - warmup) / rms(outNeutral5k, start: warmup, length: frames - warmup)

        XCTAssertGreaterThan(ratio100, 3.5)
        XCTAssertLessThan(ratio100, 4.2)
        XCTAssertLessThan(ratio5k, 1.3)
    }

    func testHighShelfAttenuatesHighFrequencyFarMoreThanLowFrequency() {
        var cut = neutral
        cut.highDb = -12
        let frames = 9600
        let warmup = 4800

        let neutral8k = DriveEq(params: neutral, sampleRate: fs)
        let cut8k = DriveEq(params: cut, sampleRate: fs)
        let in8k = sine(freq: 8000, amp: 0.5, frames: frames, sampleRate: fs)
        var outNeutral8k = in8k
        var outCut8k = in8k
        var scratch = in8k
        neutral8k.process(left: &outNeutral8k, right: &scratch, frames: frames)
        scratch = in8k
        cut8k.process(left: &outCut8k, right: &scratch, frames: frames)
        let ratio8k = rms(outCut8k, start: warmup, length: frames - warmup) / rms(outNeutral8k, start: warmup, length: frames - warmup)

        let neutral100 = DriveEq(params: neutral, sampleRate: fs)
        let cut100 = DriveEq(params: cut, sampleRate: fs)
        let in100 = sine(freq: 100, amp: 0.5, frames: frames, sampleRate: fs)
        var outNeutral100 = in100
        var outCut100 = in100
        scratch = in100
        neutral100.process(left: &outNeutral100, right: &scratch, frames: frames)
        scratch = in100
        cut100.process(left: &outCut100, right: &scratch, frames: frames)
        let ratio100 = rms(outCut100, start: warmup, length: frames - warmup) / rms(outNeutral100, start: warmup, length: frames - warmup)

        XCTAssertGreaterThanOrEqual(1 / ratio8k, 1.8)
        XCTAssertLessThan(ratio100, 1.3)
    }

    func testResetRestoresInitialStateExactly() {
        let params = DriveEqParams(drive: 0.4, lowDb: 3, midDb: -2, highDb: 4, levelDb: -1)
        let eq = DriveEq(params: params, sampleRate: fs)
        let input = sine(freq: 330, amp: 0.6, frames: 512, sampleRate: fs)

        var leftA = input
        var rightA = input
        eq.process(left: &leftA, right: &rightA, frames: 512)

        eq.reset()

        var leftB = input
        var rightB = input
        eq.process(left: &leftB, right: &rightB, frames: 512)

        for i in 0..<512 {
            XCTAssertEqual(leftB[i], leftA[i])
            XCTAssertEqual(rightB[i], rightA[i])
        }
    }

    func testValidateInsertEnforcesDriveEqBounds() {
        let base = DriveEqParams(drive: 0.5, lowDb: 0, midDb: 0, highDb: 0, levelDb: 0)
        XCTAssertEqual(validateInsert(.driveEq(base)), [])

        var p = base
        p.drive = -0.1
        XCTAssertFalse(validateInsert(.driveEq(p)).isEmpty)
        p = base
        p.drive = 1.1
        XCTAssertFalse(validateInsert(.driveEq(p)).isEmpty)
        p = base
        p.lowDb = -12.1
        XCTAssertFalse(validateInsert(.driveEq(p)).isEmpty)
        p = base
        p.lowDb = 12.1
        XCTAssertFalse(validateInsert(.driveEq(p)).isEmpty)
        p = base
        p.midDb = -12.1
        XCTAssertFalse(validateInsert(.driveEq(p)).isEmpty)
        p = base
        p.midDb = 12.1
        XCTAssertFalse(validateInsert(.driveEq(p)).isEmpty)
        p = base
        p.highDb = -12.1
        XCTAssertFalse(validateInsert(.driveEq(p)).isEmpty)
        p = base
        p.highDb = 12.1
        XCTAssertFalse(validateInsert(.driveEq(p)).isEmpty)
        p = base
        p.levelDb = -12.1
        XCTAssertFalse(validateInsert(.driveEq(p)).isEmpty)
        p = base
        p.levelDb = 12.1
        XCTAssertFalse(validateInsert(.driveEq(p)).isEmpty)
    }

    func testDriveEqInsertJsonPinDecodesAndValidatesClean() throws {
        // Same JSON string as the TS spec ('driveEq insert JSON pin: parses
        // and validates clean').
        let json = #"{ "kind": "driveEq", "driveEq": { "drive": 0.4, "lowDb": 3, "midDb": -2, "highDb": 4, "levelDb": -1 } }"#
        let insert = try JSONDecoder().decode(InsertSpec.self, from: Data(json.utf8))
        XCTAssertEqual(validateInsert(insert), [])
        guard case let .driveEq(driveEq) = insert else {
            return XCTFail("expected a driveEq insert")
        }
        XCTAssertEqual(driveEq.drive, 0.4)
        XCTAssertEqual(driveEq.lowDb, 3)
        XCTAssertEqual(driveEq.midDb, -2)
        XCTAssertEqual(driveEq.highDb, 4)
        XCTAssertEqual(driveEq.levelDb, -1)
    }

    func testMatchesTwinReference() {
        let params = DriveEqParams(drive: 0.4, lowDb: 3, midDb: -2, highDb: 4, levelDb: -1)
        let eq = DriveEq(params: params, sampleRate: fs)
        let warmupFrames = 512
        let captureFrames = 8
        let totalFrames = warmupFrames + captureFrames
        let input = sine(freq: 440, amp: 0.5, frames: totalFrames, sampleRate: fs)
        var left = input
        var right = input
        eq.process(left: &left, right: &right, frames: totalFrames)
        XCTAssertEqual(twinReferenceL.count, 8)
        XCTAssertEqual(twinReferenceR.count, 8)
        for i in 0..<8 {
            XCTAssertEqual(Double(left[warmupFrames + i]), twinReferenceL[i], accuracy: 1e-6)
            XCTAssertEqual(Double(right[warmupFrames + i]), twinReferenceR[i], accuracy: 1e-6)
        }
    }
}
