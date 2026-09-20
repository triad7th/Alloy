@testable import AlloyAudio
import XCTest

private final class RenderPatchHost: PatchSynthHost {
    let host = PatchEngineHost(sampleRate: 48000)
    func noteOn(midi: Int, velocity: Double) {
        host.noteOn(midi: midi, velocity: velocity)
    }

    func noteOff(midi: Int) {
        host.noteOff(midi: midi)
    }

    func allNotesOff() {
        host.allNotesOff()
    }
}

final class SustainRenderTests: XCTestCase {
    func testEveryRepressRendersANewAttackAfterThePreviousSampleEnds() throws {
        let adapter = RenderPatchHost()
        let samples: [Float] = (0 ..< 2048).map { index in
            let phase = 2.0 * Double.pi * 440.0 * Double(index) / 48000.0
            let decay = 1.0 - Double(index) / 2048.0
            return Float(0.5 * sin(phase) * decay)
        }
        adapter.host.setZoneSet("piano", [VelocityLayerData(topVelocity: 1, zones: [
            SampleZoneData(rootMidi: 69, sampleRate: 48000, data: samples)
        ])])
        let patch = try JSONDecoder().decode(Patch.self, from: Data("""
        {"schemaVersion":1,"meta":{"id":"test.sustain","name":"Sustain","category":"melodic"},
         "layers":[{"keyRange":{"lowMidi":0,"highMidi":127},"velRange":{"low":0,"high":1},
         "generator":{"kind":"sample","zoneSetId":"piano","crossfade":0},
         "tva":{"level":1,"adsr":{"attack":0,"decay":0,"sustain":1,"release":0.1},"velCurve":1}}],
         "sends":{"reverb":0,"delay":0}}
        """.utf8))
        adapter.host.setPatch(patch)
        var errors: [String] = []
        adapter.host.onPatchRejected = { errors.append(contentsOf: $0) }
        let router = InstrumentSynthEngine(
            engines: ["piano": PatchSynthEngine(host: adapter, defaultVelocity: 0.7)],
            defaultInstrumentId: "piano"
        )
        router.setSustain(true)
        for _ in 0 ..< 3 {
            router.noteOn(midi: 69)
            router.noteOff(midi: 69)
            var left = [Float](repeating: 0, count: 4096)
            var right = left
            adapter.host.render(intoLeft: &left, right: &right, frames: 4096)
            XCTAssertTrue(errors.isEmpty)
            XCTAssertGreaterThan(try XCTUnwrap(left.map { abs($0) }.max()), 0.1)
            XCTAssertLessThan(try XCTUnwrap(left[3072...].map { abs($0) }.max()), 0.00001)
        }
    }
}
