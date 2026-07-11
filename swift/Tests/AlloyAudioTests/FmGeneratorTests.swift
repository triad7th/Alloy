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
}
