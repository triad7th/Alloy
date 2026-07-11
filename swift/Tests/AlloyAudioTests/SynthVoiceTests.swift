@testable import AlloyAudio
import XCTest

/// Renders `voice` from its current position and returns per-window peak
/// levels — a cheap envelope follower for asserting envelope shape.
func windowPeaks(_ voice: MixerVoice, windows: Int, windowFrames: Int) -> [Double] {
    var peaks: [Double] = []
    for _ in 0..<windows {
        var buffer = [Float](repeating: 0, count: windowFrames)
        _ = voice.render(into: &buffer, frames: windowFrames)
        peaks.append(Double(buffer.map(abs).max() ?? 0))
    }
    return peaks
}

final class SynthVoiceTests: XCTestCase {
    private let fs = 44_100.0
    private let config = SynthVoiceConfig(
        waveform: .triangle, attack: 0.005, decay: 0.12, sustain: 0.6, release: 0.25,
    )

    private func makeVoice(velocity: Double = 1) -> SynthVoice {
        let voice = SynthVoice(config: config, midi: 69, velocity: velocity, sampleRate: fs)
        voice.start(at: 0)
        return voice
    }

    func test_attackReachesVoicePeakTimesVelocity() {
        let voice = makeVoice()
        // 10ms windows; window 0 spans the 5ms attack, window 1 is post-attack.
        let peaks = windowPeaks(voice, windows: 2, windowFrames: 441)
        XCTAssertEqual(peaks[1], VoiceConstants.voicePeak, accuracy: 0.02)
    }

    func test_decaysTowardSustainLevel() {
        let voice = makeVoice()
        // After attack (5ms) + decay (120ms), level ~ peak * sustain = 0.18.
        let peaks = windowPeaks(voice, windows: 20, windowFrames: 441) // 200ms
        XCTAssertEqual(peaks[19], VoiceConstants.voicePeak * 0.6, accuracy: 0.02)
    }

    func test_velocityScalesAndIsClamped() {
        let half = makeVoice(velocity: 0.5)
        let over = makeVoice(velocity: 2) // clamps to 1
        XCTAssertEqual(windowPeaks(half, windows: 2, windowFrames: 441)[1],
                       VoiceConstants.voicePeak * 0.5, accuracy: 0.02)
        XCTAssertEqual(windowPeaks(over, windows: 2, windowFrames: 441)[1],
                       VoiceConstants.voicePeak, accuracy: 0.02)
    }

    func test_releaseRampsLinearlyToZeroAndEndsAtFade() {
        let voice = makeVoice()
        _ = windowPeaks(voice, windows: 10, windowFrames: 441) // advance to 100ms
        voice.release(at: 0.1)
        // 250ms release from 100ms: ramp ends at 350ms; window 25 starts there.
        let after = windowPeaks(voice, windows: 26, windowFrames: 441)
        XCTAssertGreaterThan(after[9], 0.05) // ~200ms, mid-release
        XCTAssertEqual(after[25], 0, accuracy: 1e-3) // past 350ms

        var buffer = [Float](repeating: 0, count: 441)
        XCTAssertFalse(voice.render(into: &buffer, frames: 441)) // reports ended
    }

    func test_stopSilencesWithinFastStop() {
        let voice = makeVoice()
        _ = windowPeaks(voice, windows: 10, windowFrames: 441)
        voice.stop(at: 0.1)
        // FAST_STOP_S = 30ms: silent within the 4th 10ms window after stop.
        let after = windowPeaks(voice, windows: 4, windowFrames: 441)
        XCTAssertEqual(after[3], 0, accuracy: 1e-3)
    }

    func test_renderAddsIntoExistingBufferContent() {
        let voice = makeVoice()
        var buffer = [Float](repeating: 1, count: 8)
        _ = voice.render(into: &buffer, frames: 8)
        // Attack starts from gain 0 — content must still be ~1, not overwritten to ~0.
        XCTAssertEqual(Double(buffer[0]), 1, accuracy: 0.01)
    }
}
