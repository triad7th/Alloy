import SwiftUI

/// Structurally compatible with AlloyTime's `TimeZoneOption` — kept as a local
/// shape so AlloyUI does not depend on AlloyTime; hosts pass their options
/// (and any synthetic leading entry like "Follow System") straight in.
/// Mirrored twin of the web `ZonePickerOption`.
public struct ZonePickerOption: Equatable, Sendable {
    public let id: String
    public let label: String

    public init(id: String, label: String) {
        self.id = id
        self.label = label
    }
}

/// Searchable zone list: a search field over a scrollable, filtered list.
/// Live-apply on tap (calls `onPick` immediately — no draft/commit). Hosts
/// supply the options, the selected id, a `countryFor` lookup (e.g.
/// AlloyTime's `ZoneCountry.country(for:)`) for the row flags, and a
/// `listHeight` that fits their sheet on screen (a fixed height overflowed
/// landscape iPhones — the enclosing GlassSheet hugs content, so the list
/// must be bounded by the host). Mirrored twin of the web
/// `zone-picker.component`; the web's back/cancel control is dropped on
/// Apple platforms — the sheet's X is the cancel.
public struct ZonePickerView: View {
    let options: [ZonePickerOption]
    let selectedId: String
    var listHeight: CGFloat
    var countryFor: (String) -> String?
    let onPick: (String) -> Void

    public init(
        options: [ZonePickerOption],
        selectedId: String,
        listHeight: CGFloat = 280,
        countryFor: @escaping (String) -> String? = { _ in nil },
        onPick: @escaping (String) -> Void
    ) {
        self.options = options
        self.selectedId = selectedId
        self.listHeight = listHeight
        self.countryFor = countryFor
        self.onPick = onPick
    }

    @State private var query = ""

    /// Same filter contract as the web twin: case-insensitive substring of
    /// the full label (name + offset); blank query returns everything.
    public static func filtered(
        _ options: [ZonePickerOption], query: String
    ) -> [ZonePickerOption] {
        let q = query.trimmingCharacters(in: .whitespaces).lowercased()
        return q.isEmpty ? options : options.filter { $0.label.lowercased().contains(q) }
    }

    private var filtered: [ZonePickerOption] {
        Self.filtered(options, query: query)
    }

    public var body: some View {
        VStack(spacing: 8) {
            searchField
            ScrollView {
                LazyVStack(spacing: 2) {
                    ForEach(filtered, id: \.id) { zone in
                        row(zone)
                    }
                    if filtered.isEmpty {
                        Text("No matching time zone")
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                            .padding(.top, 12)
                    }
                }
            }
            .frame(height: listHeight)
        }
    }

    private var searchField: some View {
        let field = TextField("Search time zone", text: $query)
            .textFieldStyle(.roundedBorder)
            .autocorrectionDisabled()
            .accessibilityLabel("Search time zone")
        #if os(iOS) || os(tvOS)
        return field.textInputAutocapitalization(.never)
        #else
        return field
        #endif
    }

    private func row(_ zone: ZonePickerOption) -> some View {
        Button { onPick(zone.id) } label: {
            HStack(spacing: 10) {
                FlagView(countryCode: countryFor(zone.id)).frame(width: 18, height: 18)
                Text(zone.label).font(.subheadline).lineLimit(1)
                Spacer(minLength: 0)
                if zone.id == selectedId {
                    SFIcon("checkmark").frame(width: 14, height: 14)
                }
            }
            .padding(.vertical, 8)
            .padding(.horizontal, 10)
            .background(
                zone.id == selectedId ? Color.white.opacity(0.12) : .clear,
                in: RoundedRectangle(cornerRadius: 8)
            )
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }
}
