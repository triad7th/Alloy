@testable import AlloyAudio
import XCTest

final class DspPrngTests: XCTestCase {
    // Same 8 values as prng.spec.ts TWIN_REFERENCE (integer-exact).
    private let twinReference: [Double] = [0.00006295018829405308,0.015747428173199296,0.6164041024167091,0.07161863497458398,0.5584883580449969,0.17357419803738594,0.14725036034360528,0.10145739885047078]

    func testDeterministicForSeed() {
        let a = DspPrng(seed: 42)
        let b = DspPrng(seed: 42)
        for _ in 0..<100 {
            XCTAssertEqual(a.next(), b.next())
        }
    }

    func testStaysInUnitInterval() {
        let prng = DspPrng(seed: 7)
        for _ in 0..<10000 {
            let v = prng.next()
            XCTAssertGreaterThanOrEqual(v, 0)
            XCTAssertLessThan(v, 1)
        }
    }

    func testSeedZeroUsesNonzeroDefault() {
        XCTAssertNotEqual(DspPrng(seed: 0).next(), 0)
    }

    func testMatchesTwinReference() {
        let prng = DspPrng(seed: 1)
        XCTAssertEqual(twinReference.count, 8)
        for expected in twinReference {
            XCTAssertEqual(prng.next(), expected)
        }
    }
}
