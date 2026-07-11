import Foundation

/// Modulation LFO with delay + fade-in gate. Twin of web src/dsp/lfo.ts.
public enum LfoShape {
    case sine
    case triangle
}

public struct LfoParams {
    public let shape: LfoShape
    public let rateHz: Double
    public let delay: Double
    public let fadeIn: Double

    public init(shape: LfoShape, rateHz: Double, delay: Double, fadeIn: Double) {
        self.shape = shape
        self.rateHz = rateHz
        self.delay = delay
        self.fadeIn = fadeIn
    }
}

public final class Lfo {
    private var phase = 0.0
    private var elapsed = 0.0
    private let params: LfoParams
    private let sampleRate: Double

    public init(params: LfoParams, sampleRate: Double) {
        self.params = params
        self.sampleRate = sampleRate
    }

    public func nextSample() -> Double {
        let delaySamples = params.delay * sampleRate
        let fadeSamples = params.fadeIn * sampleRate
        let since = elapsed - delaySamples
        elapsed += 1
        if since < 0 { return 0 }
        let gate = fadeSamples <= 0 ? 1 : min(1, since / fadeSamples)
        let raw: Double
        switch params.shape {
        case .sine:
            raw = sin(DspConstants.twoPi * phase)
        case .triangle:
            raw = Self.triangle(phase)
        }
        phase += params.rateHz / sampleRate
        phase -= phase.rounded(.down)
        return raw * gate
    }

    /// Sine-aligned triangle: 0 → +1 → −1 → 0 across one cycle.
    private static func triangle(_ p: Double) -> Double {
        if p < 0.25 { return 4 * p }
        if p < 0.75 { return 2 - 4 * p }
        return 4 * p - 4
    }
}
