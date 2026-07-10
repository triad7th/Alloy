import AlloyAudio
import AlloyUI
import SwiftUI

/// One-octave keyboard driving AVSynthEngine with a harness-local catalog —
/// instrument catalogs are app-side by design. 'lead' is the supersaw;
/// 'pluck' is a sampled spec with no zones, so it always plays its synth
/// fallback and needs no sample assets.
private let harnessInstruments = [
    InstrumentDescriptor(
        id: "lead",
        voice: .supersaw(SupersawVoiceSpec(
            unison: 5, detuneCents: 24, filterBaseHz: 900, filterEnvHz: 2600,
            filterDecay: 0.35, filterQ: 0.9,
            amp: SynthVoiceConfig(waveform: .sawtooth, attack: 0.005, decay: 0.25,
                                  sustain: 0.5, release: 0.35)
        )),
        sends: VoiceSends(reverb: 0.3, delay: 0.18)
    ),
    InstrumentDescriptor(
        id: "pluck",
        voice: .sampled(SampledVoiceSpec(
            sampleBaseURL: "", sampleMidis: [], release: 0.25,
            fallback: SynthVoiceConfig(waveform: .triangle, attack: 0.005, decay: 0.12,
                                       sustain: 0.6, release: 0.25)
        )),
        sends: VoiceSends(reverb: 0.18)
    ),
]

struct SynthDemoView: View {
    @State private var engine: AVSynthEngine? = nil
    @State private var sustain = false
    @State private var instrument = "lead"

    // C4..C5 with note names; sharps render as narrow dark keys.
    private let keys: [(midi: Int, name: String)] = (60...72).map {
        ($0, Pitch.noteName(midi: $0))
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            KnobCard {
                KnobToggle(isOn: sustain, label: "Sustain") {
                    sustain = $0
                    engine?.setSustain($0)
                }
                KnobSegment(
                    options: harnessInstruments.map { (value: $0.id, label: $0.id.capitalized) },
                    selection: instrument
                ) {
                    instrument = $0
                    engine?.setInstrument($0)
                }
            }
            // Wider than an iPhone screen — scrolls instead of stretching the page.
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(alignment: .top, spacing: 4) {
                    ForEach(keys, id: \.midi) { key in
                        keyButton(key.midi, name: key.name)
                    }
                }
            }
        }
        .onAppear {
            if engine == nil {
                let e = AVSynthEngine(instruments: harnessInstruments)
                e.setSustain(sustain)
                e.setInstrument(instrument)
                engine = e
            }
        }
        .onDisappear { engine?.allNotesOff() }
    }

    private func keyButton(_ midi: Int, name: String) -> some View {
        let black = Pitch.isBlackKey(midi: midi)
        return Text(name)
            .font(.caption2)
            .frame(width: black ? 30 : 38, height: black ? 70 : 100, alignment: .bottom)
            .background(black ? Color(white: 0.15) : Color(white: 0.92))
            .foregroundStyle(black ? .white : .black)
            .clipShape(RoundedRectangle(cornerRadius: 5))
            .onLongPressGesture(
                minimumDuration: .infinity,
                perform: {},
                onPressingChanged: { pressing in
                    if pressing { engine?.noteOn(midi: midi) } else { engine?.noteOff(midi: midi) }
                }
            )
    }
}
