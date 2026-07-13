#if canImport(AVFoundation)
import AVFoundation
import Foundation

/// `SampleDecoder` backed by AVFoundation: encoded (.m4a) bytes -> mono Float
/// PCM. Platform edge — host I/O, never reached from the DSP core, mirroring
/// the decode path `BundleSampleSource` already uses for bundled samples.
/// Twin of web `WebAudioDecoder` (pack-source.ts): same contract, so any
/// channel count is averaged to mono and the file's own sample rate is reported.
///
/// `AVAudioFile` reads from a URL rather than from memory, so the bytes are
/// staged in a uniquely-named temporary file and removed afterwards.
public struct AVAudioFileDecoder: SampleDecoder {
    public init() {}

    public func decode(_ bytes: Data) async throws -> DecodedPcm {
        let url = FileManager.default.temporaryDirectory
            .appendingPathComponent("alloy-pack-\(UUID().uuidString).m4a")
        try bytes.write(to: url)
        defer { try? FileManager.default.removeItem(at: url) }

        let file = try AVAudioFile(forReading: url)
        let format = file.processingFormat
        guard
            let buffer = AVAudioPCMBuffer(
                pcmFormat: format, frameCapacity: AVAudioFrameCount(file.length),
            )
        else { throw SampleDecoderError.decodeFailed }
        try file.read(into: buffer)
        guard let channels = buffer.floatChannelData else { throw SampleDecoderError.decodeFailed }

        let frames = Int(buffer.frameLength)
        let channelCount = Int(format.channelCount)
        guard frames > 0, channelCount > 0 else { throw SampleDecoderError.decodeFailed }

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
        return DecodedPcm(sampleRate: format.sampleRate, data: mono)
    }
}

public enum SampleDecoderError: Error, Equatable {
    case decodeFailed
}
#endif
