import Foundation

/// Voice: one sounding note of a Patch. Each matching layer runs its own
/// generator → TVF → TVA chain with LFO modulation. TVA envelopes run
/// per-sample (click-free); the TVF envelope and LFO run at control rate
/// (sampleRate / CONTROL_INTERVAL), ticked once per chunk keyed to an
/// absolute per-voice sample position so output is identical regardless of
/// how render() calls are sized. Twin of web src/dsp/voice.ts (canonical).

/// Resolves a patch's sample zoneSetId to concrete zone data (packs in phase 3; fixtures in tests).
public typealias ZoneSetProvider = (String) -> [VelocityLayerData]?

/// Samples per modulation tick; TVF envelope + LFO run at sampleRate / CONTROL_INTERVAL.
public let CONTROL_INTERVAL = 16

/// Release time constant (seconds) for quickRelease (voice steal / allNotesOff).
private let quickReleaseTau = 0.008

public final class Voice {
    private final class LayerUnit {
        let layer: PatchLayer
        let generator: ToneGenerator
        /// Full-rate amplitude envelope (per-sample, click-free).
        let tva: AdsrEnvelope
        let svf: Svf?
        /// Control-rate filter envelope.
        let tvfEnv: AdsrEnvelope?
        /// Control-rate modulation LFO.
        let lfo: Lfo?
        /// layerGain = tva.level * velocityResidual and
        /// velocityResidual = velocity <= 0 ? 0 : velocity ** (tva.velCurve - 1) —
        /// generators already applied velocity^1; the TVA contributes the
        /// perceptual residual so total velocity gain is velocity^velCurve.
        let gain: Double
        /// Tremolo gain held since the last control tick.
        var ampMod = 1.0
        /// Preallocated chunk buffer; zero-filled per chunk (no allocation in render).
        var scratch = [Float](repeating: 0, count: CONTROL_INTERVAL)

        init(
            layer: PatchLayer,
            generator: ToneGenerator,
            tva: AdsrEnvelope,
            svf: Svf?,
            tvfEnv: AdsrEnvelope?,
            lfo: Lfo?,
            gain: Double,
        ) {
            self.layer = layer
            self.generator = generator
            self.tva = tva
            self.svf = svf
            self.tvfEnv = tvfEnv
            self.lfo = lfo
            self.gain = gain
        }
    }

    private let patch: Patch
    private let sampleRate: Double
    private let zoneSetProvider: ZoneSetProvider?
    private var units: [LayerUnit] = []
    private var midi = 0
    private var velocity = 0.0
    /// Absolute sample position within the note; drives the control tick.
    private var samplePos = 0

    public init(patch: Patch, sampleRate: Double, zoneSetProvider: ZoneSetProvider? = nil) {
        self.patch = patch
        self.sampleRate = sampleRate
        self.zoneSetProvider = zoneSetProvider
    }

    /// True while any layer is alive (TVA active and generator not finished).
    public var active: Bool {
        units.contains { $0.tva.isActive && !$0.generator.finished }
    }

    /// Selects layers whose key/vel ranges contain the note and builds their units.
    public func noteOn(midi: Int, velocity: Double) {
        self.midi = midi
        self.velocity = velocity
        samplePos = 0
        units = []
        for layer in patch.layers {
            guard layer.keyRange.lowMidi <= midi, midi <= layer.keyRange.highMidi else { continue }
            guard layer.velRange.low <= velocity, velocity <= layer.velRange.high else { continue }
            guard let generator = buildGenerator(layer.generator) else {
                continue // Unresolvable zoneSetId: layer inactive, not an error.
            }
            let tva = AdsrEnvelope(params: layer.tva.adsr, sampleRate: sampleRate)
            let controlRate = sampleRate / Double(CONTROL_INTERVAL)
            let svf = layer.tvf.map { Svf(mode: $0.mode, sampleRate: sampleRate) }
            let tvfEnv = (layer.tvf?.env).map { AdsrEnvelope(params: $0, sampleRate: controlRate) }
            let lfo = layer.mod.map { Lfo(params: $0.lfo, sampleRate: controlRate) }
            generator.noteOn(midi: midi, velocity: velocity)
            tva.noteOn()
            tvfEnv?.noteOn()
            let velocityResidual = velocity <= 0 ? 0 : pow(velocity, layer.tva.velCurve - 1)
            units.append(LayerUnit(
                layer: layer,
                generator: generator,
                tva: tva,
                svf: svf,
                tvfEnv: tvfEnv,
                lfo: lfo,
                gain: layer.tva.level * velocityResidual,
            ))
        }
    }

