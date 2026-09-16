/// Immediate note-command subset shared by patch hosts.
public protocol PatchSynthHost: AnyObject {
    func noteOn(midi: Int, velocity: Double)
    func noteOff(midi: Int)
    func allNotesOff()
}

/// Adds physical-key and pedal tracking to one patch host. Main-thread-only.
public final class PatchSynthEngine: SynthEngine {
    private let host: any PatchSynthHost
    private let defaultVelocity: Double
    private let core: SynthEngineCore

    public init(host: any PatchSynthHost, defaultVelocity: Double = 1) {
        self.host = host
        self.defaultVelocity = defaultVelocity
        let player = HostPlayer(host: host)
        core = SynthEngineCore(playerFor: { _ in player }, now: { 0 })
        core.setInstrument("patch")
    }

    public func noteOn(midi: Int) {
        noteOn(midi: midi, velocity: defaultVelocity)
    }

    public func noteOn(midi: Int, velocity: Double) {
        core.noteOn(midi: midi, velocity: velocity)
    }

    public func noteOff(midi: Int) {
        core.noteOff(midi: midi)
    }

    public func setSustain(_ on: Bool) {
        core.setSustain(on)
    }

    public func setInstrument(_: String) {}
    public func allNotesOff() {
        core.allNotesOff(); host.allNotesOff()
    }

    private final class HostPlayer: VoicePlayer {
        let host: any PatchSynthHost
        init(host: any PatchSynthHost) {
            self.host = host
        }

        func start(midi: Int, velocity: Double, at _: Double) -> any ActiveVoiceHandle {
            host.noteOn(midi: midi, velocity: velocity)
            return Handle(host: host, midi: midi)
        }
    }

    private final class Handle: ActiveVoiceHandle {
        let host: any PatchSynthHost
        let midi: Int
        init(host: any PatchSynthHost, midi: Int) {
            self.host = host; self.midi = midi
        }

        func release(at _: Double) {
            host.noteOff(midi: midi)
        }

        /// Panic is one host-wide command, including tails no longer in the core.
        func stop(at _: Double) {}
    }
}
