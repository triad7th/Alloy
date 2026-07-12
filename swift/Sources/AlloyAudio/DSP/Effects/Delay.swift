import Foundation

/// Tempo-syncable stereo / ping-pong delay send unit with damped feedback.
/// 100% wet; fed by the delay send tap. Twin of web
/// src/dsp/effects/delay.ts (canonical).

public final class Delay: SendEffect {
    private let params: DelayParams
    private var bufL: [Double]
    private var bufR: [Double]
    private let size: Int
    private var pos = 0
    private let delaySamples: Int
    private var lpL = 0.0
    private var lpR = 0.0
    private let fb: Double
    private let dampCoef: Double
    private let pingpong: Bool

    public init(params: DelayParams, sampleRate: Double) {
        self.params = params
        self.delaySamples = max(1, Int(((params.timeMs / 1000) * sampleRate).rounded()))
        self.size = delaySamples + 1
        self.bufL = [Double](repeating: 0, count: size)
        self.bufR = [Double](repeating: 0, count: size)
        self.fb = params.feedback
        self.dampCoef = params.damping
        self.pingpong = params.mode == .pingpong
    }

    public func reset() {
        for i in 0..<bufL.count { bufL[i] = 0 }
        for i in 0..<bufR.count { bufR[i] = 0 }
        pos = 0
        lpL = 0
        lpR = 0
    }

    public func process(inL: inout [Float], inR: inout [Float], outL: inout [Float], outR: inout [Float], frames: Int) {
        for n in 0..<frames {
            var rp = pos - delaySamples
            if rp < 0 { rp += size }
            let dl = bufL[rp]
            let dr = bufR[rp]

            // Damped feedback (one-pole LPF on the delayed signal).
            lpL += dampCoef * (dl - lpL)
            lpR += dampCoef * (dr - lpR)

            // Feedback routing: ping-pong crosses channels.
            let fbL = pingpong ? lpR : lpL
            let fbR = pingpong ? lpL : lpR

            var wl = Double(inL[n]) + fb * fbL
            var wr = Double(inR[n]) + fb * fbR
            if abs(wl) < 1e-20 { wl = 0 }
            if abs(wr) < 1e-20 { wr = 0 }
            bufL[pos] = wl
            bufR[pos] = wr

            pos += 1
            if pos >= size { pos = 0 }

            // 100% wet output = the delayed taps.
            outL[n] = Float(dl)
            outR[n] = Float(dr)
        }
    }
}
