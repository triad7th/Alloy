@testable import AlloyAudio
import XCTest

final class PatchTests: XCTestCase {
    private var fixtureData: Data { Data(fixturePatchJSON.utf8) }

    /// Wire-contract pin shared verbatim with patch.spec.ts: a va generator
    /// may omit pulseWidth (TS type is optional; Swift decodes it as 0.5).
    private let noPulseWidthPatchJSON = """
    {
      "schemaVersion": 1,
      "meta": { "id": "test.nopw", "name": "No Pulse Width", "category": "melodic" },
      "layers": [
        {
          "keyRange": { "lowMidi": 0, "highMidi": 127 },
          "velRange": { "low": 0, "high": 1 },
          "generator": { "kind": "va", "va": { "shape": "saw", "unison": 2, "detuneCents": 12 }, "seed": 3 },
          "tva": { "level": 0.7, "adsr": { "attack": 0.01, "decay": 0.2, "sustain": 0.6, "release": 0.2 }, "velCurve": 1 }
        }
      ],
      "sends": { "reverb": 0, "delay": 0 }
    }
    """

    private func decodeFixture() throws -> Patch {
        try JSONDecoder().decode(Patch.self, from: fixtureData)
    }

    func testFixtureParsesAndValidatesClean() throws {
        let patch = try decodeFixture()
        XCTAssertEqual(patch.schemaVersion, PATCH_SCHEMA_VERSION)
        XCTAssertEqual(patch.layers.count, 2)
        XCTAssertTrue(validatePatch(patch).isEmpty)
    }

    func testRejectsWrongSchemaVersionEmptyLayersAndTooManyLayers() throws {
        let base = try decodeFixture()

        var wrongVersion = base
        wrongVersion.schemaVersion = 2
        XCTAssertFalse(validatePatch(wrongVersion).isEmpty)

        var noLayers = base
        noLayers.layers = []
        XCTAssertFalse(validatePatch(noLayers).isEmpty)

        var tooManyLayers = base
        tooManyLayers.layers = Array(repeating: base.layers[0], count: 5)
        XCTAssertFalse(validatePatch(tooManyLayers).isEmpty)
    }

    func testSurfacesNestedFmErrorsWithLayerPrefix() throws {
        var broken = try decodeFixture()
        guard case let .fm(fmParams) = broken.layers[1].generator else {
            return XCTFail("expected fm generator on layer 2")
        }
        let brokenAlgorithm = FmAlgorithm(
            routes: fmParams.algorithm.routes,
            carriers: [9],
            feedback: fmParams.algorithm.feedback,
        )
        let brokenFm = FmGeneratorParams(operators: fmParams.operators, algorithm: brokenAlgorithm)
        broken.layers[1].generator = .fm(brokenFm)

        let errors = validatePatch(broken)
        XCTAssertTrue(errors.contains { $0.hasPrefix("layer 2:") })
    }

    func testRejectsBadRangesAndGeneratorSpecifics() throws {
        var badKeys = try decodeFixture()
        badKeys.layers[0].keyRange = KeyRange(lowMidi: 80, highMidi: 40)
        XCTAssertFalse(validatePatch(badKeys).isEmpty)

        var badVa = try decodeFixture()
        guard case let .va(vaParams, seed) = badVa.layers[0].generator else {
            return XCTFail("expected va generator on layer 1")
        }
        let brokenVaParams = VaParams(
            shape: vaParams.shape,
            unison: 0,
            detuneCents: vaParams.detuneCents,
            pulseWidth: vaParams.pulseWidth,
        )
        badVa.layers[0].generator = .va(brokenVaParams, seed: seed)
        XCTAssertFalse(validatePatch(badVa).isEmpty)
    }

    func testVaGeneratorOmittingPulseWidthDecodesWithDefault() throws {
        let patch = try JSONDecoder().decode(Patch.self, from: Data(noPulseWidthPatchJSON.utf8))
        XCTAssertTrue(validatePatch(patch).isEmpty)
        guard case let .va(vaParams, seed) = patch.layers[0].generator else {
            return XCTFail("expected va generator on layer 1")
        }
        XCTAssertEqual(vaParams.pulseWidth, 0.5)
        XCTAssertEqual(seed, 3)
    }

    func testFixtureWithoutInsertsStillValidates() throws {
        // Backward-compat pin: `inserts` is optional and schemaVersion stays
        // 1, so every pre-2a patch JSON must keep decoding and validating.
        let patch = try decodeFixture()
        XCTAssertNil(patch.inserts)
        XCTAssertTrue(validatePatch(patch).isEmpty)
    }

