import AlloyTime
import XCTest

final class ZoneFormatTests: XCTestCase {
    // 2026-01-15T12:34:56Z — the twin fixture instant.
    private let instant = Date(timeIntervalSince1970: 1_768_480_496)
    private func zone(_ id: String) -> TimeZone { ZoneCatalog.resolve(id)! }

    func test_compactOffset_wholeHours() {
        XCTAssertEqual(ZoneFormat.compactOffset(instant, timeZone: zone("America/Los_Angeles")), "\u{2212}8")
        XCTAssertEqual(ZoneFormat.compactOffset(instant, timeZone: zone("Asia/Seoul")), "+9")
        XCTAssertEqual(ZoneFormat.compactOffset(instant, timeZone: zone("UTC")), "+0")
    }

    func test_compactOffset_subHour() {
        XCTAssertEqual(ZoneFormat.compactOffset(instant, timeZone: zone("Asia/Kolkata")), "+5:30")
        XCTAssertEqual(ZoneFormat.compactOffset(instant, zone: "-03:30"), "\u{2212}3:30")
    }

    func test_gmtOffset() {
        XCTAssertEqual(ZoneFormat.gmtOffset(instant, timeZone: zone("America/Los_Angeles")), "GMT\u{2212}08:00")
        XCTAssertEqual(ZoneFormat.gmtOffset(instant, timeZone: zone("UTC")), "GMT+00:00")
        XCTAssertEqual(ZoneFormat.gmtOffset(instant, timeZone: zone("Asia/Kolkata")), "GMT+05:30")
    }

    func test_zoneCity() {
        XCTAssertEqual(ZoneFormat.zoneCity("America/Los_Angeles", abbreviate: false), "LOS ANGELES")
        XCTAssertEqual(ZoneFormat.zoneCity("America/Los_Angeles", abbreviate: true), "LA")
        XCTAssertEqual(ZoneFormat.zoneCity("Europe/London", abbreviate: true), "LON")
        XCTAssertEqual(ZoneFormat.zoneCity("America/Argentina/Buenos_Aires", abbreviate: true), "BA")
        XCTAssertEqual(ZoneFormat.zoneCity("UTC", abbreviate: true), "UTC")
        XCTAssertEqual(ZoneFormat.zoneCity("+05:30", abbreviate: true), "")
    }
}
