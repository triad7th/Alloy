import Foundation

/// Patch data model: the wire schema every later phase-1b task builds on.
/// Pure data (JSON-serializable) plus non-throwing validation, so hosts can
/// check patch data before constructing voices. Twin of web src/dsp/patch.ts
/// (canonical). JSON field names match the TS shape exactly.
public let PATCH_SCHEMA_VERSION = 1

public enum PatchCategory: String, Codable {
    case melodic
    case kit
}

public struct PatchMeta: Codable {
    public let id: String
    public let name: String
    public let category: PatchCategory
    public let gmProgram: Int?

    public init(id: String, name: String, category: PatchCategory, gmProgram: Int? = nil) {
        self.id = id
        self.name = name
        self.category = category
        self.gmProgram = gmProgram
    }
}

public struct KeyRange: Codable {
    public let lowMidi: Int
    public let highMidi: Int

    public init(lowMidi: Int, highMidi: Int) {
        self.lowMidi = lowMidi
        self.highMidi = highMidi
    }
}

/// 0..1 inclusive.
public struct VelRange: Codable {
    public let low: Double
    public let high: Double

    public init(low: Double, high: Double) {
        self.low = low
        self.high = high
    }
}

public enum GeneratorSpec: Codable {
    case fm(FmGeneratorParams)
    case additive([AdditivePartial])
    case va(VaParams, seed: UInt32)
    case sample(zoneSetId: String, crossfade: Double)

    private enum CodingKeys: String, CodingKey { case kind, fm, partials, va, seed, zoneSetId, crossfade }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        switch try c.decode(String.self, forKey: .kind) {
        case "fm": self = try .fm(c.decode(FmGeneratorParams.self, forKey: .fm))
        case "additive": self = try .additive(c.decode([AdditivePartial].self, forKey: .partials))
        case "va": self = try .va(c.decode(VaParams.self, forKey: .va), seed: c.decode(UInt32.self, forKey: .seed))
        case "sample": self = try .sample(zoneSetId: c.decode(String.self, forKey: .zoneSetId), crossfade: c.decode(Double.self, forKey: .crossfade))
        default: throw DecodingError.dataCorruptedError(forKey: .kind, in: c, debugDescription: "unknown generator kind")
        }
    }

    public func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        switch self {
        case let .fm(params): try c.encode("fm", forKey: .kind); try c.encode(params, forKey: .fm)
        case let .additive(partials): try c.encode("additive", forKey: .kind); try c.encode(partials, forKey: .partials)
        case let .va(params, seed): try c.encode("va", forKey: .kind); try c.encode(params, forKey: .va); try c.encode(seed, forKey: .seed)
        case let .sample(zoneSetId, crossfade): try c.encode("sample", forKey: .kind); try c.encode(zoneSetId, forKey: .zoneSetId); try c.encode(crossfade, forKey: .crossfade)
        }
    }
}

public struct TvfParams: Codable {
    public let mode: SvfMode
    public let cutoffHz: Double
    public let q: Double
    /// Extra Hz opened by the filter envelope at full level.
    public let envAmountHz: Double
    public let env: AdsrParams?
    /// 0 = fixed cutoff; 1 = cutoff doubles per octave above middle C.
    public let keyTrack: Double
    /// Extra Hz opened at velocity 1.
    public let velAmountHz: Double

    public init(
        mode: SvfMode,
        cutoffHz: Double,
        q: Double,
        envAmountHz: Double,
        env: AdsrParams? = nil,
        keyTrack: Double,
        velAmountHz: Double,
    ) {
        self.mode = mode
        self.cutoffHz = cutoffHz
        self.q = q
        self.envAmountHz = envAmountHz
        self.env = env
        self.keyTrack = keyTrack
        self.velAmountHz = velAmountHz
    }
}

public struct TvaParams: Codable {
    /// Linear layer gain.
    public let level: Double
    public let adsr: AdsrParams
    /// Perceptual velocity exponent; generators already apply velocity^1.
    public let velCurve: Double

    public init(level: Double, adsr: AdsrParams, velCurve: Double) {
        self.level = level
        self.adsr = adsr
        self.velCurve = velCurve
    }
}

public struct LfoRouting: Codable {
    public let lfo: LfoParams
    public let toPitchCents: Double
    public let toCutoffHz: Double
    /// 0..1 tremolo depth.
    public let toAmpDepth: Double

    public init(lfo: LfoParams, toPitchCents: Double, toCutoffHz: Double, toAmpDepth: Double) {
        self.lfo = lfo
        self.toPitchCents = toPitchCents
        self.toCutoffHz = toCutoffHz
        self.toAmpDepth = toAmpDepth
    }
}

