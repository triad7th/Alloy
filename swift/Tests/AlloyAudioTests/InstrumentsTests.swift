@testable import AlloyAudio
import XCTest

/// AlloyAudio ships no instrument catalog — these tests pin the descriptor
/// shape apps build their catalogs from (ids are opaque strings).
final class InstrumentsTests: XCTestCase {
    private let fallback = SynthVoiceConfig(
        waveform: .triangle, attack: 0.005, decay: 0.12, sustain: 0.6, release: 0.25,
    )

    func test_waveformRawValuesMatchTheWebStrings() {
        XCTAssertEqual(Waveform.sine.rawValue, "sine")
        XCTAssertEqual(Waveform.square.rawValue, "square")
        XCTAssertEqual(Waveform.sawtooth.rawValue, "sawtooth")
        XCTAssertEqual(Waveform.triangle.rawValue, "triangle")
    }

    func test_descriptorCarriesIdVoiceAndSends() {
        let descriptor = InstrumentDescriptor(
            id: "grand-piano",
            voice: .sampled(SampledVoiceSpec(
                sampleBaseURL: "samples/grand-piano",
                sampleMidis: Array(stride(from: 21, through: 108, by: 3)),
                release: 0.25, fallback: fallback,
            )),
            sends: VoiceSends(reverb: 0.18),
        )
        XCTAssertEqual(descriptor.id, "grand-piano")
        XCTAssertEqual(descriptor.sends, VoiceSends(reverb: 0.18, delay: 0))
        guard case let .sampled(spec) = descriptor.voice else {
            return XCTFail("expected a sampled voice")
        }
        XCTAssertEqual(spec.sampleMidis.count, 30)
        XCTAssertEqual(spec.fallback, fallback)
    }

    func test_sendsDefaultToZeroAndUnrouted() {
        let descriptor = InstrumentDescriptor(
            id: "plain",
            voice: .supersaw(SupersawVoiceSpec(
                unison: 5, detuneCents: 24, filterBaseHz: 900, filterEnvHz: 2600,
                filterDecay: 0.35, filterQ: 0.9,
                amp: SynthVoiceConfig(waveform: .sawtooth, attack: 0.005, decay: 0.25, sustain: 0.5, release: 0.35),
            )),
        )
        XCTAssertEqual(descriptor.sends, VoiceSends())
        XCTAssertEqual(descriptor.sends.reverb, 0)
        XCTAssertEqual(descriptor.sends.delay, 0)
    }
}
