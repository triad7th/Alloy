@testable import AlloyAudio
import XCTest

final class AdditiveGeneratorTests: XCTestCase {
    private let fs = 48_000.0
    private let twinReference: [Double] = [
        0, 0.04105590283870697, 0.0818713828921318, 0.12220834940671921, 0.1618332862854004,
        0.20051950216293335, 0.23804932832717896, 0.2742161452770233,
    ]

    private func midiHz(_ midi: Int) -> Double {
        Pitch.frequency(midi: midi)
    }

    private func render(_ gen: AdditiveGenerator, _ frames: Int) -> [Float] {
        var out = [Float](repeating: 0, count: frames)
        gen.render(into: &out, frames: frames)
        return out
    }

    func testSinglePartialIsPureSine() {
        let gen = AdditiveGenerator(partials: [AdditivePartial(ratio: 1, level: 1)], sampleRate: fs)
        gen.noteOn(midi: 69, velocity: 1)
        let out = render(gen, 200)
        for i in 0..<200 {
            let expected = sin(2 * Double.pi * 440 * Double(i) / fs)
            XCTAssertEqual(Double(out[i]), expected, accuracy: 1e-6)
        }
    }

    func testPartialsSumLinearly() {
        let both = AdditiveGenerator(
            partials: [
                AdditivePartial(ratio: 1, level: 0.5),
                AdditivePartial(ratio: 2, level: 0.25),
            ],
            sampleRate: fs,
        )
        both.noteOn(midi: 60, velocity: 1)
        let out = render(both, 200)
        let f0 = midiHz(60)
        for i in 0..<200 {
            let expected =
                0.5 * sin(2 * Double.pi * f0 * Double(i) / fs) + 0.25 * sin(2 * Double.pi * 2 * f0 * Double(i) / fs)
            XCTAssertEqual(Double(out[i]), expected, accuracy: 1e-6)
        }
    }

    func testSilentBeforeNoteOnAndSoundsAfterNoteOff() {
        let gen = AdditiveGenerator(partials: [AdditivePartial(ratio: 1, level: 1)], sampleRate: fs)
        for v in render(gen, 32) {
            XCTAssertEqual(v, 0)
        }
        gen.noteOn(midi: 69, velocity: 1)
        _ = render(gen, 32)
        gen.noteOff()
        XCTAssertFalse(gen.finished)
        let after = render(gen, 32)
        XCTAssertGreaterThan(after.map { abs($0) }.max() ?? 0, 0)
    }

    func testSetPitchRatioEqualsPlayingAnOctaveHigher() {
        let partials = [
            AdditivePartial(ratio: 1, level: 0.6),
            AdditivePartial(ratio: 3, level: 0.2),
        ]
        let bent = AdditiveGenerator(partials: partials, sampleRate: fs)
        bent.noteOn(midi: 60, velocity: 1)
        bent.setPitchRatio(2)
        let reference = AdditiveGenerator(partials: partials, sampleRate: fs)
        reference.noteOn(midi: 72, velocity: 1)
        let a = render(bent, 512)
        let b = render(reference, 512)
        for i in 0..<512 {
            XCTAssertEqual(Double(a[i]), Double(b[i]), accuracy: 1e-9)
        }
    }

    func testMatchesTwinReference() {
        let gen = AdditiveGenerator(
            partials: [
                AdditivePartial(ratio: 1, level: 0.6),
                AdditivePartial(ratio: 3, level: 0.2),
            ],
            sampleRate: fs,
        )
        gen.noteOn(midi: 60, velocity: 1)
        let out = render(gen, 8)
        XCTAssertEqual(twinReference.count, 8)
        for (i, expected) in twinReference.enumerated() {
            XCTAssertEqual(Double(out[i]), expected, accuracy: 1e-6)
        }
    }
}
