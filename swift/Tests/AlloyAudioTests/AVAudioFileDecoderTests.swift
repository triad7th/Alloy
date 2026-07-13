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
