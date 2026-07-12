@testable import AlloyAudio
import XCTest

final class PatchEngineTests: XCTestCase {
    private let fs = 48_000.0

    private let fullKey = KeyRange(lowMidi: 0, highMidi: 127)
    private let fullVel = VelRange(low: 0, high: 1)
    /// Fast attack so scheduled notes become audible within a few samples.
    private let adsr = AdsrParams(attack: 0.001, decay: 0.2, sustain: 0.7, release: 0.03)

    private func additiveLayer() -> PatchLayer {
        PatchLayer(
            keyRange: fullKey,
            velRange: fullVel,
            generator: .additive([AdditivePartial(ratio: 1, level: 1)]),
            tva: TvaParams(level: 0.8, adsr: adsr, velCurve: 1),
        )
    }

    private func makePatch(_ layers: [PatchLayer]? = nil) -> Patch {
        Patch(
            schemaVersion: PATCH_SCHEMA_VERSION,
            meta: PatchMeta(id: "test.engine", name: "Engine Test", category: .melodic),
            layers: layers ?? [additiveLayer()],
            sends: PatchSends(reverb: 0, delay: 0),
        )
    }

    /// Stereo render helper; most scheduling tests assert on the left
    /// channel (insert-free rendering is unity mono→stereo, so L carries the
    /// old mono expectations verbatim).
    private func processStereo(_ engine: PatchEngine, _ frames: Int) -> (left: [Float], right: [Float]) {
        var left = [Float](repeating: 0, count: frames)
        var right = [Float](repeating: 0, count: frames)
        engine.process(intoLeft: &left, right: &right, frames: frames)
        return (left, right)
    }

    private func process(_ engine: PatchEngine, _ frames: Int) -> [Float] {
        processStereo(engine, frames).left
    }

    /// Renders totalFrames in fixed-size blocks, returning the concatenated stereo buffers.
    private func processBlocksStereo(_ engine: PatchEngine, _ totalFrames: Int, _ block: Int) -> (left: [Float], right: [Float]) {
        var outL = [Float](repeating: 0, count: totalFrames)
        var outR = [Float](repeating: 0, count: totalFrames)
        var bufL = [Float](repeating: 0, count: block)
        var bufR = [Float](repeating: 0, count: block)
        var offset = 0
        while offset < totalFrames {
            let n = min(block, totalFrames - offset)
            for i in 0..<n {
                bufL[i] = 0
                bufR[i] = 0
            }
            engine.process(intoLeft: &bufL, right: &bufR, frames: n)
            for i in 0..<n {
                outL[offset + i] = bufL[i]
                outR[offset + i] = bufR[i]
            }
            offset += n
        }
        return (outL, outR)
    }

    private func processBlocks(_ engine: PatchEngine, _ totalFrames: Int, _ block: Int) -> [Float] {
        processBlocksStereo(engine, totalFrames, block).left
    }

    private func maxAbs(_ samples: [Float], _ from: Int, _ to: Int) -> Float {
        var peak: Float = 0
        for i in from..<to {
            peak = max(peak, abs(samples[i]))
        }
        return peak
    }

    /// Shared fixture-patch event list for the renderPatch tests.
    private let renderEvents = [
        EngineEvent(frame: 0, kind: .noteOn(midi: 60, velocity: 0.8)),
        EngineEvent(frame: 480, kind: .noteOn(midi: 64, velocity: 0.6)),
        EngineEvent(frame: 2400, kind: .noteOff(midi: 60)),
        EngineEvent(frame: 4000, kind: .allNotesOff),
    ]

    private func fixturePatch() throws -> Patch {
        try JSONDecoder().decode(Patch.self, from: Data(fixturePatchJSON.utf8))
    }

    // 1. Transport: fresh engine frame == 0; process(256) twice → frame == 512.
    func testStartsTheTransportAtFrame0AndAdvancesByFramesRendered() {
        let engine = PatchEngine(sampleRate: fs)
        XCTAssertEqual(engine.frame, 0)
        XCTAssertEqual(engine.activeVoiceCount, 0)
        _ = process(engine, 256)
        _ = process(engine, 256)
        XCTAssertEqual(engine.frame, 512)
    }

