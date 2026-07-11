import Foundation

/// Commands crossing main → render thread for the rompler PatchEngineHost.
/// Frames are ABSOLUTE ENGINE frames (the host transport, the
/// PatchEngineHost.renderedFrames timebase); 0 or any past frame fires at the
/// next block start. The web twin's WorkletInMessage carries absolute CONTEXT
/// frames instead — see docs/mirroring.md for the asymmetry ledger.
public enum PatchCommand {
    case setPatch(Patch)
    case setZoneSet(String, [VelocityLayerData])
    case noteOn(midi: Int, velocity: Double, atFrame: Int)
    case noteOff(midi: Int, atFrame: Int)
    case allNotesOff(atFrame: Int)
}

/// Hands PatchCommands from any thread to the audio render thread — the
/// rompler analog of ChannelCommandQueue. Drains are bounded by the caller;
/// leftovers stay queued in FIFO order for the next render.
/// @unchecked Sendable: every access to `pending` is guarded by `lock` (NSLock).
public final class PatchCommandQueue: @unchecked Sendable {
    private var pending: [PatchCommand] = []
    private let lock = NSLock()

    public init() {}

    public func push(_ command: PatchCommand) {
        lock.withLock { pending.append(command) }
    }

    /// Removes and returns up to `max` commands, FIFO.
    public func drain(max: Int) -> [PatchCommand] {
        lock.withLock {
            let count = Swift.max(0, Swift.min(max, pending.count))
            let drained = Array(pending.prefix(count))
            pending.removeFirst(count)
            return drained
        }
    }
}
