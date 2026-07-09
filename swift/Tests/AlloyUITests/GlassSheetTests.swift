import AlloyUI
import SwiftUI
import XCTest

final class GlassSheetTests: XCTestCase {
    func test_publicConstruction() {
        _ = SFIcon("globe")
        if #available(iOS 26.0, macOS 26.0, tvOS 26.0, watchOS 26.0, *) {
            _ = GlassIconButton(icon: "xmark", label: "Close") {}
            _ = GlassSheet(title: "Test", onClose: {}) { Text("body") }
        }
    }
}
