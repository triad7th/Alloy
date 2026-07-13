import Foundation

/// Progressive pack loader: fetch + decode a pack into SampleZoneData, and BE
/// a stateful ZoneSetProvider (nil until a zone set finishes decoding). The
/// engine's existing nil-handling (Voice.swift: unresolvable zoneSetId =>
/// layer inactive) turns this into progressive delivery + synth fallback for
/// free. Twin of web src/pack/pack-loader.ts (canonical).
///
/// Thread-safe (lock-guarded, mirrors SampleZoneStore): `load()` publishes
/// each zone set from a background task while `provide` is read from the
/// render path.
public final class PackLoader: @unchecked Sendable {
    private let source: PackSource
    private let decoder: SampleDecoder
    private let lock = NSLock()
    private var zoneSets: [String: [VelocityLayerData]] = [:]

    public init(source: PackSource, decoder: SampleDecoder) {
        self.source = source
        self.decoder = decoder
    }

    /// Fetch the manifest, then fetch + decode each zone set; publish each
    /// zone set as it completes (progressive).
    public func load() async throws {
        let manifest = try await source.fetchManifest()
        for (zoneSetId, spec) in manifest.zoneSets {
            var layers: [VelocityLayerData] = []
            for layer in spec.layers {
                var zones: [SampleZoneData] = []
                for z in layer.zones {
                    let bytes = try await source.fetchZone(z.file)
                    let pcm = try await decoder.decode(bytes)
                    zones.append(buildZone(z, sampleRate: pcm.sampleRate, pcm: pcm.data))
                }
                layers.append(VelocityLayerData(topVelocity: layer.topVelocity, zones: zones))
            }
            lock.withLock { zoneSets[zoneSetId] = layers }
        }
    }

    /// ZoneSetProvider: nil until the zone set has decoded, then its layers.
    public func provide(_ zoneSetId: String) -> [VelocityLayerData]? {
        lock.withLock { zoneSets[zoneSetId] }
    }
}

/// Fold gain into the PCM and tuneCents into the effective root; produce the
/// runtime SampleZoneData without touching SampleZoneGenerator.
///
/// **Sanctioned asymmetry** (see docs/mirroring.md): the TS twin folds
/// tuneCents into a *fractional* `rootMidi` (`rootMidi + tuneCents / 100`) —
/// `SampleZoneData.rootMidi` there is a plain `number`. Swift's
/// `SampleZoneData.rootMidi` is `Int` (it predates this task and is in the
/// HARD CONSTRAINT no-touch list along with `SampleZoneGenerator`, so it
/// cannot be widened here), so Swift rounds the folded root to the nearest
/// MIDI note instead of carrying the sub-semitone remainder. Fine tuning is
/// deferred to 3b (by-ear pack tuning) regardless; today's generated packs
/// use tuneCents 0, so this rounding is inert until real assets land.
public func buildZone(_ spec: ZoneSpec, sampleRate: Double, pcm: [Float]) -> SampleZoneData {
    var data = [Float](repeating: 0, count: pcm.count)
    let gain = Float(spec.gain)
    for i in 0..<pcm.count {
        data[i] = pcm[i] * gain
    }
    let foldedRoot = Double(spec.rootMidi) + spec.tuneCents / 100
    return SampleZoneData(
        rootMidi: Int(foldedRoot.rounded()),
        sampleRate: sampleRate,
        data: data,
        loopStart: spec.loopStart,
        loopEnd: spec.loopEnd,
    )
}
