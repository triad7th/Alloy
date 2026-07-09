import AVFoundation

/// Feeds decoded sample zones into a SampleZoneStore. Platform edge of the
/// web alloy-audio twin's SampleLoader (fetch + decodeAudioData).
public protocol SampleSource {
    /// Kick off asynchronous loading; each zone becomes playable the moment
    /// it lands in the store. Idempotent per source instance.
    func startLoading(midis: [Int], into store: SampleZoneStore)
}

/// Decodes sample mp3s from an injectable bundle off the main thread. Alloy
/// ships no sample assets — apps (and the preview harnesses) bundle their
/// own and point this source at them. A zone that fails to decode is
/// skipped silently — playback uses the nearest zone that did load, or the
/// synth fallback (web parity).
/// @unchecked Sendable: `started` is lock-guarded; Bundle reads are
/// thread-safe.
public final class BundleSampleSource: SampleSource, @unchecked Sendable {
    private let bundle: Bundle
    private let subdirectory: String
    private let lock = NSLock()
    private var started = false

    /// - Parameters:
    ///   - bundle: where the samples live (the app's main bundle by default;
    ///     tests and harnesses inject their own).
    ///   - subdirectory: bundle-relative sample directory; empty means the
    ///     bundle's resource root.
    public init(bundle: Bundle = .main, subdirectory: String = "") {
        self.bundle = bundle
        self.subdirectory = subdirectory
    }

    /// URL of a bundled sample, honoring the injected bundle/subdirectory.
    public func sampleURL(midi: Int) -> URL? {
        bundle.url(
            forResource: sampleFileName(midi: midi), withExtension: nil,
            subdirectory: subdirectory.isEmpty ? nil : subdirectory,
        )
    }

    public func startLoading(midis: [Int], into store: SampleZoneStore) {
        let isFirstCall = lock.withLock {
            if started { return false }
            started = true
            return true
        }
        guard isFirstCall else { return }
        Task.detached(priority: .utility) { [self] in
            for midi in midis {
                guard
                    let url = sampleURL(midi: midi),
                    let zone = Self.decode(url: url, midi: midi)
                else { continue } // skip this zone (web parity)
                store.add(zone)
            }
        }
    }

    /// AVAudioFile -> mono Float32 SampleZone (channels averaged).
    private static func decode(url: URL, midi: Int) -> SampleZone? {
        guard
            let file = try? AVAudioFile(forReading: url),
            let buffer = AVAudioPCMBuffer(
                pcmFormat: file.processingFormat,
                frameCapacity: AVAudioFrameCount(file.length),
            ),
            (try? file.read(into: buffer)) != nil,
            let channels = buffer.floatChannelData
        else { return nil }

        let frames = Int(buffer.frameLength)
        let channelCount = Int(buffer.format.channelCount)
        guard frames > 0, channelCount > 0 else { return nil }

        var mono = [Float](repeating: 0, count: frames)
        for channel in 0..<channelCount {
            let data = channels[channel]
            for frame in 0..<frames {
                mono[frame] += data[frame]
            }
        }
        if channelCount > 1 {
            let scale = 1 / Float(channelCount)
            for frame in 0..<frames {
                mono[frame] *= scale
            }
        }
        return SampleZone(midi: midi, samples: mono, sampleRate: file.processingFormat.sampleRate)
    }
}
