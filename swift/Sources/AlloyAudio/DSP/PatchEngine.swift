import Foundation

/// PatchEngine: polyphonic voice pool over a sample-position transport clock.
/// Events are scheduled at absolute frames and applied sample-accurately:
/// process() renders segment-wise up to each due event's exact offset, applies
/// every event at that frame in schedule order, and continues. Voices stay
/// mono; per segment the summed voice bus is copied to a stereo scratch pair
/// at unity (insert-free ⇒ L == R == the old mono output), the patch's insert
/// chain processes it in place, and the result ADDS into the caller's
/// left/right buffers — all through preallocated scratches, so the engine
/// allocates only when voices start (and in setPatch, the drain context,
/// where the chain is rebuilt). Twin of web src/dsp/patch-engine.ts
/// (canonical).

public struct EngineEvent {
    public enum Kind {
        case noteOn(midi: Int, velocity: Double)
        case noteOff(midi: Int)
        case allNotesOff
    }

    /// Absolute transport frame the event fires at.
    public let frame: Int
    public let kind: Kind

    public init(frame: Int, kind: Kind) {
        self.frame = frame
        self.kind = kind
    }
}

/// Largest frames-per-process() call (hosts use 128); sizes the segment scratch.
private let maxBlockFrames = 4096

/// renderPatch block size — matches the 1b-ii host quantum.
private let renderBlockFrames = 128

public final class PatchEngine {
    private final class VoiceEntry {
        let midi: Int
        let voice: Voice
        /// Transport frame the voice started at; drives steal priority.
        let startFrame: Int
        /// Keyed up (noteOff/restrike/allNotesOff); stays pooled until silent.
        var released = false
        /// Last render() return; false = silent and reapable.
        var alive = true

        init(midi: Int, voice: Voice, startFrame: Int) {
            self.midi = midi
            self.voice = voice
            self.startFrame = startFrame
        }
    }

    private let sampleRate: Double
    private let maxVoices: Int
    private let zoneSetProvider: ZoneSetProvider?
    private var patch: Patch?
    private var voices: [VoiceEntry] = []
    /// Pending events, sorted by frame; equal frames keep schedule order.
    private var queue: [EngineEvent] = []
    private var frameCount = 0
    /// Per-segment mono mix buffer; voices add into it.
    private var scratch = [Float](repeating: 0, count: maxBlockFrames)
    /// Per-segment stereo pair the insert chain processes in place.
    private var scratchL = [Float](repeating: 0, count: maxBlockFrames)
    private var scratchR = [Float](repeating: 0, count: maxBlockFrames)
    /// Insert chain; rebuilt only in setPatch (see its doc comment).
    private var inserts: [EffectUnit] = []

    public init(sampleRate: Double, maxVoices: Int = 64, zoneSetProvider: ZoneSetProvider? = nil) {
        self.sampleRate = sampleRate
        self.maxVoices = max(1, maxVoices)
        self.zoneSetProvider = zoneSetProvider
    }

    /// Returns validatePatch errors; [] = accepted (the TS twin throws
    /// instead). New notes use the new patch; sounding voices finish on the
    /// old one. The insert chain is rebuilt here (the drain context — never
    /// in process) from the new patch; it is one shared chain and effects
    /// are never reset on notes, so tails ring across notes AND across
    /// setPatch: voices still sounding on the old patch render through the
    /// NEW chain (hardware-like patch transition; per-generation chains are
    /// an explicit non-goal).
    @discardableResult
    public func setPatch(_ patch: Patch) -> [String] {
        let errors = validatePatch(patch)
        if errors.isEmpty {
            self.patch = patch
            inserts = (patch.inserts ?? []).map { createInsert($0, sampleRate: sampleRate) }
        }
        return errors
    }

    /// Sample-position transport clock: frames rendered since construction.
    public var frame: Int { frameCount }

    /// Live pool entries (sounding + releasing, before reap).
    public var activeVoiceCount: Int { voices.count }

    /// Schedule at an absolute frame. Events at frames already passed fire at
    /// the start of the next process() block. Same-frame events fire in
    /// schedule order (stable insert).
    public func schedule(_ event: EngineEvent) {
        var i = queue.count
        while i > 0, queue[i - 1].frame > event.frame {
            i -= 1
        }
        queue.insert(event, at: i)
    }

