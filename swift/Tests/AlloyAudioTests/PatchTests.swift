@testable import AlloyAudio
import XCTest

final class PatchTests: XCTestCase {
    private var fixtureData: Data { Data(fixturePatchJSON.utf8) }

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

    func testRoundTripEncodeDecodeStillValidates() throws {
        let patch = try decodeFixture()
        let encoded = try JSONEncoder().encode(patch)
        let decoded = try JSONDecoder().decode(Patch.self, from: encoded)
        XCTAssertTrue(validatePatch(decoded).isEmpty)
        XCTAssertEqual(decoded.layers.count, patch.layers.count)
    }
}
