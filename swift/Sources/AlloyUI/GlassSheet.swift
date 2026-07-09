import SwiftUI

/// Circular Liquid Glass icon button. The ONE component for all round glass
/// buttons (controls bar, sheet close) so the press animation — the glass
/// lift and scale — is identical everywhere. Its own GlassEffectContainer
/// keeps the pressed glass a perfect circle instead of blending with an
/// enclosing panel's rounded-rectangle glass.
@available(iOS 26.0, macOS 26.0, tvOS 26.0, watchOS 26.0, *)
public struct GlassIconButton: View {
    let icon: String
    let label: String
    var size: CGFloat =
        36 // visual diameter; web chrome buttons are 44px, X is 34px — iOS shrinks ~proportionally
    let action: () -> Void

    public init(icon: String, label: String, size: CGFloat = 36, action: @escaping () -> Void) {
        self.icon = icon; self.label = label; self.size = size; self.action = action
    }

    public var body: some View {
        GlassEffectContainer {
            Button(action: action) {
                SFIcon(icon)
                    .frame(width: size * 0.5, height: size * 0.5)
                    .padding(size * 0.25)
            }
            .buttonStyle(.glass)
            .buttonBorderShape(.circle)
        }
        .foregroundStyle(Color(white: 0.93))
        .accessibilityLabel(label)
    }
}

/// Bottom panel matching the web's sheet component: hugs its content height,
/// Liquid Glass background so the face stays visible behind, centered grab
/// bar, title header with a large-target close button, and a backdrop that
/// dismisses on tap (the AllyClock sheet rule: apply live, accept on any
/// dismissal — no confirm/cancel).
///
/// Choreography is the web twin's (`sheet.component.ts` close()/closed):
/// ANY dismissal — backdrop, X, or the `dismiss` closure handed to content —
/// plays the slide-out first; `onClosed` fires once, after the exit
/// animation completes; re-entry while closing is ignored.
@available(iOS 26.0, macOS 26.0, tvOS 26.0, watchOS 26.0, *)
public struct GlassSheet<Content: View>: View {
    let title: String
    /// Horizontal safe-area inset of the host window. The panel spans the full
    /// width (root ignores the safe area), so the header must clear the
    /// Dynamic Island / rounded corners itself.
    var hInset: CGFloat = 0
    /// Fires once, after the slide-out completes. Presenters clear their
    /// sheet state (and commit any pending selection) here.
    let onClosed: () -> Void
    @ViewBuilder var content: (_ dismiss: @escaping () -> Void) -> Content

    @State private var shown = false

    public init(title: String, hInset: CGFloat = 0, onClosed: @escaping () -> Void,
                @ViewBuilder content: @escaping (_ dismiss: @escaping () -> Void) -> Content)
    {
        self.title = title; self.hInset = hInset; self.onClosed = onClosed; self.content = content
    }

    private var panelShape: UnevenRoundedRectangle {
        // Rounded only at the top — the panel sits flush with the screen bottom.
        UnevenRoundedRectangle(
            topLeadingRadius: AlloyTokens.sheetCornerRadius,
            topTrailingRadius: AlloyTokens.sheetCornerRadius
        )
    }

    public var body: some View {
        ZStack(alignment: .bottom) {
            // Backdrop: token dim, tap anywhere outside to dismiss.
            AlloyTokens.backdrop
                .opacity(shown ? 1 : 0)
                .ignoresSafeArea()
                .animation(.easeOut(duration: AlloyTokens.sheetAnimation), value: shown)
                .onTapGesture(perform: dismiss)

            if shown {
                VStack(spacing: 0) {
                    Capsule()
                        .fill(Color.white.opacity(0.35))
                        .frame(width: 40, height: 4)
                        .padding(.top, 8)

                    Text(title)
                        .font(.headline)
                        .foregroundStyle(Color(white: 0.95))
                        .frame(minHeight: 44)

                    content(dismiss)
                        .padding(.horizontal, hInset)
                        // Web nav-header keeps ~24px below the title; 4pt read as
                        // the content crowding the header.
                        .padding(.top, 16)
                        .padding(.bottom, 20)
                }
                .frame(maxWidth: .infinity)
                .glassEffect(.regular, in: panelShape)
                // The X sits in an overlay applied AFTER glassEffect: glass nested
                // inside another glass surface renders its pressed state as a
                // rounded rectangle, not the circle. As a sibling of the panel's
                // glass, the button presses as a perfect circle — identical to the
                // controls-bar buttons.
                .overlay(alignment: .topLeading) {
                    GlassIconButton(icon: "xmark", label: "Close", size: 28, action: dismiss)
                        // Pinned to the panel edge, not inset by hInset: the sheet's
                        // top-left is mid-screen in landscape, clear of the Dynamic
                        // Island and corner curves, so only content needs hInset.
                        .padding(.leading, 12)
                        .padding(.top, 16)
                }
                .transition(.move(edge: .bottom).combined(with: .opacity))
            }
        }
        .onAppear {
            withAnimation(.spring(duration: AlloyTokens.sheetAnimation)) { shown = true }
        }
    }

    /// Web `close()` twin: idempotent; animates out, then reports closed.
    private func dismiss() {
        guard shown else { return } // re-entry while closing is ignored
        withAnimation(.easeIn(duration: AlloyTokens.sheetAnimation)) {
            shown = false
        } completion: {
            onClosed()
        }
    }
}
