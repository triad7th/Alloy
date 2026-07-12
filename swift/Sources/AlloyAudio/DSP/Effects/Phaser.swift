import Foundation

/// Multi-stage allpass phaser — per channel, a chain of `stages` first-order
/// allpass filters sharing one swept coefficient, plus feedback from the
/// chain's last output. The coefficient (tan/pow-heavy) is recomputed only
/// once per EffectConstants.controlInterval samples (control rate); the
/// allpass chain itself runs every sample (full rate) — same two-rate
/// philosophy as the voice's TVF/LFO (see Voice.swift CONTROL_INTERVAL).
/// Twin of web src/dsp/effects/phaser.ts (canonical).

/// Sweep range for the shared allpass coefficient's underlying cutoff.
public let PHASER_F_MIN = 200.0
public let PHASER_F_MAX = 2200.0

private let offsetL = 0.0
private let offsetR = 0.25

public final class Phaser: EffectUnit {
    private let params: PhaserParams
    private let sampleRate: Double
    private var zL: [Double]
    private var zR: [Double]
    private var lastOutL = 0.0
    private var lastOutR = 0.0
    private var phase = 0.0
    private var sampleCounter = 0
    private var coefL = 0.0
    private var coefR = 0.0

    public init(params: PhaserParams, sampleRate: Double) {
        self.params = params
        self.sampleRate = sampleRate
        self.zL = [Double](repeating: 0, count: params.stages)
        self.zR = [Double](repeating: 0, count: params.stages)
        updateCoefficients()
    }

    public func reset() {
        for i in 0..<zL.count { zL[i] = 0 }
        for i in 0..<zR.count { zR[i] = 0 }
        lastOutL = 0
        lastOutR = 0
        phase = 0
        sampleCounter = 0
        updateCoefficients()
    }

    public func process(left: inout [Float], right: inout [Float], frames: Int) {
        let stages = params.stages
        let feedback = params.feedback
        let mix = params.mix

        for i in 0..<frames {
            if sampleCounter % EffectConstants.controlInterval == 0 {
                updateCoefficients()
            }

            let l = Double(left[i])
            let r = Double(right[i])

            var xl = l + lastOutL * feedback
            for s in 0..<stages {
                let y = -coefL * xl + zL[s]
                zL[s] = xl + coefL * y
                xl = y
            }
            lastOutL = xl

            var xr = r + lastOutR * feedback
            for s in 0..<stages {
                let y = -coefR * xr + zR[s]
                zR[s] = xr + coefR * y
                xr = y
            }
            lastOutR = xr

            left[i] = Float(l * (1 - mix) + xl * mix)
            right[i] = Float(r * (1 - mix) + xr * mix)

            phase += params.rateHz / sampleRate
            phase -= phase.rounded(.down)
            sampleCounter += 1
        }
    }

    private func updateCoefficients() {
        let depth = params.depth

        let sweepL = 0.5 + 0.5 * depth * sin(DspConstants.twoPi * (phase + offsetL))
        let fL = PHASER_F_MIN * pow(PHASER_F_MAX / PHASER_F_MIN, sweepL)
        let tL = tan(Double.pi * fL / sampleRate)
        coefL = (tL - 1) / (tL + 1)

        let sweepR = 0.5 + 0.5 * depth * sin(DspConstants.twoPi * (phase + offsetR))
        let fR = PHASER_F_MIN * pow(PHASER_F_MAX / PHASER_F_MIN, sweepR)
        let tR = tan(Double.pi * fR / sampleRate)
        coefR = (tR - 1) / (tR + 1)
    }
}
