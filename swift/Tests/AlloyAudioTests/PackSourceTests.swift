@testable import AlloyAudio
import Foundation
import XCTest

/// Twin of web pack-source.spec.ts (canonical): BasePathPackSource's request
/// URLs, its manifest validation throw path, and fetchZone's byte pass-through
/// via a fake injected fetch closure (no real network).
final class PackSourceTests: XCTestCase {
    private func goodManifest() -> PackManifest {
        PackManifest(
            schemaVersion: PACK_SCHEMA_VERSION,
            id: "grand-piano",
            tier: .standard,
            sampleRate: 48_000,
            format: "m4a",
            zoneSets: [
                "piano": ZoneSetSpec(layers: [
                    LayerSpec(topVelocity: 1, zones: [ZoneSpec(rootMidi: 60, file: "c4.m4a", gain: 1, tuneCents: 0)]),
                ]),
            ],
            credits: [],
        )
    }

    private func encode(_ manifest: PackManifest) -> Data {
        try! JSONEncoder().encode(manifest)
    }

    func testFetchManifestRequestsBaseManifestJsonAndReturnsTheParsedManifest() async throws {
        var requested: [String] = []
        let manifest = goodManifest()
        let bytes = encode(manifest)
        let fetchFn: FetchFn = { url in
            requested.append(url)
            return bytes
        }
        let source = BasePathPackSource(base: "packs/piano", fetchFn: fetchFn)

        let result = try await source.fetchManifest()

        XCTAssertEqual(requested, ["packs/piano/manifest.json"])
        XCTAssertEqual(result.id, manifest.id)
        XCTAssertEqual(result.tier, manifest.tier)
        XCTAssertEqual(result.sampleRate, manifest.sampleRate)
        XCTAssertEqual(result.schemaVersion, manifest.schemaVersion)
        XCTAssertEqual(result.zoneSets.keys.sorted(), manifest.zoneSets.keys.sorted())
    }

    func testFetchManifestThrowsOnAnInvalidManifest() async {
        var bad = goodManifest()
        bad.schemaVersion = PACK_SCHEMA_VERSION + 1
        let bytes = encode(bad)
        let fetchFn: FetchFn = { _ in bytes }
        let source = BasePathPackSource(base: "packs/piano", fetchFn: fetchFn)

        do {
            _ = try await source.fetchManifest()
            XCTFail("expected fetchManifest to throw")
        } catch let PackSourceError.invalidManifest(errors) {
            XCTAssertFalse(errors.isEmpty)
        } catch {
            XCTFail("expected PackSourceError.invalidManifest, got \(error)")
        }
    }

    func testFetchZoneRequestsBaseFileAndReturnsTheBytes() async throws {
        var requested: [String] = []
        let bytes = Data([1, 2, 3, 4])
        let fetchFn: FetchFn = { url in
            requested.append(url)
            return bytes
        }
        let source = BasePathPackSource(base: "packs/piano", fetchFn: fetchFn)

        let result = try await source.fetchZone("c4.m4a")

        XCTAssertEqual(requested, ["packs/piano/c4.m4a"])
        XCTAssertEqual(result, bytes)
    }
}
