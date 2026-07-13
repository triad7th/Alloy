@testable import AlloyAudio
import XCTest

final class PackManifestTests: XCTestCase {
    private func goodManifest() -> PackManifest {
        PackManifest(
            schemaVersion: PACK_SCHEMA_VERSION,
            id: "grand-piano",
            tier: .standard,
            sampleRate: 48000,
            format: "m4a",
            zoneSets: [
                "main": ZoneSetSpec(layers: [
                    LayerSpec(
                        topVelocity: 0.5,
                        zones: [ZoneSpec(rootMidi: 60, file: "c4-soft.m4a", gain: 1, tuneCents: 0)],
                    ),
                    LayerSpec(
                        topVelocity: 1,
                        zones: [
                            ZoneSpec(
                                rootMidi: 60,
                                file: "c4-loud.m4a",
                                loopStart: 100,
                                loopEnd: 200,
                                gain: 0.9,
                                tuneCents: -3,
                            ),
                        ],
                    ),
                ]),
            ],
            credits: [CreditEntry(source: "Acme Samples", license: "CC0", url: "https://example.com")],
        )
    }

    func testAcceptsAWellFormedManifest() {
        XCTAssertEqual(validateManifest(goodManifest()), [])
    }

    func testRejectsWrongSchemaVersion() {
        var m = goodManifest()
        m.schemaVersion = 2
        XCTAssertFalse(validateManifest(m).isEmpty)
    }

    func testRejectsEmptyId() {
        var m = goodManifest()
        m.id = ""
        XCTAssertFalse(validateManifest(m).isEmpty)
    }

    func testRejectsSampleRateZero() {
        var m = goodManifest()
        m.sampleRate = 0
        XCTAssertFalse(validateManifest(m).isEmpty)
    }

    func testRejectsNonM4aFormat() {
        var m = goodManifest()
        m.format = "wav"
        XCTAssertFalse(validateManifest(m).isEmpty)
    }

    func testRejectsEmptyZoneSets() {
        var m = goodManifest()
        m.zoneSets = [:]
        XCTAssertFalse(validateManifest(m).isEmpty)
    }

    func testRejectsEmptyLayers() {
        var m = goodManifest()
        m.zoneSets["main"] = ZoneSetSpec(layers: [])
        XCTAssertFalse(validateManifest(m).isEmpty)
    }

    func testRejectsNonAscendingTopVelocity() {
        var m = goodManifest()
        let layers = m.zoneSets["main"]!.layers
        m.zoneSets["main"] = ZoneSetSpec(layers: [layers[1], layers[0]])
        XCTAssertFalse(validateManifest(m).isEmpty)
    }

    func testRejectsEmptyZones() {
        var m = goodManifest()
        var layers = m.zoneSets["main"]!.layers
        layers[0].zones = []
        m.zoneSets["main"] = ZoneSetSpec(layers: layers)
        XCTAssertFalse(validateManifest(m).isEmpty)
    }

    func testRejectsRootMidiOutOfRange() {
        var m = goodManifest()
        var layers = m.zoneSets["main"]!.layers
        layers[0].zones[0].rootMidi = 200
        m.zoneSets["main"] = ZoneSetSpec(layers: layers)
        XCTAssertFalse(validateManifest(m).isEmpty)
    }

    func testRejectsEmptyFile() {
        var m = goodManifest()
        var layers = m.zoneSets["main"]!.layers
        layers[0].zones[0].file = ""
        m.zoneSets["main"] = ZoneSetSpec(layers: layers)
        XCTAssertFalse(validateManifest(m).isEmpty)
    }

    func testRejectsGainZero() {
        var m = goodManifest()
        var layers = m.zoneSets["main"]!.layers
        layers[0].zones[0].gain = 0
        m.zoneSets["main"] = ZoneSetSpec(layers: layers)
        XCTAssertFalse(validateManifest(m).isEmpty)
    }

    func testRejectsHalfSpecifiedLoop() {
        var m = goodManifest()
        var layers = m.zoneSets["main"]!.layers
        layers[0].zones[0].loopStart = 10
        m.zoneSets["main"] = ZoneSetSpec(layers: layers)
        XCTAssertFalse(validateManifest(m).isEmpty)
    }

    func testRejectsInvertedLoop() {
        var m = goodManifest()
        var layers = m.zoneSets["main"]!.layers
        layers[1].zones[0].loopStart = 200
        layers[1].zones[0].loopEnd = 100
        m.zoneSets["main"] = ZoneSetSpec(layers: layers)
        XCTAssertFalse(validateManifest(m).isEmpty)
    }

    func testBadTierFailsAtDecodeNotValidation() {
        // Asymmetry pin (see docs/mirroring.md): the TS twin validates tier
        // at runtime because its wire type is a plain string. Swift's
        // PackTier is a Codable string enum, so an unrecognized tier is
        // structurally rejected by JSONDecoder before validateManifest (or
        // any engine code) ever runs — there is no reachable runtime check
        // to mirror.
        let json = """
        {
          "schemaVersion": 1,
          "id": "grand-piano",
          "tier": "ultra",
          "sampleRate": 48000,
          "format": "m4a",
          "zoneSets": {},
          "credits": []
        }
        """
        XCTAssertThrowsError(try JSONDecoder().decode(PackManifest.self, from: Data(json.utf8))) { error in
            XCTAssertTrue(error is DecodingError, "expected a DecodingError, got \(error)")
        }
    }

    func testDataToJsonDecoderRoundTripValidatesClean() throws {
        let json = """
        {
          "schemaVersion": 1,
          "id": "grand-piano",
          "tier": "standard",
          "sampleRate": 48000,
          "format": "m4a",
          "zoneSets": {
            "main": {
              "layers": [
                {
                  "topVelocity": 0.5,
                  "zones": [ { "rootMidi": 60, "file": "c4-soft.m4a", "gain": 1, "tuneCents": 0 } ]
                },
                {
                  "topVelocity": 1,
                  "zones": [
                    {
                      "rootMidi": 60,
                      "file": "c4-loud.m4a",
                      "loopStart": 100,
                      "loopEnd": 200,
                      "gain": 0.9,
                      "tuneCents": -3
                    }
                  ]
                }
              ]
            }
          },
          "credits": [ { "source": "Acme Samples", "license": "CC0", "url": "https://example.com" } ]
        }
        """
        let decoded = try JSONDecoder().decode(PackManifest.self, from: Data(json.utf8))
        XCTAssertTrue(validateManifest(decoded).isEmpty)
        XCTAssertEqual(decoded.zoneSets["main"]?.layers.count, 2)
    }
}
