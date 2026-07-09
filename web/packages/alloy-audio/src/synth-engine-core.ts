// The polyphony + sustain-pedal state machine, decoupled from tone production
// via VoicePlayer and from platform time via now(). Main-thread-only by
// design; the platform wrapper owns cross-thread hand-off (and, on the web,
// autoplay resume). Web-canonical twin of AlloyAudio's SynthEngineCore.swift.

import type { SynthEngine } from './synth-engine.js';
import type { ActiveVoice, VoicePlayer } from './voice-player.js';

interface Voice {
  active: ActiveVoice;
  heldByKey: boolean; // key is still physically down
  heldByPedal: boolean; // sustain pedal latched it
}

export class SynthEngineCore implements SynthEngine {
  private readonly voices = new Map<number, Voice>();
  private sustain = false;
  // No instrument selected yet: noteOn is a no-op until the platform wrapper
  // (or the app) calls setInstrument with its default id.
  private player: VoicePlayer | null = null;

  constructor(
    private readonly playerFor: (id: string) => VoicePlayer,
    private readonly now: () => number,
  ) {}

  noteOn(midi: number, velocity = 1): void {
    if (!this.player) {
      return;
    }
    const existing = this.voices.get(midi);
    if (existing) {
      // Already sounding; the envelope is intentionally not re-struck. But re-assert
      // the physical hold and clear any pedal latch left by a prior release, so a
      // later pedal-up does not release a key that is still physically down.
      existing.heldByKey = true;
      existing.heldByPedal = false;
      return;
    }
    const active = this.player.start(midi, velocity, this.now());
    this.voices.set(midi, { active, heldByKey: true, heldByPedal: false });
  }

  noteOff(midi: number): void {
    const voice = this.voices.get(midi);
    if (!voice) {
      return;
    }
    voice.heldByKey = false;
    if (this.sustain) {
      voice.heldByPedal = true;
      return;
    }
    this.release(midi, voice);
  }

  setSustain(on: boolean): void {
    this.sustain = on;
    if (!on) {
      for (const [midi, voice] of [...this.voices]) {
        if (voice.heldByPedal && !voice.heldByKey) {
          this.release(midi, voice);
        }
      }
    }
  }

  setInstrument(id: string): void {
    this.player = this.playerFor(id);
  }

  allNotesOff(): void {
    const when = this.now();
    for (const [midi, voice] of [...this.voices]) {
      voice.active.stop(when);
      this.voices.delete(midi);
    }
  }

  private release(midi: number, voice: Voice): void {
    voice.active.release(this.now());
    this.voices.delete(midi);
  }
}
