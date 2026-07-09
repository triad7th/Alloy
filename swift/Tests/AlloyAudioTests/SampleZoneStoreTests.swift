@testable import AlloyAudio
import XCTest

final class SampleZoneStoreTests: XCTestCase {
    private func zone(_ midi: Int) -> SampleZone {
        SampleZone(midi: midi, samples: [0], sampleRate: 44_100)
    }

    func test_sampleFileNameZeroPadsToThreeDigits() {
        XCTAssertEqual(sampleFileName(midi: 21), "021.mp3")
        XCTAssertEqual(sampleFileName(midi: 60), "060.mp3")
        XCTAssertEqual(sampleFileName(midi: 108), "108.mp3")
    }

    func test_emptyStoreReturnsNilAndZeroCount() {
        let store = SampleZoneStore()
        XCTAssertEqual(store.loadedCount, 0)
        XCTAssertNil(store.nearestLoaded(to: 60))
    }

    func test_nearestPicksClosestZone() {
        let store = SampleZoneStore()
        store.add(zone(48))
        store.add(zone(60))
        XCTAssertEqual(store.nearestLoaded(to: 50)?.midi, 48)
        XCTAssertEqual(store.nearestLoaded(to: 58)?.midi, 60)
        XCTAssertEqual(store.loadedCount, 2)
    }

    func test_equidistantTiePrefersLowerZone() {
        let store = SampleZoneStore()
        store.add(zone(48))
        store.add(zone(52))
        XCTAssertEqual(store.nearestLoaded(to: 50)?.midi, 48)
    }

    func test_addReplacesExistingZoneForSameMidi() {
        let store = SampleZoneStore()
        store.add(zone(60))
        store.add(SampleZone(midi: 60, samples: [0, 1], sampleRate: 48_000))
        XCTAssertEqual(store.loadedCount, 1)
        XCTAssertEqual(store.nearestLoaded(to: 60)?.samples.count, 2)
    }
}
