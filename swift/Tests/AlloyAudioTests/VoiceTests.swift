@testable import AlloyAudio
import XCTest

final class VoiceTests: XCTestCase {
    private let fs = 48_000.0
    private let twinReference: [Double] = [
        -0.00000528768669028068, -0.00004836813241126947, -0.00027252416475676, -0.0008509701583534479,
        -0.0019434844143688679, -0.003815143136307597, -0.006873433478176594, -0.011534090153872967,
    ]

    private let fullKey = KeyRange(lowMidi: 0, highMidi: 127)
    private let fullVel = VelRange(low: 0, high: 1)
    private let adsr = AdsrParams(attack: 0.005, decay: 0.2, sustain: 0.7, release: 0.2)

    private func makePatch(_ layers: [PatchLayer]) -> Patch {
        Patch(
            schemaVersion: PATCH_SCHEMA_VERSION,
            meta: PatchMeta(id: "test.voice", name: "Voice Test", category: .melodic),
            layers: layers,
            sends: PatchSends(reverb: 0, delay: 0),
        )
    }

    private func render(_ voice: Voice, _ frames: Int) -> [Float] {
        var out = [Float](repeating: 0, count: frames)
        voice.render(into: &out, frames: frames)
        return out
    }

    private func rms(_ samples: [Float], _ from: Int, _ to: Int) -> Double {
        var sum = 0.0
        for i in from..<to {
            sum += Double(samples[i]) * Double(samples[i])
        }
        return (sum / Double(to - from)).squareRoot()
    }

    func testExportsTheControlIntervalUsedByTheModulationTick() {
        XCTAssertEqual(CONTROL_INTERVAL, 16)
    }

    // 1. Layer selection: two layers with disjoint key ranges; noteOn(40) sounds only layer A.
    func testSoundsOnlyTheLayerWhoseKeyRangeContainsTheNote() {
        let layerA = PatchLayer(
            keyRange: KeyRange(lowMidi: 0, highMidi: 59),
            velRange: fullVel,
            generator: .additive([AdditivePartial(ratio: 1, level: 1)]),
            tva: TvaParams(level: 0.8, adsr: adsr, velCurve: 1),
        )
        let layerB = PatchLayer(
            keyRange: KeyRange(lowMidi: 60, highMidi: 127),
            velRange: fullVel,
            generator: .additive([AdditivePartial(ratio: 2, level: 1)]),
            tva: TvaParams(level: 0.8, adsr: adsr, velCurve: 1),
        )
        let voice = Voice(patch: makePatch([layerA, layerB]), sampleRate: fs)
        voice.noteOn(midi: 40, velocity: 1)
        let out = render(voice, 64)
        // Hand-built equivalent of layer A: bare generator * per-sample TVA * level.
        let gen = AdditiveGenerator(partials: [AdditivePartial(ratio: 1, level: 1)], sampleRate: fs)
        let env = AdsrEnvelope(params: adsr, sampleRate: fs)
        gen.noteOn(midi: 40, velocity: 1)
        env.noteOn()
        var scratch = [Float](repeating: 0, count: 64)
        gen.render(into: &scratch, frames: 64)
        for i in 0..<64 {
            XCTAssertEqual(Double(out[i]), Double(scratch[i]) * env.nextSample() * 0.8, accuracy: 5e-7)
        }
    }

    // 2. Velocity residual: velCurve 2 at velocity 0.5 is exactly velocity^(2-1) = 0.5x the velCurve-1 render.
    func testAppliesThePerceptualVelocityResidual() {
        func layerWithCurve(_ velCurve: Double) -> PatchLayer {
            PatchLayer(
                keyRange: fullKey,
                velRange: fullVel,
                generator: .additive([AdditivePartial(ratio: 1, level: 1)]),
                tva: TvaParams(level: 0.8, adsr: adsr, velCurve: velCurve),
            )
        }
        let curved = Voice(patch: makePatch([layerWithCurve(2)]), sampleRate: fs)
        let linear = Voice(patch: makePatch([layerWithCurve(1)]), sampleRate: fs)
        curved.noteOn(midi: 60, velocity: 0.5)
        linear.noteOn(midi: 60, velocity: 0.5)
        let a = render(curved, 256)
        let b = render(linear, 256)
        var compared = 0
        for i in 0..<256 where abs(b[i]) > 1e-6 {
            XCTAssertLessThan(abs(Double(a[i]) / Double(b[i]) - 0.5), 1e-9)
            compared += 1
        }
        XCTAssertGreaterThan(compared, 100)
    }

