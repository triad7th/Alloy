import AlloyUI
import SwiftUI
import XCTest

// Twin of zone-picker.component.spec.ts — same fixtures, same filter contract.
final class ZonePickerTests: XCTestCase {
    private let options = [
        ZonePickerOption(id: "", label: "Follow Time Machine"),
        ZonePickerOption(id: "Asia/Seoul", label: "Asia/Seoul  +09:00"),
        ZonePickerOption(id: "Asia/Tokyo", label: "Asia/Tokyo  +09:00"),
    ]

    func test_blankQueryReturnsAllOptions() {
        XCTAssertEqual(ZonePickerView.filtered(options, query: "").count, 3)
        XCTAssertEqual(ZonePickerView.filtered(options, query: "   ").count, 3)
    }

    func test_filtersByFullLabelCaseInsensitive() {
        let hits = ZonePickerView.filtered(options, query: "tokyo")
        XCTAssertEqual(hits.map(\.id), ["Asia/Tokyo"])
        // Offset text is part of the label and therefore searchable.
        XCTAssertEqual(ZonePickerView.filtered(options, query: "+09").count, 2)
    }

    func test_noMatchesReturnsEmpty() {
        XCTAssertTrue(ZonePickerView.filtered(options, query: "zzz").isEmpty)
    }

    func test_publicConstruction() {
        _ = ZonePickerView(options: options, selectedId: "Asia/Seoul") { _ in }
        _ = ZonePickerView(
            options: options, selectedId: "", listHeight: 200,
            countryFor: { $0 == "Asia/Seoul" ? "kr" : nil }
        ) { _ in }
    }
}
