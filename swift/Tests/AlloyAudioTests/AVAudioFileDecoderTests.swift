@testable import AlloyAudio
import Foundation
import XCTest

/// The Swift half of the pack decode path. 3a shipped only fakes on this side,
/// so this is the first test that proves Swift can turn real encoded bytes into
/// PCM — and, through PackLoader, into a resolvable zone set.
final class AVAudioFileDecoderTests: XCTestCase {
    /// 0.5 s of 440 Hz at amplitude 0.5, AAC-encoded by the samplepack pipeline.
    private func fixtureBytes() throws -> Data {
        let url = try XCTUnwrap(
            Bundle.module.url(forResource: "tone440", withExtension: "m4a", subdirectory: "Fixtures"),
        )
        return try Data(contentsOf: url)
    }

    func testDecodesRealAacBytesToMonoPcm() async throws {
        let pcm = try await AVAudioFileDecoder().decode(fixtureBytes())

        XCTAssertEqual(pcm.sampleRate, 48000, accuracy: 1)
        // AAC adds priming/padding frames, so the length is near — not equal to —
        // the 24000 source frames.
        XCTAssertGreaterThan(pcm.data.count, 21000)
        XCTAssertLessThan(pcm.data.count, 28000)

        let peak = pcm.data.reduce(0) { max($0, abs($1)) }
        XCTAssertGreaterThan(peak, 0.3, "decoded a silent buffer")
        XCTAssertLessThan(peak, 0.75, "decoded signal is far hotter than the 0.5 source")
    }

    /// Stereo fixture: left amplitude 0.6, right amplitude 0.2, same 440 Hz
    /// tone, in phase — asymmetric on purpose so the mono-downmix branch
    /// (`channelCount > 1`) is numerically distinguishable from wrong
    /// implementations. Twin of web `WebAudioDecoder.decode` (pack-source.ts),
    /// which does `data[i] += ch[i] / channels`: a failure here means the two
    /// decoders have diverged and stereo packs would play too hot (or with
    /// only one channel's content) on Apple but not on web.
    private func stereoFixtureBytes() throws -> Data {
        let url = try XCTUnwrap(
            Bundle.module.url(forResource: "stereo-lr", withExtension: "m4a", subdirectory: "Fixtures"),
        )
        return try Data(contentsOf: url)
    }

    func testDecodesStereoBytesAsAverageNotSum() async throws {
        let pcm = try await AVAudioFileDecoder().decode(stereoFixtureBytes())

        let peak = pcm.data.reduce(0) { max($0, abs($1)) }
        // Correct average of 0.6 and 0.2 peaks at ~0.4. A sum-instead-of-average
        // bug would peak near 0.8; a left-channel-only bug would peak near 0.6;
        // a right-channel-only bug would peak near 0.2. Generous tolerances
        // account for AAC's lossy encode, but the bands below keep those three
        // wrong implementations well outside the passing range.
        XCTAssertGreaterThan(peak, 0.3, "peak too low for the 0.4 average — looks like a right-only read")
        XCTAssertLessThan(peak, 0.5, "peak too high for the 0.4 average — looks like a sum or left-only read")
    }

    func testDecodeThrowsOnBytesThatAreNotAudio() async {
        let garbage = Data(repeating: 0x7f, count: 512)
        do {
            _ = try await AVAudioFileDecoder().decode(garbage)
            XCTFail("expected a decode failure")
        } catch {
            // any error is acceptable — AVFoundation's or ours
        }
    }

    /// The whole point of the task: a real decoder behind the real loader.
    func testPackLoaderResolvesAZoneSetUsingTheRealDecoder() async throws {
        let bytes = try fixtureBytes()
        let manifest = PackManifest(
            schemaVersion: PACK_SCHEMA_VERSION,
            id: "fixture-pack",
            tier: .tiny,
            sampleRate: 48000,
            format: "m4a",
            zoneSets: [
                "piano": ZoneSetSpec(layers: [
                    LayerSpec(topVelocity: 1, zones: [
                        ZoneSpec(rootMidi: 60, file: "tone440.m4a", gain: 0.5, tuneCents: 0),
                    ]),
                ]),
            ],
            credits: [],
        )
        let loader = PackLoader(
            source: InMemoryPackSource(manifest: manifest, zones: ["tone440.m4a": bytes]),
            decoder: AVAudioFileDecoder(),
        )

        XCTAssertNil(loader.provide("piano"), "must be nil before load (progressive delivery)")
        try await loader.load()

        let layers = try XCTUnwrap(loader.provide("piano"))
        XCTAssertEqual(layers.count, 1)
        let zone = try XCTUnwrap(layers.first?.zones.first)
        XCTAssertEqual(zone.rootMidi, 60, accuracy: 1e-9)
        XCTAssertEqual(zone.sampleRate, 48000, accuracy: 1)
        // gain 0.5 was folded into the PCM at load: the 0.5-amplitude tone halves.
        let peak = zone.data.reduce(0) { max($0, abs($1)) }
        XCTAssertGreaterThan(peak, 0.15)
        XCTAssertLessThan(peak, 0.4)
    }
}

/// Serves a manifest + encoded bytes from memory, so the test never touches the
/// network or the filesystem beyond the bundled fixture.
private struct InMemoryPackSource: PackSource {
    let manifest: PackManifest
    let zones: [String: Data]

    func fetchManifest() async throws -> PackManifest { manifest }

    func fetchZone(_ file: String) async throws -> Data {
        guard let bytes = zones[file] else { throw PackSourceError.invalidManifest(["no such zone: \(file)"]) }
        return bytes
    }
}
