import Foundation

/// Topology-preserving-transform state variable filter (Zavalishin).
/// Stable under audio-rate cutoff modulation — this is the patch TVF.
/// Constructed fully open; call setParams to shape.
/// Twin of web src/dsp/svf.ts (canonical).
public enum SvfMode: String, Codable {
    case lowpass
    case bandpass
    case highpass
}

public final class Svf {
    private let mode: SvfMode
    private let sampleRate: Double
    private var ic1 = 0.0
    private var ic2 = 0.0
    private var k = 1.0
    private var a1 = 0.0
    private var a2 = 0.0
    private var a3 = 0.0

    public init(mode: SvfMode, sampleRate: Double) {
        self.mode = mode
        self.sampleRate = sampleRate
        setParams(cutoffHz: sampleRate * 0.49, q: 0.707)
    }

    public func setParams(cutoffHz: Double, q: Double) {
        let clamped = min(max(cutoffHz, 10), sampleRate * 0.49)
        let g = tan(Double.pi * clamped / sampleRate)
        k = 1 / max(q, 0.5)
        a1 = 1 / (1 + g * (g + k))
        a2 = g * a1
        a3 = g * a2
    }

    public func process(_ x: Double) -> Double {
        let v3 = x - ic2
        let v1 = a1 * ic1 + a2 * v3
        let v2 = ic2 + a2 * ic1 + a3 * v3
        ic1 = 2 * v1 - ic1
        ic2 = 2 * v2 - ic2
        switch mode {
        case .lowpass: return v2
        case .bandpass: return v1
        case .highpass: return x - k * v1 - v2
        }
    }
}
