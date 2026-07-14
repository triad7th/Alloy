@testable import AlloyAudio
import Foundation
import XCTest

/// CPU-envelope GATE for the full render path (64 voices, all inserts + master
/// reverb/delay/limiter). The founding spec's budget is "< 25% of one mid-tier
/// phone core", and in the release config — the one that actually ships — that
/// is what this test asserts: ratio < 0.25. It is a gate, not an observation.
/// Twin: web src/dsp/benchmark.spec.ts (canonical); the web twin keeps a loose
/// bound because Node/V8 is not the shipping runtime, so the real budget is
/// enforced here.
final class BenchmarkTests: XCTestCase {
    private let fs = 48_000.0
    private let block = 128

    /// RELEASE (`swift test -c release`) is the config that ships and the one the
    /// budget is about: the bound is the spec's own number, **0.25** = 25% of one
    /// core. Measured on this dev machine at 20.3-21.0% of realtime with the FM
    /// anti-aliasing of phase 3c in place (19 of the 64 benchmark voices clear the
    /// 12 kHz threshold and run 4x + a 32-tap decimator; it was 12% before 3c and
    /// 21.5% before the decimator's per-tap modulo came out). This bound must not
    /// be raised to accommodate a regression — a change that pushes it past 0.25 is
    /// over the design's stated envelope, and that is a decision for a human.
    ///
    /// DEBUG (`swift test`'s default -Onone: no inlining, full ARC traffic, array
    /// bounds checks) runs this DSP-heavy loop ~50x slower — measured 1034-1047% of
    /// realtime, i.e. a ratio of ~10.4. A `< 0.25` bound there would be a guaranteed
    /// failure, not a flake, so debug gets its own bound: **13.5**, ~1.3x the
    /// measured 10.47, tight enough that a real regression trips it (the old 20.0
    /// would have absorbed a further 1.9x silently).
    /// `_isDebugAssertConfiguration()` is the stdlib's own way to tell the two
    /// configs apart at runtime.
    private let realtimeBound = _isDebugAssertConfiguration() ? 13.5 : 0.25

    func testSixtyFourVoiceFullFxFasterThanRealtime() {
        let seconds = 4
        let voices = 64
        let fm = patchFM()
        let patch = Patch(
            schemaVersion: fm.schemaVersion,
            meta: fm.meta,
            layers: fm.layers,
            sends: PatchSends(reverb: 0.3, delay: 0.25), // full master path active
            inserts: fm.inserts,
        )
        let engine = PatchEngine(sampleRate: fs)
        engine.setPatch(patch)
        for v in 0..<voices {
            engine.schedule(EngineEvent(frame: 0, kind: .noteOn(midi: 36 + v, velocity: 0.8)))
        }
        let total = Int(fs) * seconds
        var left = [Float](repeating: 0, count: block)
        var right = [Float](repeating: 0, count: block)
        let t0 = Date()
        var off = 0
        while off < total {
            let n = min(block, total - off)
            for i in 0..<n {
                left[i] = 0
                right[i] = 0
            }
            engine.process(intoLeft: &left, right: &right, frames: n)
            off += n
        }
        let elapsedMs = Date().timeIntervalSince(t0) * 1000
        let audioMs = Double(seconds) * 1000
        let ratio = elapsedMs / audioMs
        print(
            "64-voice full-FX: \(String(format: "%.1f", elapsedMs)) ms to render "
                + "\(String(format: "%.0f", audioMs)) ms audio = "
                + "\(String(format: "%.1f", ratio * 100))% of realtime on this machine "
                + "(target < 25% of one mid-tier phone core)",
        )
        XCTAssertGreaterThan(engine.activeVoiceCount, 0) // voices actually ran
        XCTAssertLessThan(ratio, realtimeBound) // the < 25%-of-one-core gate (release)
    }

    func testReverbTailDenormalFlushAssessment() {
        let fm = patchFM()
        let patch = Patch(
            schemaVersion: fm.schemaVersion,
            meta: fm.meta,
            layers: fm.layers,
            sends: PatchSends(reverb: 0.6, delay: 0.4),
            inserts: fm.inserts,
        )
        let engine = PatchEngine(sampleRate: fs)
        engine.setPatch(patch)
        engine.schedule(EngineEvent(frame: 0, kind: .noteOn(midi: 60, velocity: 1)))
        engine.schedule(EngineEvent(frame: 2400, kind: .noteOff(midi: 60)))
        let seconds = 8
        let total = Int(fs) * seconds // long tail decaying toward zero
        var left = [Float](repeating: 0, count: block)
        var right = [Float](repeating: 0, count: block)
        let t0 = Date()
        var off = 0
        while off < total {
            let n = min(block, total - off)
            for i in 0..<n {
                left[i] = 0
                right[i] = 0
            }
            engine.process(intoLeft: &left, right: &right, frames: n)
            off += n
        }
        let ratio = Date().timeIntervalSince(t0) * 1000 / (Double(seconds) * 1000)
        print(
            "reverb-tail denormal check: \(String(format: "%.1f", ratio * 100))% of realtime "
                + "(should not spike as the tail decays)",
        )
        XCTAssertLessThan(ratio, realtimeBound)
    }
}
