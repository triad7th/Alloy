@testable import AlloyAudio
import XCTest

/// Golden patch-render twin tests: the flagship cross-platform guarantee.
/// Four patches (one per generator kind) rendered through the full engine
/// with an identical event script; each is checked for determinism (both
/// channels), non-silence during the sustain window (left channel), tail
/// silence after every voice's release ends (both channels), and
/// byte-for-byte-equivalent (within tolerance) output against the TS twin
/// at three probe windows, per channel. patchFM() and patchOrgan() carry an
/// insert (chorus / tremolo respectively), so their L and R differ; patchVA()
/// and patchSample() stay insert-free, so L == R exactly and the same probe
/// arrays apply to both channels.
/// Twin: web src/dsp/golden-render.spec.ts (canonical).
final class GoldenRenderTests: XCTestCase {
    private let twinFmLAt0: [Double] = [
        0, 0.00004385089414427057, 0.00023502255498897284, 0.0006316988146863878, 0.0011505421716719866,
        0.0015545807546004653, 0.001461898791603744, 0.0004615425132215023,
    ]
    private let twinFmRAt0: [Double] = [
        0, 0.00004385089414427057, 0.00023502255498897284, 0.0006316988146863878, 0.0011505421716719866,
        0.0015545807546004653, 0.001461898791603744, 0.0004615425132215023,
    ]
    private let twinFmLAt12000: [Double] = [
        0.09767042100429535, 0.1319395899772644, 0.14433124661445618, 0.1342770755290985,
        0.10536986589431763, 0.06848285347223282, 0.044441405683755875, 0.043092530220746994,
    ]
    private let twinFmRAt12000: [Double] = [
        0.06892663240432739, 0.1115599200129509, 0.14111073315143585, 0.14879755675792694,
        0.13041824102401733, 0.09379544109106064, 0.06045583263039589, 0.045510582625865936,
    ]
    private let twinFmLAt30000: [Double] = [
        -0.0002945534943137318, 0.00003405138704692945, 0.0003620763018261641, 0.0006869593635201454,
        0.0010074613383039832, 0.001323775970377028, 0.001636893255636096, 0.0019475476583465934,
    ]
    private let twinFmRAt30000: [Double] = [
        -0.0006600169581361115, -0.0003977482265327126, -0.00013420407776720822, 0.00012850291386712343,
        0.00038940913509577513, 0.00064875278621912, 0.0009073815308511257, 0.0011658334406092763,
    ]

    private let twinVaAt0: [Double] = [
        -0.00000528768669028068, -0.00011583104060264304, -0.0006340973195619881, -0.001822814461775124,
        -0.0037135493475943804, -0.006206805817782879, -0.009122508578002453, -0.012244155630469322,
    ]
    private let twinVaAt12000: [Double] = [
        -0.3694263994693756, -0.3372212052345276, -0.30703914165496826, -0.2798972725868225,
        -0.25608959794044495, -0.2354125678539276, -0.2173682451248169, -0.20132917165756226,
    ]
    private let twinVaAt30000: [Double] = [
        0.0005263532511889935, 0.0005169602809473872, 0.0005355137982405722, 0.0005767068360000849,
        0.0006321268738247454, 0.00066895637428388, 0.0006399331614375114, 0.0005355597822926939,
    ]

    private let twinOrganLAt0: [Double] = [
        0, 0.0008677557343617082, 0.0025832613464444876, 0.005118618253618479, 0.008438479155302048,
        0.01250061672180891, 0.017256595194339752, 0.022652553394436836,
    ]
    private let twinOrganRAt0: [Double] = [
        0, 0.0007405632641166449, 0.00220557302236557, 0.004372142255306244, 0.007210978772491217,
        0.010686858557164669, 0.014759184792637825, 0.019382648169994354,
    ]
    private let twinOrganLAt12000: [Double] = [
        -0.031063152477145195, -0.015996789559721947, -0.0013805433409288526, 0.012364795431494713,
        0.024838926270604134, 0.035674113780260086, 0.04454612731933594, 0.05118346959352493,
    ]
    private let twinOrganRAt12000: [Double] = [
        -0.021408390253782272, -0.011021876707673073, -0.0009509489173069596, 0.008514880202710629,
        0.017100509256124496, 0.024553539231419563, 0.030651777982711792, 0.0352095402777195,
    ]
    private let twinOrganLAt30000: [Double] = [
        -0.00001965241062862333, 0.00002713444882829208, 0.00007348675717366859, 0.00011890262248925865,
        0.00016290343774016947, 0.00020504584244918078, 0.00024493239470757544, 0.0002822207461576909,
    ]
    private let twinOrganRAt30000: [Double] = [
        -0.00003150292468490079, 0.000043501397158252075, 0.00011782522778958082, 0.00019066344248130918,
        0.00026124794385395944, 0.00032886682311072946, 0.000392881513107568, 0.00045274157309904695,
    ]

    private let twinSampleAt0: [Double] = [
        0, 0.0012398377293720841, 0.003989039454609156, 0.007852182723581791, 0.012874904088675976,
        0.018994592130184174, 0.02614615671336651, 0.03426505997776985,
    ]
    private let twinSampleAt12000: [Double] = [
        0.24263130128383636, 0.24333973228931427, 0.24375347793102264, 0.24384763836860657,
        0.24360333383083344, 0.2430049031972885, 0.24202658236026764, 0.24065963923931122,
    ]
    private let twinSampleAt30000: [Double] = [
        -0.0013253232464194298, -0.0006364962318912148, 0.000051807881391141564, 0.0007370639941655099,
        0.0014171609655022621, 0.0020897265058010817, 0.002752428175881505, 0.003403137670829892,
    ]