    /// Asymmetry pin (see docs/mirroring.md): the TS twin has a runtime
    /// `validateInsert` default arm that rejects an unknown `kind` with a
    /// patchRejected reply (never throws — see effect-types.ts and
    /// worklet-host-core.spec.ts). Swift never reaches an equivalent
    /// runtime check: `InsertSpec.init(from:)` throws a `DecodingError` the
    /// moment it sees an unrecognized `kind`, so an unknown insert kind is
    /// structurally rejected at decode time, before `validatePatch` (or any
    /// engine code) ever runs.
    func testUnknownInsertKindFailsAtDecodeNotValidation() {
        let json = """
        {
          "schemaVersion": 1,
          "meta": { "id": "test.unknown-insert", "name": "Unknown Insert", "category": "melodic" },
          "layers": [
            {
              "keyRange": { "lowMidi": 0, "highMidi": 127 },
              "velRange": { "low": 0, "high": 1 },
              "generator": { "kind": "additive", "partials": [ { "ratio": 1, "level": 1 } ] },
              "tva": { "level": 0.8, "adsr": { "attack": 0.005, "decay": 0.3, "sustain": 0.7, "release": 0.25 }, "velCurve": 1 }
            }
          ],
          "sends": { "reverb": 0, "delay": 0 },
          "inserts": [ { "kind": "phaser" } ]
        }
        """
        XCTAssertThrowsError(try JSONDecoder().decode(Patch.self, from: Data(json.utf8))) { error in
            XCTAssertTrue(error is DecodingError, "expected a DecodingError, got \(error)")
        }
    }

    func testRejectsMoreThanMaxInserts() throws {
        var patch = try decodeFixture()
        let chorus = InsertSpec.chorus(ChorusParams(mode: .chorus, rateHz: 1, depthMs: 3, mix: 0.5))
        patch.inserts = [chorus, chorus, chorus, chorus]
        XCTAssertTrue(validatePatch(patch).contains("too many inserts (4 > 3)"))
    }

    func testPrefixesInsertValidationErrorsWithTheirOneBasedIndex() throws {
        var patch = try decodeFixture()
        patch.inserts = [.chorus(ChorusParams(mode: .chorus, rateHz: 0, depthMs: 25, mix: 1.5))]
        let errors = validatePatch(patch)
        XCTAssertGreaterThanOrEqual(errors.count, 3)
        XCTAssertTrue(errors.allSatisfy { $0.hasPrefix("insert 1: ") })
    }

    func testInsertsFixtureDecodesValidatesAndRoundTrips() throws {
        // Same JSON string as the TS spec ('inserts fixture parses,
        // validates clean, and round-trips').
        let patch = try JSONDecoder().decode(Patch.self, from: Data(fixtureInsertsPatchJSON.utf8))
        XCTAssertTrue(validatePatch(patch).isEmpty)
        XCTAssertEqual(patch.inserts?.count, 2)

        let encoded = try JSONEncoder().encode(patch)
        let decoded = try JSONDecoder().decode(Patch.self, from: encoded)
        XCTAssertTrue(validatePatch(decoded).isEmpty)
        guard case let .chorus(chorus)? = decoded.inserts?[0] else {
            return XCTFail("expected a chorus insert at position 1")
        }
        XCTAssertEqual(chorus.mode, .ensemble)
        XCTAssertEqual(chorus.rateHz, 0.9)
        XCTAssertEqual(chorus.depthMs, 2.5)
        XCTAssertEqual(chorus.mix, 0.4)
        guard case let .tremolo(tremolo)? = decoded.inserts?[1] else {
            return XCTFail("expected a tremolo insert at position 2")
        }
        XCTAssertEqual(tremolo.rateHz, 5.5)
        XCTAssertEqual(tremolo.depth, 0.6)
        XCTAssertEqual(tremolo.spread, 1)
    }

    func testRoundTripEncodeDecodeStillValidates() throws {
        let patch = try decodeFixture()
        let encoded = try JSONEncoder().encode(patch)
        let decoded = try JSONDecoder().decode(Patch.self, from: encoded)
        XCTAssertTrue(validatePatch(decoded).isEmpty)
        XCTAssertEqual(decoded.layers.count, patch.layers.count)
    }
}
