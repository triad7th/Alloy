import Foundation

/// Master send + limiter bus. Snapshots the (post-insert) dry stereo bus,
/// taps it into the shared reverb and delay by the current patch's send
/// levels, sums both wets back onto the dry, then brickwall-limits. In place,
/// non-allocating. Adds limiter.latencySamples of latency to the whole
/// render. Twin of web src/dsp/effects/master-bus.ts (canonical).

private let masterBusMaxBlockFrames = 4096

public final class MasterBus {
    private let reverb: Reverb
    private let delay: Delay
    private let limiter: Limiter
    private var sendReverb = 0.0
    private var sendDelay = 0.0
    /// Dry snapshot at process() entry — both sends tap this, not the wet bus.
    private var dryL = [Float](repeating: 0, count: masterBusMaxBlockFrames)
    private var dryR = [Float](repeating: 0, count: masterBusMaxBlockFrames)
    /// Pre-scaled send input.
    private var sendL = [Float](repeating: 0, count: masterBusMaxBlockFrames)
    private var sendR = [Float](repeating: 0, count: masterBusMaxBlockFrames)
    /// Wet output of whichever send unit is running (reused sequentially).
    private var wetL = [Float](repeating: 0, count: masterBusMaxBlockFrames)
    private var wetR = [Float](repeating: 0, count: masterBusMaxBlockFrames)

    public init(config: MasterConfig, sampleRate: Double) {
        self.reverb = Reverb(params: config.reverb, sampleRate: sampleRate)
        self.delay = Delay(params: config.delay, sampleRate: sampleRate)
        self.limiter = Limiter(params: config.limiter, sampleRate: sampleRate)
    }

    public var latencySamples: Int {
        limiter.latencySamples
    }

    public func setSends(reverb: Double, delay: Double) {
        sendReverb = reverb
        sendDelay = delay
    }

    public func reset() {
        reverb.reset()
        delay.reset()
        limiter.reset()
        for i in 0..<dryL.count {
            dryL[i] = 0
            dryR[i] = 0
            sendL[i] = 0
            sendR[i] = 0
            wetL[i] = 0
            wetR[i] = 0
        }
    }

    public func process(left: inout [Float], right: inout [Float], frames: Int) {
        // Snapshot the dry bus; both send taps read from this snapshot.
        for i in 0..<frames {
            dryL[i] = left[i]
            dryR[i] = right[i]
        }

        // Reverb send: dry * sendReverb -> reverb -> add wet. The reverb always
        // runs so its tail keeps ringing after the send level drops; the send
        // level scales only its input.
        for i in 0..<frames {
            sendL[i] = Float(Double(dryL[i]) * sendReverb)
            sendR[i] = Float(Double(dryR[i]) * sendReverb)
        }
        reverb.process(inL: &sendL, inR: &sendR, outL: &wetL, outR: &wetR, frames: frames)
        for i in 0..<frames {
            left[i] += wetL[i]
            right[i] += wetR[i]
        }

        // Delay send: dry * sendDelay -> delay -> add wet (taps the SAME dry
        // snapshot, so it never echoes the reverb wet just added).
        for i in 0..<frames {
            sendL[i] = Float(Double(dryL[i]) * sendDelay)
            sendR[i] = Float(Double(dryR[i]) * sendDelay)
        }
        delay.process(inL: &sendL, inR: &sendR, outL: &wetL, outR: &wetR, frames: frames)
        for i in 0..<frames {
            left[i] += wetL[i]
            right[i] += wetR[i]
        }

        // Master brickwall, last.
        limiter.process(left: &left, right: &right, frames: frames)
    }
}
