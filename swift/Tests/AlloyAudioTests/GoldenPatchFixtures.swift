@testable import AlloyAudio
import Foundation

/// Golden patch-render fixtures: one full Patch per generator kind, a shared
/// event script, and a baked sine sample-zone set. Consumed by
/// GoldenRenderTests. Mirrored verbatim from web
/// src/dsp/testing/golden-patches.ts (canonical).
///
/// Swift 6 strict concurrency forbids top-level `let` globals of non-Sendable
/// value types (Patch and friends predate Sendable conformance), so every
/// fixture is a function returning a fresh value instead of a stored global.

private func fullKey() -> KeyRange { KeyRange(lowMidi: 0, highMidi: 127) }
private func fullVel() -> VelRange { VelRange(low: 0, high: 1) }

func goldenEvents() -> [EngineEvent] {
    [
        EngineEvent(frame: 0, kind: .noteOn(midi: 60, velocity: 0.8)),
        EngineEvent(frame: 6000, kind: .noteOn(midi: 67, velocity: 0.6)),
        EngineEvent(frame: 12000, kind: .noteOff(midi: 60)),
        EngineEvent(frame: 18000, kind: .noteOff(midi: 67)),
    ]
}

/// Last release (0.3 s after noteOff@18000) ends ≈ frame 32 400.
let GOLDEN_FRAMES = 36_000
let GOLDEN_FS = 48_000.0

/// Single fm layer: the Task 2 fixture's FM layer promoted to full key/vel range.
/// Carries a chorus insert (Task 4), so its render is true stereo: L != R.
func patchFM() -> Patch {
    Patch(
        schemaVersion: PATCH_SCHEMA_VERSION,
        meta: PatchMeta(id: "golden.fm", name: "Golden FM", category: .melodic),
        layers: [
            PatchLayer(
                keyRange: fullKey(),
                velRange: fullVel(),
                generator: .fm(FmGeneratorParams(
                    operators: [
                        FmOperatorParams(ratio: 1, level: 1, adsr: AdsrParams(attack: 0.002, decay: 0.6, sustain: 0, release: 0.3)),
                        FmOperatorParams(ratio: 14, level: 0.4, adsr: AdsrParams(attack: 0.001, decay: 0.08, sustain: 0, release: 0.05)),
                    ],
                    algorithm: FmAlgorithm(routes: [FmRoute(from: 1, to: 0)], carriers: [0]),
                )),
                tva: TvaParams(level: 0.5, adsr: AdsrParams(attack: 0.002, decay: 0.5, sustain: 0.4, release: 0.15), velCurve: 1.5),
            ),
        ],
        sends: PatchSends(reverb: 0, delay: 0),
        inserts: [.chorus(ChorusParams(mode: .ensemble, rateHz: 0.7, depthMs: 2.2, mix: 0.35))],
    )
}

/// Single va layer + tvf + mod: the Task 2 fixture's VA layer (already full range).
func patchVA() -> Patch {
    Patch(
        schemaVersion: PATCH_SCHEMA_VERSION,
        meta: PatchMeta(id: "golden.va", name: "Golden VA", category: .melodic),
        layers: [
            PatchLayer(
                keyRange: fullKey(),
                velRange: fullVel(),
                generator: .va(VaParams(shape: .saw, unison: 3, detuneCents: 18, pulseWidth: 0.5), seed: 7),
                tvf: TvfParams(
                    mode: .lowpass,
                    cutoffHz: 900,
                    q: 0.9,
                    envAmountHz: 2200,
                    env: AdsrParams(attack: 0.004, decay: 0.18, sustain: 0.25, release: 0.2),
                    keyTrack: 0.5,
                    velAmountHz: 1200,
                ),
                // Faster release than the Task 2 fixture's 0.25 s: the golden event
                // script needs every layer's release tail to be inaudible by
                // GOLDEN_FRAMES (36 000), and a 0.25 s time constant does not decay
                // far enough in the ~0.35 s available after the last noteOff@18000.
                tva: TvaParams(level: 0.8, adsr: AdsrParams(attack: 0.005, decay: 0.3, sustain: 0.7, release: 0.05), velCurve: 2),
                mod: LfoRouting(lfo: LfoParams(shape: .sine, rateHz: 5.5, delay: 0.3, fadeIn: 0.4), toPitchCents: 8, toCutoffHz: 0, toAmpDepth: 0),
            ),
        ],
        sends: PatchSends(reverb: 0, delay: 0),
    )
}

