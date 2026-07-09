import Foundation

/// Hands UI-thread engine commands to the audio render thread. Each command
/// receives the render-clock time at which it executes — the start of the
/// next render quantum, equivalent to the web alloy-audio twin passing
/// ctx.currentTime.
/// @unchecked Sendable: every access to `pending` is guarded by `lock` (NSLock).
final class ChannelCommandQueue: @unchecked Sendable {
    private var pending: [(Double) -> Void] = []
    private let lock = NSLock()

    func enqueue(_ command: @escaping (Double) -> Void) {
        lock.withLock { pending.append(command) }
    }

    func drain(now: Double) {
        var commands: [(Double) -> Void] = []
        lock.withLock {
            commands = pending
            pending.removeAll(keepingCapacity: true)
        }
        for command in commands {
            command(now)
        }
    }
}