    private func rms(_ samples: [Float], _ from: Int, _ to: Int) -> Double {
        var sum = 0.0
        for i in from..<to {
            sum += Double(samples[i]) * Double(samples[i])
        }
        return (sum / Double(to - from)).squareRoot()
    }

    private func probe(_ samples: [Float], _ start: Int, _ length: Int = 8) -> [Double] {
        (0..<length).map { Double(samples[start + $0]) }
    }

    private struct ChannelProbes {
        let at0: [Double]
        let at12000: [Double]
        let at30000: [Double]
    }

    private func assertGolden(
        _ patch: Patch,
        zoneSetProvider: ZoneSetProvider?,
        left: ChannelProbes,
        right: ChannelProbes,
        insertFree: Bool,
        file: StaticString = #filePath,
        line: UInt = #line,
    ) {
        // Determinism: two renders must be byte-identical on both channels.
        let events = goldenEvents()
        let a = renderPatch(patch: patch, events: events, totalFrames: GOLDEN_FRAMES, sampleRate: GOLDEN_FS, zoneSetProvider: zoneSetProvider)
        let b = renderPatch(patch: patch, events: events, totalFrames: GOLDEN_FRAMES, sampleRate: GOLDEN_FS, zoneSetProvider: zoneSetProvider)
        XCTAssertEqual(a.left.count, GOLDEN_FRAMES, file: file, line: line)
        XCTAssertEqual(a.right.count, GOLDEN_FRAMES, file: file, line: line)
        for i in 0..<GOLDEN_FRAMES {
            XCTAssertEqual(b.left[i], a.left[i], file: file, line: line)
            XCTAssertEqual(b.right[i], a.right[i], file: file, line: line)
        }

        // Non-silence during the sustain window (left); silence after the
        // release tail (both channels).
        XCTAssertGreaterThan(rms(a.left, 6000, 12000), 0.01, file: file, line: line)
        XCTAssertLessThan(rms(a.left, GOLDEN_FRAMES - 1000, GOLDEN_FRAMES), 0.01, file: file, line: line)
        XCTAssertLessThan(rms(a.right, GOLDEN_FRAMES - 1000, GOLDEN_FRAMES), 0.01, file: file, line: line)

        // Twin probes, per channel.
        for (channel, out, probes) in [("left", a.left, left), ("right", a.right, right)] {
            XCTAssertEqual(probes.at0.count, 8, channel, file: file, line: line)
            XCTAssertEqual(probes.at12000.count, 8, channel, file: file, line: line)
            XCTAssertEqual(probes.at30000.count, 8, channel, file: file, line: line)
            for (i, pair) in zip(probe(out, 0), probes.at0).enumerated() {
                XCTAssertEqual(pair.0, pair.1, accuracy: 1e-4, "\(channel) at0[\(i)]", file: file, line: line)
            }
            for (i, pair) in zip(probe(out, 12000), probes.at12000).enumerated() {
                XCTAssertEqual(pair.0, pair.1, accuracy: 1e-4, "\(channel) at12000[\(i)]", file: file, line: line)
            }
            for (i, pair) in zip(probe(out, 30000), probes.at30000).enumerated() {
                XCTAssertEqual(pair.0, pair.1, accuracy: 1e-4, "\(channel) at30000[\(i)]", file: file, line: line)
            }
        }

        // Insert-free patches (VA, SAMPLE) pin the bypass path: L == R
        // bit-exactly across the full render, not just at the probe windows.
        if insertFree {
            for i in 0..<GOLDEN_FRAMES {
                XCTAssertEqual(a.right[i], a.left[i], "frame \(i)", file: file, line: line)
            }
        }
    }

    func testFmGoldenRender() {
        assertGolden(
            patchFM(),
            zoneSetProvider: nil,
            left: ChannelProbes(at0: twinFmLAt0, at12000: twinFmLAt12000, at30000: twinFmLAt30000),
            right: ChannelProbes(at0: twinFmRAt0, at12000: twinFmRAt12000, at30000: twinFmRAt30000),
            insertFree: false,
        )
    }

    func testVaGoldenRender() {
        let probes = ChannelProbes(at0: twinVaAt0, at12000: twinVaAt12000, at30000: twinVaAt30000)
        assertGolden(patchVA(), zoneSetProvider: nil, left: probes, right: probes, insertFree: true)
    }

    func testOrganGoldenRender() {
        assertGolden(
            patchOrgan(),
            zoneSetProvider: nil,
            left: ChannelProbes(at0: twinOrganLAt0, at12000: twinOrganLAt12000, at30000: twinOrganLAt30000),
            right: ChannelProbes(at0: twinOrganRAt0, at12000: twinOrganRAt12000, at30000: twinOrganRAt30000),
            insertFree: false,
        )
    }

    func testSampleGoldenRender() {
        let probes = ChannelProbes(at0: twinSampleAt0, at12000: twinSampleAt12000, at30000: twinSampleAt30000)
        assertGolden(patchSample(), zoneSetProvider: goldenZoneSetProvider, left: probes, right: probes, insertFree: true)
    }
}
