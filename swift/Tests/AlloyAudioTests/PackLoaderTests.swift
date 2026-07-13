@testable import AlloyAudio
import Foundation
import XCTest

/// Twin of web pack-source.spec.ts + pack-loader.spec.ts (canonical): fake
/// in-memory PackSource + fake SampleDecoder, provide() nil-before/populated-
/// after load(), buildZone's gain/tune folding, and a render through the
/// Swift PatchEngine with `loader.provide` as the zoneSetProvider — asserting
/// non-silence + determinism, plus the progressive-fallback silent case.
final class PackLoaderTests: XCTestCase {
    private let fs = 48_000.0
    private let zoneLength = 4800

    /// Mono sine test asset: `cycles` full cycles over `length` samples.
    private func sinePcm(length: Int, cycles: Int) -> [Float] {
        var data = [Float](repeating: 0, count: length)
        for i in 0..<length {
            data[i] = Float(sin(2 * Double.pi * Double(cycles) * Double(i) / Double(length)))
        }
        return data
    }

    private func piano2LayerManifest() -> PackManifest {
        PackManifest(
            schemaVersion: PACK_SCHEMA_VERSION,
            id: "test-piano",
            tier: .tiny,
            sampleRate: fs,
            format: "m4a",
            zoneSets: [
                "piano": ZoneSetSpec(layers: [
                    LayerSpec(topVelocity: 0.5, zones: [ZoneSpec(rootMidi: 60, file: "soft.m4a", gain: 1, tuneCents: 0)]),
                    LayerSpec(
                        topVelocity: 1,
                        zones: [
                            ZoneSpec(
                                rootMidi: 60,
                                file: "loud.m4a",
                                loopStart: 0,
                                loopEnd: zoneLength,
                                gain: 2,
                                tuneCents: 50,
                            ),
                        ],
                    ),
                ]),
            ],
            credits: [],
        )
    }

    /// In-memory PackSource: files map name -> a one-byte marker.
    private struct FakePackSource: PackSource {
        let manifest: PackManifest
        let files: [String: Data]

        func fetchManifest() async throws -> PackManifest { manifest }

        func fetchZone(_ file: String) async throws -> Data {
            guard let bytes = files[file] else {
                throw NSError(domain: "FakePackSource", code: 1, userInfo: [NSLocalizedDescriptionKey: "no fixture for \(file)"])
            }
            return bytes
        }
    }

    /// SampleDecoder that maps a one-byte marker to a known, non-silent DecodedPcm.
    private struct FakeDecoder: SampleDecoder {
        let pcmByMarker: [UInt8: DecodedPcm]

        func decode(_ bytes: Data) async throws -> DecodedPcm {
            guard let marker = bytes.first, let pcm = pcmByMarker[marker] else {
                throw NSError(domain: "FakeDecoder", code: 1, userInfo: [NSLocalizedDescriptionKey: "no pcm fixture"])
            }
            return pcm
        }
    }

    private func makeLoader() -> PackLoader {
        let source = FakePackSource(
            manifest: piano2LayerManifest(),
            files: ["soft.m4a": Data([0]), "loud.m4a": Data([1])],
        )
        let decoder = FakeDecoder(pcmByMarker: [
            0: DecodedPcm(sampleRate: fs, data: [Float](repeating: 0.3, count: 10)),
            1: DecodedPcm(sampleRate: fs, data: sinePcm(length: zoneLength, cycles: 44)),
        ])
        return PackLoader(source: source, decoder: decoder)
    }

    // MARK: - buildZone

    func testBuildZoneFoldsGainByScalingThePcm() {
        // Twin pin: web `buildZone` scales [0.1, -0.2, 0.3] by gain 2 to [0.2, -0.4, 0.6].
        let spec = ZoneSpec(rootMidi: 60, file: "x.m4a", gain: 2, tuneCents: 0)
        let zone = buildZone(spec, sampleRate: fs, pcm: [0.1, -0.2, 0.3])
        for (actual, expected) in zip(zone.data, [Float(0.2), -0.4, 0.6]) {
            XCTAssertEqual(actual, expected, accuracy: 1e-5)
        }
    }

