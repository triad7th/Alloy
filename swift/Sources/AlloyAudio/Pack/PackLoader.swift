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
        // Swift Dictionary iteration order is unspecified; sort keys so the
        // progressive-load order (which zone set publishes first) is
        // deterministic and stable across runs. Twin: pack-loader.ts sorts
        // Object.keys(manifest.zoneSets) for the same reason.
        for zoneSetId in manifest.zoneSets.keys.sorted() {
            guard let spec = manifest.zoneSets[zoneSetId] else { continue }
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

/// Fold gain into the PCM and tuneCents into a fractional root; produce the
/// runtime SampleZoneData without touching SampleZoneGenerator.
public func buildZone(_ spec: ZoneSpec, sampleRate: Double, pcm: [Float]) -> SampleZoneData {
    var data = [Float](repeating: 0, count: pcm.count)
    for i in 0..<pcm.count {
        data[i] = Float(Double(pcm[i]) * spec.gain)
    }
    let hasLoop = spec.loopStart != nil && spec.loopEnd != nil
    return SampleZoneData(
        rootMidi: Double(spec.rootMidi) + spec.tuneCents / 100,
        sampleRate: sampleRate,
        data: data,
        loopStart: hasLoop ? spec.loopStart : nil,
        loopEnd: hasLoop ? spec.loopEnd : nil,
    )
}
