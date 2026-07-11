import Foundation

/// Modulated-delay stereo chorus/ensemble — the identity effect of the
/// rompler aesthetic. Sums the incoming stereo pair to mono, writes it into a
/// single circular delay buffer, then reads back 2 (chorus) or 3 (ensemble)
/// taps whose delay sweeps sinusoidally around baseDelayMs, spread across
/// phase offsets so the taps drift in and out of alignment with each other.
/// Twin of web src/dsp/effects/stereo-chorus.ts (canonical).

private let baseDelayMs = 7.0
private let chorusOffsets: [Double] = [0, 0.25]
private let ensembleOffsets: [Double] = [0, 1.0 / 3.0, 2.0 / 3.0]
private let ensembleWeightsL: [Double] = [0.55, 0.3, 0.15]
private let ensembleWeightsR: [Double] = [0.15, 0.3, 0.55]
private let maxTaps = 3

public final class StereoChorus: EffectUnit {
    private let params: ChorusParams
    private let sampleRate: Double
    private var buffer: [Float]
    private let bufferSize: Int
    private let offsets: [Double]
    private var tapScratch = [Float](repeating: 0, count: maxTaps)
    private var writeIndex = 0
    private var phase = 0.0

    public init(params: ChorusParams, sampleRate: Double) {
        self.params = params
        self.sampleRate = sampleRate
        self.bufferSize = Int(((baseDelayMs + params.depthMs + 2) / 1000 * sampleRate).rounded(.up))
        self.buffer = [Float](repeating: 0, count: bufferSize)
        self.offsets = params.mode == .ensemble ? ensembleOffsets : chorusOffsets
    }

    public func reset() {
        for i in 0..<buffer.count { buffer[i] = 0 }
        writeIndex = 0
        phase = 0
    }

    public func process(left: inout [Float], right: inout [Float], frames: Int) {
        let depthMs = params.depthMs
        let mix = params.mix
        let mode = params.mode
        let tapCount = offsets.count

        for i in 0..<frames {
            let l = Double(left[i])
            let r = Double(right[i])
            buffer[writeIndex] = Float((l + r) * 0.5)

            for t in 0..<tapCount {
                let delaySamples =
                    (baseDelayMs + depthMs * sin(DspConstants.twoPi * (phase + offsets[t]))) / 1000 * sampleRate
                let readPos = Double(writeIndex) - delaySamples
                let idx0Raw = Int(readPos.rounded(.down))
                let frac = readPos - Double(idx0Raw)
                let idx0 = ((idx0Raw % bufferSize) + bufferSize) % bufferSize
                let idx1 = (idx0 + 1) % bufferSize
                let s0 = Double(buffer[idx0])
                let s1 = Double(buffer[idx1])
                tapScratch[t] = Float(s0 + (s1 - s0) * frac)
            }

            if mode == .ensemble {
                var wetL = 0.0
                var wetR = 0.0
                for t in 0..<tapCount {
                    wetL += ensembleWeightsL[t] * Double(tapScratch[t])
                    wetR += ensembleWeightsR[t] * Double(tapScratch[t])
                }
                left[i] = Float(l * (1 - mix) + wetL * mix)
                right[i] = Float(r * (1 - mix) + wetR * mix)
            } else {
                left[i] = Float(l * (1 - mix) + Double(tapScratch[0]) * mix)
                right[i] = Float(r * (1 - mix) + Double(tapScratch[1]) * mix)
            }

            writeIndex = (writeIndex + 1) % bufferSize
            phase += params.rateHz / sampleRate
            phase -= phase.rounded(.down)
        }
    }
}
