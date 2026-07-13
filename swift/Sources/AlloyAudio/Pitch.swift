import Foundation

/// MIDI pitch math. Mirrored twin of the web alloy-audio `pitch.ts`.
/// A4 = MIDI 69 = 440 Hz; middle C = C4 = 60.
public enum Pitch {
    static let noteNames = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]
    static let blackPitchClasses: Set<Int> = [1, 3, 6, 8, 10]

    public static func frequency(midi: Double) -> Double {
        440 * pow(2, (midi - 69) / 12)
    }

    public static func frequency(midi: Int) -> Double {
        frequency(midi: Double(midi))
    }

    /// "C4", "F#3" — the same sharp-only spelling set the web labels use.
    public static func noteName(midi: Int) -> String {
        let pitchClass = ((midi % 12) + 12) % 12
        let octave = Int((Double(midi) / 12).rounded(.down)) - 1
        return "\(noteNames[pitchClass])\(octave)"
    }

    public static func isBlackKey(midi: Int) -> Bool {
        blackPitchClasses.contains(((midi % 12) + 12) % 12)
    }
}
