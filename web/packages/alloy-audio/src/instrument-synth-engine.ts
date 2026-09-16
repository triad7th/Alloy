import type { SynthEngine } from './synth-engine.js';

/** Routes notes to their original engine until both key and pedal release.
 * Retains replaced engines so pedal changes and panic also reach their tails. */
export class InstrumentSynthEngine implements SynthEngine {
  private readonly engines: Map<string, SynthEngine>;
  private readonly retained = new Set<SynthEngine>();
  private readonly owners = new Map<number, { engine: SynthEngine; held: boolean }>();
  private selected: string;
  private sustain = false;

  constructor(engines: ReadonlyMap<string, SynthEngine>, defaultInstrumentId: string) {
    if (!engines.has(defaultInstrumentId)) throw new Error('Default instrument must be registered');
    this.engines = new Map(engines);
    this.selected = defaultInstrumentId;
    for (const engine of engines.values()) this.retained.add(engine);
  }

  replaceEngine(id: string, engine: SynthEngine): void {
    if (!this.engines.has(id)) return;
    if (!this.retained.has(engine)) engine.setSustain(this.sustain);
    this.retained.add(engine);
    this.engines.set(id, engine);
  }

  noteOn(midi: number, velocity?: number): void {
    const owner = this.owners.get(midi);
    if (owner) {
      if (!owner.held) {
        owner.held = true;
        owner.engine.noteOn(midi, velocity);
      }
      return;
    }
    const engine = this.engines.get(this.selected)!;
    engine.setInstrument(this.selected);
    engine.noteOn(midi, velocity);
    this.owners.set(midi, { engine, held: true });
  }

  noteOff(midi: number): void {
    const owner = this.owners.get(midi);
    if (!owner || !owner.held) return;
    owner.held = false;
    owner.engine.noteOff(midi);
    if (!this.sustain) this.owners.delete(midi);
  }

  setSustain(on: boolean): void {
    this.sustain = on;
    for (const engine of this.retained) engine.setSustain(on);
    if (!on) for (const [midi, owner] of this.owners) if (!owner.held) this.owners.delete(midi);
  }

  setInstrument(id: string): void { if (this.engines.has(id)) this.selected = id; }

  allNotesOff(): void {
    for (const engine of this.retained) engine.allNotesOff();
    this.owners.clear();
  }
}
