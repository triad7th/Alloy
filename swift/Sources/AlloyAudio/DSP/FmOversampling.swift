import Foundation

// Anti-aliasing for the FM generator. Phase modulation generates sidebands far
// above Nyquist; rendered at the output rate they fold back as inharmonic
// low-frequency junk (measured -25 dB below the fundamental on G#6 with a
// ratio-14 modulator, -21 dB on C8). Oversampling the operator loop and
// band-limiting before decimation removes them.
//
// The cost is paid per VOICE, only where it is needed: below the threshold,
// oversampling was measured to be a no-op (C4: -53 dB at 1x, -51 dB at 4x).
// Twin of web src/dsp/fm-oversampling.ts (canonical).

/// Oversampling factor used above the threshold. 4x puts everything through C7
/// at the measurement floor; 8x would be needed for a fully clean C8 and costs
/// ~9x the FM CPU, which the <25%-of-a-core envelope will not absorb.
public let FM_OVERSAMPLING = 4

/// 32-tap Blackman-windowed sinc, cutoff 0.45/4 of the oversampled rate,
/// normalized to unity DC gain. PINNED, not computed: a runtime-designed filter
/// would risk a last-ulp divergence between the Swift and JS math libraries, and
/// these coefficients are part of the twin contract. Group delay is 15.5
/// oversampled samples = 3.875 output samples (~83 us) — inaudible between
/// independent voices, but between two CORRELATED layers of one patch (one over
/// the K threshold, one under) it is a comb notch near 6 kHz. Accepted.
public let FM_DECIMATION_TAPS: [Double] = [
    2.8477986181713758e-19, -6.0477988340191030e-5, -4.3340271636890365e-5, 5.2916070916784888e-4,
    1.9038353814484067e-3, 3.3115968607472083e-3, 2.6042373642096179e-3, -2.7237870035835541e-3,
    -1.2906466905783016e-2, -2.3118576278907177e-2, -2.3226872620304369e-2, -1.9606343826616681e-3,
    4.5690838648908765e-2, 1.1232751779472532e-1, 1.7825129611097032e-1, 2.1942167258103942e-1,
    2.1942167258103948e-1, 1.7825129611097032e-1, 1.1232751779472533e-1, 4.5690838648908771e-2,
    -1.9606343826616690e-3, -2.3226872620304369e-2, -2.3118576278907201e-2, -1.2906466905783032e-2,
    -2.7237870035835541e-3, 2.6042373642096179e-3, 3.3115968607472083e-3, 1.9038353814484074e-3,
    5.2916070916784867e-4, -4.3340271636890290e-5, -6.0477988340191701e-5, 2.8477986181713758e-19,
]

/// The oversampling factor a voice needs, from the highest frequency anywhere in
/// its operator stack — `maxOpFrequency` must ALREADY include the worst case of
/// anything that can bend the note up while it sounds (see `maxPitchModRatio`).
/// A pure function of the note and the patch: deterministic, twin-identical,
/// decided once per note.
///
/// Threshold placed from measurement — 1x and 4x are indistinguishable up to
/// 13.1 kHz and diverge from 14.7 kHz up. 12 kHz therefore carries ~1.5
/// semitones of proven-clean headroom and ~3.5 semitones to first measured
/// divergence. That margin is slack, not a load-bearing allowance: pitch
/// modulation is priced in explicitly, because `setPitchRatio` must NOT re-pick
/// the factor mid-note (switching K under a sounding voice would glitch).
public func chooseOversampling(maxOpFrequency: Double, sampleRate: Double) -> Int {
    maxOpFrequency > sampleRate / 4 ? FM_OVERSAMPLING : 1
}

/// Worst-case upward pitch multiplier a layer's LFO pitch route can reach.
///
/// Derived from the modulation model: a `PatchLayer` has at most ONE `mod` (one
/// LFO, one `toPitchCents`), and `Voice.tickModulation` is the only caller of
/// `setPitchRatio` — it sets `2 ** (toPitchCents * lfoVal / 1200)` with `lfoVal`
/// in [-1, 1] (`Lfo.nextSample`: a sine/triangle scaled by a 0...1 gate). So the
/// largest UPWARD excursion is `2 ** (|toPitchCents| / 1200)`: the absolute
/// value, because a negative depth still bends up on the LFO's -1 half-cycle.
/// No pitch route (or depth 0) gives exactly 1, so every patch without vibrato
/// keeps the K it had, at zero CPU cost.
///
/// If a second route to pitch is ever added, this must become the sum of the
/// absolute depths (assume every contributing LFO peaks at once).
public func maxPitchModRatio(pitchModCents: Double) -> Double {
    pow(2, abs(pitchModCents) / 1200)
}

/// Ring-buffered FIR: push every oversampled sample, read one output per
/// `FM_OVERSAMPLING` pushes.
public final class FmDecimator {
    private var history: [Double]
    private var pos = 0

    public init() {
        history = [Double](repeating: 0, count: FM_DECIMATION_TAPS.count)
    }

    public func reset() {
        for i in history.indices {
            history[i] = 0
        }
        pos = 0
    }

    public func push(_ x: Double) {
        history[pos] = x
        pos = (pos + 1) % history.count
    }

    /// Textbook convolution, y[n] = sum_j taps[j] * x[n-j]: taps[0] multiplies
    /// the NEWEST sample. After push(), `pos` indexes the OLDEST sample, so
    /// walking i = pos...newest visits x oldest-first and the matching tap is
    /// taps[n-1-j]. (The table is near-symmetric but NOT bit-exactly
    /// palindromic — 10 of its 16 mirror pairs differ in the last ulps — so the
    /// tap index has to be right; there is no symmetry to lean on.)
    ///
    /// The window is walked as two contiguous runs (pos..<n, then 0..<pos)
    /// rather than with a `% n` per tap: 32 modulos per output sample was the
    /// dominant added cost for a 2-op voice. Same samples, same taps, same
    /// summation order, so it is BIT-identical to the naive modulo form — pinned
    /// by a test.
    public func output() -> Double {
        let n = history.count
        let p = pos
        var y = 0.0
        var j = 0
        for i in p..<n {
            y += FM_DECIMATION_TAPS[n - 1 - j] * history[i]
            j += 1
        }
        for i in 0..<p {
            y += FM_DECIMATION_TAPS[n - 1 - j] * history[i]
            j += 1
        }
        return y
    }
}