    // 3. Vel-range gating: a note below the layer's velocity window matches zero layers.
    func testIsImmediatelyInactiveWhenTheVelocityMissesEveryLayerWindow() {
        let layer = PatchLayer(
            keyRange: fullKey,
            velRange: VelRange(low: 0.6, high: 1),
            generator: .additive([AdditivePartial(ratio: 1, level: 1)]),
            tva: TvaParams(level: 0.8, adsr: adsr, velCurve: 1),
        )
        let voice = Voice(patch: makePatch([layer]), sampleRate: fs)
        voice.noteOn(midi: 60, velocity: 0.3)
        XCTAssertFalse(voice.active)
        var out = [Float](repeating: 0, count: 128)
        XCTAssertFalse(voice.render(into: &out, frames: 128))
        for i in 0..<128 {
            XCTAssertEqual(out[i], 0)
        }
    }

    // 4. TVF darkens: lowpass 300 Hz on a saw well above cutoff loses most of its energy.
    func testDarkensTheLayerThroughTheTvfLowpass() {
        func saw(_ tvf: TvfParams?) -> PatchLayer {
            PatchLayer(
                keyRange: fullKey,
                velRange: fullVel,
                generator: .va(VaParams(shape: .saw, unison: 1, detuneCents: 0, pulseWidth: 0.5), seed: 1),
                tvf: tvf,
                tva: TvaParams(level: 0.8, adsr: adsr, velCurve: 1),
            )
        }
        let filtered = Voice(
            patch: makePatch([
                saw(TvfParams(mode: .lowpass, cutoffHz: 300, q: 0.707, envAmountHz: 0, keyTrack: 0, velAmountHz: 0)),
            ]),
            sampleRate: fs,
        )
        let unfiltered = Voice(patch: makePatch([saw(nil)]), sampleRate: fs)
        filtered.noteOn(midi: 72, velocity: 1)
        unfiltered.noteOn(midi: 72, velocity: 1)
        let f = render(filtered, 4800)
        let u = render(unfiltered, 4800)
        XCTAssertLessThan(rms(f, 2400, 4800), 0.4 * rms(u, 2400, 4800))
    }

    // 5. noteOff → release → inactive; a dead voice renders nothing and returns false.
    func testGoesInactiveAfterTheReleaseAndThenAddsNothing() {
        let layer = PatchLayer(
            keyRange: fullKey,
            velRange: fullVel,
            generator: .additive([AdditivePartial(ratio: 1, level: 1)]),
            tva: TvaParams(
                level: 0.8,
                adsr: AdsrParams(attack: 0.005, decay: 0.1, sustain: 0.5, release: 0.03),
                velCurve: 1,
            ),
        )
        let voice = Voice(patch: makePatch([layer]), sampleRate: fs)
        voice.noteOn(midi: 60, velocity: 1)
        _ = render(voice, 4800) // 0.1 s
        XCTAssertTrue(voice.active)
        voice.noteOff()
        _ = render(voice, 24_000) // 0.5 s ≫ release tail
        XCTAssertFalse(voice.active)
        var out = [Float](repeating: 0, count: 64)
        XCTAssertFalse(voice.render(into: &out, frames: 64))
        for i in 0..<64 {
            XCTAssertEqual(out[i], 0)
        }
    }

    // 6. quickRelease reaps fast (0.008 s time constant vs the layer's 0.03 s release).
    func testQuickReleaseReapsTheVoiceFast() {
        let layer = PatchLayer(
            keyRange: fullKey,
            velRange: fullVel,
            generator: .additive([AdditivePartial(ratio: 1, level: 1)]),
            tva: TvaParams(
                level: 0.8,
                adsr: AdsrParams(attack: 0.005, decay: 0.1, sustain: 0.5, release: 0.03),
                velCurve: 1,
            ),
        )
        // Stolen right at noteOn: reapable within 0.05 s.
        let stolen = Voice(patch: makePatch([layer]), sampleRate: fs)
        stolen.noteOn(midi: 60, velocity: 1)
        stolen.quickRelease()
        _ = render(stolen, 2400) // 0.05 s
        XCTAssertFalse(stolen.active)
        // Stolen while sounding: the 0.008 s tau clears SILENCE_FLOOR within 0.1 s,
        // where the normal 0.03 s release would still be audible.
        let sounding = Voice(patch: makePatch([layer]), sampleRate: fs)
        sounding.noteOn(midi: 60, velocity: 1)
        _ = render(sounding, 4800) // 0.1 s
        sounding.quickRelease()
        _ = render(sounding, 4800) // 0.1 s
        XCTAssertFalse(sounding.active)
        let released = Voice(patch: makePatch([layer]), sampleRate: fs)
        released.noteOn(midi: 60, velocity: 1)
        _ = render(released, 4800)
        released.noteOff()
        _ = render(released, 4800)
        XCTAssertTrue(released.active)
    }

