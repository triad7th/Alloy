@testable import AlloyAudio
import XCTest

final class FmGeneratorTests: XCTestCase {
    private let fs = 48_000.0
    private let fastAdsr = AdsrParams(attack: 0.001, decay: 1, sustain: 1, release: 0.01)
    private let twinReference: [Double] = [
        0, 0.004423217847943306, 0.015922080725431442, 0.037106290459632874, 0.07009749114513397,
        0.11572307348251343, 0.1723853349685669, 0.23498837649822235,
    ]

    private func twoOp(modLevel: Double) -> FmGeneratorParams {
        FmGeneratorParams(
            operators: [
                FmOperatorParams(ratio: 1, level: 1, adsr: fastAdsr),
                FmOperatorParams(ratio: 2, level: modLevel, adsr: fastAdsr),
            ],
            algorithm: FmAlgorithm(routes: [FmRoute(from: 1, to: 0)], carriers: [0], feedback: nil),
        )
    }

    private func render(_ gen: FmGenerator, _ frames: Int) -> [Float] {
        var out = [Float](repeating: 0, count: frames)
        gen.render(into: &out, frames: frames)
        return out
    }

    func testZeroModulationIsEnvelopedSine() {
        let gen = FmGenerator(params: twoOp(modLevel: 0), sampleRate: fs)
        gen.noteOn(midi: 69, velocity: 1)
        let out = render(gen, 512)
        let env = AdsrEnvelope(params: fastAdsr, sampleRate: fs)
        env.noteOn()
        for i in 0..<512 {
            let expected = sin(2 * Double.pi * 440 * Double(i) / fs) * env.nextSample()
            XCTAssertEqual(Double(out[i]), expected, accuracy: 1e-5)
        }
    }

    func testModulationChangesWaveform() {
        let plain = FmGenerator(params: twoOp(modLevel: 0), sampleRate: fs)
        let modulated = FmGenerator(params: twoOp(modLevel: 0.8), sampleRate: fs)
        plain.noteOn(midi: 69, velocity: 1)
        modulated.noteOn(midi: 69, velocity: 1)
        let a = render(plain, 512)
        let b = render(modulated, 512)
        let maxDiff = zip(a, b).map { abs($0 - $1) }.max() ?? 0
        XCTAssertGreaterThan(maxDiff, 0.1)
    }

    func testVelocityScalesAmplitude() {
        let loud = FmGenerator(params: twoOp(modLevel: 0.5), sampleRate: fs)
        let quiet = FmGenerator(params: twoOp(modLevel: 0.5), sampleRate: fs)
        loud.noteOn(midi: 60, velocity: 1)
        quiet.noteOn(midi: 60, velocity: 0.5)
        let a = render(loud, 256)
        let b = render(quiet, 256)
        for i in 0..<256 {
            XCTAssertEqual(b[i], a[i] * 0.5, accuracy: 1e-6)
        }
    }

    func testNotFinishedBeforeNoteOn() {
        let gen = FmGenerator(params: twoOp(modLevel: 0.5), sampleRate: fs)
        XCTAssertFalse(gen.finished)
    }

    func testFinishesAfterRelease() {
        let gen = FmGenerator(params: twoOp(modLevel: 0.5), sampleRate: fs)
        gen.noteOn(midi: 69, velocity: 1)
        _ = render(gen, 256)
        gen.noteOff()
        _ = render(gen, Int(fs))
        XCTAssertTrue(gen.finished)
        for v in render(gen, 64) {
            XCTAssertEqual(v, 0)
        }
    }

    func testValidateFmGeneratorParamsReportsErrors() {
        let bad = FmGeneratorParams(
            operators: [FmOperatorParams(ratio: 1, level: 1, adsr: fastAdsr)],
            algorithm: FmAlgorithm(routes: [], carriers: [0], feedback: FmFeedback(op: 5, amount: 0.3)),
        )
        XCTAssertFalse(validateFmGeneratorParams(bad).isEmpty)
    }

