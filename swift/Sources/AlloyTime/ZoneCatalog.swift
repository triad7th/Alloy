import Foundation

/// One picker row: a zone id, display label, and current UTC offset (minutes
/// east) for sorting. Port of `TimeZoneOption` in `zone-catalog.ts`.
public struct TimeZoneOption: Equatable, Sendable {
    public let id: String
    public let label: String
    public let offset: Int
    public init(id: String, label: String, offset: Int) {
        self.id = id; self.label = label; self.offset = offset
    }
}

/// Zone list + labels for pickers. Port of `zone-catalog.ts` onto Foundation:
/// `TimeZone.knownTimeZoneIdentifiers` plays `Intl.supportedValuesOf` and
/// `secondsFromGMT(for:)` replaces longOffset parsing. Built on demand — the
/// web caches only because the Intl scan is slow; Foundation's is cheap.
public enum ZoneCatalog {
    /// All known zone ids, with `localZone` prepended when Foundation doesn't
    /// know it (parity with the web's local-zone injection).
    public static func buildTimeZones(localZone: String) -> [String] {
        let base = TimeZone.knownTimeZoneIdentifiers
        return base.contains(localZone) ? base : [localZone] + base
    }

    /// Current UTC offset (minutes east) for a zone id at an instant; 0 for
    /// unresolvable ids (the web's bare-"GMT" fallback).
    public static func zoneOffsetMinutes(_ id: String, at date: Date) -> Int {
        guard let zone = resolve(id) else { return 0 }
        return zone.secondsFromGMT(for: date) / 60
    }

    /// "+09:00" / "−07:30" (U+2212 minus, matching the rest of the app).
    public static func formatOffset(_ minutes: Int) -> String {
        let sign = minutes < 0 ? "\u{2212}" : "+"
        let abs = Swift.abs(minutes)
        return String(format: "%@%02d:%02d", sign, abs / 60, abs % 60)
    }

    /// Picker options: each zone labelled with its current GMT offset, sorted
    /// by offset then zone id.
    public static func buildOptions(localZone: String = TimeZone.current.identifier,
                                    at date: Date = Date()) -> [TimeZoneOption]
    {
        buildTimeZones(localZone: localZone)
            .map { id in
                let offset = zoneOffsetMinutes(id, at: date)
                return TimeZoneOption(id: id, label: "\(id)  \(formatOffset(offset))",
                                      offset: offset)
            }
            .sorted { ($0.offset, $0.id) < ($1.offset, $1.id) }
    }

    /// Fixed-offset "special" zones: UTC plus every 30-minute GMT offset from
    /// −12:00 to +14:00. Ids are ASCII offset strings ("+05:30") resolved via
    /// `resolve`; labels use U+2212.
    public static func buildSpecialZones() -> [TimeZoneOption] {
        var zones = [TimeZoneOption(id: "UTC", label: "UTC", offset: 0)]
        for minutes in stride(from: -720, through: 840, by: 30) where minutes != 0 {
            let abs = Swift.abs(minutes)
            let id = String(format: "%@%02d:%02d", minutes < 0 ? "-" : "+", abs / 60, abs % 60)
            zones.append(TimeZoneOption(id: id, label: "GMT\(formatOffset(minutes))",
                                        offset: minutes))
        }
        return zones.sorted { ($0.offset, $0.id) < ($1.offset, $1.id) }
    }

    /// TimeZone for an id: IANA identifier, or an ASCII fixed-offset id
    /// ("+05:30" / "-08:00") via `secondsFromGMT` — Foundation doesn't parse
    /// those as identifiers the way the web's Intl does.
    public static func resolve(_ id: String) -> TimeZone? {
        if let zone = TimeZone(identifier: id) { return zone }
        return fixedOffsetMinutes(id).flatMap { TimeZone(secondsFromGMT: $0 * 60) }
    }

    /// Parse "+HH:MM"/"-HH:MM" (exactly 6 ASCII chars) to signed minutes.
    private static func fixedOffsetMinutes(_ id: String) -> Int? {
        guard id.count == 6, id.first == "+" || id.first == "-",
              id[id.index(id.startIndex, offsetBy: 3)] == ":",
              let h = Int(id.dropFirst().prefix(2)), let m = Int(id.suffix(2)),
              h <= 14, m <= 59 else { return nil }
        let minutes = h * 60 + m
        return id.first == "-" ? -minutes : minutes
    }
}
