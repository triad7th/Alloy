import AlloyTime
import XCTest

private final class MemoryStorage: TimeMachineStorage {
    var map: [String: String] = [:]
    func getItem(_ key: String) -> String? { map[key] }
    func setItem(_ key: String, _ value: String) { map[key] = value }
    func removeItem(_ key: String) { map[key] = nil }
}

final class TimeMachineTests: XCTestCase {
    private let local = "America/Los_Angeles"
    private let instant = Date(timeIntervalSince1970: 1_768_480_496)

    func test_liveByDefault() {
        let tm = TimeMachine(localZone: local, storage: nil)
        let real = Date(timeIntervalSince1970: 1_700_000_000)
        XCTAssertNil(tm.mock)
        XCTAssertFalse(tm.isMocked)
        XCTAssertEqual(tm.now(real), real)
        XCTAssertEqual(tm.timeZone(), local)
    }

    func test_mockFreezesAndClears() {
        let tm = TimeMachine(localZone: local, storage: nil)
        tm.setMock(instant)
        XCTAssertEqual(tm.now(Date()), instant)
        XCTAssertTrue(tm.isMocked)
        tm.clearMock()
        XCTAssertNil(tm.mock)
        XCTAssertFalse(tm.isMocked)
    }

    func test_zoneOverride_localMeansLive() {
        let tm = TimeMachine(localZone: local, storage: nil)
        tm.setTimeZone("Asia/Seoul")
        XCTAssertEqual(tm.timeZone(), "Asia/Seoul")
        XCTAssertTrue(tm.isMocked)
        tm.setTimeZone(local)
        XCTAssertNil(tm.mockTimeZone)
        XCTAssertFalse(tm.isMocked)
    }

    func test_persistsAndRestores() {
        let storage = MemoryStorage()
        let a = TimeMachine(localZone: local, storage: storage, namespace: "allyclock")
        a.setMock(instant)
        a.setTimeZone("Asia/Seoul")
        XCTAssertNotNil(storage.map["allyclock.clock.mock"])
        XCTAssertEqual(storage.map["allyclock.clock.tz"], "Asia/Seoul")
        let b = TimeMachine(localZone: local, storage: storage, namespace: "allyclock")
        XCTAssertEqual(b.mock, instant)
        XCTAssertEqual(b.mockTimeZone, "Asia/Seoul")
        a.clearMock()
        a.clearTimeZone()
        XCTAssertTrue(storage.map.isEmpty)
    }

    func test_ignoresInvalidPersistedValues() {
        let storage = MemoryStorage()
        storage.map["ally.clock.mock"] = "not-a-date"
        storage.map["ally.clock.tz"] = "Not/A_Zone"
        let tm = TimeMachine(localZone: local, storage: storage)
        XCTAssertNil(tm.mock)
        XCTAssertNil(tm.mockTimeZone)
    }
}
