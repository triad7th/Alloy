// The playing surface the UI talks to. Instrument ids are opaque strings —
// AlloyAudio is instrument-agnostic; apps own their catalogs.
// Web-canonical twin of AlloyAudio's SynthEngine.swift.

export interface SynthEngine {
  noteOn(midi: number, velocity?: number): void;
  noteOff(midi: number): void;
  setSustain(on: boolean): void;
  setInstrument(id: string): void;
  allNotesOff(): void;
}
