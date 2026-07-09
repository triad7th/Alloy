import AlloyAudio
import XCTest

/// Alloy deliberately ships no sample assets (they stay app-side), and
/// macOS has no MP3 encoder to synthesize a fixture at runtime — so unlike
/// AllyPiano's suite these tests cover the injectable bundle/subdirectory
/// seam and the skip-silently branches; the happy decode path stays covered
/// by the consuming app's suite against its real bundled samples.
final class BundleSampleSourceTests: XCTestCase {
    /// A directory bundle containing `<subdirectory>/060.mp3` (dummy bytes).
    private func makeFixtureBundle(subdirectory: String, contents: Data = Data("not audio".utf8)) throws -> Bundle {
        let root = URL(fileURLWithPath: NSTemporaryDirectory())
            .appendingPathComponent("alloy-audio-fixture-\(UUID().uuidString)")
        let dir = subdirectory.isEmpty ? root : root.appendingPathComponent(subdirectory)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        try contents.write(to: dir.appendingPathComponent(sampleFileName(midi: 60)))
        return Bundle(url: root)!
    }

    func test_sampleURLHonorsInjectedBundleAndSubdirectory() throws {
        let bundle = try makeFixtureBundle(subdirectory: "grand-piano")
        let source = BundleSampleSource(bundle: bundle, subdirectory: "grand-piano")
        XCTAssertEqual(source.sampleURL(midi: 60)?.lastPathComponent, "060.mp3")
        XCTAssertNil(source.sampleURL(midi: 61)) // only 060.mp3 exists
        // Wrong subdirectory finds nothing.
        XCTAssertNil(BundleSampleSource(bundle: bundle, subdirectory: "upright").sampleURL(midi: 60))
    }

    func test_emptySubdirectoryMeansBundleRoot() throws {
        let bundle = try makeFixtureBundle(subdirectory: "")
        let source = BundleSampleSource(bundle: bundle)
        XCTAssertNotNil(source.sampleURL(midi: 60))
        XCTAssertNil(source.sampleURL(midi: 61))
    }

    func test_missingFileIsSkippedSilently() {
        let store = SampleZoneStore()
        let source = BundleSampleSource() // .main: no 001.mp3 anywhere
        source.startLoading(midis: [1], into: store)
        RunLoop.current.run(until: Date().addingTimeInterval(0.3))
        XCTAssertEqual(store.loadedCount, 0) // skipped, no crash
    }

    func test_undecodableFileIsSkippedSilently() throws {
        // The file resolves but is not audio: decode fails, zone is skipped,
        // playback falls back to the nearest zone / synth (web parity).
        let bundle = try makeFixtureBundle(subdirectory: "grand-piano")
        let store = SampleZoneStore()
        let source = BundleSampleSource(bundle: bundle, subdirectory: "grand-piano")
        XCTAssertNotNil(source.sampleURL(midi: 60))
        source.startLoading(midis: [60], into: store)
        RunLoop.current.run(until: Date().addingTimeInterval(0.3))
        XCTAssertEqual(store.loadedCount, 0)
    }
}
