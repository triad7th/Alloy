@testable import AlloyAudio
import XCTest

final class PitchTests: XCTestCase {
    func test_a4Is440Hz() {
        XCTAssertEqual(Pitch.frequency(midi: 69), 440, accuracy: 0.0001)
    }

    func test_octaveAboveDoubles() {
        XCTAssertEqual(Pitch.frequency(midi: 81), 880, accuracy: 0.0001)
    }

    func test_middleCNaming() {
        XCTAssertEqual(Pitch.noteName(midi: 60), "C4")
        XCTAssertEqual(Pitch.noteName(midi: 61), "C#4")
        XCTAssertEqual(Pitch.noteName(midi: 21), "A0")
        XCTAssertEqual(Pitch.noteName(midi: 108), "C8")
    }

    func test_blackKeyPitchClasses() {
        // Pitch classes 1, 3, 6, 8, 10 (C#, D#, F#, G#, A#) are black.
        let blacksInOctave = (60...71).filter { Pitch.isBlackKey(midi: $0) }
        XCTAssertEqual(blacksInOctave, [61, 63, 66, 68, 70])
    }
}
