@testable import AlloyAudio
import XCTest

final class LfoTests: XCTestCase {
    private let fs = 1000.0
    private let twinReference: [Double] = [0, 0.30901700258255005, 0.5877852439880371, 0.80901700258255, 0.9510565400123596, 1, 0.9510565400123596, 0.80901700258255]

    func testZeroDuringDelay() {
        let lfo = Lfo(params: LfoParams(shape: .sine, rateHz: 10, delay: 0.1, fadeIn: 0), sampleRate: fs)
        for _ in 0..<100 {
            XCTAssertEqual(lfo.nextSample(), 0)
        }
        XCTAssertNotEqual(lfo.nextSample(), 0)
    }

    func testLinearFadeIn() {
        let lfo = Lfo(params: LfoParams(shape: .triangle, rateHz: 1, delay: 0, fadeIn: 1), sampleRate: fs)
        let out = (0..<260).map { _ in lfo.nextSample() }
        XCTAssertEqual(out[250], 0.25, accuracy: 0.01)
    }

    func testBoundedAndPeriodic() {
        let lfo = Lfo(params: LfoParams(shape: .sine, rateHz: 50, delay: 0, fadeIn: 0), sampleRate: fs)
        let out = (0..<200).map { _ in lfo.nextSample() }
        for v in out {
            XCTAssertLessThanOrEqual(abs(v), 1)
        }
        for i in 0..<100 {
            XCTAssertEqual(out[i], out[i + 20], accuracy: 1e-9)
        }
    }

    func testMatchesTwinReference() {
        let lfo = Lfo(params: LfoParams(shape: .sine, rateHz: 50, delay: 0, fadeIn: 0), sampleRate: fs)
        XCTAssertEqual(twinReference.count, 8)
        for expected in twinReference {
            XCTAssertEqual(lfo.nextSample(), expected, accuracy: 1e-6)
        }
    }
}