    /// Renders the next `frames` samples ADDING into left/right[0..<frames]; advances the transport.
    public func process(intoLeft left: inout [Float], right: inout [Float], frames: Int) {
        precondition(frames <= maxBlockFrames, "process frames \(frames) exceeds \(maxBlockFrames)")
        var pos = 0
        while pos < frames {
            while let next = queue.first, next.frame <= frameCount + pos {
                queue.removeFirst()
                apply(next, at: frameCount + pos)
            }
            var end = frames
            if let next = queue.first {
                end = min(end, next.frame - frameCount)
            }
            renderSegment(intoLeft: &left, right: &right, offset: pos, length: end - pos)
            pos = end
        }
        frameCount += frames
    }

    private func apply(_ event: EngineEvent, at currentFrame: Int) {
        switch event.kind {
        case let .noteOn(midi, velocity):
            noteOn(midi: midi, velocity: velocity, at: currentFrame)
        case let .noteOff(midi):
            noteOff(midi: midi)
        case .allNotesOff:
            for entry in voices {
                entry.voice.quickRelease()
                entry.released = true
            }
        }
    }

    private func noteOn(midi: Int, velocity: Double, at currentFrame: Int) {
        guard let patch else {
            return // No patch loaded yet: note events are silently ignored.
        }
        if let restruck = voices.first(where: { $0.midi == midi && !$0.released }) {
            restruck.voice.quickRelease()
            restruck.released = true // Stays pooled until silent.
        }
        if voices.count >= maxVoices {
            steal()
        }
        let voice = Voice(patch: patch, sampleRate: sampleRate, zoneSetProvider: zoneSetProvider)
        voice.noteOn(midi: midi, velocity: velocity)
        voices.append(VoiceEntry(midi: midi, voice: voice, startFrame: currentFrame))
    }

    /// Keys up the newest non-released entry for that midi (if any).
    private func noteOff(midi: Int) {
        for entry in voices.reversed() where entry.midi == midi && !entry.released {
            entry.released = true
            entry.voice.noteOff()
            return
        }
    }

    /// At the cap: drop the earliest-started released entry, or the earliest
    /// overall if none is released. A hard drop is acceptable for 1b; a
    /// dying-voice fade list is a later refinement.
    private func steal() {
        guard !voices.isEmpty else { return }
        var earliest = 0
        var earliestReleased = -1
        for (i, entry) in voices.enumerated() {
            if entry.startFrame < voices[earliest].startFrame {
                earliest = i
            }
            if entry.released, earliestReleased == -1 || entry.startFrame < voices[earliestReleased].startFrame {
                earliestReleased = i
            }
        }
        voices.remove(at: earliestReleased != -1 ? earliestReleased : earliest)
    }

    /// Zero the mono scratch segment, have every voice add into it, copy it
    /// to the stereo scratch pair at unity, run the insert chain in patch
    /// order, add the pair into left/right; reap silent voices. The chain
    /// runs even over voice-silent segments so effect tails keep ringing.
    private func renderSegment(intoLeft left: inout [Float], right: inout [Float], offset: Int, length: Int) {
        for i in 0..<length {
            scratch[i] = 0
        }
        for entry in voices {
            entry.alive = entry.voice.render(into: &scratch, frames: length)
        }
        for i in 0..<length {
            scratchL[i] = scratch[i]
            scratchR[i] = scratch[i]
        }
        for insert in inserts {
            insert.process(left: &scratchL, right: &scratchR, frames: length)
        }
        for i in 0..<length {
            left[offset + i] += scratchL[i]
            right[offset + i] += scratchR[i]
        }
        voices.removeAll { !$0.alive }
    }
}

/// Offline render harness — the golden-test and future bounce path. Fresh
/// engine, schedule all, process in 128-frame blocks (last block short),
/// return the full stereo buffer pair.
public func renderPatch(
    patch: Patch,
    events: [EngineEvent],
    totalFrames: Int,
    sampleRate: Double,
    zoneSetProvider: ZoneSetProvider? = nil,
) -> (left: [Float], right: [Float]) {
    let engine = PatchEngine(sampleRate: sampleRate, zoneSetProvider: zoneSetProvider)
    engine.setPatch(patch)
    for event in events {
        engine.schedule(event)
    }
    var outL = [Float](repeating: 0, count: totalFrames)
    var outR = [Float](repeating: 0, count: totalFrames)
    var blockL = [Float](repeating: 0, count: renderBlockFrames)
    var blockR = [Float](repeating: 0, count: renderBlockFrames)
    var offset = 0
    while offset < totalFrames {
        let n = min(renderBlockFrames, totalFrames - offset)
        for i in 0..<n {
            blockL[i] = 0
            blockR[i] = 0
        }
        engine.process(intoLeft: &blockL, right: &blockR, frames: n)
        for i in 0..<n {
            outL[offset + i] = blockL[i]
            outR[offset + i] = blockR[i]
        }
        offset += n
    }
    return (outL, outR)
}
