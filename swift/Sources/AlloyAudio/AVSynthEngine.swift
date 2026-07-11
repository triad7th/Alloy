import AudioToolbox
import AVFoundation

/// AVFoundation adapter for the synth engine — the semantic platform edge
/// paired with the web alloy-audio twin's WebSynthEngine. Builds a STATIC
/// graph from the injected instrument catalog:
///
///   source(id A) ──┬─ dry tap ──────────────────┐
///                  └─ reverb tap ──┐            │
///   source(id B) ──┬─ dry tap ─────┼────────────┤
///                  ├─ reverb tap ──┤            │
///                  └─ delay tap ─┐ │            │
///                                │ └─▶ reverbSum ─▶ reverb ─▶ sum
///                                └───▶ delaySum ──▶ delay ──▶ sum ─▶ limiter ─▶ out
///
/// Voices render inside each channel's AVAudioSourceNode via VoiceMixer;
/// note commands cross to the render thread through ChannelCommandQueue.
/// @unchecked Sendable: the public API is main-thread-only; all cross-thread
/// hand-off goes through the locked ChannelCommandQueue and SampleZoneStore.
public final class AVSynthEngine: SynthEngine, @unchecked Sendable {
    private let engine: AVAudioEngine
    private let store = SampleZoneStore()
    private let instruments: [InstrumentDescriptor]
    private let defaultDescriptor: InstrumentDescriptor
    private var channels: [String: Channel] = [:]
    private var core: SynthEngineCore!
    #if os(iOS)
        private var sessionConfigured = false
    #endif
    private var observers: [NSObjectProtocol] = []

    /// Everything one instrument channel owns. The render closure captures
    /// this object; nothing here is touched off the audio thread except the
    /// queue (thread-safe) and the clock (read-only off-thread).
    private final class Channel: @unchecked Sendable {
        let queue = ChannelCommandQueue()
        let mixer = VoiceMixer()
        let sampleRate: Double
        var renderedFrames: Int64 = 0
        var scratch: [Float]

        init(sampleRate: Double, maximumFrames: Int) {
            self.sampleRate = sampleRate
            scratch = [Float](repeating: 0, count: maximumFrames)
        }

        var now: Double { Double(renderedFrames) / sampleRate }
    }

