import AlloyUI
import SwiftUI
import XCTest

final class KnobsTests: XCTestCase {
    func test_knobCard_publicConstruction() {
        _ = KnobCard { Text("content") }
    }

    func test_knobLabel_publicConstruction() {
        _ = KnobLabel("Label")
    }

    func test_knobToggle_publicConstruction() {
        _ = KnobToggle(isOn: true, label: "Toggle", set: { _ in })
    }

    func test_knobSwitch_publicConstruction() {
        _ = KnobSwitch(isOn: true, label: "Switch", set: { _ in })
    }

    func test_knobSegment_publicConstruction() {
        let options: [(value: String, label: String)] = [("a", "Option A"), ("b", "Option B")]
        _ = KnobSegment(options: options, selection: "a", set: { _ in })
    }

    func test_knobField_publicConstruction() {
        _ = KnobField(action: {}) { Text("content") }
    }

    func test_knobColumns_boundaries() {
        // 599 -> 1 column
        XCTAssertEqual(knobColumns(for: 599), 1)
        // 600 -> 2 columns
        XCTAssertEqual(knobColumns(for: 600), 2)
        // 899 -> 2 columns
        XCTAssertEqual(knobColumns(for: 899), 2)
        // 900 -> 3 columns
        XCTAssertEqual(knobColumns(for: 900), 3)
    }
}
