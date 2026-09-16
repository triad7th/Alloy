import AVFoundation

public enum AVPatchSynthEngineError: Error {
    case invalidPatch([String])
    case missingZoneSet(String)
    case invalidOutputFormat
}

/// Playable patch host. Public note/lifecycle methods are main-thread-only,
/// matching AVSynthEngine. The host command queue owns audio-thread handoff.
/// @unchecked Sendable permits notification callbacks to re-enter on .main;
/// loading is detached and touches only the thread-safe PackLoader.
public final class AVPatchSynthEngine: SynthEngine, @unchecked Sendable {
    private let engine: AVAudioEngine
    private let source: AVAudioSourceNode
    private let core: PatchSynthEngine
    private var observers: [NSObjectProtocol] = []
    private var disposed = false

    @MainActor
    public static func create(
        patch: Patch,
        loader: PackLoader,
        zoneSetIds: [String],
        defaultVelocity: Double = 1,
        engine: AVAudioEngine = .init()
    ) async throws -> AVPatchSynthEngine {
        let errors = validatePatch(patch)
        guard errors.isEmpty else { throw AVPatchSynthEngineError.invalidPatch(errors) }
        // Decode the full pack away from the main actor. Nothing has been
        // attached yet, so loader/cancellation failures leave no graph behind.
        try await Task.detached(priority: .userInitiated) { try await loader.load() }.value
        try Task.checkCancellation()
        for id in zoneSetIds {
            guard loader.provide(id) != nil else { throw AVPatchSynthEngineError.missingZoneSet(id) }
        }
        #if os(iOS)
            if !engine.isInManualRenderingMode {
                let session = AVAudioSession.sharedInstance()
                try session.setCategory(.playback)
                try session.setActive(true)
            }
        #endif
        let output = engine.isInManualRenderingMode
            ? engine.manualRenderingFormat : engine.outputNode.outputFormat(forBus: 0)
        guard output.sampleRate > 0 else { throw AVPatchSynthEngineError.invalidOutputFormat }
        let host = PatchEngineHost(sampleRate: output.sampleRate)
        for id in zoneSetIds {
            host.setZoneSet(id, loader.provide(id)!)
        }
        host.setPatch(patch)
        let adapter = AVPatchSynthEngine(engine: engine, host: host, defaultVelocity: defaultVelocity)
        do {
            engine.prepare()
            try engine.start()
            adapter.observeLifecycle()
            return adapter
        } catch {
            adapter.dispose()
            throw error
        }
    }

    private init(engine: AVAudioEngine, host: PatchEngineHost, defaultVelocity: Double) {
        self.engine = engine
        source = host.makeSourceNode()
        core = PatchSynthEngine(host: Commands(host: host), defaultVelocity: defaultVelocity)
        engine.attach(source)
        engine.connect(source, to: engine.mainMixerNode, format: host.sourceNodeFormat)
    }

    public func noteOn(midi: Int) {
        guard !disposed else { return }
        ensureAudioReady()
        core.noteOn(midi: midi)
    }

    public func noteOn(midi: Int, velocity: Double) {
        guard !disposed else { return }
        ensureAudioReady()
        core.noteOn(midi: midi, velocity: velocity)
    }

    public func noteOff(midi: Int) {
        if !disposed { core.noteOff(midi: midi) }
    }

    public func setSustain(_ on: Bool) {
        if !disposed { core.setSustain(on) }
    }

    public func setInstrument(_: String) {}
    public func allNotesOff() {
        if !disposed { core.allNotesOff() }
    }

    public func dispose() {
        guard !disposed else { return }
        allNotesOff()
        disposed = true
        observers.forEach(NotificationCenter.default.removeObserver)
        observers.removeAll()
        engine.stop()
        engine.disconnectNodeOutput(source)
        engine.detach(source)
    }

    private func ensureAudioReady() {
        #if os(iOS)
            if !engine.isInManualRenderingMode {
                try? AVAudioSession.sharedInstance().setActive(true)
            }
        #endif
        if !engine.isRunning { try? engine.start() }
    }

    private func observeLifecycle() {
        #if os(iOS)
            observers.append(NotificationCenter.default.addObserver(
                forName: AVAudioSession.interruptionNotification, object: nil, queue: .main
            ) { [weak self] _ in
                guard let self, !disposed else { return }
                // Both interruption edges clear stale notes. Session activation
                // and restart belong to the next playable gesture.
                allNotesOff()
            })
        #endif
        observers.append(NotificationCenter.default.addObserver(
            forName: .AVAudioEngineConfigurationChange, object: engine, queue: .main
        ) { [weak self] _ in
            guard let self, !disposed else { return }
            // Configuration changes may stop the engine; clear voices now
            // and let the next note gesture restart it.
            allNotesOff()
        })
    }

    deinit { dispose() }

    private final class Commands: PatchSynthHost {
        let host: PatchEngineHost
        init(host: PatchEngineHost) {
            self.host = host
        }

        func noteOn(midi: Int, velocity: Double) {
            host.noteOn(midi: midi, velocity: velocity)
        }

        func noteOff(midi: Int) {
            host.noteOff(midi: midi)
        }

        func allNotesOff() {
            host.allNotesOff()
        }
    }
}
