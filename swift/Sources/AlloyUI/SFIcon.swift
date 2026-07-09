import SwiftUI

/// SF Symbol by semantic name — the iOS side of the shared icon abstraction.
public struct SFIcon: View {
    public let name: String
    public init(_ name: String) {
        self.name = name
    }

    public var body: some View {
        Image(systemName: name).resizable().scaledToFit()
    }
}
