@testable import AlloyAudio
import XCTest

final class EffectTypesTests: XCTestCase {
    func testValidateMasterConfigAcceptsDefaultMasterConfig() {
        XCTAssertEqual(validateMasterConfig(defaultMasterConfig), [])
    }

    func testValidateReverbParamsRejectsDecayOutOfRange() {
        var params = defaultMasterConfig.reverb
        params.decay = 1.1
        XCTAssertFalse(validateReverbParams(params).isEmpty)
    }

    func testValidateDelayParamsRejectsFeedbackOutOfRange() {
        var params = defaultMasterConfig.delay
        params.feedback = 0.96
        XCTAssertFalse(validateDelayParams(params).isEmpty)
    }

    func testValidateLimiterParamsRejectsCeilingDbOutOfRange() {
        var params = defaultMasterConfig.limiter
        params.ceilingDb = 0.1
        XCTAssertFalse(validateLimiterParams(params).isEmpty)
    }
}
