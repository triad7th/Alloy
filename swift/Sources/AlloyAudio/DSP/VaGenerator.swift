import Foundation

/// Virtual-analog unison stack: N polyBLEP oscillators spread across
/// ±detuneCents/2, phases seeded from DspPrng. Twin of web
/// src/dsp/va-generator.ts (canonical).
public struct VaParams {
    public let shape: OscShape
    public let unison: Int
    public let detuneCents: Double
    public let pulseWidth: Double

    public init(shape: OscShape, unison: Int, detuneCents: Double, pulseWidth: Double = 0.5) {
        self.shape = shape
        self.unison = unison
        self.detuneCents = detuneCents
        self.pulseWidth = pulseWidth
    }
}

public final class VaGenerator: ToneGenerator {
    private let params: VaParams
    private let oscillators: [PolyBlepOscillator]
    private let gainNorm: Double
    private var amp = 0.0
    private var keyed = false

    public init(params: VaParams, sampleRate: Double, seed: UInt32 = 1) {
        self.params = params
        let prng = DspPrng(seed: seed)
        let count = max(1, params.unison)
        oscillators = (0..<count).map { _ in
            PolyBlepOscillator(
                shape: params.shape,
                sampleRate: sampleRate,
                initialPhase: prng.next(),
                pulseWidth: params.pulseWidth,
            )
        }
        gainNorm = 1 / Double(count).squareRoot()
    }

    public var finished: Bool { false }

    public func noteOn(midi: Int, velocity: Double) {
        let base = Pitch.frequency(midi: midi)
        let count = oscillators.count
        for (i, osc) in oscillators.enumerated() {
            let cents = count == 1
                ? 0
                : -params.detuneCents / 2 + params.detuneCents * Double(i) / Double(count - 1)
            osc.setFrequency(base * pow(2, cents / 1200))
        }
        amp = velocity
        keyed = true
    }

    public func noteOff() {
        // Intentionally empty: no intrinsic envelope to key up.
    }

    public func render(into out: inout [Float], frames: Int) {
        guard keyed else { return }
        for n in 0..<frames {
            var sample = 0.0
            for osc in oscillators {
                sample += osc.nextSample()
            }
            out[n] += Float(sample * gainNorm * amp)
        }
    }
}