    /// Key-up: every layer's TVA + TVF envelopes and generator get noteOff.
    public func noteOff() {
        for unit in units {
            unit.tva.noteOff()
            unit.tvfEnv?.noteOff()
            unit.generator.noteOff()
        }
    }

    /// Steal / allNotesOff: fast TVA release plus key-up everywhere.
    public func quickRelease() {
        for unit in units {
            unit.tva.fastRelease(tau: quickReleaseTau)
            unit.tvfEnv?.noteOff()
            unit.generator.noteOff()
        }
    }

    /// ADDS into out. Returns false once every layer is silent (voice reapable).
    @discardableResult
    public func render(into out: inout [Float], frames: Int) -> Bool {
        var n = 0
        while n < frames {
            let posInChunk = samplePos % CONTROL_INTERVAL
            let chunkLen = min(CONTROL_INTERVAL - posInChunk, frames - n)
            let tick = posInChunk == 0
            for unit in units {
                guard unit.tva.isActive, !unit.generator.finished else { continue }
                if tick {
                    tickModulation(unit)
                }
                for i in 0..<chunkLen {
                    unit.scratch[i] = 0
                }
                unit.generator.render(into: &unit.scratch, frames: chunkLen)
                for i in 0..<chunkLen {
                    let raw = Double(unit.scratch[i])
                    let shaped = unit.svf?.process(raw) ?? raw
                    out[n + i] += Float(shaped * unit.tva.nextSample() * unit.gain * unit.ampMod)
                }
            }
            samplePos += chunkLen
            n += chunkLen
        }
        return active
    }

    /// One control tick: advance LFO + TVF envelope, refresh pitch/cutoff/amp modulation.
    private func tickModulation(_ unit: LayerUnit) {
        let lfoVal = unit.lfo?.nextSample() ?? 0
        let tvfEnvVal = unit.tvfEnv?.nextSample() ?? 0
        if let mod = unit.layer.mod, mod.toPitchCents != 0 {
            unit.generator.setPitchRatio(pow(2, mod.toPitchCents * lfoVal / 1200))
        }
        if let tvf = unit.layer.tvf, let svf = unit.svf {
            let cutoff = tvf.cutoffHz * pow(2, tvf.keyTrack * Double(midi - 60) / 12)
                + tvf.envAmountHz * tvfEnvVal
                + tvf.velAmountHz * velocity
                + (unit.layer.mod?.toCutoffHz ?? 0) * lfoVal
            svf.setParams(cutoffHz: cutoff, q: tvf.q) // Svf clamps internally.
        }
        unit.ampMod = 1 - (unit.layer.mod?.toAmpDepth ?? 0) * (0.5 + 0.5 * lfoVal)
    }

    /// Builds the layer's generator; nil marks the layer inactive (an
    /// unresolvable sample zoneSetId or missing provider is progressive-loading
    /// silence, not an error).
    private func buildGenerator(_ spec: GeneratorSpec) -> ToneGenerator? {
        switch spec {
        case let .fm(params):
            return FmGenerator(params: params, sampleRate: sampleRate)
        case let .additive(partials):
            return AdditiveGenerator(partials: partials, sampleRate: sampleRate)
        case let .va(params, seed):
            return VaGenerator(params: params, sampleRate: sampleRate, seed: seed)
        case let .sample(zoneSetId, crossfade):
            guard let zones = zoneSetProvider?(zoneSetId), !zones.isEmpty else { return nil }
            return SampleZoneGenerator(layers: zones, crossfade: crossfade, sampleRate: sampleRate)
        }
    }
}
