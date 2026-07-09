import Foundation

/// Phase-accumulator oscillator; part of the hand-rolled DSP that stands in
/// for the web alloy-audio twin's native WebAudio OscillatorNode. Sawtooth
/// and square are polyBLEP band-limited (Web Audio's OscillatorNode is
/// band-limited; a naive saw aliases audibly at high keys). Sine and
/// triangle are computed naively.
public struct Oscillator {
    private let waveform: Waveform
    private let increment: Double
    private var phase = 0.0

    public init(waveform: Waveform, frequency: Double, detuneCents: Double = 0, sampleRate: Double) {
        self.waveform = waveform
        let detuned = frequency * pow(2, detuneCents / 1200)
        increment = detuned / sampleRate
    }

    public mutating func next() -> Double {
        let value = sample(at: phase)
        phase += increment
        if phase >= 1 { phase -= 1 }
        return value
    }

    private func sample(at t: Double) -> Double {
        switch waveform {
        case .sine:
            return sin(2 * .pi * t)
        case .sawtooth:
            return 2 * t - 1 - polyBLEP(t)
        case .square:
            let raw: Double = t < 0.5 ? 1 : -1
            var shifted = t + 0.5
            if shifted >= 1 { shifted -= 1 }
            return raw + polyBLEP(t) - polyBLEP(shifted)
        case .triangle:
            // Naive triangle: +1 at phase 0, -1 at phase 0.5.
            return 4 * abs(t - 0.5) - 1
        }
    }

    /// Two-sample polynomial band-limited step correction at wrap points.
    private func polyBLEP(_ t: Double) -> Double {
        let dt = increment
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
