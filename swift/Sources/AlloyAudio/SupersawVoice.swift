import Foundation

/// Port of the web alloy-audio SupersawPlayer voice: `unison` sawtooth
/// oscillators spread evenly across ±detuneCents/2 (a lone oscillator sits
/// at 0), mixed at 1/sqrt(unison), through a lowpass whose cutoff decays
/// from baseHz+envHz to baseHz, into a linear-attack / exponential-decay
/// amp. Mono per voice — width and space come from the master chain sends.
public final class SupersawVoice: MixerVoice {
    private static let coefficientUpdateInterval = 32

    private let spec: SupersawVoiceSpec
    private let velocity: Double
    private let sampleRate: Double
    private var oscillators: [Oscillator]
    private let mixGain: Double
    private var filter: BiquadLowpass
    private var cutoff = ParamRamp()
    private var amp = ParamRamp()
    private var time = 0.0
    private var endTime = Double.infinity
    private var framesUntilCoefficientUpdate = 0

    public init(spec: SupersawVoiceSpec, midi: Int, velocity: Double, sampleRate: Double) {
        self.spec = spec
        self.velocity = min(max(velocity, 0), 1)
        self.sampleRate = sampleRate
        let frequency = Pitch.frequency(midi: midi)
        let unison = spec.unison
        oscillators = (0..<unison).map { i in
            let detune = unison > 1
                ? -spec.detuneCents / 2 + Double(i) * spec.detuneCents / Double(unison - 1)
                : 0
            return Oscillator(
                waveform: .sawtooth, frequency: frequency,
                detuneCents: detune, sampleRate: sampleRate,
            )
        }
        mixGain = 1 / Double(unison).squareRoot()
        filter = BiquadLowpass(sampleRate: sampleRate)
    }

    public func start(at when: Double) {
        time = when
        cutoff.setValue(spec.filterBaseHz + spec.filterEnvHz, at: when)
        cutoff.setTarget(spec.filterBaseHz, startingAt: when, timeConstant: spec.filterDecay)
        let peak = VoiceConstants.voicePeak * velocity
        amp.setValue(0, at: when)
        amp.linearRamp(to: peak, endingAt: when + spec.amp.attack)
        amp.setTarget(peak * spec.amp.sustain, startingAt: when + spec.amp.attack, timeConstant: spec.amp.decay)
    }

    public func render(into output: inout [Float], frames: Int) -> Bool {
        let step = 1 / sampleRate
        for i in 0..<frames {
            if framesUntilCoefficientUpdate == 0 {
                filter.setCutoff(cutoff.value(at: time), q: spec.filterQ)
                framesUntilCoefficientUpdate = Self.coefficientUpdateInterval
            }
            framesUntilCoefficientUpdate -= 1
            var mixed = 0.0
            for oscIndex in oscillators.indices {
                mixed += oscillators[oscIndex].next()
            }
            let filtered = filter.process(mixed * mixGain)
            output[i] += Float(filtered * amp.value(at: time))
            time += step
        }
        return time < endTime
    }

    public func release(at when: Double) {
        end(at: when, fade: spec.amp.release)
    }

    public func stop(at when: Double) {
        end(at: when, fade: VoiceConstants.fastStopSeconds)
    }

    private func end(at when: Double, fade: Double) {
        // Exponential fade: tc = fade/3 reaches ~5% by `fade`; end at 3x fade
        // so nothing audibly clicks (web SupersawPlayer.end, verbatim).
        amp.setTarget(0, startingAt: when, timeConstant: fade / 3)
        endTime = min(endTime, when + fade * 3)
    }
}
