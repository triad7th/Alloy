/// Constants shared with the web alloy-audio twin (`voice-player.ts`), verbatim.
public enum VoiceConstants {
    /// Master-relative peak per synth voice; keeps polyphony from clipping.
    public static let voicePeak = 0.3
    /// Fade used by Voice.stop (allNotesOff), in seconds.
    public static let fastStopSeconds = 0.03
}

/// One sounding note, owned by a VoiceMixer. `render` ADDS `frames` samples
/// into `output[0..<frames]` and returns false once the voice has fully
/// ended (the mixer then drops it). All times are absolute engine seconds.
public protocol Voice: AnyObject {
    func start(at when: Double)
    func render(into output: inout [Float], frames: Int) -> Bool
    func release(at when: Double)
    func stop(at when: Double)
}
