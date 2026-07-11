@testable import AlloyAudio
import XCTest

/// Golden patch-render twin tests: the flagship cross-platform guarantee.
/// Four patches (one per generator kind) rendered through the full engine
/// with an identical event script; each is checked for determinism,
/// non-silence during the sustain window, tail silence after every voice's
/// release ends, and byte-for-byte-equivalent (within tolerance) output
/// against the TS twin at three probe windows.
/// Twin: web src/dsp/golden-render.spec.ts (canonical).
final class GoldenRenderTests: XCTestCase {
    private let twinFmAt0: [Double] = [
        0, 0.00006746291182935238, 0.0003615731548052281, 0.0009718443034216762, 0.0017700649332255125,
        0.0023916626814752817, 0.002249075099825859, 0.0007100654183886945,
    ]
    private let twinFmAt12000: [Double] = [
        0.11054803431034088, 0.17245441675186157, 0.2001546025276184, 0.1871742457151413,
        0.13872912526130676, 0.07269862294197083, 0.023765740916132927, 0.01684357039630413,
    ]
    private let twinFmAt30000: [Double] = [
        -0.0005669677630066872, -0.00021138858573976904, 0.00014202739112079144, 0.0004905309760943055,
        0.0008330991840921342, 0.0011703576892614365, 0.0015036676777526736, 0.001833861111663282,
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

    private let twinOrganAt0: [Double] = [
        0, 0.0010849360842257738, 0.003230514470487833, 0.006402547005563974, 0.01055749598890543,
        0.015643175691366196, 0.021599583327770233, 0.02835986763238907,
    ]
    private let twinOrganAt12000: [Double] = [
        -0.03137022629380226, -0.016154028475284576, -0.0013940362259745598, 0.012484954670071602,
        0.025078928098082542, 0.036016833037137985, 0.04497161880135536, 0.051669541746377945,
    ]
    private let twinOrganAt30000: [Double] = [
        -0.000032754018320702016, 0.000045224074710858986, 0.00012247786798980087, 0.0001981708046514541,
        0.0002715051523409784, 0.00034174195025116205, 0.0004082187369931489, 0.0004703648737631738,
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

    private func assertGolden(
        _ patch: Patch,
        zoneSetProvider: ZoneSetProvider?,
        at0: [Double],
        at12000: [Double],
        at30000: [Double],
        file: StaticString = #filePath,
        line: UInt = #line,
    ) {
        // Determinism: two renders must be byte-identical.
        let events = goldenEvents()
        let a = renderPatch(patch: patch, events: events, totalFrames: GOLDEN_FRAMES, sampleRate: GOLDEN_FS, zoneSetProvider: zoneSetProvider)
        let b = renderPatch(patch: patch, events: events, totalFrames: GOLDEN_FRAMES, sampleRate: GOLDEN_FS, zoneSetProvider: zoneSetProvider)
        XCTAssertEqual(a.count, GOLDEN_FRAMES, file: file, line: line)
        for i in 0..<GOLDEN_FRAMES {
            XCTAssertEqual(b[i], a[i], file: file, line: line)
        }

        // Non-silence during the sustain window; silence after the release tail.
        XCTAssertGreaterThan(rms(a, 6000, 12000), 0.01, file: file, line: line)
        XCTAssertLessThan(rms(a, GOLDEN_FRAMES - 1000, GOLDEN_FRAMES), 0.01, file: file, line: line)

        // Twin probes.
        XCTAssertEqual(at0.count, 8, file: file, line: line)
        XCTAssertEqual(at12000.count, 8, file: file, line: line)
        XCTAssertEqual(at30000.count, 8, file: file, line: line)
        for (i, pair) in zip(probe(a, 0), at0).enumerated() {
            XCTAssertEqual(pair.0, pair.1, accuracy: 1e-4, "at0[\(i)]", file: file, line: line)
        }
        for (i, pair) in zip(probe(a, 12000), at12000).enumerated() {
            XCTAssertEqual(pair.0, pair.1, accuracy: 1e-4, "at12000[\(i)]", file: file, line: line)
        }
        for (i, pair) in zip(probe(a, 30000), at30000).enumerated() {
            XCTAssertEqual(pair.0, pair.1, accuracy: 1e-4, "at30000[\(i)]", file: file, line: line)
        }
    }

    func testFmGoldenRender() {
        assertGolden(patchFM(), zoneSetProvider: nil, at0: twinFmAt0, at12000: twinFmAt12000, at30000: twinFmAt30000)
    }

    func testVaGoldenRender() {
        assertGolden(patchVA(), zoneSetProvider: nil, at0: twinVaAt0, at12000: twinVaAt12000, at30000: twinVaAt30000)
    }

    func testOrganGoldenRender() {
        assertGolden(patchOrgan(), zoneSetProvider: nil, at0: twinOrganAt0, at12000: twinOrganAt12000, at30000: twinOrganAt30000)
    }

    func testSampleGoldenRender() {
        assertGolden(patchSample(), zoneSetProvider: goldenZoneSetProvider, at0: twinSampleAt0, at12000: twinSampleAt12000, at30000: twinSampleAt30000)
    }
}
