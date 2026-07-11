import Foundation

/// Tremolo/auto-pan — an amplitude LFO applied independently to L and R,
/// with the R phase offset by `spread` half-turns. spread 0 keeps both
/// channels in phase (classic tremolo); spread 1 puts them a half-cycle
/// apart (hard auto-pan, L and R gains swap peaks/troughs).
/// Twin of web src/dsp/effects/tremolo-auto-pan.ts (canonical).

public final class TremoloAutoPan: EffectUnit {
    private let params: TremoloParams
    private let sampleRate: Double
    private var phase = 0.0

    public init(params: TremoloParams, sampleRate: Double) {
        self.params = params
        self.sampleRate = sampleRate
    }

    public func reset() {
        phase = 0
    }

    public func process(left: inout [Float], right: inout [Float], frames: Int) {
        let rateHz = params.rateHz
        let depth = params.depth
        let spread = params.spread

        for i in 0..<frames {
            let gainL = 1 - depth * (0.5 + 0.5 * sin(DspConstants.twoPi * phase))
            let gainR = 1 - depth * (0.5 + 0.5 * sin(DspConstants.twoPi * phase + Double.pi * spread))
            left[i] = Float(Double(left[i]) * gainL)
            right[i] = Float(Double(right[i]) * gainR)

            phase += rateHz / sampleRate
            phase -= phase.rounded(.down)
        }
    }
}