public struct PatchLayer: Codable {
    public var keyRange: KeyRange
    public var velRange: VelRange
    public var generator: GeneratorSpec
    public var tvf: TvfParams?
    public var tva: TvaParams
    public var mod: LfoRouting?

    public init(
        keyRange: KeyRange,
        velRange: VelRange,
        generator: GeneratorSpec,
        tvf: TvfParams? = nil,
        tva: TvaParams,
        mod: LfoRouting? = nil,
    ) {
        self.keyRange = keyRange
        self.velRange = velRange
        self.generator = generator
        self.tvf = tvf
        self.tva = tva
        self.mod = mod
    }
}

public struct PatchSends: Codable {
    public var reverb: Double
    public var delay: Double

    public init(reverb: Double, delay: Double) {
        self.reverb = reverb
        self.delay = delay
    }
}

public struct Patch: Codable {
    public var schemaVersion: Int
    public var meta: PatchMeta
    /// 1..4 layers.
    public var layers: [PatchLayer]
    /// Consumed in phase 2.
    public var sends: PatchSends
    /// Ordered stereo insert chain after the mono voice bus (0..MAX_INSERTS).
    /// Optional on the wire (synthesized Codable decodes it via
    /// decodeIfPresent and omits nil on encode), so pre-2a patch JSON keeps
    /// decoding at schemaVersion 1.
    public var inserts: [InsertSpec]?

    public init(
        schemaVersion: Int,
        meta: PatchMeta,
        layers: [PatchLayer],
        sends: PatchSends,
        inserts: [InsertSpec]? = nil,
    ) {
        self.schemaVersion = schemaVersion
        self.meta = meta
        self.layers = layers
        self.sends = sends
        self.inserts = inserts
    }
}

/// Non-throwing validation; empty = safe to construct voices from on both platforms.
public func validatePatch(_ patch: Patch) -> [String] {
    var errors: [String] = []
    if patch.schemaVersion != PATCH_SCHEMA_VERSION {
        errors.append("schemaVersion \(patch.schemaVersion) !== \(PATCH_SCHEMA_VERSION)")
    }
    if patch.layers.count < 1 || patch.layers.count > 4 {
        errors.append("layer count \(patch.layers.count) outside 1..4")
    }
    for (i, layer) in patch.layers.enumerated() {
        let prefix = "layer \(i + 1): "
        let keyRange = layer.keyRange
        let velRange = layer.velRange
        let tva = layer.tva
        if !(0 <= keyRange.lowMidi && keyRange.lowMidi <= keyRange.highMidi && keyRange.highMidi <= 127) {
            errors.append("\(prefix)keyRange \(keyRange.lowMidi)..\(keyRange.highMidi) invalid")
        }
        if !(0 <= velRange.low && velRange.low <= velRange.high && velRange.high <= 1) {
            errors.append("\(prefix)velRange \(velRange.low)..\(velRange.high) invalid")
        }
        if !(tva.level > 0) {
            errors.append("\(prefix)tva.level \(tva.level) must be > 0")
        }
        switch layer.generator {
        case let .fm(fm):
            for e in validateFmGeneratorParams(fm) {
                errors.append("\(prefix)\(e)")
            }
        case let .va(va, _):
            if !(va.unison >= 1) {
                errors.append("\(prefix)va.unison \(va.unison) must be >= 1")
            }
            // No seed range check here: the TS twin validates seed is an
            // integer in 0...0xffffffff because its wire type is `number`.
            // Swift's GeneratorSpec.va seed is UInt32, so the same range is
            // enforced by the type system at decode time — an equivalent
            // runtime check would be unreachable and rejected by lint.

        case let .additive(partials):
            if partials.count < 1 {
                errors.append("\(prefix)additive requires at least one partial")
            }
        case let .sample(zoneSetId, crossfade):
            if zoneSetId.isEmpty {
                errors.append("\(prefix)sample requires a non-empty zoneSetId")
            }
            if !(crossfade >= 0) {
                errors.append("\(prefix)sample.crossfade \(crossfade) must be >= 0")
            }
        }
    }
    if let inserts = patch.inserts {
        if inserts.count > MAX_INSERTS {
            errors.append("too many inserts (\(inserts.count) > \(MAX_INSERTS))")
        }
        for (i, insert) in inserts.enumerated() {
            for e in validateInsert(insert) {
                errors.append("insert \(i + 1): \(e)")
            }
        }
    }
    return errors
}
