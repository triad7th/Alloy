import SwiftUI

@main
struct HarnessApp: App {
    var body: some Scene {
        WindowGroup("Alloy Harness") {
            HarnessRootView()
                .frame(minWidth: 560, minHeight: 720)
                .preferredColorScheme(.dark)
        }
    }
}
