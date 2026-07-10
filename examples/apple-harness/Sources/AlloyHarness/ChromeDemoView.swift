import AlloyUI
import SwiftUI

/// Exercises the 0.5.0 chrome additions end to end: GlassSheet's
/// dismiss-then-report choreography, AutoHideModel suppression, and the
/// KnobSlider row. Open the sheet, drag the slider, flip the toggle, then
/// dismiss via backdrop, X, and the Done button — the "closed" counter
/// must increment exactly once per dismissal, after the slide-out.
struct ChromeDemoView: View {
    @State private var sheetOpen = false
    @State private var closedCount = 0
    @State private var sliderValue = 60.0
    @State private var toggleOn = true
    @State private var chrome = AutoHideModel(delay: 2.5)

    var body: some View {
        ZStack {
            Color.black.ignoresSafeArea()
            VStack(spacing: 16) {
                Text("closed fired: \(closedCount)")
                    .foregroundStyle(.white)
                GlassIconButton(icon: "slider.horizontal.3", label: "Open sheet") {
                    sheetOpen = true
                    chrome.suppressed = true
                }
                .opacity(chrome.effectivelyVisible ? 1 : 0.15)
                Text(chrome.effectivelyVisible ? "chrome visible" : "chrome hidden")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }

            if sheetOpen {
                GlassSheet(
                    title: "Chrome demo",
                    trailing: GlassSheetAction(icon: "arrow.clockwise", label: "Reset") {
                        sliderValue = 60.0
                        toggleOn = true
                    },
                    onClosed: {
                        sheetOpen = false
                        closedCount += 1
                        chrome.suppressed = false
                    },
                ) { dismiss in
                    VStack(alignment: .leading, spacing: 16) {
                        KnobSlider(
                            label: "Zoom",
                            value: $sliderValue,
                            in: 40 ... 100,
                            display: "\(Int(sliderValue)) %"
                        )
                        KnobToggle(isOn: toggleOn, label: "Note labels") { toggleOn = $0 }
                        GlassIconButton(icon: "checkmark", label: "Done", action: dismiss)
                    }
                    .padding(.horizontal, 24)
                }
            }
        }
        .onTapGesture { chrome.reveal() }
    }
}
