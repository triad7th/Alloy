import AlloyUI
import SwiftUI
import XCTest

// Twin of flag.component.spec.ts — code normalization and globe fallback.
final class FlagViewTests: XCTestCase {
    func test_blankOrNilCodeResolvesToNoAsset() {
        XCTAssertNil(FlagResolution.assetName(forCountryCode: nil))
        XCTAssertNil(FlagResolution.assetName(forCountryCode: ""))
        XCTAssertNil(FlagResolution.assetName(forCountryCode: "   "))
    }

    func test_missingArtworkResolvesToNoAsset() {
        // The test bundle ships no flag assets, so even a valid code falls
        // back to nil — the view then renders the globe, like the web twin.
        XCTAssertNil(FlagResolution.assetName(forCountryCode: "KR"))
    }

    func test_publicConstruction() {
        _ = FlagView(countryCode: "kr")
        _ = FlagView(countryCode: nil, assetPrefix: "CountryFlags/", bundle: .main)
    }
}
