@testable import AlloyAudio
import AVFoundation
import XCTest

/// PatchEngineHost: the AVAudioSourceNode-side rompler host. Flagship
/// guarantee: driving the host's command path with the golden fixtures is
/// bit-exactly the offline renderPatch harness — same core, same schedule
/// order. Twin of web src/worklet-host-core.spec.ts's flagship (semantic
/// twins; see docs/mirroring.md).
final class PatchEngineHostTests: XCTestCase {
    /// Drives the host the way the source node does: zero-filled 128-frame
    /// blocks accumulated into one buffer (renderPatch's loop shape).
    private func hostRender(_ host: PatchEngineHost, totalFrames: Int) -> [Float] {
        let blockFrames = 128
        var out = [Float](repeating: 0, count: totalFrames)
        var block = [Float](repeating: 0, count: blockFrames)
        var offset = 0
        while offset < totalFrames {
            let n = min(blockFrames, totalFrames - offset)
            for i in 0..<n {
                block[i] = 0
            }
            host.render(into: &block, frames: n)
            for i in 0..<n {
                out[offset + i] = block[i]
            }
            offset += n
        }
        return out
    }

    /// Pushes the golden event script as commands, in GOLDEN_EVENTS order
    /// (same relative order renderPatch schedules them → identical output).
    private func pushGoldenEvents(_ host: PatchEngineHost) {
        for event in goldenEvents() {
            switch event.kind {
            case let .noteOn(midi, velocity):
                host.noteOn(midi: midi, velocity: velocity, atFrame: event.frame)
            case let .noteOff(midi):
                host.noteOff(midi: midi, atFrame: event.frame)
            case .allNotesOff:
                host.allNotesOff()
            }
        }
    }

    // MARK: - Flagship equality (host path ≡ renderPatch, bit-exact)

    func testFlagshipFmHostRenderEqualsRenderPatch() {
        let host = PatchEngineHost(sampleRate: GOLDEN_FS)
        host.setPatch(patchFM())
        pushGoldenEvents(host)
        let hosted = hostRender(host, totalFrames: GOLDEN_FRAMES)
        let offline = renderPatch(
            patch: patchFM(), events: goldenEvents(), totalFrames: GOLDEN_FRAMES, sampleRate: GOLDEN_FS,
        )
        XCTAssertEqual(hosted, offline)
    }

    func testFlagshipSampleHostRenderEqualsRenderPatch() {
        let host = PatchEngineHost(sampleRate: GOLDEN_FS)
        host.setPatch(patchSample())
        host.setZoneSet("golden.sine", goldenZones())
        pushGoldenEvents(host)
        let hosted = hostRender(host, totalFrames: GOLDEN_FRAMES)
        let offline = renderPatch(
            patch: patchSample(), events: goldenEvents(), totalFrames: GOLDEN_FRAMES, sampleRate: GOLDEN_FS,
            zoneSetProvider: goldenZoneSetProvider,
        )
        XCTAssertEqual(hosted, offline)
        // The zone set actually resolved: the sustain window is audible.
        var sum = 0.0
        for i in 6000..<12000 {
            sum += Double(hosted[i]) * Double(hosted[i])
        }
        XCTAssertGreaterThan((sum / 6000).squareRoot(), 0.01)
    }

    // MARK: - Slice loop (>4096-frame render calls)

    func testSingleLargeRenderMatchesRenderPatch() {
        let host = PatchEngineHost(sampleRate: GOLDEN_FS)
        host.setPatch(patchFM())
        pushGoldenEvents(host)
        var out = [Float](repeating: 0, count: 5000)
        host.render(into: &out, frames: 5000)
        let offline = renderPatch(
            patch: patchFM(), events: goldenEvents(), totalFrames: 5000, sampleRate: GOLDEN_FS,
        )
        XCTAssertEqual(out, offline)
        XCTAssertEqual(host.renderedFrames, 5000)
    }

    // MARK: - Patch rejection

    func testRejectedPatchSurfacesErrorsThenValidPatchRecovers() {
        let host = PatchEngineHost(sampleRate: GOLDEN_FS)
        var invalid = patchFM()
        invalid.schemaVersion = 2
        var rejections: [[String]] = []
        host.onPatchRejected = { rejections.append($0) }

        host.setPatch(invalid)
        host.noteOn(midi: 60, velocity: 0.8)
        var block = [Float](repeating: 0, count: 128)
        host.render(into: &block, frames: 128)
        XCTAssertEqual(rejections, [validatePatch(invalid)])
        XCTAssertTrue(block.allSatisfy { $0 == 0 })

        host.setPatch(patchFM())
        host.noteOn(midi: 60, velocity: 0.8)
        for i in 0..<128 {
            block[i] = 0
        }
        host.render(into: &block, frames: 128)
        XCTAssertEqual(rejections.count, 1)
        XCTAssertTrue(block.contains { $0 != 0 })
    }

    // MARK: - Drain bound

    /// The plan's sketch (513 distinct-midi noteOns) is unsatisfiable: patch
    /// keyRanges cap at midi 127 and out-of-range/restruck voices are reaped
    /// within the first render. Same property, sound observable: command 513
    /// (a noteOn behind 512 no-op fillers) must not apply on the first
    /// render's drain and must apply on the second's.
    func testDrainBoundCarriesLeftoverCommandsToNextRender() {
        let host = PatchEngineHost(sampleRate: GOLDEN_FS)
        host.setPatch(patchFM()) // command 1
        for _ in 0..<(PatchEngineHost.maxCommandsPerBlock - 1) {
            host.allNotesOff() // commands 2...512: no-op fillers
        }
        host.noteOn(midi: 60, velocity: 0.8) // command 513: beyond the first drain
        var block = [Float](repeating: 0, count: 128)
        host.render(into: &block, frames: 128)
        XCTAssertEqual(host.renderedFrames, 128)
        XCTAssertEqual(host.activeVoiceCount, 0)
        for i in 0..<128 {
            block[i] = 0
        }
        host.render(into: &block, frames: 128)
        XCTAssertEqual(host.renderedFrames, 256)
        XCTAssertEqual(host.activeVoiceCount, 1)
    }

    // MARK: - Source node shell

    func testMakeSourceNodeConstructs() {
        let host = PatchEngineHost(sampleRate: 48_000)
        let node = host.makeSourceNode()
        XCTAssertGreaterThanOrEqual(node.numberOfOutputs, 1)
    }
}
