import Foundation

/// Sample playback with zones, velocity layers, loops, and Catmull-Rom
/// interpolation. Twin of web src/dsp/sample-zone-generator.ts (canonical).
public struct SampleZoneData {
    public let rootMidi: Double
    public let sampleRate: Double
    public let data: [Float]
    public let loopStart: Int?
    public let loopEnd: Int?

    public init(rootMidi: Double, sampleRate: Double, data: [Float], loopStart: Int? = nil, loopEnd: Int? = nil) {
        self.rootMidi = rootMidi
        self.sampleRate = sampleRate
        self.data = data
        self.loopStart = loopStart
        self.loopEnd = loopEnd
    }
}

public struct VelocityLayerData {
    public let topVelocity: Double
    public let zones: [SampleZoneData]

    public init(topVelocity: Double, zones: [SampleZoneData]) {
        self.topVelocity = topVelocity
        self.zones = zones
    }
}

public final class SampleZoneGenerator: ToneGenerator {
    private struct ZoneRead {
        let zone: SampleZoneData
        let gain: Double
        var pos: Double
        let baseRate: Double
        var ended: Bool
    }

    private let layers: [VelocityLayerData]
    private let crossfade: Double
    private let sampleRate: Double
    private var reads: [ZoneRead] = []
    private var pitchRatio = 1.0

    public init(layers: [VelocityLayerData], crossfade: Double, sampleRate: Double) {
        self.layers = layers
        self.crossfade = crossfade
        self.sampleRate = sampleRate
    }

    public var finished: Bool {
        !reads.isEmpty && reads.allSatisfy(\.ended)
    }

    public func noteOn(midi: Int, velocity: Double) {
        pitchRatio = 1
        reads = pickLayers(velocity: velocity).map { layer, gain in
            let zone = Self.nearestZone(layer.zones, midi: midi)
            return ZoneRead(
                zone: zone,
                gain: gain * velocity,
                pos: 0,
                baseRate: Pitch.frequency(midi: midi) / Pitch.frequency(midi: zone.rootMidi)
                    * (zone.sampleRate / sampleRate),
                ended: false,
            )
        }
    }

    public func noteOff() {
        // Intentionally empty: unlooped content rings out; the TVA owns key-up.
    }

    public func setPitchRatio(_ ratio: Double) {
        pitchRatio = ratio
    }

    public func render(into out: inout [Float], frames: Int) {
        for r in reads.indices {
            if reads[r].ended { continue }
            let zone = reads[r].zone
            let loop = zone.loopStart != nil && zone.loopEnd != nil && zone.loopEnd! > zone.loopStart!
            for n in 0..<frames {
                if loop {
                    let loopStart = zone.loopStart!
                    let loopEnd = zone.loopEnd!
                    while reads[r].pos >= Double(loopEnd) {
                        reads[r].pos -= Double(loopEnd - loopStart)
                    }
                } else if reads[r].pos >= Double(zone.data.count) {
                    reads[r].ended = true
                    break
                }
                out[n] += Float(Self.cubicRead(zone, pos: reads[r].pos, loop: loop) * reads[r].gain)
                reads[r].pos += reads[r].baseRate * pitchRatio
            }
        }
    }

    /// One or two layers with linear crossfade gains summing to 1. The
    /// crossfade window straddles each boundary symmetrically: a velocity
    /// within crossfade/2 of a boundary blends the layers on either side
    /// (exactly on the boundary -> 50/50). Both directions must be checked
    /// because firstIndex lands an on-boundary velocity in the LOWER layer.
    private func pickLayers(velocity: Double) -> [(VelocityLayerData, Double)] {
        let primary = layers.firstIndex { $0.topVelocity >= velocity } ?? layers.count - 1
        if crossfade > 0 {
            if primary > 0 {
                let boundary = layers[primary - 1].topVelocity
                let distance = velocity - boundary
                if distance >= 0, distance < crossfade / 2 {
                    let upperGain = 0.5 + distance / crossfade
                    return [(layers[primary], upperGain), (layers[primary - 1], 1 - upperGain)]
                }
            }
            if primary < layers.count - 1 {
                let boundary = layers[primary].topVelocity
                let distance = boundary - velocity
                if distance >= 0, distance < crossfade / 2 {
                    let lowerGain = 0.5 + distance / crossfade
                    return [(layers[primary], lowerGain), (layers[primary + 1], 1 - lowerGain)]
                }
            }
        }
        return [(layers[primary], 1)]
    }

    /// Nearest zone by rootMidi; ties prefer the lower zone (mirrors SampleZoneStore).
    private static func nearestZone(_ zones: [SampleZoneData], midi: Int) -> SampleZoneData {
        var best = zones[0]
        for zone in zones {
            let d = abs(zone.rootMidi - Double(midi))
            let bestD = abs(best.rootMidi - Double(midi))
            if d < bestD || (d == bestD && zone.rootMidi < best.rootMidi) {
                best = zone
            }
        }
        return best
    }

    /// Catmull-Rom 4-point read at fractional position `pos`.
    private static func cubicRead(_ zone: SampleZoneData, pos: Double, loop: Bool) -> Double {
        let i = Int(pos.rounded(.down))
        let f = pos - Double(i)
        func at(_ k: Int) -> Double {
            var idx = i + k
            if loop {
                let loopStart = zone.loopStart!
                let loopEnd = zone.loopEnd!
                while idx >= loopEnd {
                    idx -= loopEnd - loopStart
                }
            }
            guard idx >= 0, idx < zone.data.count else { return 0 }
            return Double(zone.data[idx])
        }
        let x0 = at(-1)
        let x1 = at(0)
        let x2 = at(1)
        let x3 = at(2)
        return x1 + 0.5 * f * (x2 - x0 + f * (2 * x0 - 5 * x1 + 4 * x2 - x3 + f * (3 * (x1 - x2) + x3 - x0)))
    }
}
