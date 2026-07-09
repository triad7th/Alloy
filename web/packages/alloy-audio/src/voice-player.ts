// Voice contracts shared by every tone producer, plus the two engine-wide
// level/fade constants. Web-canonical twin of AlloyAudio's VoicePlayer.swift
// (ActiveVoice is `ActiveVoiceHandle` on the Swift side).

/** One sounding note, owned by the engine's per-note voice map. */
export interface ActiveVoice {
  /** Begin the key-up release; the voice tears itself down when silent. */
  release(when: number): void;
  /** Hard stop (allNotesOff): fast fade, then teardown. */
  stop(when: number): void;
}

/** Tone-production strategy for one instrument. */
export interface VoicePlayer {
  start(midi: number, velocity: number, when: number): ActiveVoice;
}

/** Master-relative peak per voice; keeps polyphony from clipping. */
export const VOICE_PEAK = 0.3;

/** Fade time used by ActiveVoice.stop (allNotesOff), in seconds. */
export const FAST_STOP_S = 0.03;
