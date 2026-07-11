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

    public init(params: FmGeneratorParams, sampleRate: Double) {
        let errors = validateFmGeneratorParams(params)
        precondition(errors.isEmpty, errors.joined(separator: "; "))
        let opCount = params.operators.count
        self.params = params
        self.sampleRate = sampleRate
        envelopes = params.operators.map { AdsrEnvelope(params: $0.adsr, sampleRate: sampleRate) }
        phases = [Double](repeating: 0, count: opCount)
        outputs = [Double](repeating: 0, count: opCount)
    }

    public var finished: Bool {
        keyed && params.algorithm.carriers.allSatisfy { !envelopes[$0].isActive }
    }

    public func noteOn(midi: Int, velocity: Double) {
        keyed = true
        pitchRatio = 1
        frequency = Pitch.frequency(midi: midi)
        amp = velocity
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
        for n in 0..<frames {
            if finished { return }
            for i in stride(from: operators.count - 1, through: 0, by: -1) {
                var mod = 0.0
                for route in algorithm.routes where route.to == i {
                    mod += outputs[route.from]
                }
                if let feedback = algorithm.feedback, feedback.op == i {
                    mod += outputs[i] * feedback.amount
                }
                let env = envelopes[i].nextSample()
                outputs[i] = sin(DspConstants.twoPi * (phases[i] + mod)) * env * operators[i].level
                phases[i] += frequency * pitchRatio * operators[i].ratio / sampleRate
                phases[i] -= phases[i].rounded(.down)
            }
            var sample = 0.0
            for c in algorithm.carriers {
                sample += outputs[c]
            }
            out[n] += Float(sample * carrierScale)
        }
    }
}
