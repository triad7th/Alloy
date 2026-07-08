import XCTest
import AlloyTime

final class ZoneCatalogTests: XCTestCase {
    // Fixed instants so DST assertions are deterministic.
    private let jan = Date(timeIntervalSince1970: 1_768_435_200) // 2026-01-15T00:00:00Z
    private let jul = Date(timeIntervalSince1970: 1_784_073_600) // 2026-07-15T00:00:00Z

    func test_offsetMinutesTracksDST() {
        XCTAssertEqual(ZoneCatalog.zoneOffsetMinutes("America/Los_Angeles", at: jan), -480)
        XCTAssertEqual(ZoneCatalog.zoneOffsetMinutes("America/Los_Angeles", at: jul), -420)
        XCTAssertEqual(ZoneCatalog.zoneOffsetMinutes("Asia/Seoul", at: jan), 540)
    }

    func test_formatOffsetUsesU2212AndPadding() {
        XCTAssertEqual(ZoneCatalog.formatOffset(540), "+09:00")
        XCTAssertEqual(ZoneCatalog.formatOffset(-450), "\u{2212}07:30")
        XCTAssertEqual(ZoneCatalog.formatOffset(0), "+00:00")
    }

    func test_buildOptionsLabelsAndSorts() {
        let options = ZoneCatalog.buildOptions(localZone: "Asia/Seoul", at: jan)
        let seoul = options.first { $0.id == "Asia/Seoul" }
        XCTAssertEqual(seoul?.label, "Asia/Seoul  +09:00")
        XCTAssertEqual(seoul?.offset, 540)
        // Sorted by offset then id.
        let offsets = options.map(\.offset)
        XCTAssertEqual(offsets, offsets.sorted())
        // Unknown local zone is prepended, not dropped.
        XCTAssertTrue(ZoneCatalog.buildTimeZones(localZone: "Not/AZone").contains("Not/AZone"))
    }

    func test_specialZonesSpanMinus12ToPlus14() {
        let special = ZoneCatalog.buildSpecialZones()
        XCTAssertEqual(special.count, 53) // UTC + 52 half-hour offsets
        XCTAssertEqual(special.first?.offset, -720)
        XCTAssertEqual(special.last?.offset, 840)
        let bombay = special.first { $0.id == "+05:30" }
        XCTAssertEqual(bombay?.offset, 330)
        let pst = special.first { $0.id == "-08:00" }
        XCTAssertEqual(pst?.label, "GMT\u{2212}08:00")
        XCTAssertEqual(special.first { $0.id == "UTC" }?.label, "UTC")
    }

    func test_resolveHandlesIANAAndFixedOffsetIds() {
        XCTAssertEqual(ZoneCatalog.resolve("Asia/Seoul")?.identifier, "Asia/Seoul")
        XCTAssertEqual(ZoneCatalog.resolve("+05:30")?.secondsFromGMT(), 19_800)
        XCTAssertEqual(ZoneCatalog.resolve("-08:00")?.secondsFromGMT(), -28_800)
        XCTAssertNil(ZoneCatalog.resolve("Not/AZone"))
        XCTAssertNil(ZoneCatalog.resolve(""))
        XCTAssertNil(ZoneCatalog.resolve("+5:30")) // malformed: must be +HH:MM
    }
}