    func testBuildZoneRoundsTuneCentsToNearestMidiNote() {
        // Sanctioned asymmetry (docs/mirroring.md): TS folds tuneCents into a
        // fractional rootMidi (60 + 50/100 = 60.5, exact); Swift's
        // SampleZoneData.rootMidi is Int (HARD CONSTRAINT no-touch), so
        // buildZone rounds instead — 60.5 rounds away from zero to 61.
        let spec = ZoneSpec(rootMidi: 60, file: "x.m4a", gain: 1, tuneCents: 50)
        let zone = buildZone(spec, sampleRate: fs, pcm: [0])
        XCTAssertEqual(zone.rootMidi, 61)

        // A correction under half a semitone rounds away entirely (inert
        // until 3b's by-ear tuning needs finer precision than Int allows).
        let smallCorrection = ZoneSpec(rootMidi: 60, file: "x.m4a", gain: 1, tuneCents: 40)
        XCTAssertEqual(buildZone(smallCorrection, sampleRate: fs, pcm: [0]).rootMidi, 60)
    }

    // MARK: - PackLoader.provide

    func testProvideIsNilBeforeLoad() {
        let loader = makeLoader()
        XCTAssertNil(loader.provide("piano"))
    }

    func testProvideResolvesAfterLoadWithZoneCountsRootsAndLoopPoints() async throws {
        let loader = makeLoader()
        try await loader.load()

        let layers = try XCTUnwrap(loader.provide("piano"))
        XCTAssertEqual(layers.count, 2)

        XCTAssertEqual(layers[0].topVelocity, 0.5)
        XCTAssertEqual(layers[0].zones.count, 1)
        XCTAssertEqual(layers[0].zones[0].rootMidi, 60) // tuneCents 0: twin pin with the web test.
        XCTAssertNil(layers[0].zones[0].loopStart)

        XCTAssertEqual(layers[1].topVelocity, 1)
        XCTAssertEqual(layers[1].zones.count, 1)
        XCTAssertEqual(layers[1].zones[0].rootMidi, 61) // 60 + round(50/100) — see the rounding asymmetry test above.
        XCTAssertEqual(layers[1].zones[0].loopStart, 0) // twin pin with the web test.
        XCTAssertEqual(layers[1].zones[0].loopEnd, zoneLength) // twin pin with the web test.
    }

    func testProvideStaysNilForAnUnrelatedZoneSetIdAfterLoad() async throws {
        let loader = makeLoader()
        try await loader.load()
        XCTAssertNil(loader.provide("nonexistent"))
    }

    // MARK: - PackLoader + renderPatch (progressive delivery)

    private func samplePatch() -> Patch {
        Patch(
            schemaVersion: PATCH_SCHEMA_VERSION,
            meta: PatchMeta(id: "test.sample", name: "Test Sample", category: .melodic),
            layers: [
                PatchLayer(
                    keyRange: KeyRange(lowMidi: 0, highMidi: 127),
                    velRange: VelRange(low: 0, high: 1),
                    generator: .sample(zoneSetId: "piano", crossfade: 0.2),
                    tva: TvaParams(level: 0.8, adsr: AdsrParams(attack: 0.001, decay: 0.2, sustain: 0.8, release: 0.1), velCurve: 2),
                ),
            ],
            sends: PatchSends(reverb: 0, delay: 0),
        )
    }

    private func sampleEvents() -> [EngineEvent] {
        [
            EngineEvent(frame: 0, kind: .noteOn(midi: 60, velocity: 0.8)),
            EngineEvent(frame: 12_000, kind: .noteOff(midi: 60)),
        ]
    }

    func testRendersNonSilentDeterministicAudioOnceThePackHasLoaded() async throws {
        let loader = makeLoader()
        try await loader.load()
        let patch = samplePatch()
        let events = sampleEvents()
        let frames = 20_000

        let first = renderPatch(patch: patch, events: events, totalFrames: frames, sampleRate: fs, zoneSetProvider: loader.provide)
        let second = renderPatch(patch: patch, events: events, totalFrames: frames, sampleRate: fs, zoneSetProvider: loader.provide)

        // Sustain window: well past attack+decay (0.001s + 0.2s ≈ 9648 samples), before noteOff@12000.
        var nonSilent = false
        for i in 10_000..<12_000 where first.left[i] != 0 || first.right[i] != 0 {
            nonSilent = true
            break
        }
        XCTAssertTrue(nonSilent)

        XCTAssertEqual(first.left, second.left)
        XCTAssertEqual(first.right, second.right)
    }

    func testIsSilentWithoutCallingLoadFirst() {
        let loader = makeLoader() // load() intentionally not called
        let patch = samplePatch()
        let events = sampleEvents()

        let result = renderPatch(patch: patch, events: events, totalFrames: 20_000, sampleRate: fs, zoneSetProvider: loader.provide)

        XCTAssertTrue(result.left.allSatisfy { $0 == 0 })
        XCTAssertTrue(result.right.allSatisfy { $0 == 0 })
    }
}