    func testSetPitchRatioEqualsPlayingAnOctaveHigher() {
        let bent = FmGenerator(params: twoOp(modLevel: 0.5), sampleRate: fs)
        bent.noteOn(midi: 60, velocity: 1)
        bent.setPitchRatio(2)
        let reference = FmGenerator(params: twoOp(modLevel: 0.5), sampleRate: fs)
        reference.noteOn(midi: 72, velocity: 1)
        let a = render(bent, 512)
        let b = render(reference, 512)
        for i in 0..<512 {
            XCTAssertEqual(Double(a[i]), Double(b[i]), accuracy: 1e-9)
        }
    }

    func testMatchesTwinReference() {
        var params = twoOp(modLevel: 0.7)
        params = FmGeneratorParams(
            operators: params.operators,
            algorithm: FmAlgorithm(
                routes: params.algorithm.routes,
                carriers: params.algorithm.carriers,
                feedback: FmFeedback(op: 1, amount: 0.3),
            ),
        )
        let gen = FmGenerator(params: params, sampleRate: fs)
        gen.noteOn(midi: 60, velocity: 1)
        let out = render(gen, 8)
        XCTAssertEqual(twinReference.count, 8)
        for (i, expected) in twinReference.enumerated() {
            XCTAssertEqual(Double(out[i]), expected, accuracy: 1e-6)
        }
    }

    // MARK: - anti-aliasing (phase 3c)

    /// The workbench EP operator stack, at the ratio-14 modulator that made it
    /// alias. Operator 2 runs at 14x the note: on G#6 that is 23.3 kHz, against a
    /// 24 kHz Nyquist. Twin of EP_STACK in fm-generator.spec.ts.
    private var epStack: FmGeneratorParams {
        FmGeneratorParams(
            operators: [
                FmOperatorParams(
                    ratio: 1, level: 1,
                    adsr: AdsrParams(attack: 0.002, decay: 1.3, sustain: 0.16, release: 0.4),
                ),
                FmOperatorParams(
                    ratio: 1, level: 0.55,
                    adsr: AdsrParams(attack: 0.001, decay: 0.5, sustain: 0.1, release: 0.3),
                ),
                FmOperatorParams(
                    ratio: 14, level: 0.3,
                    adsr: AdsrParams(attack: 0.001, decay: 0.06, sustain: 0, release: 0.05),
                ),
            ],
            algorithm: FmAlgorithm(
                routes: [FmRoute(from: 1, to: 0), FmRoute(from: 2, to: 0)],
                carriers: [0],
                feedback: nil,
            ),
        )
    }

    private func renderNote(_ params: FmGeneratorParams, midi: Int, frames: Int) -> [Float] {
        let gen = FmGenerator(params: params, sampleRate: fs)
        gen.noteOn(midi: midi, velocity: 0.8)
        var out = [Float](repeating: 0, count: frames)
        gen.render(into: &out, frames: frames)
        return out
    }

    /// Energy below the fundamental, in dB relative to it. An FM spectrum built on
    /// f0 has NO legitimate content beneath f0, so whatever is down there is
    /// aliased foldback — a direct measurement of the defect.
    private func aliasFloorDb(_ x: [Float], f0: Double) -> Double {
        func mag(_ f: Double) -> Double {
            var re = 0.0
            var im = 0.0
            for i in 0..<x.count {
                let t = 2 * Double.pi * f * Double(i) / fs
                re += Double(x[i]) * cos(t)
                im += Double(x[i]) * sin(t)
            }
            return (re * re + im * im).squareRoot() / Double(x.count)
        }
        let fundamental = mag(f0)
        var worst = 0.0
        var f = 40.0
        while f < f0 * 0.75 {
            worst = max(worst, mag(f))
            f += 20
        }
        return 20 * log10(worst / (fundamental + 1e-15))
    }

    private func midiHz(_ m: Int) -> Double { 440 * pow(2, (Double(m) - 69) / 12) }

    func testDoesNotFoldSidebandsIntoTheBassOnGSharp6() {
        // Before oversampling this measured -25 dB; oversampled, -63 dB.
        let y = renderNote(epStack, midi: 92, frames: 24_000)
        XCTAssertLessThan(aliasFloorDb(y, f0: midiHz(92)), -55)
    }

    func testHoldsUpAtC7() {
        let y = renderNote(epStack, midi: 96, frames: 24_000)
        XCTAssertLessThan(aliasFloorDb(y, f0: midiHz(96)), -55)
    }