/// Single additive layer (drawbar-organ partial bank) + amplitude-tremolo mod.
/// Carries a tremolo insert (Task 4), so its render is true stereo: L != R.
func patchOrgan() -> Patch {
    Patch(
        schemaVersion: PATCH_SCHEMA_VERSION,
        meta: PatchMeta(id: "golden.organ", name: "Golden Organ", category: .melodic),
        layers: [
            PatchLayer(
                keyRange: fullKey(),
                velRange: fullVel(),
                generator: .additive([
                    AdditivePartial(ratio: 0.5, level: 0.7),
                    AdditivePartial(ratio: 1, level: 1),
                    AdditivePartial(ratio: 1.5, level: 0.35),
                    AdditivePartial(ratio: 2, level: 0.25),
                    AdditivePartial(ratio: 3, level: 0.12),
                    AdditivePartial(ratio: 4, level: 0.08),
                ]),
                tva: TvaParams(level: 0.6, adsr: AdsrParams(attack: 0.003, decay: 0.05, sustain: 1, release: 0.04), velCurve: 1),
                mod: LfoRouting(lfo: LfoParams(shape: .sine, rateHz: 6.8, delay: 0, fadeIn: 0.1), toPitchCents: 0, toCutoffHz: 0, toAmpDepth: 0.35),
            ),
        ],
        sends: PatchSends(reverb: 0, delay: 0),
        inserts: [.tremolo(TremoloParams(rateHz: 6.8, depth: 0.4, spread: 0.8))],
    )
}

/// Reuses patchFM()'s layer/inserts but with nonzero reverb+delay sends, so
/// this is the golden case that exercises the master bus end-to-end (reverb
/// tail + delay echo + brickwall limiter all in the render), not just the
/// dry+limiter pass-through the other four cases get with sends: 0/0. Reverb
/// decorrelates L/R on top of the chorus insert, so this is not insert-free.
func patchFMWet() -> Patch {
    let fm = patchFM()
    return Patch(
        schemaVersion: PATCH_SCHEMA_VERSION,
        meta: PatchMeta(id: "golden-fm-wet", name: "Golden FM Wet", category: .melodic),
        layers: fm.layers,
        sends: PatchSends(reverb: 0.3, delay: 0.25),
        inserts: fm.inserts,
    )
}

/// Single sample layer over the baked golden.sine zone set.
func patchSample() -> Patch {
    Patch(
        schemaVersion: PATCH_SCHEMA_VERSION,
        meta: PatchMeta(id: "golden.sample", name: "Golden Sample", category: .melodic),
        layers: [
            PatchLayer(
                keyRange: fullKey(),
                velRange: fullVel(),
                generator: .sample(zoneSetId: "golden.sine", crossfade: 0.2),
                tva: TvaParams(level: 0.8, adsr: AdsrParams(attack: 0.001, decay: 0.2, sustain: 0.8, release: 0.1), velCurve: 2),
            ),
        ],
        sends: PatchSends(reverb: 0, delay: 0),
    )
}

private let goldenZoneLength = 48_000

/// 'golden.sine': one velocity layer, one zone, a baked 440 Hz sine (deterministic, no assets).
func goldenZones() -> [VelocityLayerData] {
    var data = [Float](repeating: 0, count: goldenZoneLength)
    for i in 0..<goldenZoneLength {
        data[i] = Float(sin(DspConstants.twoPi * 440 * Double(i) / Double(goldenZoneLength)))
    }
    return [
        VelocityLayerData(
            topVelocity: 1,
            zones: [
                SampleZoneData(rootMidi: 69, sampleRate: GOLDEN_FS, data: data, loopStart: 0, loopEnd: goldenZoneLength),
            ],
        ),
    ]
}

/// Resolves 'golden.sine' to goldenZones(); everything else is unresolved.
func goldenZoneSetProvider(_ zoneSetId: String) -> [VelocityLayerData]? {
    zoneSetId == "golden.sine" ? goldenZones() : nil
}