    // 2. Sample-accurate scheduling: noteOn at frame 100 → out[0..99] all exactly 0,
    //    out[100] onward nonzero within 8 samples (attack 0.001).
    func testAppliesAScheduledNoteOnAtItsExactSampleOffset() {
        let engine = PatchEngine(sampleRate: fs)
        engine.setPatch(makePatch())
        engine.schedule(EngineEvent(frame: 100, kind: .noteOn(midi: 60, velocity: 1)))
        let out = process(engine, 256)
        for i in 0..<100 {
            XCTAssertEqual(out[i], 0)
        }
        XCTAssertGreaterThan(maxAbs(out, 100, 108), 0)
    }

    // 3. Same-frame order: noteOn(60)@0 and noteOff(60)@0 scheduled in that order →
    //    the note keys up immediately. The click-free TVA releases from level 0
    //    (noteOn never resets level), so the keyed-up voice is exactly silent and
    //    reaped; the schedule-order proof is the reversed schedule, where the
    //    noteOff finds no sounding voice and the note sustains.
    func testAppliesSameFrameEventsInScheduleOrder() {
        let keyed = PatchEngine(sampleRate: fs)
        keyed.setPatch(makePatch())
        keyed.schedule(EngineEvent(frame: 0, kind: .noteOn(midi: 60, velocity: 1)))
        keyed.schedule(EngineEvent(frame: 0, kind: .noteOff(midi: 60)))
        let silent = processBlocks(keyed, 24_000, 128) // 0.5 s
        XCTAssertEqual(keyed.activeVoiceCount, 0)
        XCTAssertEqual(maxAbs(silent, 0, 24_000), 0)
        let reversed = PatchEngine(sampleRate: fs)
        reversed.setPatch(makePatch())
        reversed.schedule(EngineEvent(frame: 0, kind: .noteOff(midi: 60)))
        reversed.schedule(EngineEvent(frame: 0, kind: .noteOn(midi: 60, velocity: 1)))
        let loud = processBlocks(reversed, 24_000, 128)
        XCTAssertEqual(reversed.activeVoiceCount, 1)
        XCTAssertGreaterThan(maxAbs(loud, 0, 24_000), 0.1)
    }

    // 4. Restrike: noteOn(60)@0, noteOn(60)@4800 → at frame 4805 activeVoiceCount == 2
    //    (old voice releasing + new voice), by 4800 + quickRelease tau * 15 → 1.
    func testRestrikesTheSameMidiByQuickReleasingTheOldVoice() {
        let engine = PatchEngine(sampleRate: fs)
        engine.setPatch(makePatch())
        engine.schedule(EngineEvent(frame: 0, kind: .noteOn(midi: 60, velocity: 1)))
        engine.schedule(EngineEvent(frame: 4800, kind: .noteOn(midi: 60, velocity: 1)))
        _ = process(engine, 2400)
        _ = process(engine, 2400)
        _ = process(engine, 5)
        XCTAssertEqual(engine.frame, 4805)
        XCTAssertEqual(engine.activeVoiceCount, 2)
        _ = process(engine, 2880) // 15 quickRelease taus (0.008 s each) past the restrike…
        _ = process(engine, 2880)
        XCTAssertEqual(engine.activeVoiceCount, 1)
    }

    // 5. Polyphony + steal: maxVoices 4; five noteOns at frames 0,10,20,30,40
    //    (midis 60..64) → activeVoiceCount never exceeds 4; the stolen voice is
    //    midi 60 (earliest start): noteOffs for 61..64 must drain the pool to 0 —
    //    if any other midi had been stolen, 60 would sustain forever.
    func testCapsPolyphonyAndStealsTheEarliestStartedVoice() {
        let engine = PatchEngine(sampleRate: fs, maxVoices: 4)
        engine.setPatch(makePatch())
        for i in 0..<5 {
            engine.schedule(EngineEvent(frame: i * 10, kind: .noteOn(midi: 60 + i, velocity: 1)))
        }
        for i in 1..<5 {
            engine.schedule(EngineEvent(frame: 2400, kind: .noteOff(midi: 60 + i)))
        }
        var maxCount = 0
        func step(_ frames: Int) {
            _ = process(engine, frames)
            maxCount = max(maxCount, engine.activeVoiceCount)
        }
        for _ in 0..<5 {
            step(10)
        }
        XCTAssertEqual(engine.activeVoiceCount, 4)
        step(2350)
        for _ in 0..<9 {
            step(2400) // release 0.03 s dies well inside 0.45 s
        }
        XCTAssertLessThanOrEqual(maxCount, 4)
        XCTAssertEqual(engine.activeVoiceCount, 0)
    }

