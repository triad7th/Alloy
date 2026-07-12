import Foundation

/// Algorithmic reverb send unit — an 8-line feedback delay network (FDN) with
/// input diffusion, per-line HF damping, a normalized Hadamard feedback mix,
/// and modulated lines for density. Zero sample bytes; identical on both
/// platforms. Fed by the reverb send tap; outputs 100% wet. Twin of web
/// src/dsp/effects/reverb.ts (canonical).

// Delay-line lengths in samples at 48 kHz (mutually near-prime, ~24..58 ms),
// the plate's fixed character. Rescaled by sampleRate/48000 at construction.
private let lineLen48k = [1153, 1327, 1559, 1801, 2063, 2311, 2543, 2801]
private let diffuserLen48k = [229, 173]
private let diffuserCoef = 0.7
private let predelayMax48k = 4800.0 // 100 ms
private let modMaxSamples = 16.0 // peak modulation excursion on lines 0 and 4
private let controlTwoPi = Double.pi * 2
private let hadamardSteps = [1, 2, 4]

private func scaleLen(_ len48k: Double, _ sampleRate: Double) -> Int {
    max(1, Int((len48k * sampleRate / 48000).rounded()))
}

/// Fixed-length circular delay line with integer and fractional reads.
private final class Line {
    let length: Int
    private var buf: [Double]
    private var pos = 0

    init(length: Int, extra: Int) {
        self.length = length
        self.buf = [Double](repeating: 0, count: length + extra)
    }

    /// Sample written `length` samples ago.
    func readInt() -> Double {
        buf[pos]
    }

    /// Sample written `length + delta` samples ago, linear-interpolated
    /// (delta >= 0, delta <= extra).
    func readFrac(_ delta: Double) -> Double {
        let size = buf.count
        let d = Int(delta.rounded(.down))
        let f = delta - Double(d)
        var i0 = pos - d
        if i0 < 0 { i0 += size }
        var i1 = i0 - 1
        if i1 < 0 { i1 += size }
        return buf[i0] * (1 - f) + buf[i1] * f
    }

    func write(_ v: Double) {
        buf[pos] = abs(v) < 1e-20 ? 0 : v // denormal flush
        pos += 1
        if pos >= buf.count { pos = 0 }
    }

    func clear() {
        for i in 0..<buf.count { buf[i] = 0 }
        pos = 0
    }
}

/// Schroeder allpass diffuser: y = -g*x + z; z_next = x + g*y.
private final class Allpass {
    private var buf: [Double]
    private var pos = 0
    private let g: Double

    init(length: Int, g: Double) {
        self.buf = [Double](repeating: 0, count: length)
        self.g = g
    }

    func process(_ x: Double) -> Double {
        let z = buf[pos]
        let y = -g * x + z
        let w = x + g * y
        buf[pos] = abs(w) < 1e-20 ? 0 : w
        pos += 1
        if pos >= buf.count { pos = 0 }
        return y
    }

    func clear() {
        for i in 0..<buf.count { buf[i] = 0 }
        pos = 0
    }
}

public final class Reverb: SendEffect {
    private let params: ReverbParams
    private let lines: [Line]
    private let diffusers: [Allpass]
    private var predelay: [Double]
    private var predelayPos = 0
    private let predelaySamples: Int
    private var damp = [Double](repeating: 0, count: 8) // one-pole LPF state per line
    private var h = [Double](repeating: 0, count: 8) // Hadamard scratch
    private var s = [Double](repeating: 0, count: 8) // per-sample line-read scratch
    private var lfoPhase = 0.0
    private let lfoInc: Double
    private let g: Double
    private let dampCoef: Double
    private let bwCoef: Double
    private var bwState = 0.0
    private let modSamples: Double

    public init(params: ReverbParams, sampleRate: Double) {
        self.params = params
        self.lines = lineLen48k.map { Line(length: scaleLen(Double($0), sampleRate), extra: Int(modMaxSamples) + 2) }
        self.diffusers = diffuserLen48k.map { Allpass(length: scaleLen(Double($0), sampleRate), g: diffuserCoef) }
        self.predelaySamples = min(
            scaleLen(predelayMax48k, sampleRate),
            max(1, Int(((params.predelayMs / 1000) * sampleRate).rounded()))
        )
        self.predelay = [Double](repeating: 0, count: scaleLen(predelayMax48k, sampleRate) + 1)
        self.g = 0.7 + 0.28 * params.decay
        self.dampCoef = params.damping // one-pole: lp += damp*(x - lp)
        self.bwCoef = params.bandwidth // one-pole: bw += bwCoef*(x - bw)
        self.lfoInc = (controlTwoPi * params.modRateHz) / sampleRate
        self.modSamples = params.modDepth * modMaxSamples
    }

    public func reset() {
        for l in lines { l.clear() }
        for d in diffusers { d.clear() }
        for i in 0..<predelay.count { predelay[i] = 0 }
        predelayPos = 0
        for i in 0..<damp.count { damp[i] = 0 }
        for i in 0..<h.count { h[i] = 0 }
        lfoPhase = 0
        bwState = 0
    }

    private func hadamard() {
        for step in hadamardSteps {
            var i = 0
            while i < 8 {
                if (i & step) == 0 {
                    let a = h[i]
                    let b = h[i + step]
                    h[i] = a + b
                    h[i + step] = a - b
                }
                i += 1
            }
        }
        let norm = 1 / 8.0.squareRoot()
        for i in 0..<8 { h[i] *= norm }
    }

    public func process(inL: inout [Float], inR: inout [Float], outL: inout [Float], outR: inout [Float], frames: Int) {
        let size = predelay.count
        for n in 0..<frames {
            // Mono send, input bandwidth roll-off.
            var x = (Double(inL[n]) + Double(inR[n])) * 0.5
            bwState += bwCoef * (x - bwState)
            if abs(bwState) < 1e-20 { bwState = 0 }
            x = bwState

            // Predelay.
            var rp = predelayPos - predelaySamples
            if rp < 0 { rp += size }
            let pre = predelay[rp]
            predelay[predelayPos] = x
            predelayPos += 1
            if predelayPos >= size { predelayPos = 0 }

            // Input diffusion.
            var d = pre
            d = diffusers[0].process(d)
            d = diffusers[1].process(d)

            // Read line outputs (lines 0 and 4 modulated).
            let mod = modSamples * sin(lfoPhase)
            lfoPhase += lfoInc
            if lfoPhase >= controlTwoPi { lfoPhase -= controlTwoPi }
            let s0 = lines[0].readFrac(mod < 0 ? 0 : mod)
            let s4 = lines[4].readFrac(mod < 0 ? -mod : 0)
            s[0] = s0
            s[1] = lines[1].readInt()
            s[2] = lines[2].readInt()
            s[3] = lines[3].readInt()
            s[4] = s4
            s[5] = lines[5].readInt()
            s[6] = lines[6].readInt()
            s[7] = lines[7].readInt()

            // Per-line damping in the feedback path.
            for k in 0..<8 {
                damp[k] += dampCoef * (s[k] - damp[k])
                if abs(damp[k]) < 1e-20 { damp[k] = 0 }
                h[k] = damp[k]
            }

            // Feedback mix, write back input + g * mixed.
            hadamard()
            for k in 0..<8 {
                lines[k].write(d + g * h[k])
            }

            // Output taps.
            outL[n] = Float((s[0] + s[2] + s[4] + s[6]) * 0.5)
            outR[n] = Float((s[1] + s[3] + s[5] + s[7]) * 0.5)
        }
    }
}
