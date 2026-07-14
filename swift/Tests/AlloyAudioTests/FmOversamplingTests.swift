@testable import AlloyAudio
import Foundation
import XCTest

/// Twin of web fm-oversampling.spec.ts (canonical).
final class FmOversamplingTests: XCTestCase {
    private let fs = 48_000.0

    private func decimate(hz: Double, frames: Int) -> [Double] {
        let fsOs = fs * Double(FM_OVERSAMPLING)
        let dec = FmDecimator()
        var out = [Double](repeating: 0, count: frames)
        var n = 0
        for i in 0..<frames {
            for _ in 0..<FM_OVERSAMPLING {
                dec.push(sin(2 * Double.pi * hz * Double(n) / fsOs))
                n += 1
            }
            out[i] = dec.output()
        }
        return out
    }

    private func rms(_ x: ArraySlice<Double>) -> Double {
        sqrt(x.reduce(0) { $0 + $1 * $1 } / Double(x.count))
    }

    func testDecimationTableIs32TapsAndSumsToUnity() {
        XCTAssertEqual(FM_DECIMATION_TAPS.count, 32)
        XCTAssertEqual(FM_DECIMATION_TAPS.reduce(0, +), 1, accuracy: 1e-12)
    }

    func testPassesAToneInsideTheAudioBandAtUnityGain() {
        let y = decimate(hz: 1000, frames: 4096)[64...]
        XCTAssertGreaterThan(rms(y), 0.65)
        XCTAssertLessThan(rms(y), 0.75)
    }

    /// dB, relative to a unit sine, of what survives decimation at `hz`.
    private func attenuationDb(_ hz: Double) -> Double {
        20 * log10(rms(decimate(hz: hz, frames: 4096)[64...]) / 0.707)
    }

    func testCrushesTheFrequenciesThatFoldIntoTheAudibleMidrange() {
        // What matters is not the response AT a frequency, but where that frequency
        // FOLDS TO once we drop to 48 kHz. These are the dangerous ones:
        //   40 kHz -> folds to  8 kHz  (squarely audible)
        //   36 kHz -> folds to 12 kHz  (squarely audible)
        XCTAssertLessThan(attenuationDb(40_000), -60)
        XCTAssertLessThan(attenuationDb(36_000), -45)
    }

    func testIsDeliberatelySoftAtTheTransitionBandWhichFoldsWhereNobodyHears() {
        // 30 kHz folds to 18 kHz — the very top of hearing — and sits in a 32-tap
        // filter's transition band, where it only gets ~-23 dB. That is the accepted
        // cost of 32 taps, and it is why the end-to-end alias floor still measures
        // -63 dB on G#6. Pinned so a future "improvement" that narrows the passband
        // to chase this number has to argue with a test: narrowing the cutoff to
        // crush 30 kHz would lowpass the OUTPUT and gut the brightness this whole
        // phase exists to recover.
        XCTAssertLessThan(attenuationDb(30_000), -15)
        XCTAssertGreaterThan(attenuationDb(30_000), -35)
    }

    func testKeepsTheAudioBandIntactSoTheBrightnessSurvives() {
        XCTAssertGreaterThan(attenuationDb(1_000), -0.5)
        XCTAssertGreaterThan(attenuationDb(10_000), -0.5)
        XCTAssertGreaterThan(attenuationDb(15_000), -2) // -1.2 dB measured
    }

    func testChooseOversamplingSwitchesAtQuarterSampleRate() {
        XCTAssertEqual(chooseOversampling(maxOpFrequency: 1000, sampleRate: fs), 1)
        XCTAssertEqual(chooseOversampling(maxOpFrequency: 11_999, sampleRate: fs), 1)
        XCTAssertEqual(chooseOversampling(maxOpFrequency: fs / 4, sampleRate: fs), 1)
        XCTAssertEqual(chooseOversampling(maxOpFrequency: 12_001, sampleRate: fs), FM_OVERSAMPLING)
        XCTAssertEqual(chooseOversampling(maxOpFrequency: 23_300, sampleRate: fs), FM_OVERSAMPLING)
    }

    func testChooseOversamplingScalesWithTheSampleRate() {
        XCTAssertEqual(chooseOversampling(maxOpFrequency: 20_000, sampleRate: 96_000), 1)
        XCTAssertEqual(chooseOversampling(maxOpFrequency: 25_000, sampleRate: 96_000), FM_OVERSAMPLING)
    }

    func testModuloFreeTapLoopIsBitIdenticalToNaiveConvolution() {
        // output() walks the ring as two contiguous runs instead of doing `% n`
        // per tap. That is only allowed because it visits the same samples with
        // the same taps in the SAME summation order — so the result must be equal
        // to the last bit, not merely close. Exact ==, no accuracy: if this ever
        // needs a tolerance, the summation order changed and the optimization is
        // wrong.
        let n = FM_DECIMATION_TAPS.count
        var history = [Double](repeating: 0, count: n) // naive reference: ring + `% n`
        var pos = 0
        func refPush(_ x: Double) {
            history[pos] = x
            pos = (pos + 1) % n
        }
        func refOutput() -> Double {
            var y = 0.0
            for j in 0..<n {
                y += FM_DECIMATION_TAPS[j] * history[(pos + j) % n]
            }
            return y
        }

        let dec = FmDecimator()
        // An FM-shaped signal (asymmetric, wideband), and a varying number of
        // pushes per output so `pos` lands on every offset 0..<n — including 0,
        // where the second run is empty.
        var t = 0
        var peak = 0.0
        for i in 0..<500 {
            let pushes = 1 + (i % 7)
            for _ in 0..<pushes {
                let x = sin(0.031 * Double(t) + 3.7 * sin(0.0017 * Double(t)))
                    * (1 - 0.001 * Double(t % 400))
                dec.push(x)
                refPush(x)
                t += 1
            }
            let got = dec.output()
            let want = refOutput()
            XCTAssertEqual(got, want) // bit-exact, no accuracy argument
            peak = max(peak, abs(got))
        }
        XCTAssertGreaterThan(peak, 0.1) // the equality above was on real signal, not silence
    }
}
