@testable import AlloyAudio
import XCTest

final class SupersawVoiceTests: XCTestCase {
    private let fs = 44_100.0
    /// AllyPiano's Midnight voice values, verbatim (the twin-test fixture).
    private let spec = SupersawVoiceSpec(
        unison: 5, detuneCents: 24,
        filterBaseHz: 900, filterEnvHz: 2600, filterDecay: 0.35, filterQ: 0.9,
        amp: SynthVoiceConfig(waveform: .sawtooth, attack: 0.005, decay: 0.25, sustain: 0.5, release: 0.35),
    )

    private func makeVoice(velocity: Double = 1) -> SupersawVoice {
        let voice = SupersawVoice(spec: spec, midi: 57, velocity: velocity, sampleRate: fs) // A3 220Hz
        voice.start(at: 0)
        return voice
    }

    func test_attackPeakIsBoundedByVoicePeak() {
        // 5 detuned saws mixed at 1/sqrt(5) through a lowpass can transiently
        // beat above a single saw's peak but must stay in the same ballpark.
        let voice = makeVoice()
        let peaks = windowPeaks(voice, windows: 4, windowFrames: 441) // 40ms
        XCTAssertGreaterThan(peaks[1], VoiceConstants.voicePeak * 0.3)
        XCTAssertLessThan(peaks.max()!, VoiceConstants.voicePeak * 2.5)
    }

    func test_filterEnvelopeDarkensTheToneOverTime() {
        // Normalized HF proxy: mean |first difference| / mean |amplitude|
        // per window — invariant to the amp envelope's own decay, so this
        // fails if the filter envelope stops closing (3500Hz -> 900Hz).
        let voice = makeVoice()
        func hfRatio(_ frames: Int) -> Double {
            var buffer = [Float](repeating: 0, count: frames)
            _ = voice.render(into: &buffer, frames: frames)
            var diffSum = 0.0
            var ampSum = 0.0
            for i in 0..<frames - 1 {
                diffSum += abs(Double(buffer[i + 1] - buffer[i]))
                ampSum += abs(Double(buffer[i]))
            }
            return ampSum > 0 ? diffSum / ampSum : 0
        }
        var skip = [Float](repeating: 0, count: 4410) // first 100ms — filter still closing
        _ = voice.render(into: &skip, frames: 4410)
        let early = hfRatio(4410) // measure 100ms-200ms — filter partway closed
        var skip2 = [Float](repeating: 0, count: 39_690)
        _ = voice.render(into: &skip2, frames: 39_690) // advance another 900ms
        let late = hfRatio(4410) // measure 1.1s-1.2s — filter fully closed
        XCTAssertLessThan(late, early * 0.7)
    }

    func test_singleOscillatorUnisonHasNoDetuneAndRenders() {
        let mono = SupersawVoiceSpec(
            unison: 1, detuneCents: 24,
            filterBaseHz: 900, filterEnvHz: 2600, filterDecay: 0.35, filterQ: 0.9,
            amp: spec.amp,
        )
        let voice = SupersawVoice(spec: mono, midi: 57, velocity: 1, sampleRate: fs)
        voice.start(at: 0)
        var buffer = [Float](repeating: 0, count: 4410)
        XCTAssertTrue(voice.render(into: &buffer, frames: 4410))
        XCTAssertFalse(buffer.contains { $0.isNaN })
        XCTAssertGreaterThan(buffer.map(abs).max()!, 0.01)
    }

    func test_releaseDecaysExponentiallyAndEndsAtTripleFade() {
        let voice = makeVoice()
        _ = windowPeaks(voice, windows: 10, windowFrames: 441) // advance to 100ms
        voice.release(at: 0.1)
        // fade = amp.release = 0.35: tc = fade/3; ~5% by 0.35s, ended by 1.05s.
        let after = windowPeaks(voice, windows: 106, windowFrames: 441)
        let beforeRelease = after[0]
        XCTAssertLessThan(after[36], beforeRelease * 0.08) // ~360ms later
        var buffer = [Float](repeating: 0, count: 441)
        XCTAssertFalse(voice.render(into: &buffer, frames: 441)) // past 1.15s total
    }

    func test_stopSilencesWithinFastStopWindow() {
        let voice = makeVoice()
        _ = windowPeaks(voice, windows: 10, windowFrames: 441)
        voice.stop(at: 0.1)
        let after = windowPeaks(voice, windows: 10, windowFrames: 441) // 100ms
        XCTAssertEqual(after[9], 0, accuracy: 5e-3) // ended by 90ms (= 3*fade)
    }

    func test_unisonMixIsRootNNormalized() {
        // Detuned saws sum incoherently: RMS(5 saws)/sqrt(5) ~ RMS(1 saw).
        // A 1/N normalization bug would push this ratio to ~0.45.
        func sustainedRMS(unison: Int) -> Double {
            let spec = SupersawVoiceSpec(
                unison: unison, detuneCents: 24,
                filterBaseHz: 900, filterEnvHz: 2600, filterDecay: 0.35, filterQ: 0.9,
                amp: SynthVoiceConfig(waveform: .sawtooth, attack: 0.005, decay: 0.25, sustain: 0.5, release: 0.35),
            )
            let voice = SupersawVoice(spec: spec, midi: 57, velocity: 1, sampleRate: fs)
            voice.start(at: 0)
            var skip = [Float](repeating: 0, count: 22_050) // past the attack
            _ = voice.render(into: &skip, frames: 22_050)
            var buffer = [Float](repeating: 0, count: 22_050) // 0.5s window
            _ = voice.render(into: &buffer, frames: 22_050)
            var sum = 0.0
            for sample in buffer { sum += Double(sample * sample) }
            return (sum / Double(buffer.count)).squareRoot()
        }
        let ratio = sustainedRMS(unison: 5) / sustainedRMS(unison: 1)
        XCTAssertGreaterThan(ratio, 0.6)
        XCTAssertLessThan(ratio, 1.6)
    }
}
