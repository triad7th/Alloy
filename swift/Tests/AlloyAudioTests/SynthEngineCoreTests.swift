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

    func test_duplicateNoteOnWhilePhysicallyHeldDoesNotRestrikeUnderSustain() {
        let engine = makeEngine()
        engine.setSustain(true)
        engine.noteOn(midi: 60)
        engine.noteOn(midi: 60)
        XCTAssertEqual(players[alpha]?.started.count, 1)
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

    func test_repressedKeySurvivesPedalUp() throws {
        let engine = makeEngine()
        engine.setSustain(true)
        engine.noteOn(midi: 60)
        engine.noteOff(midi: 60) // heldByPedal
        clock = 1
        engine.noteOn(midi: 60) // a fresh physical strike
        let handles = try XCTUnwrap(players[alpha]?.handles)
        XCTAssertEqual(handles.count, 2)
        guard handles.count == 2 else { return }
        XCTAssertEqual(handles[0].releasedAt, 1)
        clock = 2
        engine.setSustain(false)
        XCTAssertNil(handles[1].releasedAt)
        clock = 3
        engine.noteOff(midi: 60)
        XCTAssertEqual(handles[1].releasedAt, 3)
    }

    func test_restrikesPedalHeldNotesWithFreshVelocityWithoutReleasingOtherChordNotes() throws {
        let engine = makeEngine()
        engine.setSustain(true)
        engine.noteOn(midi: 64, velocity: 0.5)
        engine.noteOff(midi: 64)
        engine.noteOn(midi: 60, velocity: 0.4)
        engine.noteOff(midi: 60)
        clock = 1
        engine.noteOn(midi: 60, velocity: 0.8)
        engine.noteOff(midi: 60)
        clock = 2
        engine.noteOn(midi: 60, velocity: 0.6)
        engine.noteOff(midi: 60)
        let player = try XCTUnwrap(players[alpha])
        XCTAssertEqual(player.started.map(\.midi), [64, 60, 60, 60])
        XCTAssertEqual(player.started.map(\.velocity), [0.5, 0.4, 0.8, 0.6])
        XCTAssertEqual(player.started.map(\.when), [0, 0, 1, 2])
        XCTAssertEqual(player.handles.map(\.releasedAt), [nil, 1, 2, nil])
        XCTAssertEqual(player.handles.map(\.stoppedAt), [nil, nil, nil, nil])
        clock = 3
        engine.setSustain(false)
        XCTAssertEqual(player.handles.map(\.releasedAt), [3, 1, 2, 3])
    }

    func test_pressAndReleaseWithoutSustainStillRestrikesNormally() throws {
        let engine = makeEngine()
        engine.noteOn(midi: 60)
        clock = 1
        engine.noteOff(midi: 60)
        engine.noteOn(midi: 60)
        let handles = try XCTUnwrap(players[alpha]?.handles)
        XCTAssertEqual(handles.count, 2)
        guard handles.count == 2 else { return }
        XCTAssertEqual(handles[0].releasedAt, 1)
        XCTAssertNil(handles[1].releasedAt)
    }

    func test_retainsOriginalPlayerForPedalOwnedPitchInSharedEngine() {
        let core = makeEngine()
        let router = InstrumentSynthEngine(engines: [alpha: core, beta: core], defaultInstrumentId: alpha)
        router.setSustain(true)
        router.noteOn(midi: 60)
        router.noteOff(midi: 60)
        router.setInstrument(beta)
        router.noteOn(midi: 64)
        router.noteOff(midi: 64)
        router.noteOn(midi: 60, velocity: 0.8)
        XCTAssertEqual(players[alpha]?.started.map(\.midi), [60, 60])
        XCTAssertEqual(players[beta]?.started.map(\.midi), [64])
        router.setSustain(false)
        router.noteOff(midi: 60)
        router.noteOn(midi: 60) // Ownership ended: use the selected instrument.
        XCTAssertEqual(players[beta]?.started.map(\.midi), [64, 60])
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