    // 6. allNotesOff: three notes, allNotesOff@2400, render 0.15 s more
    //    (quickRelease tau 8 ms → 18 tau) → activeVoiceCount == 0.
    func testAllNotesOffQuickReleasesEveryVoice() {
        let engine = PatchEngine(sampleRate: fs)
        engine.setPatch(makePatch())
        for midi in [60, 64, 67] {
            engine.schedule(EngineEvent(frame: 0, kind: .noteOn(midi: midi, velocity: 1)))
        }
        engine.schedule(EngineEvent(frame: 2400, kind: .allNotesOff))
        _ = process(engine, 2400)
        XCTAssertEqual(engine.activeVoiceCount, 3)
        _ = process(engine, 3600)
        _ = process(engine, 3600)
        XCTAssertEqual(engine.activeVoiceCount, 0)
    }

    // 7. setPatch rejects invalid (returns the errors); the engine still renders
    //    with the old patch.
    func testRejectsAnInvalidPatchAndKeepsRenderingWithTheOldOne() {
        let engine = PatchEngine(sampleRate: fs)
        XCTAssertEqual(engine.setPatch(makePatch()), [])
        let errors = engine.setPatch(makePatch([]))
        XCTAssertEqual(errors, ["layer count 0 outside 1..4"])
        engine.schedule(EngineEvent(frame: 0, kind: .noteOn(midi: 60, velocity: 1)))
        let out = process(engine, 256)
        XCTAssertEqual(engine.activeVoiceCount, 1)
        XCTAssertGreaterThan(maxAbs(out, 0, 256), 0)
    }

    // 8. renderPatch determinism: two calls with identical args → identical buffers.
    func testRenderPatchIsDeterministicAcrossRepeatRenders() throws {
        let patch = try fixturePatch()
        let a = renderPatch(patch: patch, events: renderEvents, totalFrames: 4800, sampleRate: fs).left
        let b = renderPatch(patch: patch, events: renderEvents, totalFrames: 4800, sampleRate: fs).left
        XCTAssertEqual(a.count, 4800)
        XCTAssertGreaterThan(maxAbs(a, 0, 4800), 0)
        XCTAssertEqual(a, b)
    }

    // 9. renderPatch (128-frame blocks) equals a manual 48-frame process loop exactly
    //    (chunk determinism is pinned by the Voice tests).
    func testRenderPatchMatchesAManualEngineLoopAtADifferentBlockSize() throws {
        let patch = try fixturePatch()
        let harness = renderPatch(patch: patch, events: renderEvents, totalFrames: 4800, sampleRate: fs).left
        let engine = PatchEngine(sampleRate: fs)
        engine.setPatch(patch)
        for event in renderEvents {
            engine.schedule(event)
        }
        let manual = processBlocks(engine, 4800, 48)
        XCTAssertEqual(manual, harness)
    }

    // 10. Mono compatibility contract: an insert-free patch renders identical
    //     L and R (the mono→stereo copy is unity), pinned exactly.
    func testRendersIdenticalLeftAndRightChannelsWithoutInserts() {
        let engine = PatchEngine(sampleRate: fs)
        engine.setPatch(makePatch())
        engine.schedule(EngineEvent(frame: 0, kind: .noteOn(midi: 60, velocity: 1)))
        let (left, right) = processBlocksStereo(engine, 4800, 128)
        XCTAssertGreaterThan(maxAbs(left, 0, 4800), 0)
        XCTAssertEqual(left, right)
    }