    // 7. Unresolvable zoneSetId: progressive-loading semantics — silent, inactive, no throw.
    func testTreatsAnUnresolvableZoneSetIdAsAnInactiveLayerNotAnError() {
        let layer = PatchLayer(
            keyRange: fullKey,
            velRange: fullVel,
            generator: .sample(zoneSetId: "missing.pack", crossfade: 0),
            tva: TvaParams(level: 0.8, adsr: adsr, velCurve: 1),
        )
        let noProvider = Voice(patch: makePatch([layer]), sampleRate: fs)
        noProvider.noteOn(midi: 60, velocity: 1)
        XCTAssertFalse(noProvider.active)
        var out = [Float](repeating: 0, count: 64)
        XCTAssertFalse(noProvider.render(into: &out, frames: 64))
        for i in 0..<64 {
            XCTAssertEqual(out[i], 0)
        }
        let unresolved = Voice(patch: makePatch([layer]), sampleRate: fs, zoneSetProvider: { _ in nil })
        unresolved.noteOn(midi: 60, velocity: 1)
        XCTAssertFalse(unresolved.active)
    }

    // 8. Chunk determinism: samplePos-based ticking makes output independent of render() call sizes.
    func testRendersIdenticallyRegardlessOfRenderCallSizes() {
        let layer = PatchLayer(
            keyRange: fullKey,
            velRange: fullVel,
            generator: .va(VaParams(shape: .saw, unison: 2, detuneCents: 10, pulseWidth: 0.5), seed: 5),
            tvf: TvfParams(
                mode: .lowpass,
                cutoffHz: 800,
                q: 0.9,
                envAmountHz: 1500,
                env: AdsrParams(attack: 0.01, decay: 0.1, sustain: 0.3, release: 0.1),
                keyTrack: 0.3,
                velAmountHz: 500,
            ),
            tva: TvaParams(level: 0.8, adsr: adsr, velCurve: 1.5),
            mod: LfoRouting(
                lfo: LfoParams(shape: .sine, rateHz: 50, delay: 0, fadeIn: 0),
                toPitchCents: 25,
                toCutoffHz: 400,
                toAmpDepth: 0.4,
            ),
        )
        let patch = makePatch([layer])
        let one = Voice(patch: patch, sampleRate: fs)
        one.noteOn(midi: 60, velocity: 0.7)
        let whole = render(one, 64)
        // Four aligned 16-frame calls.
        let four = Voice(patch: patch, sampleRate: fs)
        four.noteOn(midi: 60, velocity: 0.7)
        for k in 0..<4 {
            let out16 = render(four, 16)
            for i in 0..<16 {
                XCTAssertEqual(out16[i], whole[k * 16 + i])
            }
        }
        // Two calls that straddle chunk boundaries (24 + 40).
        let split = Voice(patch: patch, sampleRate: fs)
        split.noteOn(midi: 60, velocity: 0.7)
        let first = render(split, 24)
        let second = render(split, 40)
        for i in 0..<24 {
            XCTAssertEqual(first[i], whole[i])
        }
        for i in 0..<40 {
            XCTAssertEqual(second[i], whole[24 + i])
        }
    }

    // 9. Twin reference: fixture patch, noteOn(60, 0.8), first 8 samples.
    func testMatchesTheTwinReference() throws {
        let patch = try JSONDecoder().decode(Patch.self, from: Data(fixturePatchJSON.utf8))
        let voice = Voice(patch: patch, sampleRate: fs)
        voice.noteOn(midi: 60, velocity: 0.8)
        let out = render(voice, 8)
        XCTAssertEqual(twinReference.count, 8)
        for (i, expected) in twinReference.enumerated() {
            XCTAssertEqual(Double(out[i]), expected, accuracy: 1e-6)
        }
    }
}
