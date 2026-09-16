import type { SynthEngine } from './synth-engine.js';
import { SynthEngineCore } from './synth-engine-core.js';

/** Immediate note-command subset shared by the worklet and native patch hosts. */
export interface PatchSynthHost {
  noteOn(midi: number, velocity: number): void;
  noteOff(midi: number): void;
  allNotesOff(): void;
}

/** Adds physical-key and pedal tracking to one patch host. */
export class PatchSynthEngine implements SynthEngine {
  private readonly core: SynthEngineCore;

  constructor(private readonly host: PatchSynthHost, private readonly defaultVelocity = 1) {
    this.core = new SynthEngineCore(() => ({
      start: (midi, velocity) => {
        host.noteOn(midi, velocity);
        return { release: () => host.noteOff(midi), stop: () => {} };
      },
    }), () => 0);
    this.core.setInstrument('patch');
  }

  noteOn(midi: number, velocity = this.defaultVelocity): void { this.core.noteOn(midi, velocity); }
  noteOff(midi: number): void { this.core.noteOff(midi); }
  setSustain(on: boolean): void { this.core.setSustain(on); }
  setInstrument(_id: string): void {}
  allNotesOff(): void { this.core.allNotesOff(); this.host.allNotesOff(); }
}
