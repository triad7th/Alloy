@testable import AlloyAudio
import XCTest

final class SampleZoneGeneratorTests: XCTestCase {
    private let fs = 48_000.0
    private let twinReference: [Double] = [
        0, 0.025196194648742676, 0.05756402760744095, 0.08628634363412857, 0.11493714898824692,
        0.14349259436130524, 0.17192910611629486, 0.2002229541540146,
    ]

    /// Mono sine test asset: `cycles` full cycles over `length` samples.
    private func sineZone(rootMidi: Int, length: Int, cycles: Int, loop: Bool = false) -> SampleZoneData {
        var data = [Float](repeating: 0, count: length)
        for i in 0..<length {
            data[i] = Float(sin(2 * Double.pi * Double(cycles) * Double(i) / Double(length)))
        }
        return loop
            ? SampleZoneData(rootMidi: Double(rootMidi), sampleRate: fs, data: data, loopStart: 0, loopEnd: length)
            : SampleZoneData(rootMidi: Double(rootMidi), sampleRate: fs, data: data)
    }

    private func constantZone(rootMidi: Int, value: Float, length: Int = 4800) -> SampleZoneData {
        SampleZoneData(
            rootMidi: Double(rootMidi),
            sampleRate: fs,
            data: [Float](repeating: value, count: length),
            loopStart: 0,
            loopEnd: length,
        )
    }

    private func oneLayer(_ zone: SampleZoneData) -> [VelocityLayerData] {
        [VelocityLayerData(topVelocity: 1, zones: [zone])]
    }

    private func render(_ gen: SampleZoneGenerator, _ frames: Int) -> [Float] {
        var out = [Float](repeating: 0, count: frames)
        gen.render(into: &out, frames: frames)
        return out
    }

    private func zeroCrossings(_ out: [Float]) -> Int {
        var count = 0
        for i in 1..<out.count where out[i - 1] < 0 && out[i] >= 0 {
            count += 1
        }
        return count
    }

    func testPlaysRootPitchNoteBackAtUnityRate() {
        let gen = SampleZoneGenerator(layers: oneLayer(sineZone(rootMidi: 69, length: 4800, cycles: 44)), crossfade: 0, sampleRate: fs)
        gen.noteOn(midi: 69, velocity: 1)
        let out = render(gen, 4796) // stay clear of the unlooped tail
        let zone = sineZone(rootMidi: 69, length: 4800, cycles: 44)
        for i in 1..<4700 {
            XCTAssertEqual(Double(out[i]), Double(zone.data[i]), accuracy: 5e-4) // cubic interp ≈ identity on-grid
        }
    }

    func testOctaveUpDoublesPlaybackRate() {
        let gen = SampleZoneGenerator(layers: oneLayer(sineZone(rootMidi: 69, length: 48_000, cycles: 440, loop: true)), crossfade: 0, sampleRate: fs)
        gen.noteOn(midi: 81, velocity: 1)
        let out = render(gen, 48_000)
        let crossings = zeroCrossings(out)
        XCTAssertGreaterThan(crossings, 830)
        XCTAssertLessThan(crossings, 930) // ≈ 880
    }

    func testLoopedZonesSustainPastBufferLengthAndNeverFinish() {
        let gen = SampleZoneGenerator(layers: oneLayer(sineZone(rootMidi: 69, length: 4800, cycles: 44, loop: true)), crossfade: 0, sampleRate: fs)
        gen.noteOn(midi: 69, velocity: 1)
        _ = render(gen, 4800 * 3)
        XCTAssertFalse(gen.finished)
        let later = render(gen, 256)
        XCTAssertGreaterThan(later.map(abs).max() ?? 0, 0.1)
    }

    func testUnloopedZonesFinishAtEndOfDataAndGoSilent() {
        let gen = SampleZoneGenerator(layers: oneLayer(sineZone(rootMidi: 69, length: 4800, cycles: 44)), crossfade: 0, sampleRate: fs)
        gen.noteOn(midi: 69, velocity: 1)
        _ = render(gen, 4800 + 64)
        XCTAssertTrue(gen.finished)
        for v in render(gen, 64) {
            XCTAssertEqual(v, 0)
        }
    }

