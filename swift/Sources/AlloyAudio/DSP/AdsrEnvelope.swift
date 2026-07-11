import Foundation

/// Exponential-segment ADSR — one-pole approach toward a per-stage target.
/// Twin of web src/dsp/adsr-envelope.ts (canonical).
public struct AdsrParams: Codable {
    public let attack: Double
    public let decay: Double
    public let sustain: Double
    public let release: Double

    public init(attack: Double, decay: Double, sustain: Double, release: Double) {
        self.attack = attack
        self.decay = decay
        self.sustain = sustain
        self.release = release
    }
}

public final class AdsrEnvelope {
    private enum Stage { case idle, attack, decay, release }

    private static let attackOvershoot = 1.3
    private static let attackTauFactor = log(attackOvershoot / (attackOvershoot - 1))

    private var stage = Stage.idle
    private var level = 0.0
    private let params: AdsrParams
    private let sampleRate: Double
    private let attackCoef: Double
    private let decayCoef: Double
    private var releaseCoef: Double

    public init(params: AdsrParams, sampleRate: Double) {
        self.params = params
        self.sampleRate = sampleRate
        attackCoef = Self.onePoleCoef(tau: params.attack / Self.attackTauFactor, sampleRate: sampleRate)
        decayCoef = Self.onePoleCoef(tau: params.decay, sampleRate: sampleRate)
        releaseCoef = Self.onePoleCoef(tau: params.release, sampleRate: sampleRate)
    }

    public var isActive: Bool { stage != .idle }

    public func noteOn() { stage = .attack }

    public func noteOff() {
        if stage != .idle { stage = .release }
    }

    /// Enter release with an overriding time constant (voice steal / allNotesOff).
    public func fastRelease(tau: Double) {
        releaseCoef = Self.onePoleCoef(tau: tau, sampleRate: sampleRate)
        noteOff()
    }

    public func nextSample() -> Double {
        switch stage {
        case .idle:
            return 0
        case .attack:
            level += attackCoef * (Self.attackOvershoot - level)
            if level >= 1 {
                level = 1
                stage = .decay
            }
            return level
        case .decay:
            level += decayCoef * (params.sustain - level)
            return level
        case .release:
            level += releaseCoef * (0 - level)
            if level <= DspConstants.silenceFloor {
                level = 0
                stage = .idle
            }
            return level
        }
    }

    private static func onePoleCoef(tau: Double, sampleRate: Double) -> Double {
        1 - exp(-1 / (max(tau, 1e-4) * sampleRate))
    }
}
