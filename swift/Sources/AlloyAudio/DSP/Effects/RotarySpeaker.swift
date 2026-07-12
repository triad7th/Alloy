import Foundation

/// Rotary speaker (simplified crossed AM) — the mono sum runs through a
/// one-pole crossover at 800 Hz; the high band ("horn") and low band ("drum")
/// each get opposed-pan amplitude modulation at their own rotor rate.
/// "Polished over realistic": AM + pan only, no doppler. Unity-center gains
/// (1 ± depth·sin — at depth 0 each channel carries the full band sum m,
/// matching the engine's unity mono→stereo convention; gains swing 0..2).
/// Speed is baked per patch (no live-switch path yet). Cheap enough to run
/// fully per-sample — no control ticks.
/// Twin of web src/dsp/effects/rotary-speaker.ts (canonical).

/// Rotor rates in Hz per speed setting.
public let ROTARY_HORN_RATE_FAST = 6.6
public let ROTARY_DRUM_RATE_FAST = 5.7
public let ROTARY_HORN_RATE_SLOW = 0.8
public let ROTARY_DRUM_RATE_SLOW = 0.7

/// Horn/drum crossover frequency.
public let ROTARY_CROSSOVER_HZ = 800.0

public final class RotarySpeaker: EffectUnit {
    private let params: RotaryParams
    private let sampleRate: Double
    private let crossoverCoef: Double
    private let hornRate: Double
    private let drumRate: Double
    private var lowState = 0.0
    private var hornPhase = 0.0
    private var drumPhase = 0.0

    public init(params: RotaryParams, sampleRate: Double) {
        self.params = params
        self.sampleRate = sampleRate
        self.crossoverCoef = 1 - exp(-DspConstants.twoPi * ROTARY_CROSSOVER_HZ / sampleRate)
        self.hornRate = params.speed == .fast ? ROTARY_HORN_RATE_FAST : ROTARY_HORN_RATE_SLOW
        self.drumRate = params.speed == .fast ? ROTARY_DRUM_RATE_FAST : ROTARY_DRUM_RATE_SLOW
    }

    public func reset() {
        lowState = 0
        hornPhase = 0
        drumPhase = 0
    }

    public func process(left: inout [Float], right: inout [Float], frames: Int) {
        let depth = params.depth
        let mix = params.mix

        for i in 0..<frames {
            let l = Double(left[i])
            let r = Double(right[i])

            let m = (l + r) / 2
            lowState += crossoverCoef * (m - lowState)
            let low = lowState
            let high = m - low

            let hornL = 1 + depth * sin(DspConstants.twoPi * hornPhase)
            let hornR = 1 + depth * sin(DspConstants.twoPi * hornPhase + Double.pi)
            let drumL = 1 + depth * sin(DspConstants.twoPi * drumPhase)
            let drumR = 1 + depth * sin(DspConstants.twoPi * drumPhase + Double.pi)

            let wetL = high * hornL + low * drumL
            let wetR = high * hornR + low * drumR

            left[i] = Float(l * (1 - mix) + wetL * mix)
            right[i] = Float(r * (1 - mix) + wetR * mix)

            hornPhase += hornRate / sampleRate
            hornPhase -= hornPhase.rounded(.down)
            drumPhase += drumRate / sampleRate
            drumPhase -= drumPhase.rounded(.down)
        }
    }
}
