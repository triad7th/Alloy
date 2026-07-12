@testable import AlloyAudio
import XCTest

/// Golden patch-render twin tests: the flagship cross-platform guarantee.
/// Five patches (one per generator kind, plus masterWet exercising the
/// master bus end-to-end) rendered through the full engine with an
/// identical event script; each is checked for determinism (both channels),
/// non-silence during the sustain window (left channel), tail silence after
/// every voice's release ends (both channels), and byte-for-byte-equivalent
/// (within tolerance) output against the TS twin at three probe windows,
/// per channel. The near-onset probe window is frame 200 (not 0): the
/// master bus's brickwall limiter adds limiterLookaheadSamples (64) samples
/// of latency to the whole render, so frame 200 is chosen to land past that
/// latency, into the note's early attack. patchFM(), patchOrgan(), and
/// patchFMWet() carry an insert and/or nonzero sends, so their L and R
/// differ; patchVA() and patchSample() stay insert-free with sends: 0/0, so
/// L == R exactly and the same probe arrays apply to both channels.
/// Twin: web src/dsp/golden-render.spec.ts (canonical).
final class GoldenRenderTests: XCTestCase {
    private let twinFmLAt200: [Double] = [
        0.018499910831451416, -0.1807583123445511, -0.2085844874382019, -0.02170083485543728,
        0.12831884622573853, 0.15995024144649506, 0.08683272451162338, -0.10458861291408539,
    ]
    private let twinFmRAt200: [Double] = [
        0.018499910831451416, -0.1807583123445511, -0.2085844874382019, -0.02170083485543728,
        0.12831884622573853, 0.15995024144649506, 0.08683272451162338, -0.10458861291408539,
    ]
    private let twinFmLAt12000: [Double] = [
        0.0412430614233017, 0.04025046527385712, 0.025656133890151978, 0.0007463379297405481,
        -0.018219761550426483, -0.021193811669945717, -0.01021641306579113, 0.014374683611094952,
    ]
    private let twinFmRAt12000: [Double] = [
        0.04948773980140686, 0.06238541007041931, 0.054564908146858215, 0.02612711675465107,
        -0.006834726314991713, -0.02934853732585907, -0.03359094634652138, -0.013981420546770096,
    ]
    private let twinFmLAt30000: [Double] = [
        0.0049483561888337135, 0.004591814707964659, 0.004224658012390137, 0.003848353400826454,
        0.0034656422212719917, 0.0030797093641012907, 0.0026931101456284523, 0.0023070184979587793,
    ]
    private let twinFmRAt30000: [Double] = [
        0.0050187199376523495, 0.0047462452203035355, 0.004462467040866613, 0.004168746527284384,
        0.003867511870339513, 0.0035614382941275835, 0.0032525116112083197, 0.0029414622113108635,
    ]

    private let twinVaAt200: [Double] = [
        0.3057917654514313, 0.3143463432788849, 0.3229660391807556, 0.3316505551338196,
        0.3403979539871216, 0.3492056727409363, 0.3580710291862488, 0.3669917583465576,
    ]
    private let twinVaAt12000: [Double] = [
        -0.21438194811344147, -0.19875241816043854, -0.18303890526294708, -0.16730928421020508,
        -0.1516093611717224, -0.13596504926681519, -0.12038620561361313, -0.10487114638090134,
    ]
    private let twinVaAt30000: [Double] = [
        -0.00042984061292372644, -0.0003775983350351453, -0.00032548833405599, -0.00027351724565960467,
        -0.00022168364375829697, -0.00016998039791360497, -0.00011839654325740412, -0.00006691899034194648,
    ]