    /// - Parameters:
    ///   - instruments: the app's instrument catalog; one channel strip is
    ///     built per descriptor. Must be non-empty.
    ///   - defaultInstrumentId: initially selected instrument; nil (or an id
    ///     not in the catalog) selects the first descriptor.
    public init(
        instruments: [InstrumentDescriptor],
        defaultInstrumentId: String? = nil,
        engine: AVAudioEngine = .init(),
        sampleSource: SampleSource = BundleSampleSource(),
    ) {
        precondition(!instruments.isEmpty, "AVSynthEngine needs at least one instrument")
        self.engine = engine
        self.instruments = instruments
        defaultDescriptor = instruments.first { $0.id == defaultInstrumentId } ?? instruments[0]
        let outputFormat = engine.outputNode.outputFormat(forBus: 0)
        let sampleRate = outputFormat.sampleRate > 0 ? outputFormat.sampleRate : 44_100
        let mono = AVAudioFormat(standardFormatWithSampleRate: sampleRate, channels: 1)!

        // Master chain (values from the web MasterChain, spec-mapped).
        let sum = AVAudioMixerNode()
        // AVAudioUnitReverb/Delay expose a single input bus, so a second
        // channel's tap connecting directly to the effect would silently
        // evict the first (AVAudioEngine.connect replaces, it doesn't sum,
        // on plain effect nodes). Route taps through summing mixers first —
        // same reasoning as the `sum` mixer in front of the limiter.
        let reverbSum = AVAudioMixerNode()
        let delaySum = AVAudioMixerNode()
        let reverb = AVAudioUnitReverb()
        reverb.loadFactoryPreset(.mediumRoom)
        reverb.wetDryMix = 100
        let delay = AVAudioUnitDelay()
        delay.delayTime = 0.26
        delay.feedback = 25
        delay.wetDryMix = 100
        let limiter = AVAudioUnitEffect(audioComponentDescription: AudioComponentDescription(
            componentType: kAudioUnitType_Effect,
            componentSubType: kAudioUnitSubType_DynamicsProcessor,
            componentManufacturer: kAudioUnitManufacturer_Apple,
            componentFlags: 0,
            componentFlagsMask: 0,
        ))
        for node in [sum, reverbSum, delaySum, reverb, delay, limiter] as [AVAudioNode] {
            engine.attach(node)
        }
        engine.connect(sum, to: limiter, format: nil)
        engine.connect(limiter, to: engine.outputNode, format: nil)
        engine.connect(reverbSum, to: reverb, format: nil)
        engine.connect(delaySum, to: delay, format: nil)
        engine.connect(reverb, to: sum, format: nil)
        engine.connect(delay, to: sum, format: nil)
        Self.configureLimiter(limiter)

        // Per-instrument channel strips, from the injected catalog.
        for descriptor in instruments {
            let sends = descriptor.sends
            let channel = Channel(sampleRate: sampleRate, maximumFrames: 4096)
            let source = AVAudioSourceNode(format: mono) { _, _, frameCount, audioBufferList in
                Self.render(channel: channel, frameCount: frameCount, audioBufferList: audioBufferList)
            }
            engine.attach(source)

            var points: [AVAudioConnectionPoint] = []
            let dry = AVAudioMixerNode()
            dry.outputVolume = 1
            engine.attach(dry)
            engine.connect(dry, to: sum, format: nil)
            points.append(AVAudioConnectionPoint(node: dry, bus: dry.nextAvailableInputBus))
            if sends.reverb > 0 {
                let tap = AVAudioMixerNode()
                tap.outputVolume = Float(sends.reverb)
                engine.attach(tap)
                engine.connect(tap, to: reverbSum, format: nil)
                points.append(AVAudioConnectionPoint(node: tap, bus: tap.nextAvailableInputBus))
            }
            if sends.delay > 0 {
                let tap = AVAudioMixerNode()
                tap.outputVolume = Float(sends.delay)
                engine.attach(tap)
                engine.connect(tap, to: delaySum, format: nil)
                points.append(AVAudioConnectionPoint(node: tap, bus: tap.nextAvailableInputBus))
            }
            engine.connect(source, to: points, fromBus: 0, format: mono)
            channels[descriptor.id] = channel
        }

        // Startup preload (web parity): decode begins at construction.
        for descriptor in instruments {
            if case let .sampled(spec) = descriptor.voice {
                sampleSource.startLoading(midis: spec.sampleMidis, into: store)
            }
        }

        let defaultClock = channels[defaultDescriptor.id]!
        core = SynthEngineCore(
            playerFor: { [unowned self] id in player(for: id) },
            now: { defaultClock.now },
        )
        // Preload (web parity): selecting the default instrument builds its
        // player; sample decode is already underway from the loop above.
        core.setInstrument(defaultDescriptor.id)

        engine.prepare()
        do {
            try engine.start()
        } catch {
            // Stay silent but alive; retried on the next noteOn.
        }
        observeInterruptions()
    }

    // MARK: - SynthEngine

    public func noteOn(midi: Int, velocity: Double) {
        ensureAudioReady()
        core.noteOn(midi: midi, velocity: velocity)
    }

    public func noteOff(midi: Int) { core.noteOff(midi: midi) }
    public func setSustain(_ on: Bool) { core.setSustain(on) }
    public func setInstrument(_ id: String) { core.setInstrument(id) }
    public func allNotesOff() { core.allNotesOff() }

    // MARK: - Voice players

    private func player(for id: String) -> VoicePlayer {
        // Unknown/legacy ids fall back to the default instrument.
        let descriptor = instruments.first { $0.id == id } ?? defaultDescriptor
        let channel = channels[descriptor.id]!
        switch descriptor.voice {
        case let .sampled(spec):
            return ChannelVoicePlayer(channel: channel) { [store] midi, velocity, sampleRate in
                if let zone = store.nearestLoaded(to: midi) {
                    return SampledVoice(
                        zone: zone, midi: midi, velocity: velocity,
                        releaseSeconds: spec.release, sampleRate: sampleRate,
                    )
                }
                // Until any zone decodes (or forever, if decoding fails),
                // notes transparently use the spec's fallback synth.
                return SynthVoice(config: spec.fallback, midi: midi, velocity: velocity, sampleRate: sampleRate)
            }
        case let .supersaw(spec):
            return ChannelVoicePlayer(channel: channel) { midi, velocity, sampleRate in
                SupersawVoice(spec: spec, midi: midi, velocity: velocity, sampleRate: sampleRate)
            }
        }
    }

