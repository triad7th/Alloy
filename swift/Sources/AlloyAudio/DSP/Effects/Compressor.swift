import Foundation

/// Stereo-linked feed-forward compressor — a single max(|L|, |R|) detector
/// drives both channels identically (link), so a loud transient on one
/// channel ducks both together instead of skewing the stereo image. The
/// detector's one-pole attack/release smoothing runs every sample (full
/// rate); the log/pow-heavy gain computation runs once per
/// EffectConstants.controlInterval samples (control rate) and is held
/// constant across the tick — same two-rate philosophy as the phaser's
/// swept coefficient (see Phaser.swift). Twin of web
/// src/dsp/effects/compressor.ts (canonical).
public final class Compressor: EffectUnit {
    private let params: CompressorParams
    private var env = 0.0
    private var gain: Double
    private var sampleCounter = 0
    private let attackCoef: Double
    private let releaseCoef: Double

    public init(params: CompressorParams, sampleRate: Double) {
        self.params = params
        self.attackCoef = 1 - exp(-1 / ((params.attackMs / 1000) * sampleRate))
        self.releaseCoef = 1 - exp(-1 / ((params.releaseMs / 1000) * sampleRate))
        self.gain = pow(10, params.makeupDb / 20)
    }

    public func reset() {
        env = 0
        gain = pow(10, params.makeupDb / 20)
        sampleCounter = 0
    }

    public func process(left: inout [Float], right: inout [Float], frames: Int) {
        let thresholdDb = params.thresholdDb
        let ratio = params.ratio
        let makeupDb = params.makeupDb

        for i in 0..<frames {
            let l = Double(left[i])
            let r = Double(right[i])

            let d = max(abs(l), abs(r))
            env += (d > env ? attackCoef : releaseCoef) * (d - env)

            if sampleCounter % EffectConstants.controlInterval == 0 {
                let envDb = 20 * log10(max(env, 1e-6))
                let over = max(0, envDb - thresholdDb)
                let reductionDb = over * (1 - 1 / ratio)
                gain = pow(10, (makeupDb - reductionDb) / 20)
            }

            left[i] = Float(l * gain)
            right[i] = Float(r * gain)

            sampleCounter += 1
        }
    }
}
