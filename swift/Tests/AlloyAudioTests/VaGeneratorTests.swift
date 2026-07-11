@testable import AlloyAudio
import XCTest

final class VaGeneratorTests: XCTestCase {
    private let fs = 48_000.0
    private let twinReference: [Double] = [
        -0.6720842123031616, -1.0865157842636108, -1.0660182237625122, -1.0455206632614136,
        -1.0250232219696045, -1.0045256614685059, -0.9840281009674072, -0.9635306000709534,
    ]

    private func render(_ gen: VaGenerator, _ frames: Int) -> [Float] {
        var out = [Float](repeating: 0, count: frames)
        gen.render(into: &out, frames: frames)
        return out
    }

    func testIsDeterministicForGivenSeedAndDiffersAcrossSeeds() {
        let a = VaGenerator(params: VaParams(shape: .saw, unison: 5, detuneCents: 30), sampleRate: fs, seed: 7)
        let b = VaGenerator(params: VaParams(shape: .saw, unison: 5, detuneCents: 30), sampleRate: fs, seed: 7)
        let c = VaGenerator(params: VaParams(shape: .saw, unison: 5, detuneCents: 30), sampleRate: fs, seed: 8)
        a.noteOn(midi: 60, velocity: 1)
        b.noteOn(midi: 60, velocity: 1)
        c.noteOn(midi: 60, velocity: 1)
        let outA = render(a, 256)
        let outB = render(b, 256)
        let outC = render(c, 256)
        for i in 0..<256 {
            XCTAssertEqual(outA[i], outB[i])
        }
        var differs = false
        for i in 0..<256 where outA[i] != outC[i] {
            differs = true
        }
        XCTAssertTrue(differs)
    }

    func testUnisonOutputStaysBoundedBySqrtScaling() {
        let gen = VaGenerator(params: VaParams(shape: .saw, unison: 7, detuneCents: 40), sampleRate: fs)
        gen.noteOn(midi: 60, velocity: 1)
        let out = render(gen, 48_000)
        let peak = out.map { abs($0) }.max() ?? 0
        XCTAssertLessThanOrEqual(Double(peak), 7.0.squareRoot() + 0.2)
        XCTAssertGreaterThan(Double(peak), 0.3)
    }

    func testKeepsSoundingAfterNoteOffAndNeverSelfFinishes() {
        let gen = VaGenerator(params: VaParams(shape: .saw, unison: 3, detuneCents: 20), sampleRate: fs)
        gen.noteOn(midi: 60, velocity: 1)
        _ = render(gen, 64)
        gen.noteOff()
        XCTAssertFalse(gen.finished)
        let after = render(gen, 64)
        XCTAssertGreaterThan(after.map { abs($0) }.max() ?? 0, 0)
    }

    func testMatchesTwinReference() {
        let gen = VaGenerator(params: VaParams(shape: .saw, unison: 5, detuneCents: 24), sampleRate: fs)
        gen.noteOn(midi: 57, velocity: 1)
        let out = render(gen, 8)
        XCTAssertEqual(twinReference.count, 8)
        for (i, expected) in twinReference.enumerated() {
            XCTAssertEqual(Double(out[i]), expected, accuracy: 1e-6)
        }
    }
}
