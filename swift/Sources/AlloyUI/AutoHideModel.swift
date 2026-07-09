import Foundation
import Observation

/// Auto-hiding chrome state: visible on interaction, hides after a delay.
/// Semantic mirror of the web `AutoHideDirective` (visible / reveal / hold);
/// delay comes from the shared tokens (web ships 4000 ms).
@MainActor
@Observable
public final class AutoHideModel {
    public private(set) var visible = true

    private let delay: Double
    private var hold = false
    private var hideTask: Task<Void, Never>?

    public init(delay: Double = AlloyTokens.autoHide) {
        self.delay = delay
        scheduleHide()
    }

    /// Show the chrome and restart the hide clock (no-op arming while held).
    public func reveal() {
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
