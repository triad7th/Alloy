@testable import AlloyAudio
import XCTest

final class PolyBlepOscillatorTests: XCTestCase {
    private let fs = 48_000.0
    private let twinReference: [Double] = [0,-0.9816666841506958,-0.9633333086967468,-0.9449999928474426,-0.9266666769981384,-0.9083333611488342,-0.8899999856948853,-0.871666669845581]

    func testSineMatchesStdlib() {
        let osc = PolyBlepOscillator(shape: .sine, sampleRate: fs)
        osc.setFrequency(440)
        for i in 0..<100 {
            XCTAssertEqual(osc.nextSample(), sin(2 * Double.pi * 440 * Double(i) / fs), accuracy: 1e-9)
        }
    }

    func testSawSoftensResetStep() {
        let osc = PolyBlepOscillator(shape: .saw, sampleRate: fs)
        osc.setFrequency(2000)
        let out = (0..<200).map { _ in osc.nextSample() }
        var maxJump = 0.0
        for i in 1..<out.count {
            maxJump = max(maxJump, abs(out[i] - out[i - 1]))
        }
        XCTAssertLessThan(maxJump, 1.4)
        XCTAssertGreaterThan(maxJump, 0.2)
    }

    func testPulseMeanTracksWidth() {
        let osc = PolyBlepOscillator(shape: .pulse, sampleRate: fs, pulseWidth: 0.25)
        osc.setFrequency(100)
        let out = (0..<4800).map { _ in osc.nextSample() }
        let mean = out.reduce(0, +) / Double(out.count)
        XCTAssertEqual(mean, 2 * 0.25 - 1, accuracy: 0.05)
    }

    func testInitialPhase() {
        let osc = PolyBlepOscillator(shape: .sine, sampleRate: fs, initialPhase: 0.25)
        osc.setFrequency(440)
        XCTAssertEqual(osc.nextSample(), 1, accuracy: 1e-9)
    }

    func testMatchesTwinReference() {
        let osc = PolyBlepOscillator(shape: .saw, sampleRate: fs)
        osc.setFrequency(440)
        XCTAssertEqual(twinReference.count, 8)
        for expected in twinReference {
            XCTAssertEqual(osc.nextSample(), expected, accuracy: 1e-6)
        }
    }
}
