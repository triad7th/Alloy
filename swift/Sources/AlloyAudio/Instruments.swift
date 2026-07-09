/// Voice spec types. Mirrored twin of the web alloy-audio `instruments.ts`.
/// AlloyAudio is instrument-agnostic: ids are opaque strings and the
/// concrete instrument catalog stays app-side — apps (and the preview
/// harnesses) supply their own `InstrumentDescriptor`s.

public enum Waveform: String, Sendable {
    case sine, square, sawtooth, triangle
}

public struct SynthVoiceConfig: Equatable, Sendable {
    public let waveform: Waveform
    public let attack: Double
    public let decay: Double
    /// 0..1 level after decay.
    public let sustain: Double
    public let release: Double

    public init(waveform: Waveform, attack: Double, decay: Double, sustain: Double, release: Double) {
        self.waveform = waveform
        self.attack = attack
        self.decay = decay
        self.sustain = sustain
        self.release = release
    }
}

public struct SampledVoiceSpec: Equatable, Sendable {
    /// Sample directory, relative to the bundled/hosted asset root.
    public let sampleBaseURL: String
    /// MIDI notes with a recorded file (file name = zero-padded midi + ".mp3").
    public let sampleMidis: [Int]
    /// Key-up gain release in seconds.
    public let release: Double
    /// Stopgap synth used until sample zones decode.
    public let fallback: SynthVoiceConfig

    public init(sampleBaseURL: String, sampleMidis: [Int], release: Double, fallback: SynthVoiceConfig) {
        self.sampleBaseURL = sampleBaseURL
        self.sampleMidis = sampleMidis
        self.release = release
        self.fallback = fallback
    }
}

public struct SupersawVoiceSpec: Equatable, Sendable {
    public let unison: Int
    /// Total detune spread in cents (oscillators spaced evenly across ±detuneCents/2).
    public let detuneCents: Double
    public let filterBaseHz: Double
    public let filterEnvHz: Double
    public let filterDecay: Double
    public let filterQ: Double
    /// Amp envelope; waveform is always sawtooth.
    public let amp: SynthVoiceConfig

    public init(
        unison: Int, detuneCents: Double, filterBaseHz: Double, filterEnvHz: Double,
        filterDecay: Double, filterQ: Double, amp: SynthVoiceConfig,
    ) {
        self.unison = unison
        self.detuneCents = detuneCents
        self.filterBaseHz = filterBaseHz
        self.filterEnvHz = filterEnvHz
        self.filterDecay = filterDecay
        self.filterQ = filterQ
        self.amp = amp
    }
}

public enum VoiceSpec: Equatable, Sendable {
    case sampled(SampledVoiceSpec)
    case supersaw(SupersawVoiceSpec)
}

/// Master-chain send levels for one instrument channel (0 = not routed).
public struct VoiceSends: Equatable, Sendable {
    public let reverb: Double
    public let delay: Double

    public init(reverb: Double = 0, delay: Double = 0) {
        self.reverb = reverb
        self.delay = delay
    }
}

/// One playable instrument: an opaque id, a voice, and its send levels.
public struct InstrumentDescriptor: Equatable, Sendable {
    public let id: String
    public let voice: VoiceSpec
    public let sends: VoiceSends

    public init(id: String, voice: VoiceSpec, sends: VoiceSends = VoiceSends()) {
        self.id = id
        self.voice = voice
        self.sends = sends
    }
}
