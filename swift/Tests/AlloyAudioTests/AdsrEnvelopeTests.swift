@testable import AlloyAudio
import XCTest

final class AdsrEnvelopeTests: XCTestCase {
    private let fs = 48_000.0
    private let params = AdsrParams(attack: 0.01, decay: 0.1, sustain: 0.5, release: 0.05)
    // Same values as adsr-envelope.spec.ts TWIN_REFERENCE.
    private let twinReference: [Double] = [0.003965269774198532, 0.007918444462120533, 0.011859561316668987, 0.01578865759074688, 0.019705768674612045, 0.023610930889844894, 0.02750418335199356, 0.03138555958867073]

    private func render(_ env: AdsrEnvelope, _ n: Int) -> [Double] {
        (0..<n).map { _ in env.nextSample() }
    }

    func testSilentBeforeNoteOn() {
        let env = AdsrEnvelope(params: params, sampleRate: fs)
        XCTAssertFalse(env.isActive)
        XCTAssertEqual(env.nextSample(), 0)
    }

    func testMonotonicAttackReachesOne() {
        let env = AdsrEnvelope(params: params, sampleRate: fs)
        env.noteOn()
        let out = render(env, Int(2 * params.attack * fs))
        // Check monotonic rise during attack phase (until peak is reached)
        for i in 1..<out.count {
            XCTAssertGreaterThanOrEqual(out[i], out[i - 1] - 1e-12)
            if out[i] >= 1 { break }  // Stop checking after peak; decay phase is allowed to drop
        }
        XCTAssertEqual(out.max(), 1)
    }

    func testDecaysTowardSustain() {
        let env = AdsrEnvelope(params: params, sampleRate: fs)
        env.noteOn()
        _ = render(env, Int((params.attack + 6 * params.decay) * fs))
        let settled = env.nextSample()
        XCTAssertGreaterThan(settled, params.sustain * 0.98)
        XCTAssertLessThan(settled, params.sustain * 1.02)
    }

    func testReleaseEndsInactive() {
        let env = AdsrEnvelope(params: params, sampleRate: fs)
        env.noteOn()
        _ = render(env, Int(0.2 * fs))
        env.noteOff()
        _ = render(env, Int(15 * params.release * fs))
        XCTAssertFalse(env.isActive)
        XCTAssertEqual(env.nextSample(), 0)
    }

    func testMatchesTwinReference() {
        let env = AdsrEnvelope(params: params, sampleRate: fs)
        env.noteOn()
        XCTAssertEqual(twinReference.count, 8)
        for expected in twinReference {
            XCTAssertEqual(env.nextSample(), expected, accuracy: 1e-6)
        }
    }
}
