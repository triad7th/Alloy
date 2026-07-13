import Foundation

/// Mono PCM decoded from one .m4a. Twin of web `DecodedPcm` (pack-source.ts).
public struct DecodedPcm {
    public let sampleRate: Double
    public let data: [Float]

    public init(sampleRate: Double, data: [Float]) {
        self.sampleRate = sampleRate
        self.data = data
    }
}

/// Decodes encoded (.m4a) bytes to mono PCM. Host-injected. Twin of web
/// `SampleDecoder` (pack-source.ts).
/// `AVAudioFileDecoder` is the production implementation; tests may inject a fake.
public protocol SampleDecoder {
    func decode(_ bytes: Data) async throws -> DecodedPcm
}
