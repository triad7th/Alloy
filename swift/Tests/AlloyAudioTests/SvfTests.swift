@testable import AlloyAudio
import XCTest

final class SvfTests: XCTestCase {
    private let fs = 48_000.0
    private let twinReference: [Double] = [0,0.00022542514489032328,0.001310171326622367,0.0039899712428450584,0.008845254778862,0.016315346583724022,0.026712505146861076,0.040235623717308044]

    private func rms(_ xs: [Double]) -> Double {
        sqrt(xs.reduce(0) { $0 + $1 * $1 } / Double(xs.count))
    }

    private func renderSine(_ filter: Svf, freq: Double, n: Int) -> [Double] {
        var out: [Double] = []
        for i in 0..<n {
            out.append(filter.process(sin(2 * Double.pi * freq * Double(i) / fs)))
        }
        return Array(out[(n / 2)...])
    }

    func testLowpassPassesDc() {
        let f = Svf(mode: .lowpass, sampleRate: fs)
        f.setParams(cutoffHz: 1000, q: 0.707)
        var y = 0.0
        for _ in 0..<4800 { y = f.process(1) }
        XCTAssertEqual(y, 1, accuracy: 1e-3)
    }

    func testHighpassBlocksDc() {
        let f = Svf(mode: .highpass, sampleRate: fs)
        f.setParams(cutoffHz: 1000, q: 0.707)
        var y = 1.0
        for _ in 0..<4800 { y = f.process(1) }
        XCTAssertLessThan(abs(y), 1e-3)
    }

    func testLowpassAttenuatesHighFrequencies() {
        let f = Svf(mode: .lowpass, sampleRate: fs)
        f.setParams(cutoffHz: 500, q: 0.707)
        XCTAssertLessThan(rms(renderSine(f, freq: 10_000, n: 9600)), 0.05)
    }

    func testBandpassPeaksAtCutoff() {
        func make() -> Svf {
            let f = Svf(mode: .bandpass, sampleRate: fs)
            f.setParams(cutoffHz: 1000, q: 4)
            return f
        }
        let atCenter = rms(renderSine(make(), freq: 1000, n: 9600))
        let below = rms(renderSine(make(), freq: 100, n: 9600))
        let above = rms(renderSine(make(), freq: 10_000, n: 9600))
        XCTAssertGreaterThan(atCenter, below * 5)
        XCTAssertGreaterThan(atCenter, above * 5)
    }

    func testStableUnderCutoffModulation() {
        let f = Svf(mode: .lowpass, sampleRate: fs)
        var peak = 0.0
        for i in 0..<48_000 {
            f.setParams(cutoffHz: 500 + 8000 * (0.5 + 0.5 * sin(Double(i) / 40)), q: 4)
            peak = max(peak, abs(f.process(sin(Double(i) / 3))))
        }
        XCTAssertLessThan(peak, 4)
    }

    func testMatchesTwinReference() {
        let f = Svf(mode: .lowpass, sampleRate: fs)
        f.setParams(cutoffHz: 1000, q: 0.707)
        XCTAssertEqual(twinReference.count, 8)
        for (i, expected) in twinReference.enumerated() {
            let y = f.process(sin(2 * Double.pi * 440 * Double(i) / fs))
            XCTAssertEqual(y, expected, accuracy: 1e-6)
        }
    }
}
