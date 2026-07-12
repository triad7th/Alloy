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

/// Constants shared with the web twin (`effect-types.ts`), verbatim.
public enum EffectConstants {
    /// Samples per control-rate tick for effects with expensive (tan/pow)
    /// coefficient recomputes — same two-rate philosophy as Voice.swift's
    /// CONTROL_INTERVAL, scoped to the effects layer. Web twin:
    /// EFFECT_CONTROL_INTERVAL.
    public static let controlInterval = 16
}

public enum ChorusMode: String, Codable {
    case chorus
    case ensemble
}

public struct ChorusParams: Codable {
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

public struct TremoloParams: Codable {
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

public struct PhaserParams: Codable {
    /// Allpass stages per channel; must be 4 or 8 (TS literal type `4 | 8`).
    public var stages: Int
    /// LFO rate sweeping the shared allpass coefficient.
    public var rateHz: Double
    /// LFO excursion, 0..1.
    public var depth: Double
    /// 0..0.9 feedback from the chain's last output.
    public var feedback: Double
    /// 0..1 wet.
    public var mix: Double

    public init(stages: Int, rateHz: Double, depth: Double, feedback: Double, mix: Double) {
        self.stages = stages
        self.rateHz = rateHz
        self.depth = depth
        self.feedback = feedback
        self.mix = mix
    }
}

public enum RotarySpeed: String, Codable {
    case slow
    case fast
}

public struct RotaryParams: Codable {
    /// Rotor speed pair, baked per patch (no live-switch path yet).
    public var speed: RotarySpeed
    /// AM/pan excursion, 0..1.
    public var depth: Double
    /// 0..1 wet.
    public var mix: Double

    public init(speed: RotarySpeed, depth: Double, mix: Double) {
        self.speed = speed
        self.depth = depth
        self.mix = mix
    }
}

public struct DriveEqParams: Codable {
    /// Pre-EQ saturation amount, 0..1 (preGain = 1 + drive * 4).
    public var drive: Double
    /// Low-shelf gain in dB, -12..12 (250 Hz).
    public var lowDb: Double
    /// Mid-peak gain in dB, -12..12 (1 kHz, Q 0.707).
    public var midDb: Double
    /// High-shelf gain in dB, -12..12 (3 kHz).
    public var highDb: Double
    /// Output level trim in dB, -12..12.
    public var levelDb: Double

    public init(drive: Double, lowDb: Double, midDb: Double, highDb: Double, levelDb: Double) {
        self.drive = drive
        self.lowDb = lowDb
        self.midDb = midDb
        self.highDb = highDb
        self.levelDb = levelDb
    }
}

public struct CompressorParams: Codable {
    /// Detector threshold in dB, -60..0.
    public var thresholdDb: Double
    /// Compression ratio, 1..20 (1 = no compression).
    public var ratio: Double
    /// Detector attack time in ms, (0, 100].
    public var attackMs: Double
    /// Detector release time in ms, (0, 1000].
    public var releaseMs: Double
    /// Makeup gain in dB, 0..24.
    public var makeupDb: Double

    public init(thresholdDb: Double, ratio: Double, attackMs: Double, releaseMs: Double, makeupDb: Double) {
        self.thresholdDb = thresholdDb
        self.ratio = ratio
        self.attackMs = attackMs
        self.releaseMs = releaseMs
        self.makeupDb = makeupDb
    }
}

/// Wire format keyed on `kind` with a `chorus`/`tremolo` payload field,
/// matching the TS JSON exactly (GeneratorSpec's Codable pattern).
public enum InsertSpec: Codable {
    case chorus(ChorusParams)
    case tremolo(TremoloParams)
    case phaser(PhaserParams)
    case rotary(RotaryParams)
    case driveEq(DriveEqParams)
    case compressor(CompressorParams)

    private enum CodingKeys: String, CodingKey { case kind, chorus, tremolo, phaser, rotary, driveEq, compressor }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        switch try c.decode(String.self, forKey: .kind) {
        case "chorus": self = try .chorus(c.decode(ChorusParams.self, forKey: .chorus))
        case "tremolo": self = try .tremolo(c.decode(TremoloParams.self, forKey: .tremolo))
        case "phaser": self = try .phaser(c.decode(PhaserParams.self, forKey: .phaser))
        case "rotary": self = try .rotary(c.decode(RotaryParams.self, forKey: .rotary))
        case "driveEq": self = try .driveEq(c.decode(DriveEqParams.self, forKey: .driveEq))
        case "compressor": self = try .compressor(c.decode(CompressorParams.self, forKey: .compressor))
        default: throw DecodingError.dataCorruptedError(forKey: .kind, in: c, debugDescription: "unknown insert kind")
        }
    }

