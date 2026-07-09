import AlloyTime
import AlloyUI
import SwiftUI

/// One scrolling page per Alloy surface. Platform-agnostic SwiftUI — this
/// view drops into an iOS app target unchanged.
struct HarnessRootView: View {
    @State private var sheetShown = false
    @State private var selectedZone = ""
    @State private var zoneOptions: [ZonePickerOption] = []

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 28) {
                section("Icons & buttons") { iconsDemo }
                section("Knobs") { KnobsDemoView() }
                section("Flag & zone picker") { zoneDemo }
                section("Synth") { SynthDemoView() }
                section("Chrome") { ChromeDemoView() }
            }
            .padding(24)
        }
        .background(Color.black)
        .overlay { sheetOverlay }
        .task {
            // Full-IANA Intl scan is slow-ish; build once off the first frame.
            zoneOptions = ZoneCatalog.buildOptions().map {
                ZonePickerOption(id: $0.id, label: $0.label)
            }
        }
    }

    private func section(_ title: String, @ViewBuilder content: () -> some View) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(title).font(.title3).bold().foregroundStyle(.white)
            content()
        }
    }

    private var iconsDemo: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(spacing: 14) {
                ForEach(["gearshape", "clock", "globe", "checkmark", "pencil", "trash"], id: \.self) {
                    SFIcon($0).frame(width: 22, height: 22).foregroundStyle(.white)
                }
            }
            HStack(spacing: 10) {
                GlassIconButton(icon: "plus", label: "Add") {}
                GlassIconButton(icon: "slider.horizontal.3", label: "Adjust") {}
                GlassIconButton(icon: "square.and.arrow.up", label: "Share") { sheetShown = true }
                Text("← opens a GlassSheet").font(.footnote).foregroundStyle(.secondary)
            }
        }
    }

    private var zoneDemo: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 10) {
                // No flag assets ship with the harness, so every code exercises
                // the globe fallback — the artwork contract is app-side.
                FlagView(countryCode: "kr").frame(width: 20, height: 20)
                FlagView(countryCode: nil).frame(width: 20, height: 20)
                Text(selectedZone.isEmpty ? "No zone selected" : selectedZone)
                    .font(.subheadline).foregroundStyle(.secondary)
            }
            ZonePickerView(
                options: zoneOptions,
                selectedId: selectedZone,
                listHeight: 220,
                countryFor: { ZoneCountry.country(for: $0) }
            ) { selectedZone = $0 }
        }
    }

    @ViewBuilder
    private var sheetOverlay: some View {
        if sheetShown {
            GlassSheet(title: "Harness Sheet", onClosed: { sheetShown = false }) { _ in
                VStack(alignment: .leading, spacing: 10) {
                    Text("GlassSheet body — apply-on-close semantics live here.")
                    KnobLabel("A knob label inside the sheet")
                }
                .padding(.vertical, 8)
            }
        }
    }
}

/// Knob controls bound to throwaway local state.
private struct KnobsDemoView: View {
    @State private var enabled = true
    @State private var speed = "1x"

    var body: some View {
        KnobCard {
            KnobLabel("Playback")
            KnobToggle(isOn: enabled, label: "Enabled") { enabled = $0 }
            KnobSegment(
                options: [("0.5x", "0.5x"), ("1x", "1x"), ("2x", "2x")].map { (value: $0.0, label: $0.1) },
                selection: speed
            ) { speed = $0 }
        }
    }
}
