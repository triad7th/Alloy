import Foundation
import Observation
import SwiftUI

/// Auto-hiding chrome state: visible on interaction, hides after a delay.
/// Semantic mirror of the web `AutoHideDirective` (visible / reveal / hold /
/// revealBlocked); delay comes from the shared tokens.
/// `suppressed` combines the web's `revealBlocked` with hidden-while-open:
/// hosts set it while a sheet is open — the chrome reads not-visible,
/// `reveal()` is a no-op, and lifting suppression reveals + re-arms.
@MainActor
@Observable
public final class AutoHideModel {
    public private(set) var visible = true

    /// While true (a sheet is open), the chrome is hidden and reveal() is
    /// blocked. Lifting suppression reveals and restarts the hide clock.
    public var suppressed = false {
        didSet {
            guard oldValue != suppressed, !suppressed else { return }
            reveal()
        }
    }

    /// What hosts bind opacity/hit-testing to.
    public var effectivelyVisible: Bool { visible && !suppressed }

    private let delay: Double
    private var hold = false
    private var hideTask: Task<Void, Never>?

    public init(delay: Double = AlloyTokens.autoHide) {
        self.delay = delay
        scheduleHide()
    }

    /// Show the chrome and restart the hide clock (no-op while suppressed —
    /// the web's revealBlocked).
    public func reveal() {
        guard !suppressed else { return }
        visible = true
        scheduleHide()
    }

    /// While held, the chrome never hides (mirror of the web's holdVisible).
    public func setHold(_ holding: Bool) {
        hold = holding
        if holding {
            hideTask?.cancel()
        } else {
            scheduleHide()
        }
    }

    public func scheduleHide() {
        hideTask?.cancel()
        guard !hold else { return }
        hideTask = Task { [weak self, delay] in
            try? await Task.sleep(for: .seconds(delay))
            guard !Task.isCancelled else { return }
            self?.visible = false
        }
    }
}

@MainActor
public extension View {
    /// Binds visibility to the shared chrome model: fade + unhittable while
    /// hidden (mirror of the web `AutoHideDirective` host bindings).
    func chromeAutoHides(_ chrome: AutoHideModel) -> some View {
        opacity(chrome.effectivelyVisible ? 1 : 0)
            .allowsHitTesting(chrome.effectivelyVisible)
            .animation(.easeInOut(duration: AlloyTokens.chromeFade), value: chrome.effectivelyVisible)
    }
}