    func testImprovesC8EvenThoughC8IsNotFullyCleanByDesign() {
        // Accepted limit: 8x would be needed to get C8 below -60, at ~9x the CPU.
        let y = renderNote(epStack, midi: 108, frames: 24_000)
        XCTAssertLessThan(aliasFloorDb(y, f0: midiHz(108)), -40)
    }

    func testLeavesLowNotesOnTheOriginalOneTimesPath() {
        let gen = FmGenerator(params: epStack, sampleRate: fs)
        gen.noteOn(midi: 60, velocity: 0.8)
        XCTAssertEqual(gen.oversampling, 1) // C4 x 14 = 3.7 kHz, well under 12 kHz
        gen.noteOn(midi: 92, velocity: 0.8)
        XCTAssertEqual(gen.oversampling, FM_OVERSAMPLING) // G#6 x 14 = 23.3 kHz
    }

    func testPricesTheWorstCasePitchModulationIntoTheFactor() {
        // midi 80 x ratio 14 = 11.63 kHz: under the 12 kHz threshold, so K=1 —
        // until the layer carries a deep LFO pitch route. At 1200 cents the LFO
        // peak doubles the pitch, putting the modulator at 23.3 kHz WHILE the
        // voice renders. K is committed at noteOn (re-picking it mid-note would
        // glitch), so the depth has to be priced in up front.
        let plain = FmGenerator(params: epStack, sampleRate: fs, pitchModCents: 0)
        plain.noteOn(midi: 80, velocity: 0.8)
        XCTAssertEqual(plain.oversampling, 1) // no vibrato: unchanged, and free

        let vibrato = FmGenerator(params: epStack, sampleRate: fs, pitchModCents: 1200)
        vibrato.noteOn(midi: 80, velocity: 0.8)
        XCTAssertEqual(vibrato.oversampling, FM_OVERSAMPLING)

        // Sign-blind: -1200 cents bends up just as far on the LFO's negative half.
        let down = FmGenerator(params: epStack, sampleRate: fs, pitchModCents: -1200)
        down.noteOn(midi: 80, velocity: 0.8)
        XCTAssertEqual(down.oversampling, FM_OVERSAMPLING)

        // Shallow vibrato on a low note must not drag a voice onto the 4x path.
        let shallow = FmGenerator(params: epStack, sampleRate: fs, pitchModCents: 50)
        shallow.noteOn(midi: 60, velocity: 0.8)
        XCTAssertEqual(shallow.oversampling, 1)
    }

    func testStaysCleanAtTheLfoPitchPeak() {
        // The behavioral half of the test above. Hold the LFO at its +1 peak
        // (pitchRatio = 2 for the whole render) so the spectrum sits on 2*f0 and
        // everything below it can only be foldback — no vibrato sweep to confound
        // the measurement. With the depth priced in the voice runs at 4x and
        // measures -66 dB; ignoring it leaves the voice on the 1x path at -25 dB,
        // the shipped bug, back again.
        let gen = FmGenerator(params: epStack, sampleRate: fs, pitchModCents: 1200)
        gen.noteOn(midi: 80, velocity: 0.8)
        gen.setPitchRatio(2)
        var out = [Float](repeating: 0, count: 24_000)
        gen.render(into: &out, frames: out.count)
        XCTAssertLessThan(aliasFloorDb(out, f0: midiHz(92)), -55) // -65.8 dB measured
    }

    func testSwitchesFactorBetweenAdjacentNotesWithoutALevelJump() {
        // The adaptive design is only legitimate because oversampling is a no-op
        // below the threshold. ratio 14 puts the 12 kHz threshold at f0 = 857 Hz,
        // i.e. between midi 80 (830 Hz -> 1x) and midi 81 (880 Hz -> 4x).
        func rms(_ v: [Float]) -> Double {
            (v.reduce(0.0) { $0 + Double($1) * Double($1) } / Double(v.count)).squareRoot()
        }
        let below = renderNote(epStack, midi: 80, frames: 12_000)
        let above = renderNote(epStack, midi: 81, frames: 12_000)
        XCTAssertLessThan(abs(20 * log10(rms(above) / rms(below))), 1.5)
    }

    func testAntiAliasedRenderIsDeterministic() {
        XCTAssertEqual(
            renderNote(epStack, midi: 92, frames: 4096),
            renderNote(epStack, midi: 92, frames: 4096),
        )
    }
}
