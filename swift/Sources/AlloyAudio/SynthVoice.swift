import Foundation

/// Port of the web alloy-audio SynthVoicePlayer voice: one oscillator
/// through a linear-attack / linear-decay-to-sustain gain; key-up is a
/// snapshot then LINEAR ramp to 0 ending exactly at `at + fade` (unlike the
/// exponential releases of the supersaw and sampled voices).
public final class SynthVoice: Voice {
    private let config: SynthVoiceConfig
    private let velocity: Double
    private let sampleRate: Double
    private var osc: Oscillator
    private var gain = ParamRamp()
    private var time = 0.0
    private var endTime = Double.infinity

    public init(config: SynthVoiceConfig, midi: Int, velocity: Double, sampleRate: Double) {
        self.config = config
        self.velocity = min(max(velocity, 0), 1)
        self.sampleRate = sampleRate
        osc = Oscillator(
            waveform: config.waveform,
            frequency: Pitch.frequency(midi: midi),
            sampleRate: sampleRate,
        )
    }

    public func start(at when: Double) {
        time = when
        let peak = VoiceConstants.voicePeak * velocity
        gain.setValue(0, at: when)
        gain.linearRamp(to: peak, endingAt: when + config.attack)
        gain.linearRamp(to: peak * config.sustain, endingAt: when + config.attack + config.decay)
    }

    public func render(into output: inout [Float], frames: Int) -> Bool {
        let step = 1 / sampleRate
        for i in 0..<frames {
            output[i] += Float(osc.next() * gain.value(at: time))
            time += step
        }
        return time < endTime
    }

    public func release(at when: Double) {
        end(at: when, fade: config.release)
    }

    public func stop(at when: Double) {
        end(at: when, fade: VoiceConstants.fastStopSeconds)
    }

    private func end(at when: Double, fade: Double) {
        gain.setValue(gain.value(at: when), at: when)
        gain.linearRamp(to: 0, endingAt: when + fade)
        endTime = min(endTime, when + fade)
    }
}
