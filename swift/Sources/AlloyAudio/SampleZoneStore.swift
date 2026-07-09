import Foundation

/// '060.mp3' — sample assets are named by zero-padded MIDI number. The
/// naming convention is the sample contract shared with the web alloy-audio
/// twin (`sample-loader.ts`); the assets themselves stay app-side.
public func sampleFileName(midi: Int) -> String {
    String(format: "%03d.mp3", midi)
}

/// One decoded sample zone: a mono buffer and the rate it was recorded at.
public struct SampleZone {
    public let midi: Int
    public let samples: [Float]
    public let sampleRate: Double

    public init(midi: Int, samples: [Float], sampleRate: Double) {
        self.midi = midi
        self.samples = samples
        self.sampleRate = sampleRate
    }
}

/// The pure half of the web SampleLoader: zones keyed by MIDI, nearest-zone
/// lookup with the web's tie-break (equidistant prefers the LOWER zone).
/// Thread-safe (every member is NSLock-guarded): decode adds zones from a
/// background task while note-on reads from the UI thread.
public final class SampleZoneStore: @unchecked Sendable {
    private var zones: [Int: SampleZone] = [:]
    private let lock = NSLock()

    public init() {}

    public func add(_ zone: SampleZone) {
        lock.withLock { zones[zone.midi] = zone }
    }

    public var loadedCount: Int {
        lock.withLock { zones.count }
    }

    public func nearestLoaded(to midi: Int) -> SampleZone? {
        lock.withLock {
            var best: Int?
            for zone in zones.keys {
                if let current = best {
                    let zoneDistance = abs(zone - midi)
                    let bestDistance = abs(current - midi)
                    if zoneDistance < bestDistance || (zoneDistance == bestDistance && zone < current) {
                        best = zone
                    }
                } else {
                    best = zone
                }
            }
            return best.flatMap { zones[$0] }
        }
    }
}
