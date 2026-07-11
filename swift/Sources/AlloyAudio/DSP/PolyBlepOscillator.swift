import Foundation

/// Band-limited oscillator via polyBLEP edge correction. Twin of web
/// src/dsp/poly-blep-oscillator.ts (canonical).
public enum OscShape: String, Codable {
    case sine
    case saw
    case pulse
}

public final class PolyBlepOscillator {
    private let shape: OscShape
    private let sampleRate: Double
    private let pulseWidth: Double
    private var phase: Double
    private var increment = 0.0

    public init(shape: OscShape, sampleRate: Double, initialPhase: Double = 0, pulseWidth: Double = 0.5) {
        self.shape = shape
        self.sampleRate = sampleRate
        self.pulseWidth = pulseWidth
        phase = Self.wrap(initialPhase)
    }

    public func setFrequency(_ hz: Double) {
        increment = hz / sampleRate
    }

    public func nextSample() -> Double {
        let t = phase
        let dt = increment
        let value: Double
        switch shape {
        case .sine:
            value = sin(DspConstants.twoPi * t)
        case .saw:
            value = 2 * t - 1 - Self.polyBlep(t, dt)
        case .pulse:
            let w = pulseWidth
            value = (t < w ? 1 : -1) + Self.polyBlep(t, dt) - Self.polyBlep(Self.wrap(t - w), dt)
        }
        phase = Self.wrap(t + dt)
        return value
    }

    private static func wrap(_ p: Double) -> Double {
        p - p.rounded(.down)
    }

    /// 2-sample polynomial band-limited step centered on the phase reset.
    private static func polyBlep(_ t: Double, _ dt: Double) -> Double {
        if dt <= 0 { return 0 }
        if t < dt {
            let x = t / dt
            return x + x - x * x - 1
        }
        if t > 1 - dt {
            let x = (t - 1) / dt
            return x * x + x + x + 1
        }
        return 0
    }
}
