import Foundation

/// RBJ audio-EQ-cookbook lowpass biquad (direct form 1); the Swift stand-in
/// for the web alloy-audio twin's native BiquadFilterNode.
public struct BiquadLowpass {
    private let sampleRate: Double
    private var b0 = 1.0, b1 = 0.0, b2 = 0.0, a1 = 0.0, a2 = 0.0
    private var x1 = 0.0, x2 = 0.0, y1 = 0.0, y2 = 0.0

    public init(sampleRate: Double) {
        self.sampleRate = sampleRate
    }

    public mutating func setCutoff(_ hz: Double, q: Double) {
        let clamped = min(max(hz, 10), sampleRate * 0.45)
        let omega = 2 * Double.pi * clamped / sampleRate
        let alpha = sin(omega) / (2 * max(q, 0.01))
        let cosw = cos(omega)
        let a0 = 1 + alpha
        b0 = ((1 - cosw) / 2) / a0
        b1 = (1 - cosw) / a0
        b2 = ((1 - cosw) / 2) / a0
        a1 = (-2 * cosw) / a0
        a2 = (1 - alpha) / a0
    }

    public mutating func process(_ x: Double) -> Double {
        let y = b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2
        x2 = x1
        x1 = x
        y2 = y1
        y1 = y
        return y
    }
}
