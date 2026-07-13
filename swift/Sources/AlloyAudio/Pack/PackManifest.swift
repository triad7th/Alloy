import Foundation

/// Pack manifest: the shared contract between the offline samplepack
/// pipeline and the runtime PackLoader. Pure data (JSON), non-throwing
/// validation. zoneSets[zoneSetId] keys are what patches reference; tiers
/// differ in file contents, not zoneSetIds. Twin of web
/// src/pack/manifest.ts (canonical). JSON field names match the TS shape
/// exactly.
public let PACK_SCHEMA_VERSION = 1

public enum PackTier: String, Codable {
    case tiny
    case standard
    case hq
}

public struct ZoneSpec: Codable {
    /// Original pitch of the recording, MIDI note.
    public var rootMidi: Int
    /// Relative .m4a path within the pack directory.
    public var file: String
    /// Loop region [loopStart, loopEnd) in samples; omit for one-shots.
    public var loopStart: Int?
    public var loopEnd: Int?
    /// Linear gain applied to the decoded PCM at load.
    public var gain: Double
    /// Fine-tune added to the effective root at load (positive raises the
    /// effective root, i.e. plays the sample lower). Correction for
    /// recordings slightly off pitch.
    public var tuneCents: Double

    public init(
        rootMidi: Int,
        file: String,
        loopStart: Int? = nil,
        loopEnd: Int? = nil,
        gain: Double,
        tuneCents: Double,
    ) {
        self.rootMidi = rootMidi
        self.file = file
        self.loopStart = loopStart
        self.loopEnd = loopEnd
        self.gain = gain
        self.tuneCents = tuneCents
    }
}

public struct LayerSpec: Codable {
    /// Inclusive upper velocity bound, 0..1; layers sorted ascending.
    public var topVelocity: Double
    public var zones: [ZoneSpec]

    public init(topVelocity: Double, zones: [ZoneSpec]) {
        self.topVelocity = topVelocity
        self.zones = zones
    }
}

public struct ZoneSetSpec: Codable {
    public var layers: [LayerSpec]

    public init(layers: [LayerSpec]) {
        self.layers = layers
    }
}

public struct CreditEntry: Codable {
    public var source: String
    public var license: String
    public var url: String?

    public init(source: String, license: String, url: String? = nil) {
        self.source = source
        self.license = license
        self.url = url
    }
}

public struct PackManifest: Codable {
    public var schemaVersion: Int
    public var id: String
    public var tier: PackTier
    /// Sample rate the decoded zones assume.
    public var sampleRate: Double
    public var format: String
    public var zoneSets: [String: ZoneSetSpec]
    public var credits: [CreditEntry]

    public init(
        schemaVersion: Int,
        id: String,
        tier: PackTier,
        sampleRate: Double,
        format: String,
        zoneSets: [String: ZoneSetSpec],
        credits: [CreditEntry],
    ) {
        self.schemaVersion = schemaVersion
        self.id = id
        self.tier = tier
        self.sampleRate = sampleRate
        self.format = format
        self.zoneSets = zoneSets
        self.credits = credits
    }
}

/// Non-throwing; empty = safe to load.
public func validateManifest(_ m: PackManifest) -> [String] {
    var e: [String] = []
    if m.schemaVersion != PACK_SCHEMA_VERSION {
        e.append("schemaVersion \(m.schemaVersion) !== \(PACK_SCHEMA_VERSION)")
    }
    if m.id.isEmpty { e.append("id must be non-empty") }
    if !(m.sampleRate > 0) { e.append("sampleRate \(m.sampleRate) must be > 0") }
    if m.format != "m4a" { e.append("format '\(m.format)' must be 'm4a'") }
    let zoneSetIds = Array(m.zoneSets.keys).sorted()
    if zoneSetIds.isEmpty { e.append("at least one zoneSet required") }
    for id in zoneSetIds {
        let prefix = "zoneSet '\(id)': "
        let layers = m.zoneSets[id]!.layers
        if layers.isEmpty { e.append("\(prefix)at least one layer required") }
        var prevTop = -Double.infinity
        for (li, layer) in layers.enumerated() {
            let lp = "\(prefix)layer \(li + 1): "
            if !(layer.topVelocity > 0 && layer.topVelocity <= 1) {
                e.append("\(lp)topVelocity \(layer.topVelocity) outside (0, 1]")
            }
            if layer.topVelocity <= prevTop {
                e.append("\(lp)topVelocity \(layer.topVelocity) not strictly ascending")
            }
            prevTop = layer.topVelocity
            if layer.zones.isEmpty { e.append("\(lp)at least one zone required") }
            for (zi, z) in layer.zones.enumerated() {
                let zp = "\(lp)zone \(zi + 1): "
                if !(z.rootMidi >= 0 && z.rootMidi <= 127) {
                    e.append("\(zp)rootMidi \(z.rootMidi) outside [0, 127]")
                }
                if z.file.isEmpty { e.append("\(zp)file must be non-empty") }
                if !(z.gain > 0) { e.append("\(zp)gain \(z.gain) must be > 0") }
                let hasStart = z.loopStart != nil
                let hasEnd = z.loopEnd != nil
                if hasStart != hasEnd {
                    e.append("\(zp)loopStart/loopEnd must both be set or both omitted")
                }
                if hasStart, hasEnd, !(z.loopStart! >= 0 && z.loopStart! < z.loopEnd!) {
                    e.append("\(zp)loop \(z.loopStart!)..\(z.loopEnd!) invalid")
                }
            }
        }
    }
    return e
}
