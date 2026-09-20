@testable import AlloyAudio
import XCTest

private final class RecordingPatchHost: PatchSynthHost {
    var events: [String] = []
    func noteOn(midi: Int, velocity: Double) {
        events.append("on:\(midi):\(velocity)")
    }

    func noteOff(midi: Int) {
        events.append("off:\(midi)")
    }

    func allNotesOff() {
        events.append("panic")
    }
}

final class PatchAdapterTests: XCTestCase {
    func testDefaultAndExplicitVelocityThroughExistential() {
        let host = RecordingPatchHost()
        let router: any SynthEngine = InstrumentSynthEngine(
            engines: ["piano": PatchSynthEngine(host: host, defaultVelocity: 0.7)], defaultInstrumentId: "piano"
        )
        router.noteOn(midi: 60)
        router.noteOn(midi: 61, velocity: 0.2)
        XCTAssertEqual(host.events, ["on:60:0.7", "on:61:0.2"])
    }

    func testPedalOwnershipAcrossPromotionAndDuplicatePress() {
        let old = RecordingPatchHost(), fresh = RecordingPatchHost()
        let router = InstrumentSynthEngine(
            engines: ["piano": PatchSynthEngine(host: old, defaultVelocity: 0.7)], defaultInstrumentId: "piano"
        )
        router.setSustain(true)
        router.noteOn(midi: 60)
        router.noteOn(midi: 60)
        router.noteOff(midi: 60)
        router.replaceEngine("piano", engine: PatchSynthEngine(host: fresh, defaultVelocity: 0.7))
        router.noteOn(midi: 60)
        router.setSustain(false)
        XCTAssertEqual(old.events, ["on:60:0.7", "off:60", "on:60:0.7"])
        XCTAssertTrue(fresh.events.isEmpty)
        router.noteOff(midi: 60)
        router.noteOn(midi: 60)
        XCTAssertEqual(old.events, ["on:60:0.7", "off:60", "on:60:0.7", "off:60"])
        XCTAssertEqual(fresh.events, ["on:60:0.7"])
    }

    func testPedalAndPanicReachReplacedEngineAndClearOwnership() {
        let old = RecordingPatchHost(), fresh = RecordingPatchHost()
        let router = InstrumentSynthEngine(
            engines: ["piano": PatchSynthEngine(host: old, defaultVelocity: 0.7)], defaultInstrumentId: "piano"
        )
        router.setSustain(true)
        router.noteOn(midi: 60)
        router.noteOff(midi: 60)
        router.replaceEngine("piano", engine: PatchSynthEngine(host: fresh, defaultVelocity: 0.7))
        router.noteOn(midi: 61)
        router.noteOff(midi: 61)
        router.setSustain(false)
        XCTAssertEqual(old.events, ["on:60:0.7", "off:60"])
        XCTAssertEqual(fresh.events, ["on:61:0.7", "off:61"])
        router.allNotesOff()
        router.noteOn(midi: 60)
        XCTAssertEqual(old.events.last, "panic")
        XCTAssertEqual(fresh.events, ["on:61:0.7", "off:61", "panic", "on:60:0.7"])
    }

    func testSharedEngineSelectionAndUnknownSelection() {
        let shared = RecordingSynth()
        let router = InstrumentSynthEngine(engines: ["a": shared, "b": shared], defaultInstrumentId: "a")
        router.noteOn(midi: 60)
        router.setInstrument("b")
        router.noteOn(midi: 61)
        router.setInstrument("unknown")
        router.noteOn(midi: 62)
        router.noteOff(midi: 60)
        XCTAssertEqual(shared.events, ["a", "on:60", "b", "on:61", "b", "on:62", "off:60"])
    }

    func testPanicClearsReleasedTails() {
        let host = RecordingPatchHost()
        let synth = PatchSynthEngine(host: host, defaultVelocity: 0.7)
        synth.noteOn(midi: 60)
        synth.noteOff(midi: 60)
        synth.allNotesOff()
        XCTAssertEqual(host.events, ["on:60:0.7", "off:60", "panic"])
    }
}

private final class RecordingSynth: SynthEngine {
    var events: [String] = []
    func noteOn(midi: Int, velocity _: Double) {
        events.append("on:\(midi)")
    }

    func noteOff(midi: Int) {
        events.append("off:\(midi)")
    }

    func setSustain(_: Bool) {}
    func setInstrument(_ id: String) {
        events.append(id)
    }

    func allNotesOff() {}
}
