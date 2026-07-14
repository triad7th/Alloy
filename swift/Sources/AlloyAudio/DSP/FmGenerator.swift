import Foundation

/// Phase-modulation operator stack (DX-style "FM"). Twin of web
/// src/dsp/fm-generator.ts (canonical). Modulators sit at higher indices
/// than the operators they modulate (single high-to-low pass per sample).
public struct FmOperatorParams: Codable {
    public let ratio: Double
    public let level: Double
    public let adsr: AdsrParams

    public init(ratio: Double, level: Double, adsr: AdsrParams) {
        self.ratio = ratio
        self.level = level
        self.adsr = adsr
    }
}

public struct FmRoute: Codable {
    public let from: Int
    public let to: Int

    public init(from: Int, to: Int) {
        self.from = from
        self.to = to
    }
}

public struct FmFeedback: Codable {
    public let op: Int
    public let amount: Double

    public init(op: Int, amount: Double) {
        self.op = op
        self.amount = amount
    }
}

public struct FmAlgorithm: Codable {
    public let routes: [FmRoute]
    public let carriers: [Int]
    public let feedback: FmFeedback?

    public init(routes: [FmRoute], carriers: [Int], feedback: FmFeedback? = nil) {
        self.routes = routes
        self.carriers = carriers
        self.feedback = feedback
    }
}

public struct FmGeneratorParams: Codable {
    public let operators: [FmOperatorParams]
    public let algorithm: FmAlgorithm

    public init(operators: [FmOperatorParams], algorithm: FmAlgorithm) {
        self.operators = operators
        self.algorithm = algorithm
    }
}

/// Non-throwing validation: empty array = constructible on both platforms.
public func validateFmGeneratorParams(_ params: FmGeneratorParams) -> [String] {
    var errors: [String] = []
    let opCount = params.operators.count
    if opCount < 1 || opCount > 6 {
        errors.append("operator count \(opCount) outside 1..6")
    }
    for route in params.algorithm.routes where route.from <= route.to || route.from >= opCount || route.to < 0 {
        errors.append("route \(route.from)->\(route.to) must flow from a higher to a lower operator index")
    }
    for carrier in params.algorithm.carriers where carrier < 0 || carrier >= opCount {
        errors.append("carrier index \(carrier) out of range")
    }
    if params.algorithm.carriers.isEmpty {
        errors.append("at least one carrier required")
    }
    if let feedback = params.algorithm.feedback, feedback.op < 0 || feedback.op >= opCount {
        errors.append("feedback.op \(feedback.op) out of range")
    }
    return errors
}

public final class FmGenerator: ToneGenerator {
    private let params: FmGeneratorParams
    private let sampleRate: Double
    private let envelopes: [AdsrEnvelope]
    private var phases: [Double]
    private var outputs: [Double]
    private var frequency = 0.0
    private var pitchRatio = 1.0
    private var amp = 0.0
    private var keyed = false
    /// Highest ratio in the stack — hoisted out of noteOn (which is on the
    /// note-event path and should stay cheap).
    private let maxRatio: Double
    /// Worst-case upward pitch bend the owning layer's LFO can reach; 1 when the
    /// patch has no pitch modulation. Folded into the K choice at noteOn.
    private let maxPitchRatio: Double
    /// Oversampling factor for the current note; 1 = the original code path.
    private var oversamplingFactor = 1
    private let decimator = FmDecimator()
    /// Envelope level per operator for the current OUTPUT sample.
    private var envLevels: [Double]

