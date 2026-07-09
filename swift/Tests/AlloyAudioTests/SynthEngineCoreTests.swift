@testable import AlloyAudio
import XCTest

private final class FakeHandle: ActiveVoiceHandle {
    private(set) var releasedAt: Double?
    private(set) var stoppedAt: Double?
    func release(at when: Double) { releasedAt = when }
    func stop(at when: Double) { stoppedAt = when }
}

private final class FakePlayer: VoicePlayer {
    let name: String
    private(set) var started: [(midi: Int, velocity: Double, when: Double)] = []
    private(set) var handles: [FakeHandle] = []
    init(name: String) { self.name = name }

    func start(midi: Int, velocity: Double, at when: Double) -> ActiveVoiceHandle {
        started.append((midi, velocity, when))
        let handle = FakeHandle()
        handles.append(handle)
        return handle
    }
}

final class SynthEngineCoreTests: XCTestCase {
    // Instrument ids are opaque strings; the core never interprets them.
    private let alpha = "alpha"
    private let beta = "beta"

    private var players: [String: FakePlayer] = [:]
    private var playerRequests: [String] = []
    private var clock = 0.0

    private func makeEngine() -> SynthEngineCore {
        players = [alpha: FakePlayer(name: "alpha"), beta: FakePlayer(name: "beta")]
        playerRequests = []
        clock = 0
        let core = SynthEngineCore(
            playerFor: { id in
                self.playerRequests.append(id)
                return self.players[id]!
            },
            now: { self.clock },
        )
        core.setInstrument(alpha)
        return core
    }

    func test_selectingTheDefaultInstrumentBuildsItsPlayer() {
        _ = makeEngine()
        XCTAssertEqual(playerRequests, [alpha])
    }

    // Web-twin contract: with no instrument selected the core is inert.
    func test_noteOnIsANoOpBeforeAnyInstrumentIsSelected() {
        players = [alpha: FakePlayer(name: "alpha")]
        let core = SynthEngineCore(playerFor: { [self] id in players[id]! }, now: { 0 })
        core.noteOn(midi: 60, velocity: 1)
        core.noteOff(midi: 60)
        core.allNotesOff()
        XCTAssertTrue(players[alpha]!.started.isEmpty)
    }

    func test_noteOnStartsVoiceAtNowWithVelocity() {
        let engine = makeEngine()
        clock = 1.5
        engine.noteOn(midi: 60, velocity: 0.8)
        let started = players[alpha]!.started
        XCTAssertEqual(started.count, 1)
        XCTAssertEqual(started[0].midi, 60)
        XCTAssertEqual(started[0].velocity, 0.8)
        XCTAssertEqual(started[0].when, 1.5)
    }

    func test_repeatedNoteOnDoesNotRestrike() {
        let engine = makeEngine()
        engine.noteOn(midi: 60)
        engine.noteOn(midi: 60)
        XCTAssertEqual(players[alpha]!.started.count, 1)
    }

    func test_noteOffReleasesTheVoice() {
        let engine = makeEngine()
        engine.noteOn(midi: 60)
        clock = 2
        engine.noteOff(midi: 60)
        XCTAssertEqual(players[alpha]!.handles[0].releasedAt, 2)
    }

    func test_noteOffForUnknownMidiIsANoop() {
        let engine = makeEngine()
        engine.noteOff(midi: 99) // must not crash or start anything
        XCTAssertEqual(players[alpha]!.started.count, 0)
    }

    func test_sustainLatchesNoteOffUntilPedalUp() {
        let engine = makeEngine()
        engine.setSustain(true)
        engine.noteOn(midi: 60)
        engine.noteOff(midi: 60)
        let handle = players[alpha]!.handles[0]
        XCTAssertNil(handle.releasedAt) // latched, not released
        clock = 3
        engine.setSustain(false)
        XCTAssertEqual(handle.releasedAt, 3)
    }

    func test_pedalUpKeepsKeysThatAreStillPhysicallyDown() {
        let engine = makeEngine()
        engine.setSustain(true)
        engine.noteOn(midi: 60) // still held
        engine.noteOn(midi: 64)
        engine.noteOff(midi: 64) // latched by pedal
        engine.setSustain(false)
        let player = players[alpha]!
        XCTAssertNil(player.handles[0].releasedAt) // 60 survives: key down
        XCTAssertNotNil(player.handles[1].releasedAt) // 64 releases
    }

    func test_repressedKeySurvivesPedalUp() {
        // The retrigger fix: noteOff under pedal latches; a new noteOn on the
        // same key re-asserts the physical hold, so pedal-up must NOT release.
        let engine = makeEngine()
        engine.setSustain(true)
        engine.noteOn(midi: 60)
        engine.noteOff(midi: 60) // heldByPedal
        engine.noteOn(midi: 60) // re-pressed: heldByKey, pedal latch cleared
        engine.setSustain(false)
        XCTAssertNil(players[alpha]!.handles[0].releasedAt)
    }

    func test_setInstrumentRoutesNewNotesOnly() {
        let engine = makeEngine()
        engine.noteOn(midi: 60)
        engine.setInstrument(beta)
        engine.noteOn(midi: 64)
        XCTAssertEqual(players[alpha]!.started.count, 1)
        XCTAssertEqual(players[beta]!.started.count, 1)
        // The old note still releases through its own handle.
        engine.noteOff(midi: 60)
        XCTAssertNotNil(players[alpha]!.handles[0].releasedAt)
    }

    func test_allNotesOffStopsEverythingAndClearsState() {
        let engine = makeEngine()
        engine.setSustain(true)
        engine.noteOn(midi: 60)
        engine.noteOn(midi: 64)
        engine.noteOff(midi: 64) // pedal-latched
        clock = 5
        engine.allNotesOff()
        let player = players[alpha]!
        XCTAssertEqual(player.handles[0].stoppedAt, 5)
        XCTAssertEqual(player.handles[1].stoppedAt, 5)
        // Cleared: the same key can strike fresh.
        engine.noteOn(midi: 60)
        XCTAssertEqual(player.started.count, 3)
    }

    func test_noteOnDefaultVelocityIsOne() {
        let engine = makeEngine()
        engine.noteOn(midi: 60)
        XCTAssertEqual(players[alpha]!.started[0].velocity, 1)
    }
}
