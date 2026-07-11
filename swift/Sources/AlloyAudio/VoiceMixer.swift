/// Owns the active voices of one instrument channel. Each render call
/// zero-fills the buffer, sums every voice into it, and drops voices that
/// report ended. Single-threaded by design: the platform adapter serializes
/// all access onto the render thread via its command queue. (The web
/// alloy-audio twin has no explicit mixer — WebAudio nodes sum natively.)
public final class VoiceMixer {
    private var voices: [MixerVoice] = []

    public init() {}

    public var activeCount: Int { voices.count }

    public func add(_ voice: MixerVoice) {
        voices.append(voice)
    }

    public func render(into output: inout [Float], frames: Int) {
        for i in 0..<frames {
            output[i] = 0
        }
        voices.removeAll { voice in
            !voice.render(into: &output, frames: frames)
        }
    }
}
