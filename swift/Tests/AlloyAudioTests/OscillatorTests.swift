@testable import AlloyAudio
import XCTest

final class OscillatorTests: XCTestCase {
    private func render(_ osc: inout Oscillator, _ n: Int) -> [Double] {
        (0..<n).map { _ in osc.next() }
    }

    func test_sawPeriodMatchesFrequency() {
        var osc = Oscillator(waveform: .sawtooth, frequency: 440, sampleRate: 44_100)
        let out = render(&osc, 44_100)
        // polyBLEP smooths the wrap across two samples, so a naive
        // "large negative jump" detector undercounts. Rising zero
        // crossings happen mid-ramp (outside the BLEP region): exactly
        // one per period.
        var crossings = 0
        for i in 1..<out.count where out[i - 1] < 0 && out[i] >= 0 { crossings += 1 }
        XCTAssertEqual(crossings, 440, accuracy: 2)
    }

    func test_sawIsBoundedAfterPolyBLEP() {
        var osc = Oscillator(waveform: .sawtooth, frequency: 4186, sampleRate: 44_100) // C8
        for sample in render(&osc, 8192) {
            XCTAssertLessThanOrEqual(abs(sample), 1.3) // small BLEP overshoot allowed
        }
    }

    func test_detuneShiftsFrequencyByCentsRatio() {
        // +1200 cents = one octave = double the crossings.
        var osc = Oscillator(waveform: .sawtooth, frequency: 220, detuneCents: 1200, sampleRate: 44_100)
        let out = render(&osc, 44_100)
        var crossings = 0
        for i in 1..<out.count where out[i - 1] < 0 && out[i] >= 0 { crossings += 1 }
        XCTAssertEqual(crossings, 440, accuracy: 2)
    }

    func test_sineStartsAtZeroAndPeaksAtQuarterPeriod() {
        let fs = 44_100.0
        var osc = Oscillator(waveform: .sine, frequency: 441, sampleRate: fs)
        let period = Int(fs / 441) // 100 samples
        let out = render(&osc, period + 1)
        XCTAssertEqual(out[0], 0, accuracy: 1e-6)
        XCTAssertEqual(out[period / 4], 1, accuracy: 0.01)
    }

    func test_triangleIsBoundedAndZeroMean() {
        var osc = Oscillator(waveform: .triangle, frequency: 440, sampleRate: 44_100)
        let out = render(&osc, 44_100)
        XCTAssertLessThanOrEqual(out.map(abs).max()!, 1.0 + 1e-9)
        XCTAssertEqual(out.reduce(0, +) / Double(out.count), 0, accuracy: 0.01)
    }

    func test_squareAlternatesSign() {
        var osc = Oscillator(waveform: .square, frequency: 441, sampleRate: 44_100)
        let out = render(&osc, 200) // two periods
        XCTAssertGreaterThan(out[10], 0.5)
        XCTAssertLessThan(out[60], -0.5)
    }
}
