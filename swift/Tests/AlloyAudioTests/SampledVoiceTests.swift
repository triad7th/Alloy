@testable import AlloyAudio
import XCTest

final class SampledVoiceTests: XCTestCase {
    private let fs = 44_100.0

    /// A zone whose samples are the index ramp 0, 1, 2, ... so interpolated
    /// read positions are directly visible in the output.
    private func rampZone(midi: Int, frames: Int, rate: Double = 44_100) -> SampleZone {
        SampleZone(midi: midi, samples: (0..<frames).map(Float.init), sampleRate: rate)
    }

    func test_samePitchPlaysBackUnshifted() {
        let voice = SampledVoice(
            zone: rampZone(midi: 60, frames: 100), midi: 60,
            velocity: 1, releaseSeconds: 0.25, sampleRate: fs,
        )
        voice.start(at: 0)
        var buffer = [Float](repeating: 0, count: 8)
        _ = voice.render(into: &buffer, frames: 8)
        XCTAssertEqual(buffer, [0, 1, 2, 3, 4, 5, 6, 7])
    }

    func test_octaveUpReadsAtDoubleRate() {
        let voice = SampledVoice(
            zone: rampZone(midi: 48, frames: 100), midi: 60, // +12 semitones
            velocity: 1, releaseSeconds: 0.25, sampleRate: fs,
        )
        voice.start(at: 0)
        var buffer = [Float](repeating: 0, count: 4)
        _ = voice.render(into: &buffer, frames: 4)
        XCTAssertEqual(buffer, [0, 2, 4, 6])
    }

    func test_zoneSampleRateConversionScalesReadRate() {
        // Zone recorded at half the output rate plays at half read speed.
        let voice = SampledVoice(
            zone: rampZone(midi: 60, frames: 100, rate: 22_050), midi: 60,
            velocity: 1, releaseSeconds: 0.25, sampleRate: fs,
        )
        voice.start(at: 0)
        var buffer = [Float](repeating: 0, count: 4)
        _ = voice.render(into: &buffer, frames: 4)
        XCTAssertEqual(buffer, [0, 0.5, 1, 1.5])
    }

    func test_velocityScalesGain() {
        let voice = SampledVoice(
            zone: rampZone(midi: 60, frames: 100), midi: 60,
            velocity: 0.5, releaseSeconds: 0.25, sampleRate: fs,
        )
        voice.start(at: 0)
        var buffer = [Float](repeating: 0, count: 4)
        _ = voice.render(into: &buffer, frames: 4)
        XCTAssertEqual(buffer, [0, 0.5, 1, 1.5]) // index ramp * 0.5
    }

    func test_endsWhenBufferRunsOut() {
        let voice = SampledVoice(
            zone: rampZone(midi: 60, frames: 6), midi: 60,
            velocity: 1, releaseSeconds: 0.25, sampleRate: fs,
        )
        voice.start(at: 0)
        var buffer = [Float](repeating: 0, count: 8)
        XCTAssertFalse(voice.render(into: &buffer, frames: 8)) // exhausted mid-buffer
        XCTAssertEqual(buffer[7], 0) // no read past the end
    }

    func test_releaseFadesExponentiallyAndEndsAtTripleFade() {
        // A long constant-1 zone isolates the gain envelope.
        let zone = SampleZone(midi: 60, samples: [Float](repeating: 1, count: 60_000), sampleRate: fs)
        let voice = SampledVoice(zone: zone, midi: 60, velocity: 1, releaseSeconds: 0.25, sampleRate: fs)
        voice.start(at: 0)
        var buffer = [Float](repeating: 0, count: 4410)
        _ = voice.render(into: &buffer, frames: 4410) // advance to 100ms
        voice.release(at: 0.1)
        // tc = 0.25/3: ~5% of the level by 0.35s; voice ends by 0.85s.
        var tail = [Float](repeating: 0, count: 11_025) // 100ms..350ms
        _ = voice.render(into: &tail, frames: 11_025)
        XCTAssertLessThan(tail[11_024], 0.08)
        var rest = [Float](repeating: 0, count: 22_050) // to 850ms
        XCTAssertFalse(voice.render(into: &rest, frames: 22_050))
    }

    func test_stopUsesFastStopFade() {
        let zone = SampleZone(midi: 60, samples: [Float](repeating: 1, count: 60_000), sampleRate: fs)
        let voice = SampledVoice(zone: zone, midi: 60, velocity: 1, releaseSeconds: 0.25, sampleRate: fs)
        voice.start(at: 0)
        var buffer = [Float](repeating: 0, count: 441)
        _ = voice.render(into: &buffer, frames: 441) // 10ms
        voice.stop(at: 0.01)
        var tail = [Float](repeating: 0, count: 4410) // 100ms > 3*0.03s
        XCTAssertFalse(voice.render(into: &tail, frames: 4410))
    }
}
