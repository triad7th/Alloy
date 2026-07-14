@testable import AlloyAudio
import Foundation
import XCTest

/// CPU-envelope GATE for the full render path (64 voices, all inserts + master
/// reverb/delay/limiter). The founding spec's budget is "< 25% of one mid-tier
/// phone core".
///
/// WHERE EACH BOUND ACTUALLY RUNS — the two are not interchangeable:
/// - CI runs `swift test` (debug) and therefore enforces the DEBUG bound: 13.5
///   against ~10.4 measured, a 1.29x margin. That is the per-PR regression net.
/// - The 0.25 release budget is the real envelope, and it only executes under
///   `swift test -c release`, which nothing in CI runs. It is enforced at RELEASE
///   time: `tools/release.mjs` runs `swift test -c release --filter BenchmarkTests`
///   in its preflight, on the dev machine the number was calibrated on. Do not
///   move that bound onto a shared CI runner — it is not the reference hardware.
///
/// Twin: web src/dsp/benchmark.spec.ts (canonical); the web twin keeps a loose
/// bound because Node/V8 is not the shipping runtime, so the real budget is
/// enforced here.
final class BenchmarkTests: XCTestCase {
    private let fs = 48_000.0
    private let block = 128

    /// RELEASE (`swift test -c release`) is the config that ships and the one the
    /// budget is about: the bound is the spec's own number, **0.25** = 25% of one
    /// core. Measured on this dev machine (best of 3) at 21.4-21.7% of realtime with
    /// the FM anti-aliasing of phase 3c in place (19 of the 64 benchmark voices clear
    /// the 12 kHz threshold and run 4x + a 32-tap decimator; it was 12% before 3c).
    /// This bound must not be raised to accommodate a regression — a change that
    /// pushes it past 0.25 is over the design's stated envelope, and that is a
    /// decision for a human.
    ///
    /// DEBUG (`swift test`'s default -Onone: no inlining, full ARC traffic, array
    /// bounds checks) runs this DSP-heavy loop ~50x slower — measured 1023-1028% of
    /// realtime, i.e. a ratio of ~10.2. A `< 0.25` bound there would be a guaranteed
    /// failure, not a flake, so debug gets its own bound: **13.5**, ~1.3x the
    /// measured 10.2, tight enough that a real regression trips it (the old 20.0
    /// would have absorbed a further 1.9x silently).
    /// `_isDebugAssertConfiguration()` is the stdlib's own way to tell the two
    /// configs apart at runtime.
    private let realtimeBound = _isDebugAssertConfiguration() ? 13.5 : 0.25

    func testSixtyFourVoiceFullFxWithinCpuBudget() {
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
        var activeVoices = 0

        /// One full render of `seconds` of audio; returns elapsed / audio time.
        func renderRatio() -> Double {
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
            activeVoices = engine.activeVoiceCount
            return elapsedMs / (Double(seconds) * 1000)
        }

        // MIN of 3 runs, not the mean: machine noise (another process, thermal
        // throttling) only ever makes a run SLOWER, so the minimum is the robust
        // estimate of the true cost. This kills flake without loosening the bound.
        let ratios = (0..<3).map { _ in renderRatio() }
        let ratio = ratios.min() ?? .infinity
        print(
            "64-voice full-FX: runs "
                + ratios.map { String(format: "%.1f%%", $0 * 100) }.joined(separator: ", ")
                + " of realtime; best = \(String(format: "%.1f", ratio * 100))% "
                + "(budget < 25% of one mid-tier phone core; enforced in release)",
        )
        XCTAssertGreaterThan(activeVoices, 0) // voices actually ran
        XCTAssertLessThan(ratio, realtimeBound) // release: the <25%-of-one-core gate
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