    /// Builds the voice on the caller's thread, then hands start/add and all
    /// later release/stop calls to the render thread. The `when` arguments
    /// from SynthEngineCore are superseded by drain-time `now` (the web
    /// always passes currentTime; quantization is one render quantum).
    private final class ChannelVoicePlayer: VoicePlayer {
        private let channel: Channel
        private let makeVoice: (Int, Double, Double) -> MixerVoice

        init(channel: Channel, makeVoice: @escaping (Int, Double, Double) -> MixerVoice) {
            self.channel = channel
            self.makeVoice = makeVoice
        }

        func start(midi: Int, velocity: Double, at _: Double) -> ActiveVoiceHandle {
            let voice = makeVoice(midi, velocity, channel.sampleRate)
            let mixer = channel.mixer
            channel.queue.enqueue { now in
                voice.start(at: now)
                mixer.add(voice)
            }
            return Handle(voice: voice, queue: channel.queue)
        }

        private final class Handle: ActiveVoiceHandle {
            private let voice: MixerVoice
            private let queue: ChannelCommandQueue

            init(voice: MixerVoice, queue: ChannelCommandQueue) {
                self.voice = voice
                self.queue = queue
            }

            func release(at _: Double) {
                let voice = voice
                queue.enqueue { now in voice.release(at: now) }
            }

            func stop(at _: Double) {
                let voice = voice
                queue.enqueue { now in voice.stop(at: now) }
            }
        }
    }

    // MARK: - Render

    private static func render(
        channel: Channel,
        frameCount: AVAudioFrameCount,
        audioBufferList: UnsafeMutablePointer<AudioBufferList>,
    ) -> OSStatus {
        let frames = Int(frameCount)
        if channel.scratch.count < frames {
            channel.scratch = [Float](repeating: 0, count: frames)
        }
        channel.queue.drain(now: channel.now)
        channel.mixer.render(into: &channel.scratch, frames: frames)
        let buffers = UnsafeMutableAudioBufferListPointer(audioBufferList)
        for buffer in buffers {
            guard let data = buffer.mData?.assumingMemoryBound(to: Float.self) else { continue }
            for i in 0..<frames {
                data[i] = channel.scratch[i]
            }
        }
        channel.renderedFrames += Int64(frames)
        return noErr
    }

    // MARK: - Master chain helpers

    /// Web MasterChain limiter: threshold -6, attack 0.002, release 0.15.
    /// Head room 1 dB approximates the web's 20:1 ratio (spec-documented).
    private static func configureLimiter(_ limiter: AVAudioUnitEffect) {
        let unit = limiter.audioUnit
        AudioUnitSetParameter(unit, kDynamicsProcessorParam_Threshold, kAudioUnitScope_Global, 0, -6, 0)
        AudioUnitSetParameter(unit, kDynamicsProcessorParam_HeadRoom, kAudioUnitScope_Global, 0, 1, 0)
        AudioUnitSetParameter(unit, kDynamicsProcessorParam_AttackTime, kAudioUnitScope_Global, 0, 0.002, 0)
        AudioUnitSetParameter(unit, kDynamicsProcessorParam_ReleaseTime, kAudioUnitScope_Global, 0, 0.15, 0)
    }

    // MARK: - Session / lifecycle

    /// iOS analog of the web's resume-on-gesture: every noteOn originates
    /// from a real gesture, so activate the session and (re)start the engine
    /// here to guarantee the first note sounds.
    private func ensureAudioReady() {
        #if os(iOS)
            if !sessionConfigured {
                sessionConfigured = true
                let session = AVAudioSession.sharedInstance()
                try? session.setCategory(.playback)
                try? session.setActive(true)
            }
        #endif
        if !engine.isRunning {
            try? engine.start()
        }
    }

    private func observeInterruptions() {
        #if os(iOS)
            let interruptionToken = NotificationCenter.default.addObserver(
                forName: AVAudioSession.interruptionNotification,
                object: nil, queue: .main,
            ) { [weak self] notification in
                guard let self else { return }
                let raw = notification.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt
                if raw == AVAudioSession.InterruptionType.began.rawValue {
                    allNotesOff()
                } else {
                    try? engine.start()
                }
            }
            observers.append(interruptionToken)
        #endif
        let configChangeToken = NotificationCenter.default.addObserver(
            forName: .AVAudioEngineConfigurationChange,
            object: engine, queue: .main,
        ) { [weak self] _ in
            guard let self else { return }
            allNotesOff()
            try? engine.start()
        }
        observers.append(configChangeToken)
    }

    deinit {
        observers.forEach(NotificationCenter.default.removeObserver)
    }
}
