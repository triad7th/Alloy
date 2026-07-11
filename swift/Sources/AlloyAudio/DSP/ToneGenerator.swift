/// Shared DSP-core contracts. Everything under DSP/ is pure math: no
/// AVFoundation imports, Double internals, Float only at render
/// boundaries. Twin of web alloy-audio src/dsp/dsp-types.ts (canonical).

public enum DspConstants {
    public static let twoPi = 2.0 * Double.pi
    /// Envelope level below this is treated as silence (≈ −100 dBFS).
    public static let silenceFloor = 1e-5
}

/// A tone source for one note. `render` ADDS into `out` (caller owns
/// zero-fill). `finished` means self-terminated — only silence can ever
/// follow. Sustained kinds never self-finish; `noteOff` only forwards
/// key-up to intrinsic envelopes (the voice TVA owns the audible release).
/// A generator is never `finished` before its first `noteOn`.
public protocol ToneGenerator: AnyObject {
    func noteOn(midi: Int, velocity: Double)
    func noteOff()
    /// Multiplies the sounding frequency relative to the noteOn pitch (1 =
    /// unbent). Cheap; intended to be called at control rate. Ratio persists
    /// until the next call or noteOn (noteOn resets it to 1).
    func setPitchRatio(_ ratio: Double)
    func render(into out: inout [Float], frames: Int)
    var finished: Bool { get }
}