    public func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        switch self {
        case let .chorus(params): try c.encode("chorus", forKey: .kind); try c.encode(params, forKey: .chorus)
        case let .tremolo(params): try c.encode("tremolo", forKey: .kind); try c.encode(params, forKey: .tremolo)
        case let .phaser(params): try c.encode("phaser", forKey: .kind); try c.encode(params, forKey: .phaser)
        case let .rotary(params): try c.encode("rotary", forKey: .kind); try c.encode(params, forKey: .rotary)
        case let .driveEq(params): try c.encode("driveEq", forKey: .kind); try c.encode(params, forKey: .driveEq)
        case let .compressor(params): try c.encode("compressor", forKey: .kind); try c.encode(params, forKey: .compressor)
        }
    }
}

/// Output-only wet processor fed by a send tap. Unlike EffectUnit (in-place),
/// a send effect READS a pre-scaled send input and WRITES wet output to a
/// separate pair — the dry bus it taps from stays untouched. Non-allocating,
/// must not throw.
public protocol SendEffect: AnyObject {
    func process(inL: inout [Float], inR: inout [Float], outL: inout [Float], outR: inout [Float], frames: Int)
    func reset()
}

public struct ReverbParams: Codable, Sendable {
    /// Pre-network predelay, 0..100 ms.
    public var predelayMs: Double
    /// Tank feedback / tail length, 0..1 (maps to loop gain 0.70..0.98).
    public var decay: Double
    /// HF damping in the feedback path, 0..1 (0 = bright, 1 = dark).
    public var damping: Double
    /// Input low-pass bandwidth, 0..1 (1 = full band into the network).
    public var bandwidth: Double
    /// Chorus modulation depth of the modulated lines, 0..1.
    public var modDepth: Double
    /// Modulation LFO rate, (0, 5] Hz.
    public var modRateHz: Double

    public init(predelayMs: Double, decay: Double, damping: Double, bandwidth: Double, modDepth: Double, modRateHz: Double) {
        self.predelayMs = predelayMs
        self.decay = decay
        self.damping = damping
        self.bandwidth = bandwidth
        self.modDepth = modDepth
        self.modRateHz = modRateHz
    }
}

public enum DelayMode: String, Codable, Sendable {
    case stereo
    case pingpong
}

public struct DelayParams: Codable, Sendable {
    public var mode: DelayMode
    /// Base delay time, (0, 2000] ms.
    public var timeMs: Double
    /// Feedback gain, 0..0.95 (< 1 for stability).
    public var feedback: Double
    /// HF damping in the feedback path, 0..1.
    public var damping: Double

    public init(mode: DelayMode, timeMs: Double, feedback: Double, damping: Double) {
        self.mode = mode
        self.timeMs = timeMs
        self.feedback = feedback
        self.damping = damping
    }
}

public struct LimiterParams: Codable, Sendable {
    /// Output brickwall ceiling in dBFS, -24..0. Output |sample| never exceeds this.
    public var ceilingDb: Double
    /// Gain recovery time after a peak, (0, 1000] ms.
    public var releaseMs: Double

    public init(ceilingDb: Double, releaseMs: Double) {
        self.ceilingDb = ceilingDb
        self.releaseMs = releaseMs
    }
}

public struct MasterConfig: Codable, Sendable {
    public var reverb: ReverbParams
    public var delay: DelayParams
    public var limiter: LimiterParams

    public init(reverb: ReverbParams, delay: DelayParams, limiter: LimiterParams) {
        self.reverb = reverb
        self.delay = delay
        self.limiter = limiter
    }
}

/// Fixed lookahead of the master limiter, in samples (~1.3 ms at 48 kHz). The
/// master path delays the whole render by exactly this many samples. Web
/// twin: LIMITER_LOOKAHEAD_SAMPLES.
public let limiterLookaheadSamples = 64