    private let twinOrganLAt200: [Double] = [
        -0.04067736491560936, -0.041119758039712906, -0.041802722960710526, -0.04277607798576355,
        -0.04408556967973709, -0.04577173292636871, -0.04786883667111397, -0.05040391534566879,
    ]
    private let twinOrganRAt200: [Double] = [
        -0.0368497371673584, -0.03726723790168762, -0.03790324553847313, -0.03880323842167854,
        -0.040009088814258575, -0.04155801609158516, -0.04348160699009895, -0.045804936438798904,
    ]
    private let twinOrganLAt12000: [Double] = [
        0.2583601474761963, 0.2580789625644684, 0.2571820020675659, 0.2555491328239441,
        0.25306808948516846, 0.24963992834091187, 0.24518407881259918, 0.23964311182498932,
    ]
    private let twinOrganRAt12000: [Double] = [
        0.1812129020690918, 0.18096467852592468, 0.18028497695922852, 0.17908991873264313,
        0.17730136215686798, 0.1748504638671875, 0.17168135941028595, 0.16775444149971008,
    ]
    private let twinOrganLAt30000: [Double] = [
        -0.00007734073005849496, -0.00008516920206602663, -0.00009322958794655278, -0.0001016331952996552,
        -0.00011049464956158772, -0.00011992547661066055, -0.00013002783816773444, -0.00014088861644268036,
    ]
    private let twinOrganRAt30000: [Double] = [
        -0.00012301449896767735, -0.0001354843407170847, -0.0001483264350099489, -0.00016171806782949716,
        -0.000175841836608015, -0.0001908754784381017, -0.00020698206208180636, -0.0002243002236355096,
    ]

    private let twinSampleAt200: [Double] = [
        -0.5102869272232056, -0.5109360218048096, -0.5109862685203552, -0.5104369521141052,
        -0.5092895030975342, -0.5075443387031555, -0.5052044987678528, -0.5022722482681274,
    ]
    private let twinSampleAt12000: [Double] = [
        0.19346870481967926, 0.19412264227867126, 0.19450822472572327, 0.19465197622776031,
        0.19456924498081207, 0.1942799836397171, 0.19380927085876465, 0.19316911697387695,
    ]
    private let twinSampleAt30000: [Double] = [
        0.012282714247703552, 0.011408376507461071, 0.010517829097807407, 0.009613733738660812,
        0.008698588237166405, 0.007775065489113331, 0.006845793686807156, 0.005913407541811466,
    ]

    // masterWet: patchFMWet() (patchFM()'s layer/inserts, sends: reverb 0.3,
    // delay 0.25) — the case that exercises the master bus's reverb tail,
    // delay echo, and brickwall limiter end-to-end. Not insert-free: reverb
    // decorrelates L/R on top of the chorus insert.
    private let twinMasterWetLAt200: [Double] = [
        0.018499910831451416, -0.1807583123445511, -0.2085844874382019, -0.02170083485543728,
        0.12831884622573853, 0.15995024144649506, 0.08683272451162338, -0.10458861291408539,
    ]
    private let twinMasterWetRAt200: [Double] = [
        0.018499910831451416, -0.1807583123445511, -0.2085844874382019, -0.02170083485543728,
        0.12831884622573853, 0.15995024144649506, 0.08683272451162338, -0.10458861291408539,
    ]
    private let twinMasterWetLAt12000: [Double] = [
        -0.015728335827589035, -0.03877471387386322, -0.05660790205001831, -0.09331516176462173,
        -0.13616147637367249, -0.15300555527210236, -0.1356615275144577, -0.09122169762849808,
    ]
    private let twinMasterWetRAt12000: [Double] = [
        0.09207042306661606, 0.08398067951202393, 0.08119934797286987, 0.06326331943273544,
        0.017731640487909317, -0.020814215764403343, -0.03312517702579498, -0.009411775507032871,
    ]
    private let twinMasterWetLAt30000: [Double] = [
        -0.026331517845392227, -0.029540114104747772, -0.03609754517674446, -0.045199915766716,
        -0.05276743322610855, -0.056241218000650406, -0.05606941506266594, -0.05228394269943237,
    ]
    private let twinMasterWetRAt30000: [Double] = [
        0.03205595165491104, 0.03391000255942345, 0.030505863949656487, 0.021879851818084717,
        0.012082608416676521, 0.004883649758994579, 0.002248973585665226, 0.005562318488955498,
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
        let at200: [Double]
        let at12000: [Double]
        let at30000: [Double]
    }

