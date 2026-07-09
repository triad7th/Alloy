import SwiftUI

/// Shared "knobs" design language — mirrors `styles/_knobs.scss` and the web's
/// KnobCard, KnobLabel, and KnobToggle controls. Settings and Adjustment both
/// build their panels out of these primitives so the two stay visually identical
/// on Web, iOS, and other platforms.
public enum Knobs {
    public static let tint = AlloyTokens.tint
    public static let secondarySurface = AlloyTokens.secondarySurface
    public static let secondaryLabel = AlloyTokens.secondaryLabel
    public static let card = AlloyTokens.knobCard
}

/// Grouped card (web `.knobs-section`): dark rounded panel, uniform minimum
/// height so mixed content (toggles, segment, field) line up in the grid.
public struct KnobCard<Content: View>: View {
    @ViewBuilder var content: () -> Content

    public init(@ViewBuilder content: @escaping () -> Content) {
        self.content = content
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            content()
        }
        .padding(.vertical, 12)
        .padding(.horizontal, 16)
        .frame(maxWidth: .infinity, minHeight: 88, alignment: .topLeading)
        .background(Knobs.card, in: RoundedRectangle(cornerRadius: 12))
    }
}

/// Uppercase letterspaced section label (web `.knobs-section-label`).
public struct KnobLabel: View {
    let text: String

    public init(_ text: String) {
        self.text = text
    }

    public var body: some View {
        Text(text.uppercased())
            .font(.system(size: 11.5, weight: .semibold))
            .tracking(0.7)
            .foregroundStyle(Knobs.secondaryLabel)
    }
}

/// iOS-style pill switch with its label stacked above it (web `.knobs-toggle`
/// + `.knobs-section-label` in a `.knobs-cell`).
public struct KnobToggle: View {
    let isOn: Bool
    let label: String
    let set: (Bool) -> Void

    public init(isOn: Bool, label: String, set: @escaping (Bool) -> Void) {
        self.isOn = isOn
        self.label = label
        self.set = set
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            KnobLabel(label)
            Capsule().fill(isOn ? Knobs.tint : Knobs.secondarySurface)
                .frame(width: 44, height: 26)
                .overlay(alignment: .leading) {
                    Circle().fill(.white)
                        .frame(width: 20, height: 20)
                        .shadow(color: .black.opacity(0.4), radius: 2, y: 1)
                        .offset(x: isOn ? 21 : 3)
                }
                .animation(.easeInOut(duration: 0.2), value: isOn)
                .onTapGesture { set(!isOn) }
                .accessibilityLabel(label)
                .accessibilityAddTraits(.isButton)
                .accessibilityValue(isOn ? "on" : "off")
        }
    }
}

/// Segmented control (web `.knobs-segment`): equal-width buttons in a pill
/// track, selected segment tinted. `options` can't be `ForEach`-ed directly
/// (tuples aren't `Identifiable`), so callers pass an array and this view
/// iterates its indices.
public struct KnobSegment<T: Hashable>: View {
    let options: [(value: T, label: String)]
    let selection: T
    let set: (T) -> Void

    public init(options: [(value: T, label: String)], selection: T, set: @escaping (T) -> Void) {
        self.options = options
        self.selection = selection
        self.set = set
    }

    public var body: some View {
        HStack(spacing: 2) {
            ForEach(options.indices, id: \.self) { index in
                let option = options[index]
                let isOn = option.value == selection
                Button {
                    set(option.value)
                } label: {
                    Text(option.label)
                        .font(.system(size: 11.5, weight: .semibold))
                        .tracking(0.46)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 6)
                        .foregroundStyle(isOn ? Color.white : Knobs.secondaryLabel)
                        .background(
                            isOn ? Knobs.tint : Color.clear,
                            in: RoundedRectangle(cornerRadius: 7)
                        )
                }
                .buttonStyle(.plain)
                .accessibilityAddTraits(isOn ? .isSelected : [])
            }
        }
        .padding(2)
        .background(Knobs.secondarySurface, in: RoundedRectangle(cornerRadius: 9))
        .animation(.easeInOut(duration: 0.15), value: selection)
    }
}

/// Full-width value row (web `.knobs-tz`), used for the Time Zone field.
public struct KnobField<Content: View>: View {
    let action: () -> Void
    @ViewBuilder var content: () -> Content

    public init(action: @escaping () -> Void, @ViewBuilder content: @escaping () -> Content) {
        self.action = action
        self.content = content
    }

    public var body: some View {
        Button(action: action) {
            HStack(spacing: 8) {
                content()
            }
            .font(.system(size: 14.5))
            .foregroundStyle(Knobs.tint)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.vertical, 8)
            .padding(.horizontal, 11)
            .background(Knobs.secondarySurface, in: RoundedRectangle(cornerRadius: 8))
        }
        .buttonStyle(.plain)
    }
}

/// Port of the web's container-query breakpoints for the knobs grid
/// (`@container (min-width: 600px|900px)`).
public func knobColumns(for width: CGFloat) -> Int {
    width >= 900 ? 3 : width >= 600 ? 2 : 1
}
