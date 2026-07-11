/// Xorshift32 — the DSP core's only randomness source. Integer ops only,
/// bit-identical to the web twin (src/dsp/prng.ts).
public final class DspPrng {
    private var state: UInt32

    public init(seed: UInt32) {
        state = seed == 0 ? 0x9E37_79B9 : seed
    }

    /// Uniform double in [0, 1).
    public func next() -> Double {
        var x = state
        x ^= x << 13
        x ^= x >> 17
        x ^= x << 5
        state = x
        return Double(x) / 4_294_967_296.0
    }
}
