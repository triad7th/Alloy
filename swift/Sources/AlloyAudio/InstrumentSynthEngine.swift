/// Routes notes to their original engine until key and pedal release.
/// Main-thread-only, like SynthEngineCore. Replaced engines remain retained
/// so pedal changes and panic also reach their release tails.
public final class InstrumentSynthEngine: SynthEngine {
    private struct Owner {
        let engine: any SynthEngine
        var held: Bool
    }

    private var engines: [String: any SynthEngine]
    private var retained: [ObjectIdentifier: any SynthEngine] = [:]
    private var owners: [Int: Owner] = [:]
    private var selected: String
    private var sustain = false

    public init(engines: [String: any SynthEngine], defaultInstrumentId: String) {
        precondition(engines[defaultInstrumentId] != nil, "Default instrument must be registered")
        self.engines = engines
        selected = defaultInstrumentId
        for engine in engines.values {
            retained[ObjectIdentifier(engine)] = engine
        }
    }

    public func replaceEngine(_ id: String, engine: any SynthEngine) {
        guard engines[id] != nil else { return }
        if retained[ObjectIdentifier(engine)] == nil { engine.setSustain(sustain) }
        retained[ObjectIdentifier(engine)] = engine
        engines[id] = engine
    }

    public func noteOn(midi: Int) {
        start(midi: midi, velocity: nil)
    }

    public func noteOn(midi: Int, velocity: Double) {
        start(midi: midi, velocity: velocity)
    }

    private func start(midi: Int, velocity: Double?) {
        if var owner = owners[midi] {
            if !owner.held {
                owner.held = true
                owners[midi] = owner
                Self.start(owner.engine, midi: midi, velocity: velocity)
            }
            return
        }
        guard let engine = engines[selected] else { return }
        engine.setInstrument(selected)
        Self.start(engine, midi: midi, velocity: velocity)
        owners[midi] = Owner(engine: engine, held: true)
    }

    private static func start(_ engine: any SynthEngine, midi: Int, velocity: Double?) {
        if let velocity { engine.noteOn(midi: midi, velocity: velocity) }
        else { engine.noteOn(midi: midi) }
    }

    public func noteOff(midi: Int) {
        guard var owner = owners[midi], owner.held else { return }
        owner.held = false
        owner.engine.noteOff(midi: midi)
        if sustain { owners[midi] = owner }
        else { owners.removeValue(forKey: midi) }
    }

    public func setSustain(_ on: Bool) {
        sustain = on
        for engine in retained.values {
            engine.setSustain(on)
        }
        if !on { owners = owners.filter { $0.value.held } }
    }

    public func setInstrument(_ id: String) {
        if engines[id] != nil { selected = id }
    }

    public func allNotesOff() {
        for engine in retained.values {
            engine.allNotesOff()
        }
        owners.removeAll()
    }
}