    /// `pitchModCents` is the owning layer's LFO pitch-route depth
    /// (`PatchLayer.mod.toPitchCents`), 0 when there is none. It is part of the
    /// patch, known at noteOn, and it is what stops an LFO from bending a K=1
    /// voice's modulator past Nyquist mid-note.
    public init(params: FmGeneratorParams, sampleRate: Double, pitchModCents: Double = 0) {
        let errors = validateFmGeneratorParams(params)
        precondition(errors.isEmpty, errors.joined(separator: "; "))
        let opCount = params.operators.count
        self.params = params
        self.sampleRate = sampleRate
        envelopes = params.operators.map { AdsrEnvelope(params: $0.adsr, sampleRate: sampleRate) }
        phases = [Double](repeating: 0, count: opCount)
        outputs = [Double](repeating: 0, count: opCount)
        maxRatio = params.operators.map(\.ratio).max() ?? 1
        maxPitchRatio = maxPitchModRatio(pitchModCents: pitchModCents)
        envLevels = [Double](repeating: 0, count: opCount)
    }

    public var finished: Bool {
        keyed && params.algorithm.carriers.allSatisfy { !envelopes[$0].isActive }
    }

    /// Oversampling factor chosen for the current note (1 or `FM_OVERSAMPLING`).
    public var oversampling: Int { oversamplingFactor }

    public func noteOn(midi: Int, velocity: Double) {
        keyed = true
        pitchRatio = 1
        frequency = Pitch.frequency(midi: midi)
        amp = velocity
        // Decide the oversampling factor ONCE per note, from the highest frequency
        // anywhere in the stack UNDER THE PATCH'S WORST-CASE PITCH MODULATION.
        // setPitchRatio deliberately does not re-decide it mid-note (that would
        // glitch), so the LFO's peak upward bend has to be priced in here — else a
        // deep vibrato route sweeps a K=1 voice's modulator past Nyquist and the
        // aliasing this phase exists to kill comes back, periodically.
        oversamplingFactor = chooseOversampling(
            maxOpFrequency: frequency * maxRatio * maxPitchRatio,
            sampleRate: sampleRate,
        )
        decimator.reset()
        for i in phases.indices {
            phases[i] = 0
            outputs[i] = 0
        }
        for env in envelopes {
            env.noteOn()
        }
    }

    public func noteOff() {
        for env in envelopes {
            env.noteOff()
        }
    }

    public func setPitchRatio(_ ratio: Double) {
        pitchRatio = ratio
    }

    public func render(into out: inout [Float], frames: Int) {
        let operators = params.operators
        let algorithm = params.algorithm
        let carrierScale = amp / Double(algorithm.carriers.count)
        let os = oversamplingFactor
        // The rate the operator loop actually runs at. At os == 1 this is exactly
        // sampleRate (x1 is bit-exact), so the phase increment below is the same
        // expression, evaluated in the same order, as the pre-oversampling code —
        // which is why the goldens do not move.
        let osSampleRate = sampleRate * Double(os)
        for n in 0..<frames {
            if finished { return }
            // Envelopes advance ONCE per output sample and are held across the K
            // sub-samples. They are slow control signals (<= 83 us of hold at K=4),
            // so this is inaudible — and it is the other half of what makes the
            // os == 1 path bit-identical to the pre-oversampling code. Do NOT
            // "tidy" this back inside the operator loop.
            for i in operators.indices {
                envLevels[i] = envelopes[i].nextSample()
            }
            var sample = 0.0
            for k in 0..<os {
                for i in stride(from: operators.count - 1, through: 0, by: -1) {
                    var mod = 0.0
                    for route in algorithm.routes where route.to == i {
                        mod += outputs[route.from]
                    }
                    if let feedback = algorithm.feedback, feedback.op == i {
                        mod += outputs[i] * feedback.amount
                    }
                    outputs[i] = sin(DspConstants.twoPi * (phases[i] + mod)) * envLevels[i] * operators[i].level
                    phases[i] += frequency * pitchRatio * operators[i].ratio / osSampleRate
                    phases[i] -= phases[i].rounded(.down)
                }
                var sum = 0.0
                for c in algorithm.carriers {
                    sum += outputs[c]
                }
                if os == 1 {
                    sample = sum
                } else {
                    decimator.push(sum)
                    if k == os - 1 {
                        sample = decimator.output()
                    }
                }
            }
            out[n] += Float(sample * carrierScale)
        }
    }
}
