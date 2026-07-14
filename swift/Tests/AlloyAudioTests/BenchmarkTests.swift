@testable import AlloyAudio
import Foundation
import XCTest

/// Indicative CPU-envelope guard for the full render path (64 voices, all
/// inserts + master reverb/delay/limiter). The spec's target is "< 25% of
/// one mid-tier phone core"; this dev machine is not a phone, so the hard
/// assertion is a LOOSE realtime bound (< 1.0, i.e. faster than realtime at
/// all) that will never flake in CI. The actual realtime ratio and its
/// implied "% of one core" are printed for a human to read against the 25%
/// target. Twin: web src/dsp/benchmark.spec.ts (canonical).
final class BenchmarkTests: XCTestCase {
    private let fs = 48_000.0
    private let block = 128

    /// `swift test`'s default debug config (-Onone: no inlining, full ARC
    /// traffic, array bounds checks) renders this DSP-heavy loop an order of
    /// magnitude slower than the -O release config the app actually ships
    /// with — measured 1053% of realtime for the 64-voice case in debug vs.
    /// 21% in release. A fixed `< 1.0` bound is a guaranteed failure under
    /// plain `swift test`, not a flake, so the realtime bound gets
    /// debug-config headroom (well above the observed debug ratio) while
    /// staying at the brief's intended `< 1.0` for release, which is what the
    /// < 25%-of-one-core target is actually about.
    /// `_isDebugAssertConfiguration()` is the stdlib's own way to tell the two
    /// configs apart at runtime.
    ///
    /// The debug bound was 8.0 (against a measured 419%) until FM anti-aliasing
    /// landed: the golden FM patch modulates at ratio 14, so 19 of the 64
    /// benchmark voices (midi 81..99, whose modulator clears the 12 kHz
    /// threshold) now run the operator loop at 4x plus a 32-tap decimator. That
    /// costs 2.5x in debug (419% -> 1053%) and 1.75x in release (12% -> 21%);
    /// release still clears both the < 1.0 bound and the 25%-of-one-core target,
    /// so only the debug fudge factor moves.
    private let realtimeBound = _isDebugAssertConfiguration() ? 20.0 : 1.0

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
        XCTAssertLessThan(ratio, realtimeBound) // faster than realtime — loose, flake-proof
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
