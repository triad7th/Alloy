import Foundation

/// Sine partial bank (drawbar organs are a 9-partial preset of this).
/// Sustained kind: never self-finishes; the voice TVA ends the note.
/// Twin of web src/dsp/additive-generator.ts (canonical).
public struct AdditivePartial: Codable {
    public let ratio: Double
    public let level: Double

    public init(ratio: Double, level: Double) {
        self.ratio = ratio
        self.level = level
    }
}

public final class AdditiveGenerator: ToneGenerator {
    private let partials: [AdditivePartial]
    private let sampleRate: Double
    private var phases: [Double]
    private var frequency = 0.0
    private var amp = 0.0
    private var keyed = false

    public init(partials: [AdditivePartial], sampleRate: Double) {
        self.partials = partials
        self.sampleRate = sampleRate
        phases = [Double](repeating: 0, count: partials.count)
    }

    public var finished: Bool { false }

    public func noteOn(midi: Int, velocity: Double) {
        frequency = Pitch.frequency(midi: midi)
        amp = velocity
        keyed = true
        for i in phases.indices {
            phases[i] = 0
        }
    }

    public func noteOff() {
        // Intentionally empty: no intrinsic envelope to key up.
    }

    public func render(into out: inout [Float], frames: Int) {
        guard keyed else { return }
        for n in 0..<frames {
            var sample = 0.0
            for p in partials.indices {
                sample += sin(DspConstants.twoPi * phases[p]) * partials[p].level
                phases[p] += frequency * partials[p].ratio / sampleRate
                phases[p] -= phases[p].rounded(.down)
            }
            out[n] += Float(sample * amp)
        }
    }
}
