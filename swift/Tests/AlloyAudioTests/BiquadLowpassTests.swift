@testable import AlloyAudio
import XCTest

final class BiquadLowpassTests: XCTestCase {
    /// RMS of the filter's steady-state response to a sine at `hz`.
    private func responseRMS(cutoff: Double, q: Double, inputHz: Double) -> Double {
        let fs = 44_100.0
        var filter = BiquadLowpass(sampleRate: fs)
        filter.setCutoff(cutoff, q: q)
        var out: [Double] = []
        for i in 0..<8192 {
            let x = sin(2 * .pi * inputHz * Double(i) / fs)
            let y = filter.process(x)
            if i >= 4096 { out.append(y) } // skip transient
        }
        return sqrt(out.map { $0 * $0 }.reduce(0, +) / Double(out.count))
    }

    func test_passesWellBelowCutoff() {
        let rms = responseRMS(cutoff: 2000, q: 0.9, inputHz: 100)
        XCTAssertEqual(rms, 1 / sqrt(2), accuracy: 0.05) // ~unity gain
    }

    func test_attenuatesAboveCutoff() {
        let below = responseRMS(cutoff: 900, q: 0.9, inputHz: 100)
        let above = responseRMS(cutoff: 900, q: 0.9, inputHz: 3600) // 2 octaves up
        XCTAssertLessThan(above, below * 0.1) // > 20 dB down
    }

    func test_cutoffAboveNyquistIsClampedAndStable() {
        var filter = BiquadLowpass(sampleRate: 44_100)
        filter.setCutoff(96_000, q: 0.9)
        var peak = 0.0
        for i in 0..<4096 {
            peak = max(peak, abs(filter.process(i == 0 ? 1 : 0)))
        }
        XCTAssertLessThanOrEqual(peak, 1.5) // no blow-up
    }
}
