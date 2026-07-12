import Foundation

/// Drive + 3-band EQ — a tanh saturation stage followed by a static tone
/// stack (low shelf / mid peak / high shelf) and an output level trim.
/// Order is fixed: drive → low shelf → mid peak → high shelf → level. Every
/// gain and filter coefficient is derived from the (static) params once, in
/// the initializer — cheap enough to run fully per-sample, no control
/// ticks. The mid peak reuses the shared Svf (bandpass, Q 0.707); the
/// shelves are one-pole filters (low shelf: input + (gain-1)*lowpass; high
/// shelf: input + (gain-1)*(input-lowpass), i.e. the lowpass's high-pass
/// complement).
/// Twin of web src/dsp/effects/drive-eq.ts (canonical).

/// Shelf/peak center frequencies.
public let DRIVE_EQ_LOW_HZ = 250.0
public let DRIVE_EQ_MID_HZ = 1000.0
public let DRIVE_EQ_HIGH_HZ = 3000.0
private let driveEqMidQ = 0.707

public final class DriveEq: EffectUnit {
    private let sampleRate: Double
    private let preGain: Double
    private let gLow: Double
    private let gMid: Double
    private let gHigh: Double
    private let gLevel: Double
    private let lowCoef: Double
    private let highCoef: Double
    private var lowStateL = 0.0
    private var lowStateR = 0.0
    private var highStateL = 0.0
    private var highStateR = 0.0
    private var midL: Svf
    private var midR: Svf

    public init(params: DriveEqParams, sampleRate: Double) {
        self.sampleRate = sampleRate
        self.preGain = 1 + params.drive * 4
        self.gLow = pow(10, params.lowDb / 20)
        self.gMid = pow(10, params.midDb / 20)
        self.gHigh = pow(10, params.highDb / 20)
        self.gLevel = pow(10, params.levelDb / 20)
        self.lowCoef = 1 - exp(-DspConstants.twoPi * DRIVE_EQ_LOW_HZ / sampleRate)
        self.highCoef = 1 - exp(-DspConstants.twoPi * DRIVE_EQ_HIGH_HZ / sampleRate)
        self.midL = Svf(mode: .bandpass, sampleRate: sampleRate)
        self.midR = Svf(mode: .bandpass, sampleRate: sampleRate)
        self.midL.setParams(cutoffHz: DRIVE_EQ_MID_HZ, q: driveEqMidQ)
        self.midR.setParams(cutoffHz: DRIVE_EQ_MID_HZ, q: driveEqMidQ)
    }

    public func reset() {
        lowStateL = 0
        lowStateR = 0
        highStateL = 0
        highStateR = 0
        // Svf exposes no reset(); a fresh instance is the established way
        // to clear its internal state (same pattern as Voice's per-note TVF).
        midL = Svf(mode: .bandpass, sampleRate: sampleRate)
        midR = Svf(mode: .bandpass, sampleRate: sampleRate)
        midL.setParams(cutoffHz: DRIVE_EQ_MID_HZ, q: driveEqMidQ)
        midR.setParams(cutoffHz: DRIVE_EQ_MID_HZ, q: driveEqMidQ)
    }

    public func process(left: inout [Float], right: inout [Float], frames: Int) {
        for i in 0..<frames {
            let sl = tanh(Double(left[i]) * preGain)
            lowStateL += lowCoef * (sl - lowStateL)
            var yl = sl + (gLow - 1) * lowStateL
            yl += (gMid - 1) * midL.process(yl)
            highStateL += highCoef * (yl - highStateL)
            yl += (gHigh - 1) * (yl - highStateL)
            left[i] = Float(yl * gLevel)

            let sr = tanh(Double(right[i]) * preGain)
            lowStateR += lowCoef * (sr - lowStateR)
            var yr = sr + (gLow - 1) * lowStateR
            yr += (gMid - 1) * midR.process(yr)
            highStateR += highCoef * (yr - highStateR)
            yr += (gHigh - 1) * (yr - highStateR)
            right[i] = Float(yr * gLevel)
        }
    }
}
