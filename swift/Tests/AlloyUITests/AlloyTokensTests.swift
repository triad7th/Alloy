import AlloyUI
import SwiftUI
import XCTest

final class AlloyTokensTests: XCTestCase {
    func test_twinAgreedDurations() {
        XCTAssertEqual(AlloyTokens.sheetAnimation, 0.28, accuracy: 0.0001)
        XCTAssertEqual(AlloyTokens.autoHide, 4.0, accuracy: 0.0001)
    }

    func test_tintSpotValue() {
#if canImport(UIKit)
        // #0a84ff → r 10, g 132, b 255
        let resolved = UIColor(AlloyTokens.tint)
        var r: CGFloat = 0, g: CGFloat = 0, b: CGFloat = 0, a: CGFloat = 0
        resolved.getRed(&r, green: &g, blue: &b, alpha: &a)
        XCTAssertEqual(r, 10.0 / 255.0, accuracy: 0.001)
        XCTAssertEqual(g, 132.0 / 255.0, accuracy: 0.001)
        XCTAssertEqual(b, 255.0 / 255.0, accuracy: 0.001)
        XCTAssertEqual(a, 1.0, accuracy: 0.001)
#endif
    }
}
