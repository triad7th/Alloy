import AVFoundation

/// Real-time host for the rompler PatchEngine — the AVFoundation platform
/// edge paired with the web twin's WorkletHostCore + worklet shell (semantic
/// twins, not literal; see docs/mirroring.md). All host logic lives in
/// render(intoLeft:right:frames:), which unit tests drive directly;
/// makeSourceNode() is the thin AVAudioSourceNode shell around it (its
/// channel mapping is the one permitted piece of shell logic).
///
/// Command frames are ABSOLUTE ENGINE frames (the renderedFrames timebase);
/// the engine treats past frames as due at the next block start. Commands
/// drain at the start of each render — bounded per block, leftovers carry in
/// order — matching the web core's apply-at-render-start semantics.
///
/// @unchecked Sendable: the command API is thread-safe via the locked
/// PatchCommandQueue; engine, zone sets, and the scratch buffers are touched
/// only inside render(intoLeft:right:frames:) (the render thread), and renderedFrames
/// is written there and read-only elsewhere — the AVSynthEngine.Channel
/// pattern.
public final class PatchEngineHost: @unchecked Sendable {
    /// Per-render drain bound; leftovers stay queued in order across renders
    /// (the web twin's MAX_COMMANDS_PER_BLOCK).
    public static let maxCommandsPerBlock = 512

    /// Largest single engine.process call; render(intoLeft:right:frames:)
    /// slices larger requests through the preallocated scratches.
    private static let maxSliceFrames = 4096

    /// The stereo AVAudioFormat makeSourceNode() constructs its node with:
    /// the host's own sample rate, 2 channels. Factored out (rather than
    /// inlined) as a testing seam — AVAudioSourceNode.outputFormat(forBus:)
    /// does not reflect a node's initializer format until the node is
    /// attached AND connected inside a running AVAudioEngine graph, and once
    /// connected it reflects connect(_:to:format:)'s argument, not the
    /// initializer's — so this is the reliable way to assert what
    /// makeSourceNode() actually requests.
    static func sourceNodeFormat(sampleRate: Double) -> AVAudioFormat {
        AVAudioFormat(standardFormatWithSampleRate: sampleRate, channels: 2)!
    }

    /// Zone sets owned by the render thread: written only while applying
    /// drained commands and read only by the engine's zoneSetProvider (both
    /// inside render), so no locking — a reference-type box because the
    /// provider closure must outlive init without capturing self.
    private final class ZoneSetStore {
        var sets: [String: [VelocityLayerData]] = [:]
    }

    private let sampleRate: Double
    private let queue = PatchCommandQueue()
    private let engine: PatchEngine
    private let zoneSets: ZoneSetStore
    /// Per-slice stereo mix pair: zeroed, engine ADDS into it, added into out.
    private var scratchL = [Float](repeating: 0, count: maxSliceFrames)
    private var scratchR = [Float](repeating: 0, count: maxSliceFrames)
    /// makeSourceNode's stereo block pair, preallocated once at the
    /// maxSliceFrames cap — no render-thread regrowth (allocating inside the
    /// AVAudioSourceNode render block is a real-time-safety violation). If a
    /// callback ever asks for more than maxSliceFrames in one call (it
    /// shouldn't: hosts hand out block-sized callbacks well under 4096), the
    /// remainder renders silence and, in debug builds, trips an
    /// assertionFailure so the mismatch is caught in development rather than
    /// silently truncating audio in production.
    private var nodeScratchL = [Float](repeating: 0, count: maxSliceFrames)
    private var nodeScratchR = [Float](repeating: 0, count: maxSliceFrames)
    private var renderedFrameCount = 0

    /// Rejected patches (validatePatch errors) surface here, invoked on the
    /// render thread during the drain; nil drops them silently.
    public var onPatchRejected: (([String]) -> Void)?

