@testable import AlloyUI
import SwiftUI
import XCTest

@MainActor
final class GlassSheetTests: XCTestCase {
    func test_iconForegroundDefaultsAndOverride() {
        if #available(iOS 26.0, macOS 26.0, tvOS 26.0, watchOS 26.0, *) {
            let original = GlassIconButton(icon: "xmark", label: "Close") {}
            let custom = GlassIconButton(icon: "xmark", label: "Close", foreground: .brown) {}
            XCTAssertNil(original.foreground)
            XCTAssertEqual(custom.foreground, .brown)
            _ = original.body
            _ = custom.body
        }
    }

    func test_publicConstruction() {
        _ = SFIcon("globe")
        if #available(iOS 26.0, macOS 26.0, tvOS 26.0, watchOS 26.0, *) {
            _ = GlassIconButton(icon: "xmark", label: "Close") {}
            _ = GlassSheet(title: "Test", onClosed: {}) { dismiss in Text("body") }
            _ = GlassSheet(
                title: "Test",
                trailing: GlassSheetAction(icon: "arrow.clockwise", label: "Reset", action: {}),
                onClosed: {},
            ) { _ in Text("body") }
        }
    }
}
