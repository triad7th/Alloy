@testable import AlloyAudio
import XCTest

/// Renders a constant level for a fixed number of render calls, then ends.
private final class FakeVoice: Voice {
    let level: Float
    var callsLeft: Int
    init(level: Float, calls: Int) {
        self.level = level
        callsLeft = calls
    }

    func start(at _: Double) {}
    func render(into output: inout [Float], frames: Int) -> Bool {
        for i in 0..<frames { output[i] += level }
        callsLeft -= 1
        return callsLeft > 0
    }

    func release(at _: Double) {}
    func stop(at _: Double) {}
}

final class VoiceMixerTests: XCTestCase {
    func test_zeroFillsBufferWhenEmpty() {
        let mixer = VoiceMixer()
        var buffer = [Float](repeating: 9, count: 4)
        mixer.render(into: &buffer, frames: 4)
        XCTAssertEqual(buffer, [0, 0, 0, 0])
    }

    func test_sumsActiveVoices() {
        let mixer = VoiceMixer()
        mixer.add(FakeVoice(level: 0.25, calls: 10))
        mixer.add(FakeVoice(level: 0.5, calls: 10))
        var buffer = [Float](repeating: 0, count: 4)
        mixer.render(into: &buffer, frames: 4)
        XCTAssertEqual(buffer, [0.75, 0.75, 0.75, 0.75])
        XCTAssertEqual(mixer.activeCount, 2)
    }

    func test_dropsEndedVoices() {
        let mixer = VoiceMixer()
        mixer.add(FakeVoice(level: 0.25, calls: 1)) // ends after first render
        mixer.add(FakeVoice(level: 0.5, calls: 10))
        var buffer = [Float](repeating: 0, count: 4)
        mixer.render(into: &buffer, frames: 4)
        XCTAssertEqual(mixer.activeCount, 1)
        mixer.render(into: &buffer, frames: 4)
        XCTAssertEqual(buffer, [0.5, 0.5, 0.5, 0.5])
    }
}
