import Foundation

/// Master lookahead brickwall limiter. A `limiterLookaheadSamples` ring delay
/// plus a sliding window-peak guarantees the output never exceeds the ceiling
/// with zero overshoot. Stereo-linked (one gain drives both channels).
/// Per-sample gain — no control-rate stepping (zipper-safe). Twin of web
/// src/dsp/effects/limiter.ts (canonical).
public final class Limiter: EffectUnit {
    private let params: LimiterParams
    private let L = limiterLookaheadSamples
    private var delayL: [Float]
    private var delayR: [Float]
    private var peakBuf: [Float]
    private var pos = 0
    private var gain = 1.0
    private let ceiling: Double
    private let releaseCoef: Double

    public init(params: LimiterParams, sampleRate: Double) {
        self.params = params
        self.delayL = [Float](repeating: 0, count: limiterLookaheadSamples)
        self.delayR = [Float](repeating: 0, count: limiterLookaheadSamples)
        self.peakBuf = [Float](repeating: 0, count: limiterLookaheadSamples)
        self.ceiling = pow(10, params.ceilingDb / 20)
        self.releaseCoef = 1 - exp(-1 / ((params.releaseMs / 1000) * sampleRate))
    }

    public var latencySamples: Int {
        L
    }

    public func reset() {
        for i in 0..<L {
            delayL[i] = 0
            delayR[i] = 0
            peakBuf[i] = 0
        }
        pos = 0
        gain = 1
    }

    public func process(left: inout [Float], right: inout [Float], frames: Int) {
        let L = self.L
        for i in 0..<frames {
            let inL = left[i]
            let inR = right[i]

            // Emit the delayed sample at the current ring slot, then overwrite it.
            let outL = delayL[pos]
            let outR = delayR[pos]
            delayL[pos] = inL
            delayR[pos] = inR
            peakBuf[pos] = max(abs(inL), abs(inR))

            pos += 1
            if pos >= L { pos = 0 }

            // Peak over the whole lookahead window (the peak entered up to L samples
            // ago, so it is already accounted for before it reaches the output).
            var windowPeak: Float = 0
            for k in 0..<L {
                let p = peakBuf[k]
                if p > windowPeak { windowPeak = p }
            }
            let windowPeakD = Double(windowPeak)
            let target = windowPeakD > ceiling ? ceiling / windowPeakD : 1

            // Instant attack (clamp down immediately), per-sample one-pole release.
            if target < gain {
                gain = target
            } else {
                gain += releaseCoef * (target - gain)
            }

            left[i] = Float(Double(outL) * gain)
            right[i] = Float(Double(outR) * gain)
        }
    }
}
