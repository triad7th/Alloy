import AVFoundation

/// Real-time host for the rompler PatchEngine — the AVFoundation platform
/// edge paired with the web twin's WorkletHostCore + worklet shell (semantic
/// twins, not literal; see docs/mirroring.md). All host logic lives in
/// render(into:frames:), which unit tests drive directly; makeSourceNode()
/// is the thin, logic-free AVAudioSourceNode shell around it.
///
/// Command frames are ABSOLUTE ENGINE frames (the renderedFrames timebase);
/// the engine treats past frames as due at the next block start. Commands
/// drain at the start of each render — bounded per block, leftovers carry in
/// order — matching the web core's apply-at-render-start semantics.
///
/// @unchecked Sendable: the command API is thread-safe via the locked
/// PatchCommandQueue; engine, zone sets, and the scratch buffers are touched
/// only inside render(into:frames:) (the render thread), and renderedFrames
/// is written there and read-only elsewhere — the AVSynthEngine.Channel
/// pattern.
public final class PatchEngineHost: @unchecked Sendable {
    /// Per-render drain bound; leftovers stay queued in order across renders
    /// (the web twin's MAX_COMMANDS_PER_BLOCK).
    public static let maxCommandsPerBlock = 512

    /// Largest single engine.process call; render(into:frames:) slices
    /// larger requests through the preallocated scratch.
    private static let maxSliceFrames = 4096

    /// Zone sets owned by the render thread: written only while applying
    /// drained commands and read only by the engine's zoneSetProvider (both
    /// inside render), so no locking — a reference-type box because the
    /// provider closure must outlive init without capturing self.
    private final class ZoneSetStore {
        var sets: [String: [VelocityLayerData]] = [:]
    }

    private let queue = PatchCommandQueue()
    private let engine: PatchEngine
    private let zoneSets: ZoneSetStore
    /// Per-slice mix buffer: zeroed, engine ADDS into it, added into out.
    private var scratch = [Float](repeating: 0, count: maxSliceFrames)
    /// makeSourceNode's mono block buffer (grown if the hardware asks for more).
    private var nodeScratch = [Float](repeating: 0, count: maxSliceFrames)
    private var renderedFrameCount = 0

    /// Rejected patches (validatePatch errors) surface here, invoked on the
    /// render thread during the drain; nil drops them silently.
    public var onPatchRejected: (([String]) -> Void)?

    public init(sampleRate: Double, maxVoices: Int = 64) {
        let store = ZoneSetStore()
        zoneSets = store
        engine = PatchEngine(sampleRate: sampleRate, maxVoices: maxVoices) { store.sets[$0] }
    }

    /// Transport: frames rendered so far (written after each render
    /// callback; read-only elsewhere).
    public var renderedFrames: Int { renderedFrameCount }

    /// Live engine pool entries (sounding + releasing, before reap).
    public var activeVoiceCount: Int { engine.activeVoiceCount }

    // MARK: - Command API (any thread; applied at the next render's start)

    public func setPatch(_ patch: Patch) {
        queue.push(.setPatch(patch))
    }

    public func setZoneSet(_ id: String, _ layers: [VelocityLayerData]) {
        queue.push(.setZoneSet(id, layers))
    }

    /// atFrame 0 (or any past frame) = immediate at the next block start.
    public func noteOn(midi: Int, velocity: Double, atFrame: Int = 0) {
        queue.push(.noteOn(midi: midi, velocity: velocity, atFrame: atFrame))
    }

    public func noteOff(midi: Int, atFrame: Int = 0) {
        queue.push(.noteOff(midi: midi, atFrame: atFrame))
    }

    public func allNotesOff() {
        queue.push(.allNotesOff(atFrame: 0))
    }

    // MARK: - Render (audio thread)

    /// The testable render body: drain ≤ maxCommandsPerBlock commands (all
    /// applied at the block start, web-core semantics), slice frames into
    /// ≤4096-frame engine.process calls through the preallocated scratch,
    /// ADD into out (caller zero-fills), advance renderedFrames. The drained
    /// array is the one sanctioned per-render allocation; no throwing path.
    public func render(into out: inout [Float], frames: Int) {
        for command in queue.drain(max: Self.maxCommandsPerBlock) {
            apply(command)
        }
        var pos = 0
        while pos < frames {
            let n = min(Self.maxSliceFrames, frames - pos)
            for i in 0..<n {
                scratch[i] = 0
            }
            engine.process(into: &scratch, frames: n)
            for i in 0..<n {
                out[pos + i] += scratch[i]
            }
            pos += n
        }
        renderedFrameCount += frames
    }

    private func apply(_ command: PatchCommand) {
        switch command {
        case let .setPatch(patch):
            let errors = engine.setPatch(patch)
            if !errors.isEmpty {
                onPatchRejected?(errors)
            }
        case let .setZoneSet(id, layers):
            zoneSets.sets[id] = layers
        case let .noteOn(midi, velocity, atFrame):
            engine.schedule(EngineEvent(frame: atFrame, kind: .noteOn(midi: midi, velocity: velocity)))
        case let .noteOff(midi, atFrame):
            engine.schedule(EngineEvent(frame: atFrame, kind: .noteOff(midi: midi)))
        case let .allNotesOff(atFrame):
            engine.schedule(EngineEvent(frame: atFrame, kind: .allNotesOff))
        }
    }

    // MARK: - Source node shell

    /// AVAudioSourceNode over render(into:frames:): mono render copied to
    /// every output channel (stereo is phase 2). Logic-free by design — unit
    /// coverage stops at a construction smoke test.
    public func makeSourceNode() -> AVAudioSourceNode {
        AVAudioSourceNode { [self] _, _, frameCount, audioBufferList in
            let frames = Int(frameCount)
            if nodeScratch.count < frames {
                nodeScratch = [Float](repeating: 0, count: frames)
            }
            for i in 0..<frames {
                nodeScratch[i] = 0
            }
            render(into: &nodeScratch, frames: frames)
            let buffers = UnsafeMutableAudioBufferListPointer(audioBufferList)
            for buffer in buffers {
                guard let data = buffer.mData?.assumingMemoryBound(to: Float.self) else { continue }
                for i in 0..<frames {
                    data[i] = nodeScratch[i]
                }
            }
            return noErr
        }
    }
}
