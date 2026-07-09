import Foundation

/// Port of the web alloy-audio SampledPlayer voice: reads a decoded zone
/// buffer at rate 2^((midi - zoneMidi)/12) (scaled by the zone/output
/// sample-rate ratio) with linear interpolation. The recording carries its
/// own attack and natural decay; only the key-up release is shaped here.
/// Gain is clamp01(velocity) — NOT VOICE_PEAK-scaled.
public final class SampledVoice: Voice {
    private let samples: [Float]
    private let readIncrement: Double
    private let releaseSeconds: Double
    private let sampleRate: Double
    private var gain = ParamRamp()
    private var position = 0.0
    private var time = 0.0
    private var endTime = Double.infinity
    private let velocity: Double
    private var exhausted = false

    public init(zone: SampleZone, midi: Int, velocity: Double, releaseSeconds: Double, sampleRate: Double) {
        samples = zone.samples
        readIncrement = pow(2, Double(midi - zone.midi) / 12) * zone.sampleRate / sampleRate
        self.releaseSeconds = releaseSeconds
        self.sampleRate = sampleRate
        self.velocity = min(max(velocity, 0), 1)
    }

    public func start(at when: Double) {
        time = when
        gain.setValue(velocity, at: when)
    }

    public func render(into output: inout [Float], frames: Int) -> Bool {
        let step = 1 / sampleRate
        for i in 0..<frames {
            let index = Int(position)
            guard index + 1 < samples.count else {
                exhausted = true
                break
            }
            let fraction = Float(position - Double(index))
            let sample = samples[index] + (samples[index + 1] - samples[index]) * fraction
            output[i] += sample * Float(gain.value(at: time))
            position += readIncrement
            time += step
        }
        return !exhausted && time < endTime
    }

    public func release(at when: Double) {
        end(at: when, fade: releaseSeconds)
    }

    public func stop(at when: Double) {
        end(at: when, fade: VoiceConstants.fastStopSeconds)
    }

    private func end(at when: Double, fade: Double) {
        gain.setTarget(0, startingAt: when, timeConstant: fade / 3)
        endTime = min(endTime, when + fade * 3)
    }
}
