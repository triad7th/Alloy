import SwiftUI

@main
struct HarnessApp: App {
    var body: some Scene {
        WindowGroup("Alloy Harness") {
            HarnessRootView()
            #if os(macOS)
                .frame(minWidth: 560, minHeight: 720)
            #endif
                .preferredColorScheme(.dark)
        }
    }
}
