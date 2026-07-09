/// Note/sustain state machine. Mirrored twin of the web alloy-audio
/// `engine-core.ts` (the canonical form of this shape).

/// One sounding note, owned by the engine's per-note voice map.
public protocol ActiveVoiceHandle {
    /// Begin the key-up release; the voice tears itself down when silent.
    func release(at when: Double)
    /// Hard stop (allNotesOff): fast fade, then teardown.
    func stop(at when: Double)
}

/// Tone-production strategy for one instrument.
public protocol VoicePlayer {
    func start(midi: Int, velocity: Double, at when: Double) -> ActiveVoiceHandle
}

/// The playing surface the UI talks to. Mirrors the web SynthEngine.
public protocol SynthEngine: AnyObject {
    func noteOn(midi: Int, velocity: Double)
    func noteOff(midi: Int)
    func setSustain(_ on: Bool)
    func setInstrument(_ id: String)
    func allNotesOff()
}

public extension SynthEngine {
    func noteOn(midi: Int) { noteOn(midi: midi, velocity: 1) }
}

/// The polyphony + sustain-pedal state machine, decoupled from tone
/// production via VoicePlayer. Main-thread-only by design; the platform
/// adapter owns cross-thread hand-off.
public final class SynthEngineCore: SynthEngine {
    private struct VoiceRecord {
        var active: ActiveVoiceHandle
        var heldByKey: Bool // key is still physically down
        var heldByPedal: Bool // sustain pedal latched it
    }

    private var voices: [Int: VoiceRecord] = [:]
    private var sustain = false
    // Nil until the wrapper (or the app) calls setInstrument with its default
    // id — same contract as the web twin: noteOn is a no-op with no player.
    private var player: VoicePlayer?
    private let playerFor: (String) -> VoicePlayer
    private let now: () -> Double

    public init(
        playerFor: @escaping (String) -> VoicePlayer,
        now: @escaping () -> Double,
    ) {
        self.playerFor = playerFor
        self.now = now
    }

    public func noteOn(midi: Int, velocity: Double) {
        guard let player else { return }
        if voices[midi] != nil {
            // Already sounding; the envelope is intentionally not re-struck.
            // Re-assert the physical hold and clear any pedal latch so a later
            // pedal-up does not release a key that is still physically down.
            voices[midi]?.heldByKey = true
            voices[midi]?.heldByPedal = false
            return
        }
        let active = player.start(midi: midi, velocity: velocity, at: now())
        voices[midi] = VoiceRecord(active: active, heldByKey: true, heldByPedal: false)
    }

    public func noteOff(midi: Int) {
        guard var voice = voices[midi] else { return }
        voice.heldByKey = false
        if sustain {
            voice.heldByPedal = true
            voices[midi] = voice
            return
        }
        release(midi: midi, voice: voice)
    }

    public func setSustain(_ on: Bool) {
        sustain = on
        guard !on else { return }
        for (midi, voice) in voices where voice.heldByPedal && !voice.heldByKey {
            release(midi: midi, voice: voice)
        }
    }

    public func setInstrument(_ id: String) {
        player = playerFor(id)
    }

    public func allNotesOff() {
        let when = now()
        for voice in voices.values {
            voice.active.stop(at: when)
        }
        voices.removeAll()
    }

    private func release(midi: Int, voice: VoiceRecord) {
        voice.active.release(at: now())
        voices.removeValue(forKey: midi)
    }
}
