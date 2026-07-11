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

    private func process(_ engine: PatchEngine, _ frames: Int) -> [Float] {
        var out = [Float](repeating: 0, count: frames)
        engine.process(into: &out, frames: frames)
        return out
    }

    /// Renders totalFrames in fixed-size blocks, returning the concatenated buffer.
    private func processBlocks(_ engine: PatchEngine, _ totalFrames: Int, _ block: Int) -> [Float] {
        var out = [Float](repeating: 0, count: totalFrames)
        var buf = [Float](repeating: 0, count: block)
        var offset = 0
        while offset < totalFrames {
            let n = min(block, totalFrames - offset)
            for i in 0..<n {
                buf[i] = 0
            }
            engine.process(into: &buf, frames: n)
            for i in 0..<n {
                out[offset + i] = buf[i]
            }
            offset += n
        }
        return out
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
        let a = renderPatch(patch: patch, events: renderEvents, totalFrames: 4800, sampleRate: fs)
        let b = renderPatch(patch: patch, events: renderEvents, totalFrames: 4800, sampleRate: fs)
        XCTAssertEqual(a.count, 4800)
        XCTAssertGreaterThan(maxAbs(a, 0, 4800), 0)
        XCTAssertEqual(a, b)
    }

    // 9. renderPatch (128-frame blocks) equals a manual 48-frame process loop exactly
    //    (chunk determinism is pinned by the Voice tests).
    func testRenderPatchMatchesAManualEngineLoopAtADifferentBlockSize() throws {
        let patch = try fixturePatch()
        let harness = renderPatch(patch: patch, events: renderEvents, totalFrames: 4800, sampleRate: fs)
        let engine = PatchEngine(sampleRate: fs)
        engine.setPatch(patch)
        for event in renderEvents {
            engine.schedule(event)
        }
        let manual = processBlocks(engine, 4800, 48)
        XCTAssertEqual(manual, harness)
    }
}
