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
    /// blocks accumulated into one stereo buffer pair (renderPatch's loop shape).
    private func hostRender(_ host: PatchEngineHost, totalFrames: Int) -> (left: [Float], right: [Float]) {
        let blockFrames = 128
        var outL = [Float](repeating: 0, count: totalFrames)
        var outR = [Float](repeating: 0, count: totalFrames)
        var blockL = [Float](repeating: 0, count: blockFrames)
        var blockR = [Float](repeating: 0, count: blockFrames)
        var offset = 0
        while offset < totalFrames {
            let n = min(blockFrames, totalFrames - offset)
            for i in 0..<n {
                blockL[i] = 0
                blockR[i] = 0
            }
            host.render(intoLeft: &blockL, right: &blockR, frames: n)
            for i in 0..<n {
                outL[offset + i] = blockL[i]
                outR[offset + i] = blockR[i]
            }
            offset += n
        }
        return (outL, outR)
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
        XCTAssertEqual(hosted.left, offline.left)
        XCTAssertEqual(hosted.right, offline.right)
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
        XCTAssertEqual(hosted.left, offline.left)
        XCTAssertEqual(hosted.right, offline.right)
        // The zone set actually resolved: the sustain window is audible.
        var sum = 0.0
        for i in 6000..<12000 {
            sum += Double(hosted.left[i]) * Double(hosted.left[i])
        }
        XCTAssertGreaterThan((sum / 6000).squareRoot(), 0.01)
    }

    // MARK: - Slice loop (>4096-frame render calls)

    func testSingleLargeRenderMatchesRenderPatch() {
        let host = PatchEngineHost(sampleRate: GOLDEN_FS)
        host.setPatch(patchFM())
        pushGoldenEvents(host)
        var outL = [Float](repeating: 0, count: 5000)
        var outR = [Float](repeating: 0, count: 5000)
        host.render(intoLeft: &outL, right: &outR, frames: 5000)
        let offline = renderPatch(
            patch: patchFM(), events: goldenEvents(), totalFrames: 5000, sampleRate: GOLDEN_FS,
        )
        XCTAssertEqual(outL, offline.left)
        XCTAssertEqual(outR, offline.right)
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
        var blockL = [Float](repeating: 0, count: 128)
        var blockR = [Float](repeating: 0, count: 128)
        host.render(intoLeft: &blockL, right: &blockR, frames: 128)
        XCTAssertEqual(rejections, [validatePatch(invalid)])
        XCTAssertTrue(blockL.allSatisfy { $0 == 0 })
        XCTAssertTrue(blockR.allSatisfy { $0 == 0 })

        host.setPatch(patchFM())
        host.noteOn(midi: 60, velocity: 0.8)
        for i in 0..<128 {
            blockL[i] = 0
            blockR[i] = 0
        }
        host.render(intoLeft: &blockL, right: &blockR, frames: 128)
        XCTAssertEqual(rejections.count, 1)
        XCTAssertTrue(blockL.contains { $0 != 0 })
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
        var blockL = [Float](repeating: 0, count: 128)
        var blockR = [Float](repeating: 0, count: 128)
        host.render(intoLeft: &blockL, right: &blockR, frames: 128)
        XCTAssertEqual(host.renderedFrames, 128)
        XCTAssertEqual(host.activeVoiceCount, 0)
        for i in 0..<128 {
            blockL[i] = 0
            blockR[i] = 0
        }
        host.render(intoLeft: &blockL, right: &blockR, frames: 128)
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