public let defaultMasterConfig = MasterConfig(
    reverb: ReverbParams(predelayMs: 12, decay: 0.72, damping: 0.35, bandwidth: 0.85, modDepth: 0.35, modRateHz: 0.7),
    delay: DelayParams(mode: .pingpong, timeMs: 375, feedback: 0.38, damping: 0.4),
    limiter: LimiterParams(ceilingDb: -0.3, releaseMs: 120)
)

public let MAX_INSERTS = 3

private func validateChorusParams(_ chorus: ChorusParams) -> [String] {
    var errors: [String] = []
    if !(chorus.rateHz > 0 && chorus.rateHz <= 20) {
        errors.append("chorus.rateHz \(chorus.rateHz) outside (0, 20]")
    }
    if !(chorus.depthMs > 0 && chorus.depthMs <= baseDelayMs) {
        errors.append("chorus.depthMs \(chorus.depthMs) outside (0, \(Int(baseDelayMs))] (base delay; a larger depth makes the swept delay negative — acausal)")
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

private func validatePhaserParams(_ phaser: PhaserParams) -> [String] {
    var errors: [String] = []
    if phaser.stages != 4 && phaser.stages != 8 {
        errors.append("phaser.stages \(phaser.stages) must be 4 or 8")
    }
    if !(phaser.rateHz > 0 && phaser.rateHz <= 10) {
        errors.append("phaser.rateHz \(phaser.rateHz) outside (0, 10]")
    }
    if !(phaser.depth >= 0 && phaser.depth <= 1) {
        errors.append("phaser.depth \(phaser.depth) outside [0, 1]")
    }
    if !(phaser.feedback >= 0 && phaser.feedback <= 0.9) {
        errors.append("phaser.feedback \(phaser.feedback) outside [0, 0.9]")
    }
    if !(phaser.mix >= 0 && phaser.mix <= 1) {
        errors.append("phaser.mix \(phaser.mix) outside [0, 1]")
    }
    return errors
}

private func validateRotaryParams(_ rotary: RotaryParams) -> [String] {
    // rotary.speed is structurally valid here: RotarySpeed's Codable decode
    // rejects unknown strings before validation can run (the TS validator
    // carries the equivalent runtime check).
    var errors: [String] = []
    if !(rotary.depth >= 0 && rotary.depth <= 1) {
        errors.append("rotary.depth \(rotary.depth) outside [0, 1]")
    }
    if !(rotary.mix >= 0 && rotary.mix <= 1) {
        errors.append("rotary.mix \(rotary.mix) outside [0, 1]")
    }
    return errors
}

private func validateDriveEqParams(_ driveEq: DriveEqParams) -> [String] {
    var errors: [String] = []
    if !(driveEq.drive >= 0 && driveEq.drive <= 1) {
        errors.append("driveEq.drive \(driveEq.drive) outside [0, 1]")
    }
    if !(driveEq.lowDb >= -12 && driveEq.lowDb <= 12) {
        errors.append("driveEq.lowDb \(driveEq.lowDb) outside [-12, 12]")
    }
    if !(driveEq.midDb >= -12 && driveEq.midDb <= 12) {
        errors.append("driveEq.midDb \(driveEq.midDb) outside [-12, 12]")
    }
    if !(driveEq.highDb >= -12 && driveEq.highDb <= 12) {
        errors.append("driveEq.highDb \(driveEq.highDb) outside [-12, 12]")
    }
    if !(driveEq.levelDb >= -12 && driveEq.levelDb <= 12) {
        errors.append("driveEq.levelDb \(driveEq.levelDb) outside [-12, 12]")
    }
    return errors
}

private func validateCompressorParams(_ compressor: CompressorParams) -> [String] {
    var errors: [String] = []
    if !(compressor.thresholdDb >= -60 && compressor.thresholdDb <= 0) {
        errors.append("compressor.thresholdDb \(compressor.thresholdDb) outside [-60, 0]")
    }
    if !(compressor.ratio >= 1 && compressor.ratio <= 20) {
        errors.append("compressor.ratio \(compressor.ratio) outside [1, 20]")
    }
    if !(compressor.attackMs > 0 && compressor.attackMs <= 100) {
        errors.append("compressor.attackMs \(compressor.attackMs) outside (0, 100]")
    }
    if !(compressor.releaseMs > 0 && compressor.releaseMs <= 1000) {
        errors.append("compressor.releaseMs \(compressor.releaseMs) outside (0, 1000]")
    }
    if !(compressor.makeupDb >= 0 && compressor.makeupDb <= 24) {
        errors.append("compressor.makeupDb \(compressor.makeupDb) outside [0, 24]")
    }
    return errors
}

public func validateReverbParams(_ p: ReverbParams) -> [String] {
    var e: [String] = []
    if !(p.predelayMs >= 0 && p.predelayMs <= 100) {
        e.append("reverb.predelayMs \(p.predelayMs) outside [0, 100]")
    }
    if !(p.decay >= 0 && p.decay <= 1) {
        e.append("reverb.decay \(p.decay) outside [0, 1]")
    }
    if !(p.damping >= 0 && p.damping <= 1) {
        e.append("reverb.damping \(p.damping) outside [0, 1]")
    }
    if !(p.bandwidth >= 0 && p.bandwidth <= 1) {
        e.append("reverb.bandwidth \(p.bandwidth) outside [0, 1]")
    }
    if !(p.modDepth >= 0 && p.modDepth <= 1) {
        e.append("reverb.modDepth \(p.modDepth) outside [0, 1]")
    }
    if !(p.modRateHz > 0 && p.modRateHz <= 5) {
        e.append("reverb.modRateHz \(p.modRateHz) outside (0, 5]")
    }
    return e
}

public func validateDelayParams(_ p: DelayParams) -> [String] {
    // p.mode is structurally valid here: DelayMode's Codable decode rejects
    // unknown strings before validation can run (the TS validator carries
    // the equivalent runtime check).
    var e: [String] = []
    if !(p.timeMs > 0 && p.timeMs <= 2000) {
        e.append("delay.timeMs \(p.timeMs) outside (0, 2000]")
    }
    if !(p.feedback >= 0 && p.feedback <= 0.95) {
        e.append("delay.feedback \(p.feedback) outside [0, 0.95]")
    }
    if !(p.damping >= 0 && p.damping <= 1) {
        e.append("delay.damping \(p.damping) outside [0, 1]")
    }
    return e
}

public func validateLimiterParams(_ p: LimiterParams) -> [String] {
    var e: [String] = []
    if !(p.ceilingDb >= -24 && p.ceilingDb <= 0) {
        e.append("limiter.ceilingDb \(p.ceilingDb) outside [-24, 0]")
    }
    if !(p.releaseMs > 0 && p.releaseMs <= 1000) {
        e.append("limiter.releaseMs \(p.releaseMs) outside (0, 1000]")
    }
    return e
}

public func validateMasterConfig(_ c: MasterConfig) -> [String] {
    validateReverbParams(c.reverb) + validateDelayParams(c.delay) + validateLimiterParams(c.limiter)
}

/// Non-throwing; empty = constructible on both platforms.
public func validateInsert(_ spec: InsertSpec) -> [String] {
    switch spec {
    case let .chorus(chorus): return validateChorusParams(chorus)
    case let .tremolo(tremolo): return validateTremoloParams(tremolo)
    case let .phaser(phaser): return validatePhaserParams(phaser)
    case let .rotary(rotary): return validateRotaryParams(rotary)
    case let .driveEq(driveEq): return validateDriveEqParams(driveEq)
    case let .compressor(compressor): return validateCompressorParams(compressor)
    }
}

/// Factory used by the engine at setPatch time.
public func createInsert(_ spec: InsertSpec, sampleRate: Double) -> EffectUnit {
    switch spec {
    case let .chorus(chorus):
        return StereoChorus(params: chorus, sampleRate: sampleRate)
    case let .tremolo(tremolo):
        return TremoloAutoPan(params: tremolo, sampleRate: sampleRate)
    case let .phaser(phaser):
        return Phaser(params: phaser, sampleRate: sampleRate)
    case let .rotary(rotary):
        return RotarySpeaker(params: rotary, sampleRate: sampleRate)
    case let .driveEq(driveEq):
        return DriveEq(params: driveEq, sampleRate: sampleRate)
    case let .compressor(compressor):
        return Compressor(params: compressor, sampleRate: sampleRate)
    }
}
