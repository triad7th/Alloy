@testable import AlloyAudio
import Foundation
import XCTest

final class MasterBusTests: XCTestCase {
    private let fs = 48_000.0
    private let maxBlockFrames = 4096

    private let twinMasterL: [Double] = [
        0.2579195499420166, 0.2700578570365906, 0.28198695182800293, 0.29387202858924866, 0.30552127957344055,
        0.3185104727745056, 0.33024680614471436, 0.341719388961792,
    ]
    private let twinMasterR: [Double] = [
        0.4227323532104492, 0.4314018189907074, 0.44081199169158936, 0.4491724967956543, 0.45704570412635803,
        0.464513897895813, 0.47212913632392883, 0.47827354073524475,
    ]

    private func makeBus() -> MasterBus {
        MasterBus(config: defaultMasterConfig, sampleRate: fs)
    }

    private func sine(freq: Double, amp: Double, frames: Int, startPhase: Double = 0) -> [Float] {
        var out = [Float](repeating: 0, count: frames)
        for i in 0..<frames {
            out[i] = Float(amp * sin(startPhase + 2 * Double.pi * freq * Double(i) / fs))
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

    /// Runs `bus.process` in <= maxBlockFrames chunks over the full arrays,
    /// in place — mirrors how PatchEngine.renderSegment feeds the master bus
    /// (never a single call larger than the engine's own segment cap).
    private func processChunked(_ bus: MasterBus, _ left: inout [Float], _ right: inout [Float], frames: Int) {
        var offset = 0
        while offset < frames {
            let n = min(maxBlockFrames, frames - offset)
            var chunkL = Array(left[offset..<(offset + n)])
            var chunkR = Array(right[offset..<(offset + n)])
            bus.process(left: &chunkL, right: &chunkR, frames: n)
            for i in 0..<n {
                left[offset + i] = chunkL[i]
                right[offset + i] = chunkR[i]
            }
            offset += n
        }
    }

    func testSendsZeroOutputEqualsInputDelayedByLatencySamples() {
        let bus = makeBus()
        bus.setSends(reverb: 0, delay: 0)
        let ceiling = pow(10, defaultMasterConfig.limiter.ceilingDb / 20)
        let amp = pow(10, -12.0 / 20)
        XCTAssertLessThan(amp, ceiling)
        let frames = 4000
        var left = sine(freq: 440, amp: amp, frames: frames)
        var right = sine(freq: 440, amp: amp, frames: frames, startPhase: 0.5)
        let originalLeft = left
        let originalRight = right

        bus.process(left: &left, right: &right, frames: frames)

        for i in bus.latencySamples..<frames {
            XCTAssertEqual(Double(left[i]), Double(originalLeft[i - bus.latencySamples]), accuracy: 1e-6)
            XCTAssertEqual(Double(right[i]), Double(originalRight[i - bus.latencySamples]), accuracy: 1e-6)
        }
    }

    func testReverbSendAddsADecayingTail() {
        let bus = makeBus()
        bus.setSends(reverb: 0.3, delay: 0)
        let frames = 20_000
        var left = [Float](repeating: 0, count: frames)
        var right = [Float](repeating: 0, count: frames)
        left[0] = 1
        right[0] = 1

        processChunked(bus, &left, &right, frames: frames)

        // The direct dry impulse alone would only ever be nonzero at
        // output[latencySamples]; any energy well past that must come from
        // the reverb's ringing tail (sendDelay is 0, so the delay
        // contributes none).
        let tailRms = rms(left, start: bus.latencySamples + 2000, length: 2000)
        XCTAssertGreaterThan(tailRms, 1e-4)
    }

    func testDelaySendAddsAnEchoNearDelayTimePlusLatencySamples() {
        let bus = makeBus()
        bus.setSends(reverb: 0, delay: 0.3)
        let delaySamples = Int(((defaultMasterConfig.delay.timeMs / 1000) * fs).rounded())
        let frames = delaySamples + 200
        var left = [Float](repeating: 0, count: frames)
        var right = [Float](repeating: 0, count: frames)
        left[0] = 1
        right[0] = 1

        processChunked(bus, &left, &right, frames: frames)

        let echoIndex = delaySamples + bus.latencySamples
        // The undamped direct tap of the delay's first echo: dry * sendDelay.
        XCTAssertGreaterThan(abs(left[echoIndex]), 0.05)
        // Well before the echo (past the direct dry sample, before the delay
        // line has anything to emit), the bus is silent.
        XCTAssertLessThan(abs(left[echoIndex - 100]), 1e-6)
    }

    func testLimiterStillBrickwallsWithHotSends() {
        let bus = makeBus()
        bus.setSends(reverb: 0.5, delay: 0.5)
        let ceiling = pow(10, defaultMasterConfig.limiter.ceilingDb / 20)
        let frames = 4000
        var left = [Float](repeating: 0, count: frames)
        var right = [Float](repeating: 0, count: frames)
        for i in 0..<frames {
            left[i] = Float(10 * cos(2 * Double.pi * 440 * Double(i) / fs))
            right[i] = Float(10 * cos(2 * Double.pi * 440 * Double(i) / fs + 0.2))
        }

        bus.process(left: &left, right: &right, frames: frames)

        for i in 0..<frames {
            XCTAssertLessThanOrEqual(Double(abs(left[i])), ceiling + 1e-6)
            XCTAssertLessThanOrEqual(Double(abs(right[i])), ceiling + 1e-6)
        }
    }

    func testDeterminismTwoFreshInstancesBitIdentical() {
        let frames = 4000
        let inL = sine(freq: 330, amp: 0.4, frames: frames)
        let inR = sine(freq: 330, amp: 0.4, frames: frames, startPhase: 0.3)
        let a = makeBus()
        let b = makeBus()
        a.setSends(reverb: 0.3, delay: 0.25)
        b.setSends(reverb: 0.3, delay: 0.25)
        var leftA = inL
        var rightA = inR
        var leftB = inL
        var rightB = inR
        a.process(left: &leftA, right: &rightA, frames: frames)
        b.process(left: &leftB, right: &rightB, frames: frames)
        for i in 0..<frames {
            XCTAssertEqual(leftB[i], leftA[i])
            XCTAssertEqual(rightB[i], rightA[i])
        }
    }

    func testResetRestoresInitialStateExactly() {
        let bus = makeBus()
        bus.setSends(reverb: 0.3, delay: 0.25)
        let frames = 4000
        let input = sine(freq: 330, amp: 0.4, frames: frames)

        var leftA = input
        var rightA = input
        bus.process(left: &leftA, right: &rightA, frames: frames)

        bus.reset()

        var leftB = input
        var rightB = input
        bus.process(left: &leftB, right: &rightB, frames: frames)

        for i in 0..<frames {
            XCTAssertEqual(leftB[i], leftA[i])
            XCTAssertEqual(rightB[i], rightA[i])
        }
    }

    func testMatchesTwinReference() {
        let bus = makeBus()
        bus.setSends(reverb: 0.3, delay: 0.25)
        let warmupFrames = 4000
        let captureFrames = 8
        let totalFrames = warmupFrames + captureFrames
        var left = sine(freq: 220, amp: 0.5, frames: totalFrames)
        var right = sine(freq: 220, amp: 0.5, frames: totalFrames, startPhase: 0.4)

        bus.process(left: &left, right: &right, frames: totalFrames)

        XCTAssertEqual(twinMasterL.count, 8)
        XCTAssertEqual(twinMasterR.count, 8)
        for i in 0..<8 {
            XCTAssertEqual(Double(left[warmupFrames + i]), twinMasterL[i], accuracy: 1e-6)
            XCTAssertEqual(Double(right[warmupFrames + i]), twinMasterR[i], accuracy: 1e-6)
        }
    }
}
