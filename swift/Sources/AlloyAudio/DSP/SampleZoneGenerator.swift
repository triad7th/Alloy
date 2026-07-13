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

    /// One or two layers with EQUAL-POWER (sqrt) crossfade gains, i.e.
    /// gainA^2 + gainB^2 = 1. The crossfade window straddles each boundary
    /// symmetrically: a velocity within crossfade/2 of a boundary blends the
    /// layers on either side (exactly on the boundary -> 50/50). Both
    /// directions must be checked because firstIndex lands an on-boundary
    /// velocity in the LOWER layer.
    ///
    /// Why sqrt and NOT linear gains summing to 1 (do not "simplify" this
    /// back): two velocity layers are two DIFFERENT hammer strikes, so they
    /// are essentially UNCORRELATED signals. Uncorrelated signals add in
    /// POWER, not in amplitude. With linear gains the 50/50 point sums to
    /// sqrt(0.5^2 + 0.5^2) = 0.707 -> an audible ~3 dB hole (measured -5.3 dB
    /// on the real piano pack, since the layers also differ in energy) exactly
    /// on every layer boundary: a crescendo DIPS as it crosses one. Taking the
    /// sqrt of each blend weight keeps the summed power flat at 1 across the
    /// window, and stays continuous with the no-blend case (at the window edge
    /// the gains are exactly 1 and 0).
    private func pickLayers(velocity: Double) -> [(VelocityLayerData, Double)] {
        let primary = layers.firstIndex { $0.topVelocity >= velocity } ?? layers.count - 1
        if crossfade > 0 {
            if primary > 0 {
                let boundary = layers[primary - 1].topVelocity
                let distance = velocity - boundary
                if distance >= 0, distance < crossfade / 2 {
                    let upper = 0.5 + distance / crossfade // blend position, 0.5 .. 1
                    return [(layers[primary], upper.squareRoot()), (layers[primary - 1], (1 - upper).squareRoot())]
                }
            }
            if primary < layers.count - 1 {
                let boundary = layers[primary].topVelocity
                let distance = boundary - velocity
                if distance >= 0, distance < crossfade / 2 {
                    let lower = 0.5 + distance / crossfade // blend position, 0.5 .. 1
                    return [(layers[primary], lower.squareRoot()), (layers[primary + 1], (1 - lower).squareRoot())]
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