    // 11. Insert-chain wiring: a fully-wet chorus insert decorrelates the
    //     channels (taps 90° apart) — L must differ from R after warmup.
    func testRunsTheInsertChainSoAChorusPatchDecorrelatesLeftFromRight() {
        var patch = makePatch()
        patch.inserts = [.chorus(ChorusParams(mode: .chorus, rateHz: 0.8, depthMs: 3, mix: 1))]
        let engine = PatchEngine(sampleRate: fs)
        engine.setPatch(patch)
        engine.schedule(EngineEvent(frame: 0, kind: .noteOn(midi: 60, velocity: 1)))
        let (left, right) = processBlocksStereo(engine, 4800, 128)
        var maxDiff: Float = 0
        for i in 1000..<4800 {
            maxDiff = max(maxDiff, abs(left[i] - right[i]))
        }
        XCTAssertGreaterThan(maxDiff, 0.01)
    }

    // 12. Chain continuity across setPatch (document-pinning test): the insert
    //     chain is rebuilt only in setPatch, so a voice sounding across the
    //     swap renders through the NEW patch's chain — no throw, still audible.
    func testKeepsRenderingASoundingVoiceThroughTheNewInsertChainAfterSetPatch() {
        var chorusPatch = makePatch()
        chorusPatch.inserts = [.chorus(ChorusParams(mode: .chorus, rateHz: 0.8, depthMs: 3, mix: 0.5))]
        let engine = PatchEngine(sampleRate: fs)
        XCTAssertEqual(engine.setPatch(chorusPatch), [])
        engine.schedule(EngineEvent(frame: 0, kind: .noteOn(midi: 60, velocity: 1)))
        let before = processBlocksStereo(engine, 1024, 128)
        XCTAssertGreaterThan(maxAbs(before.left, 0, 1024), 0)
        var tremoloPatch = makePatch()
        tremoloPatch.inserts = [.tremolo(TremoloParams(rateHz: 5, depth: 0.5, spread: 1))]
        XCTAssertEqual(engine.setPatch(tremoloPatch), [])
        let after = processBlocksStereo(engine, 1024, 128)
        XCTAssertGreaterThan(maxAbs(after.left, 0, 1024), 0)
        XCTAssertGreaterThan(maxAbs(after.right, 0, 1024), 0)
    }

    // 13. Multi-effect chain integration (phase 2b close): a three-effect
    //     chain [phaser, driveEq, compressor] rendered via renderPatch is
    //     deterministic, non-silent, decorrelates L from R, and pins chain
    //     order — reversing the chain changes the render.
    func testRendersAMultiEffectInsertChainDeterministicallyAndPinsChainOrder() {
        let events = [EngineEvent(frame: 0, kind: .noteOn(midi: 60, velocity: 1))]
        let phaser = InsertSpec.phaser(PhaserParams(stages: 4, rateHz: 0.9, depth: 0.8, feedback: 0.3, mix: 0.5))
        let driveEq = InsertSpec.driveEq(DriveEqParams(drive: 0.4, lowDb: 3, midDb: -2, highDb: 2, levelDb: 0))
        let compressor = InsertSpec.compressor(
            CompressorParams(thresholdDb: -18, ratio: 4, attackMs: 5, releaseMs: 80, makeupDb: 3),
        )

        var patch = makePatch()
        patch.inserts = [phaser, driveEq, compressor]
        let a = renderPatch(patch: patch, events: events, totalFrames: 4800, sampleRate: fs)
        let b = renderPatch(patch: patch, events: events, totalFrames: 4800, sampleRate: fs)
        XCTAssertEqual(a.left, b.left)
        XCTAssertEqual(a.right, b.right)

        var sumSq: Float = 0
        for i in 1000..<4800 {
            sumSq += a.left[i] * a.left[i]
        }
        let rms = (sumSq / Float(4800 - 1000)).squareRoot()
        XCTAssertGreaterThan(rms, 0.01)

        var maxLR: Float = 0
        for i in 1000..<4800 {
            maxLR = max(maxLR, abs(a.left[i] - a.right[i]))
        }
        XCTAssertGreaterThan(maxLR, 1e-3)

        var reversedPatch = makePatch()
        reversedPatch.inserts = [compressor, driveEq, phaser]
        let reversed = renderPatch(patch: reversedPatch, events: events, totalFrames: 4800, sampleRate: fs)
        var maxDiff: Float = 0
        for i in 0..<4800 {
            maxDiff = max(maxDiff, abs(a.left[i] - reversed.left[i]), abs(a.right[i] - reversed.right[i]))
        }
        XCTAssertGreaterThan(maxDiff, 1e-3)
    }
}
