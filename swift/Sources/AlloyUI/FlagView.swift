import SwiftUI
#if canImport(UIKit)
import UIKit
#elseif canImport(AppKit)
import AppKit
#endif

/// Country flag keyed to an ISO 3166-1 alpha-2 code — the semantic key,
/// mirroring the SF-Symbol icon layer. Apps supply the artwork in their asset
/// catalog (square 1x1 renders of the same flag-icons set the web serves),
/// named `<assetPrefix><code>`, e.g. "Flags/us". A nil/blank code (UTC,
/// Etc/*, unknown zone) or missing artwork falls back to the neutral globe.
/// Mirrored twin of the web `FlagComponent`.
public enum FlagResolution {
    /// Asset-catalog name for a country code; nil when there is no country
    /// or the artwork is missing from the bundle.
    public static func assetName(
        forCountryCode countryCode: String?,
        assetPrefix: String = "Flags/",
        bundle: Bundle = .main
    ) -> String? {
        let code = (countryCode ?? "").trimmingCharacters(in: .whitespaces).lowercased()
        guard !code.isEmpty else { return nil }
        let name = "\(assetPrefix)\(code)"
        return hasImage(named: name, in: bundle) ? name : nil
    }

    private static func hasImage(named name: String, in bundle: Bundle) -> Bool {
        #if canImport(UIKit)
        return UIImage(named: name, in: bundle, with: nil) != nil
        #elseif canImport(AppKit)
        return bundle.image(forResource: name) != nil
        #else
        return false
        #endif
    }
}

public struct FlagView: View {
    let countryCode: String?
    var assetPrefix: String
    var bundle: Bundle

    public init(countryCode: String?, assetPrefix: String = "Flags/", bundle: Bundle = .main) {
        self.countryCode = countryCode
        self.assetPrefix = assetPrefix
        self.bundle = bundle
    }

    public var body: some View {
        if let asset = FlagResolution.assetName(
            forCountryCode: countryCode, assetPrefix: assetPrefix, bundle: bundle
        ) {
            Image(asset, bundle: bundle)
                .resizable()
                .scaledToFill()
                .clipShape(RoundedRectangle(cornerRadius: 2))
        } else {
            SFIcon("globe")
        }
    }
}