    func testPicksNearestZoneWithLowerTieBreak() {
        let layers = [
            VelocityLayerData(topVelocity: 1, zones: [constantZone(rootMidi: 60, value: 0.25), constantZone(rootMidi: 64, value: 0.75)]),
        ]
        let gen = SampleZoneGenerator(layers: layers, crossfade: 0, sampleRate: fs)
        gen.noteOn(midi: 62, velocity: 1) // equidistant: must prefer the lower zone (60)
        let out = render(gen, 16)
        XCTAssertEqual(Double(out[4]), 0.25, accuracy: 5e-4)
    }

    func testSelectsVelocityLayersAndCrossfadesAtBoundary() {
        let layers = [
            VelocityLayerData(topVelocity: 0.5, zones: [constantZone(rootMidi: 60, value: 0.2)]),
            VelocityLayerData(topVelocity: 1, zones: [constantZone(rootMidi: 60, value: 0.8)]),
        ]
        let soft = SampleZoneGenerator(layers: layers, crossfade: 0, sampleRate: fs)
        soft.noteOn(midi: 60, velocity: 0.3)
        XCTAssertEqual(Double(render(soft, 16)[4]), 0.2 * 0.3, accuracy: 5e-4)

        let hard = SampleZoneGenerator(layers: layers, crossfade: 0, sampleRate: fs)
        hard.noteOn(midi: 60, velocity: 0.9)
        XCTAssertEqual(Double(render(hard, 16)[4]), 0.8 * 0.9, accuracy: 5e-4)

        let blended = SampleZoneGenerator(layers: layers, crossfade: 0.2, sampleRate: fs)
        blended.noteOn(midi: 60, velocity: 0.5) // exactly on the boundary -> 50/50 blend
        XCTAssertEqual(Double(render(blended, 16)[4]), (0.2 * 0.5 + 0.8 * 0.5) * 0.5, accuracy: 5e-3)
    }

    func testTreatsZeroLengthLoopRegionAsOneShotInsteadOfHanging() {
        let zone = SampleZoneData(rootMidi: 69, sampleRate: fs, data: [Float](repeating: 0.5, count: 480), loopStart: 100, loopEnd: 100)
        let gen = SampleZoneGenerator(layers: [VelocityLayerData(topVelocity: 1, zones: [zone])], crossfade: 0, sampleRate: fs)
        gen.noteOn(midi: 69, velocity: 1)
        _ = render(gen, 600) // must return, not hang
        XCTAssertTrue(gen.finished)
    }

    func testSetPitchRatioEqualsPlayingAnOctaveHigher() {
        let bent = SampleZoneGenerator(layers: oneLayer(sineZone(rootMidi: 69, length: 48_000, cycles: 440, loop: true)), crossfade: 0, sampleRate: fs)
        bent.noteOn(midi: 60, velocity: 1)
        bent.setPitchRatio(2)
        let reference = SampleZoneGenerator(layers: oneLayer(sineZone(rootMidi: 69, length: 48_000, cycles: 440, loop: true)), crossfade: 0, sampleRate: fs)
        reference.noteOn(midi: 72, velocity: 1)
        let a = render(bent, 512)
        let b = render(reference, 512)
        for i in 0..<512 {
            XCTAssertEqual(Double(a[i]), Double(b[i]), accuracy: 1e-9)
        }
    }

    func testMatchesTwinReference() {
        let gen = SampleZoneGenerator(layers: oneLayer(sineZone(rootMidi: 69, length: 4800, cycles: 44, loop: true)), crossfade: 0, sampleRate: fs)
        gen.noteOn(midi: 57, velocity: 1)
        let out = render(gen, 8)
        XCTAssertEqual(twinReference.count, 8)
        for (i, expected) in twinReference.enumerated() {
            XCTAssertEqual(Double(out[i]), expected, accuracy: 1e-6)
        }
    }
}
