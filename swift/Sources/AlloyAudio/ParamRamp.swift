import Foundation

/// Port of the three (and only three) Web Audio `AudioParam` scheduling
/// primitives the web alloy-audio voices use, so envelope math matches
/// mathematically: `setValueAtTime`, `linearRampToValueAtTime`,
/// `setTargetAtTime`. This primitive pairing is the alignment contract with
/// the web twin's `MinimalAudioParam`.
/// Event times must be non-decreasing across calls — that is how every web
/// voice schedules, and how the Swift voices schedule too.
/// Constraint: a `linearRamp` must not directly follow an active
/// `setTarget` — snapshot first with `setValue(value(at: t), at: t)`, as the
/// web synth release does. Ramping straight off a target curve is not
/// interpolated (see the pinned regression test).
public struct ParamRamp {
    private enum Event {
        case set(value: Double, time: Double)
        case linear(to: Double, endTime: Double)
        case target(value: Double, startTime: Double, timeConstant: Double)

        var time: Double {
            switch self {
            case let .set(_, time): time
            case let .linear(_, endTime): endTime
            case let .target(_, startTime, _): startTime
            }
        }
    }

    private var events: [Event] = []
    private let initialValue: Double

    public init(initialValue: Double = 0) {
        self.initialValue = initialValue
    }

    public mutating func setValue(_ v: Double, at t: Double) {
        events.append(.set(value: v, time: t))
    }

    public mutating func linearRamp(to v: Double, endingAt t: Double) {
        events.append(.linear(to: v, endTime: t))
    }

    public mutating func setTarget(_ target: Double, startingAt t: Double, timeConstant tc: Double) {
        events.append(.target(value: target, startTime: t, timeConstant: tc))
    }

    public func value(at t: Double) -> Double {
        // Walk events in order, carrying (value, time) state forward.
        var value = initialValue
        var time = 0.0
        for (index, event) in events.enumerated() {
            switch event {
            case let .set(v, eventTime):
                if eventTime > t { return value }
                value = v
                time = eventTime
            case let .linear(to, endTime):
                if time >= endTime {
                    value = to
                } else if t < endTime {
                    let clamped = max(t, time)
                    return value + (to - value) * (clamped - time) / (endTime - time)
                } else {
                    value = to
                    time = endTime
                }
            case let .target(target, startTime, tc):
                if startTime > t { return value }
                // The exponential runs until the next event's time (or t).
                let next = events.dropFirst(index + 1).first?.time ?? .infinity
                let end = min(t, next)
                value = target + (value - target) * exp(-(end - startTime) / tc)
                time = end
            }
        }
        return value
    }
}
