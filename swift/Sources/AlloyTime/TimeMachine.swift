import Foundation
import Observation

/// Key-value store the TimeMachine persists into. UserDefaults conforms; tests
/// inject a dictionary. Mirrors the TS `TimeMachineStorage`.
public protocol TimeMachineStorage: AnyObject {
    func getItem(_ key: String) -> String?
    func setItem(_ key: String, _ value: String)
    func removeItem(_ key: String)
}

extension UserDefaults: TimeMachineStorage {
    public func getItem(_ key: String) -> String? { string(forKey: key) }
    public func setItem(_ key: String, _ value: String) { set(value, forKey: key) }
    public func removeItem(_ key: String) { removeObject(forKey: key) }
}

/// Time Machine model: an optional frozen instant + optional zone override that
/// every Ally face can read instead of the real clock. Pure model — apps layer
/// their own ticking/reactivity on top. Mirrored twin of `time-machine.ts`.
@Observable
public final class TimeMachine {
    public private(set) var mock: Date?
    public private(set) var mockTimeZone: String?

    private let localZone: String
    private let storage: TimeMachineStorage?
    private let mockKey: String
    private let tzKey: String
    nonisolated(unsafe) private static let iso = ISO8601DateFormatter()

    public init(localZone: String = TimeZone.current.identifier,
                storage: TimeMachineStorage? = UserDefaults.standard,
                namespace: String = "ally",
                isUsableZone: ((String) -> Bool)? = nil)
    {
        self.localZone = localZone
        self.storage = storage
        mockKey = "\(namespace).clock.mock"
        tzKey = "\(namespace).clock.tz"
        let usable = isUsableZone ?? { ZoneCatalog.resolve($0) != nil }

        if let stored = storage?.getItem(mockKey),
           let date = Self.parseISO(stored) { mock = date }
        if let zone = storage?.getItem(tzKey), usable(zone) { mockTimeZone = zone }
    }

    public var isMocked: Bool { mock != nil || mockTimeZone != nil }
    public func now(_ realNow: Date) -> Date { mock ?? realNow }
    public func timeZone() -> String { mockTimeZone ?? localZone }

    public func setMock(_ date: Date) {
        mock = date
        storage?.setItem(mockKey, Self.iso.string(from: date))
    }

    public func clearMock() {
        mock = nil
        storage?.removeItem(mockKey)
    }

    /// Selecting the device's local zone is "follow local", not a mock.
    public func setTimeZone(_ zone: String) {
        if zone == localZone {
            clearTimeZone()
            return
        }
        mockTimeZone = zone
        storage?.setItem(tzKey, zone)
    }

    public func clearTimeZone() {
        mockTimeZone = nil
        storage?.removeItem(tzKey)
    }

    /// ISO 8601 with or without fractional seconds (JS `toISOString()` includes
    /// milliseconds; the plain formatter does not parse them).
    private static func parseISO(_ s: String) -> Date? {
        if let d = iso.date(from: s) { return d }
        let fractional = ISO8601DateFormatter()
        fractional.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return fractional.date(from: s)
    }
}