    public init(sampleRate: Double, maxVoices: Int = 64) {
        self.sampleRate = sampleRate
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
    /// ≤4096-frame engine.process calls through the preallocated stereo
    /// scratch pair, ADD into left/right (caller zero-fills), advance
    /// renderedFrames. The drained array is the one sanctioned per-render
    /// allocation; no throwing path.
    public func render(intoLeft left: inout [Float], right: inout [Float], frames: Int) {
        for command in queue.drain(max: Self.maxCommandsPerBlock) {
            apply(command)
        }
        var pos = 0
        while pos < frames {
            let n = min(Self.maxSliceFrames, frames - pos)
            for i in 0..<n {
                scratchL[i] = 0
                scratchR[i] = 0
            }
            engine.process(intoLeft: &scratchL, right: &scratchR, frames: n)
            for i in 0..<n {
                left[pos + i] += scratchL[i]
                right[pos + i] += scratchR[i]
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

    /// AVAudioSourceNode over render(intoLeft:right:frames:), built with an
    /// explicit stereo AVAudioFormat at the host's own sample rate (the
    /// AVSynthEngine pattern) so a hardware/engine rate mismatch goes through
    /// Core Audio's sample-rate conversion instead of silently detuning the
    /// output — the riskiest 1b-ii deferral, closed here. The channel
    /// mapping below is the one permitted piece of shell logic, mirroring
    /// the web worklet shell: L -> channel 0 and R -> channel 1 on stereo
    /// (and wider) outputs, with channels past the stereo pair cleared; a
    /// single-channel output gets the (L+R)*0.5 downmix.
    ///
    /// Single-node assumption: one source node per host. A second call to
    /// makeSourceNode() shares this host's engine and transport (same
    /// PatchEngine, same renderedFrames clock, same command queue) rather
    /// than getting an independent one — construct a second PatchEngineHost
    /// if a second, independently-clocked node is needed.
    public func makeSourceNode() -> AVAudioSourceNode {
        let format = Self.sourceNodeFormat(sampleRate: sampleRate)
        return AVAudioSourceNode(format: format) { [self] _, _, frameCount, audioBufferList in
            let frames = Int(frameCount)
            // Preallocated scratches are sized to the cap on purpose —
            // growing them here would allocate on the render thread. This
            // shouldn't happen (hosts hand out block-sized callbacks well
            // under 4096 frames); if it ever does, render the real signal
            // for the frames the scratch can hold and silence for the
            // remainder, rather than growing the buffer or crashing.
            let rendered = min(frames, Self.maxSliceFrames)
            if frames > Self.maxSliceFrames {
                assertionFailure(
                    "PatchEngineHost render callback asked for \(frames) frames, " +
                        "exceeding the \(Self.maxSliceFrames)-frame node scratch cap",
                )
            }
            for i in 0..<rendered {
                nodeScratchL[i] = 0
                nodeScratchR[i] = 0
            }
            render(intoLeft: &nodeScratchL, right: &nodeScratchR, frames: rendered)
            let buffers = UnsafeMutableAudioBufferListPointer(audioBufferList)
            if buffers.count == 1, let data = buffers[0].mData?.assumingMemoryBound(to: Float.self) {
                for i in 0..<rendered {
                    data[i] = (nodeScratchL[i] + nodeScratchR[i]) * 0.5
                }
                for i in rendered..<frames {
                    data[i] = 0
                }
            } else {
                for (channel, buffer) in buffers.enumerated() {
                    guard let data = buffer.mData?.assumingMemoryBound(to: Float.self) else { continue }
                    switch channel {
                    case 0:
                        for i in 0..<rendered {
                            data[i] = nodeScratchL[i]
                        }
                    case 1:
                        for i in 0..<rendered {
                            data[i] = nodeScratchR[i]
                        }
                    default:
                        break
                    }
                    for i in rendered..<frames {
                        data[i] = 0
                    }
                }
            }
            return noErr
        }
    }
}
