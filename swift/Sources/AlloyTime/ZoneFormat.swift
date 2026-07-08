import Foundation

/// Zone-derived display strings. Mirrored twin of `zone-format.ts`.
public enum ZoneFormat {
    /// Sign + hours, with ":mm" only when the zone is off a whole hour.
    /// Uses U+2212 MINUS for negatives, matching the apps.
    public static func compactOffset(_ date: Date, timeZone: TimeZone) -> String {
        let minutes = timeZone.secondsFromGMT(for: date) / 60
        let sign = minutes < 0 ? "\u{2212}" : "+"
        let abs = Swift.abs(minutes)
        let h = abs / 60, m = abs % 60
        return m == 0 ? "\(sign)\(h)" : "\(sign)\(h):\(String(format: "%02d", m))"
    }

    /// String-id variant (web-mirrored signature); unresolvable ids read +0,
    /// matching the web's bare-"GMT" fallback.
    public static func compactOffset(_ date: Date, zone id: String) -> String {
        compactOffset(date, timeZone: ZoneCatalog.resolve(id) ?? TimeZone(secondsFromGMT: 0)!)
    }

    /// "GMT+05:30" / "GMT−08:00" (U+2212), the web's longOffset rendering.
    public static func gmtOffset(_ date: Date, timeZone: TimeZone) -> String {
        let minutes = timeZone.secondsFromGMT(for: date) / 60
        let sign = minutes < 0 ? "\u{2212}" : "+"
        let abs = Swift.abs(minutes)
        return String(format: "GMT%@%02d:%02d", sign, abs / 60, abs % 60)
    }

    /// City label from an IANA id: last path segment, underscores spaced,
    /// uppercased. `abbreviate` collapses multi-word to initials, single word to
    /// first three letters. Fixed-offset ids ("+05:30") have no city.
    public static func zoneCity(_ ianaId: String, abbreviate: Bool) -> String {
        if ianaId.range(of: "^[+\u{2212}-]\\d", options: .regularExpression) != nil { return "" }
        let city = (ianaId.split(separator: "/").last.map(String.init) ?? ianaId)
            .replacingOccurrences(of: "_", with: " ")
        if !abbreviate { return city.uppercased() }
        let words = city.split(whereSeparator: { $0 == " " || $0 == "-" }).map(String.init)
        let label = words.count > 1 ? words.map { String($0.prefix(1)) }.joined()
                                    : String(city.prefix(3))
        return label.uppercased()
    }
}
