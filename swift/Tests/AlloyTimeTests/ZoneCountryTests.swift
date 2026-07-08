import XCTest
import AlloyTime

final class ZoneCountryTests: XCTestCase {
    func test_tableHasAllEntries() {
        XCTAssertEqual(ZoneCountry.table.count, 418)
    }

    func test_knownZonesMapToCountry() {
        XCTAssertEqual(ZoneCountry.country(for: "America/Los_Angeles"), "us")
        XCTAssertEqual(ZoneCountry.country(for: "Asia/Seoul"), "kr")
        XCTAssertEqual(ZoneCountry.country(for: "Europe/London"), "gb")
    }

    func test_unknownAndFixedOffsetHaveNoCountry() {
        XCTAssertNil(ZoneCountry.country(for: "UTC"))
        XCTAssertNil(ZoneCountry.country(for: "+05:30"))
    }

    func test_flagEmojiFromCountryCode() {
        XCTAssertEqual(ZoneCountry.flagEmoji(for: "America/Los_Angeles"), "\u{1F1FA}\u{1F1F8}") // 🇺🇸
        XCTAssertEqual(ZoneCountry.flagEmoji(for: "Asia/Seoul"), "\u{1F1F0}\u{1F1F7}")           // 🇰🇷
        XCTAssertNil(ZoneCountry.flagEmoji(for: "UTC"))
    }
}