    /// - Parameter tailFrames: total frames for the "silent after the
    ///   release tail" check only (determinism and twin-probe checks always
    ///   use GOLDEN_FRAMES, matching the captured probe arrays). Defaults to
    ///   GOLDEN_FRAMES; masterWet overrides this to a much longer render
    ///   because its reverb send has a multi-second decay tail —
    ///   GOLDEN_FRAMES's default 1000-sample post-release window is long
    ///   enough for a bare TVA release (and short insert tails like chorus
    ///   or tremolo), but not for the master reverb's FDN decay time
    ///   constant.
    private func assertGolden(
        _ patch: Patch,
        zoneSetProvider: ZoneSetProvider?,
        left: ChannelProbes,
        right: ChannelProbes,
        insertFree: Bool,
        tailFrames: Int? = nil,
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
        let total = tailFrames ?? GOLDEN_FRAMES
        let tail = total == GOLDEN_FRAMES ? a : renderPatch(patch: patch, events: events, totalFrames: total, sampleRate: GOLDEN_FS, zoneSetProvider: zoneSetProvider)
        XCTAssertGreaterThan(rms(tail.left, 6000, 12000), 0.01, file: file, line: line)
        XCTAssertLessThan(rms(tail.left, total - 1000, total), 0.01, file: file, line: line)
        XCTAssertLessThan(rms(tail.right, total - 1000, total), 0.01, file: file, line: line)

        // Twin probes, per channel.
        for (channel, out, probes) in [("left", a.left, left), ("right", a.right, right)] {
            XCTAssertEqual(probes.at200.count, 8, channel, file: file, line: line)
            XCTAssertEqual(probes.at12000.count, 8, channel, file: file, line: line)
            XCTAssertEqual(probes.at30000.count, 8, channel, file: file, line: line)
            for (i, pair) in zip(probe(out, 200), probes.at200).enumerated() {
                XCTAssertEqual(pair.0, pair.1, accuracy: 1e-4, "\(channel) at200[\(i)]", file: file, line: line)
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
            left: ChannelProbes(at200: twinFmLAt200, at12000: twinFmLAt12000, at30000: twinFmLAt30000),
            right: ChannelProbes(at200: twinFmRAt200, at12000: twinFmRAt12000, at30000: twinFmRAt30000),
            insertFree: false,
        )
    }

    func testVaGoldenRender() {
        let probes = ChannelProbes(at200: twinVaAt200, at12000: twinVaAt12000, at30000: twinVaAt30000)
        assertGolden(patchVA(), zoneSetProvider: nil, left: probes, right: probes, insertFree: true)
    }

    func testOrganGoldenRender() {
        assertGolden(
            patchOrgan(),
            zoneSetProvider: nil,
            left: ChannelProbes(at200: twinOrganLAt200, at12000: twinOrganLAt12000, at30000: twinOrganLAt30000),
            right: ChannelProbes(at200: twinOrganRAt200, at12000: twinOrganRAt12000, at30000: twinOrganRAt30000),
            insertFree: false,
        )
    }

    func testSampleGoldenRender() {
        let probes = ChannelProbes(at200: twinSampleAt200, at12000: twinSampleAt12000, at30000: twinSampleAt30000)
        assertGolden(patchSample(), zoneSetProvider: goldenZoneSetProvider, left: probes, right: probes, insertFree: true)
    }

    func testMasterWetGoldenRender() {
        assertGolden(
            patchFMWet(),
            zoneSetProvider: nil,
            left: ChannelProbes(at200: twinMasterWetLAt200, at12000: twinMasterWetLAt12000, at30000: twinMasterWetLAt30000),
            right: ChannelProbes(at200: twinMasterWetRAt200, at12000: twinMasterWetRAt12000, at30000: twinMasterWetRAt30000),
            insertFree: false,
            // Reverb decay 0.72 gives the FDN a multi-second -60dB time
            // constant; 100 000 frames (~2.1 s, ~1.35 s past GOLDEN_FRAMES)
            // is comfortably past both the reverb tail and the last
            // ping-pong delay echo.
            tailFrames: 100_000,
        )
    }
}
