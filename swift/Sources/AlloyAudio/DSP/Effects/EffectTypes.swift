import Foundation

/// Insert-effect infrastructure: the contracts that let the engine hold an
/// ordered, per-patch chain of stereo processors after the mono voice bus.
/// Twin of web src/dsp/effects/effect-types.ts (canonical).

/// Stereo in-place processor. process() must not allocate or throw.
public protocol EffectUnit: AnyObject {
    func process(left: inout [Float], right: inout [Float], frames: Int)
    /// Clear all internal state (delay lines, phases).
    func reset()
}

public enum ChorusMode {
    case chorus
    case ensemble
}

public struct ChorusParams {
    public var mode: ChorusMode
    /// LFO rate.
    public var rateHz: Double
    /// Peak delay deviation.
    public var depthMs: Double
    /// 0..1 wet.
    public var mix: Double

    public init(mode: ChorusMode, rateHz: Double, depthMs: Double, mix: Double) {
        self.mode = mode
        self.rateHz = rateHz
        self.depthMs = depthMs
        self.mix = mix
    }
}

public struct TremoloParams {
    public var rateHz: Double
    public var depth: Double
    /// 0 = tremolo .. 1 = auto-pan.
    public var spread: Double

    public init(rateHz: Double, depth: Double, spread: Double) {
        self.rateHz = rateHz
        self.depth = depth
        self.spread = spread
    }
}

/// PLAIN in Task 1 — no Codable until the schema (and the `kind`-keyed wire
/// format) lands in Task 3.
public enum InsertSpec {
    case chorus(ChorusParams)
    case tremolo(TremoloParams)
}

public let MAX_INSERTS = 3

private func validateChorusParams(_ chorus: ChorusParams) -> [String] {
    var errors: [String] = []
    if !(chorus.rateHz > 0 && chorus.rateHz <= 20) {
        errors.append("chorus.rateHz \(chorus.rateHz) outside (0, 20]")
    }
    if !(chorus.depthMs > 0 && chorus.depthMs <= 20) {
        errors.append("chorus.depthMs \(chorus.depthMs) outside (0, 20]")
    }
    if !(chorus.mix >= 0 && chorus.mix <= 1) {
        errors.append("chorus.mix \(chorus.mix) outside [0, 1]")
    }
    return errors
}

private func validateTremoloParams(_ tremolo: TremoloParams) -> [String] {
    var errors: [String] = []
    if !(tremolo.rateHz > 0 && tremolo.rateHz <= 40) {
        errors.append("tremolo.rateHz \(tremolo.rateHz) outside (0, 40]")
    }
    if !(tremolo.depth >= 0 && tremolo.depth <= 1) {
        errors.append("tremolo.depth \(tremolo.depth) outside [0, 1]")
    }
    if !(tremolo.spread >= 0 && tremolo.spread <= 1) {
        errors.append("tremolo.spread \(tremolo.spread) outside [0, 1]")
    }
    return errors
}

/// Non-throwing; empty = constructible on both platforms.
public func validateInsert(_ spec: InsertSpec) -> [String] {
    switch spec {
    case let .chorus(chorus): return validateChorusParams(chorus)
    case let .tremolo(tremolo): return validateTremoloParams(tremolo)
    }
}

/// Factory used by the engine at setPatch time.
public func createInsert(_ spec: InsertSpec, sampleRate: Double) -> EffectUnit {
    switch spec {
    case let .chorus(chorus):
        return StereoChorus(params: chorus, sampleRate: sampleRate)
    case let .tremolo(tremolo):
        return TremoloAutoPan(params: tremolo, sampleRate: sampleRate)
    }
}
