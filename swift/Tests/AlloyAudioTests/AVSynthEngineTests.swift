import AlloyAudio
import AVFoundation
import XCTest

/// AllyPiano's two-instrument catalog, rebuilt locally: AlloyAudio is
/// instrument-agnostic, so the tests supply their own descriptors (the same
/// numeric values the source app ships, keeping DSP coverage identical).
private let grandPiano = InstrumentDescriptor(
    id: "grand-piano",
    voice: .sampled(SampledVoiceSpec(
        sampleBaseURL: "samples/grand-piano",
        sampleMidis: Array(stride(from: 21, through: 108, by: 3)),
        release: 0.25,
        fallback: SynthVoiceConfig(
            waveform: .triangle, attack: 0.005, decay: 0.12, sustain: 0.6, release: 0.25,
        ),
    )),
    sends: VoiceSends(reverb: 0.18),
)

private let midnight = InstrumentDescriptor(
    id: "midnight",
    voice: .supersaw(SupersawVoiceSpec(
        unison: 5,
        detuneCents: 24,
        filterBaseHz: 900,
        filterEnvHz: 2600,
        filterDecay: 0.35,
        filterQ: 0.9,
        amp: SynthVoiceConfig(
            waveform: .sawtooth, attack: 0.005, decay: 0.25, sustain: 0.5, release: 0.35,
        ),
    )),
    sends: VoiceSends(reverb: 0.3, delay: 0.18),
)

/// Adds a 1-second 440Hz sine zone synchronously — no bundle, no async.
private final class FakeSampleSource: SampleSource {
    let zoneMidis: [Int]
    init(zoneMidis: [Int] = [69]) { self.zoneMidis = zoneMidis }

    func startLoading(midis _: [Int], into store: SampleZoneStore) {
        for midi in zoneMidis {
            let fs = 44_100.0
            let samples = (0..<44_100).map { Float(sin(2 * .pi * 440 * Double($0) / fs)) * 0.5 }
            store.add(SampleZone(midi: midi, samples: samples, sampleRate: fs))
        }
    }
}

/// Never loads anything — forces the grand piano onto its synth fallback.
private final class EmptySampleSource: SampleSource {
    func startLoading(midis _: [Int], into _: SampleZoneStore) {}
}

final class AVSynthEngineTests: XCTestCase {
    private func makeOffline(source: SampleSource) throws -> (AVSynthEngine, AVAudioEngine) {
        let av = AVAudioEngine()
        let format = AVAudioFormat(standardFormatWithSampleRate: 44_100, channels: 2)!
        try av.enableManualRenderingMode(.offline, format: format, maximumFrameCount: 4096)
        let engine = AVSynthEngine(instruments: [grandPiano, midnight], engine: av, sampleSource: source)
        XCTAssertTrue(av.isRunning, "engine must start in manual rendering mode")
        return (engine, av)
    }

    /// Renders `blocks` blocks of 4096 frames and returns each block's RMS.
    private func renderRMS(_ av: AVAudioEngine, blocks: Int) throws -> [Double] {
        let buffer = AVAudioPCMBuffer(
            pcmFormat: av.manualRenderingFormat, frameCapacity: 4096,
        )!
        var rms: [Double] = []
        for _ in 0..<blocks {
            let status = try av.renderOffline(4096, to: buffer)
            XCTAssertEqual(status, .success)
            let data = buffer.floatChannelData![0]
            var sum = 0.0
            for i in 0..<Int(buffer.frameLength) { sum += Double(data[i] * data[i]) }
            rms.append(sqrt(sum / Double(buffer.frameLength)))
        }
        return rms
    }

    func test_grandPianoNoteOnProducesSound() throws {
        let (engine, av) = try makeOffline(source: FakeSampleSource())
        engine.noteOn(midi: 69)
        let rms = try renderRMS(av, blocks: 4)
        XCTAssertGreaterThan(rms.max()!, 0.01)
    }

    func test_grandPianoFallsBackToSynthWhileZonesUnloaded() throws {
        let (engine, av) = try makeOffline(source: EmptySampleSource())
        engine.noteOn(midi: 69)
        let rms = try renderRMS(av, blocks: 4)
        XCTAssertGreaterThan(rms.max()!, 0.005) // triangle fallback audible
    }

    func test_midnightProducesSound() throws {
        let (engine, av) = try makeOffline(source: FakeSampleSource())
        engine.setInstrument("midnight")
        engine.noteOn(midi: 57)
        let rms = try renderRMS(av, blocks: 4)
        XCTAssertGreaterThan(rms.max()!, 0.01)
    }

    func test_unknownInstrumentIdFallsBackToDefault() throws {
        // Web parity with instrument(byID:): unknown/legacy ids play the
        // default (first) instrument rather than going silent.
        let (engine, av) = try makeOffline(source: FakeSampleSource())
        engine.setInstrument("mellow-synth")
        engine.noteOn(midi: 69)
        let rms = try renderRMS(av, blocks: 4)
        XCTAssertGreaterThan(rms.max()!, 0.01)
    }

    func test_allNotesOffDecaysToNearSilence() throws {
        let (engine, av) = try makeOffline(source: FakeSampleSource())
        engine.noteOn(midi: 69)
        engine.noteOn(midi: 64)
        let sounding = try renderRMS(av, blocks: 4)
        engine.allNotesOff()
        // 3s tail: voices fast-stop in 90ms; reverb/delay tails decay after.
        let tail = try renderRMS(av, blocks: 32)
        XCTAssertLessThan(tail.last!, sounding.max()! * 0.05)
    }

    func test_noteOffReleasesButReverbTailRemainsBounded() throws {
        let (engine, av) = try makeOffline(source: FakeSampleSource())
        engine.noteOn(midi: 69)
        _ = try renderRMS(av, blocks: 2)
        engine.noteOff(midi: 69)
        let tail = try renderRMS(av, blocks: 32) // ~3s
        XCTAssertLessThan(tail.last!, 0.01) // decayed, not stuck droning
    }

    func test_grandReverbSendReachesTheWetPath() throws {
        // After allNotesOff fast-stops the voice (~90ms), any remaining
        // output is the wet path alone. If the grand channel's reverb tap
        // is not actually connected, this window is digital silence.
        let (engine, av) = try makeOffline(source: FakeSampleSource())
        engine.noteOn(midi: 69)
        _ = try renderRMS(av, blocks: 4) // ~0.37s of signal into the send
        engine.allNotesOff()
        _ = try renderRMS(av, blocks: 2) // let the 90ms fast-stop finish
        let wetTail = try renderRMS(av, blocks: 4) // ~0.56s..0.93s
        XCTAssertGreaterThan(wetTail.max()!, 1e-4)
    }
}
