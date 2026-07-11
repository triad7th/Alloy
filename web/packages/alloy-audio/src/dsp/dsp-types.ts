// Shared DSP-core contracts. Everything under src/dsp/ is pure math: no
// WebAudio imports, double-precision internals, Float32 only at render
// boundaries. Twin: swift/Sources/AlloyAudio/DSP/ToneGenerator.swift.

export const TWO_PI = 2 * Math.PI;

/** Envelope level below this is treated as silence (≈ −100 dBFS). */
export const SILENCE_FLOOR = 1e-5;

/**
 * A tone source for one note. `render` ADDS into `out` (the caller owns
 * zero-fill) so layers and voices sum without scratch buffers.
 *
 * Lifetime contract: `finished` means self-terminated — only silence can
 * ever follow (FM with all carrier envelopes idle; an unlooped sample past
 * its last frame). Sustained kinds (VA, additive, looped samples) never
 * self-finish: `noteOff` only forwards key-up to intrinsic envelopes, and
 * the voice's TVA (phase 1b) owns the audible release and voice teardown.
 * A generator is never `finished` before its first `noteOn`.
 */
export interface ToneGenerator {
  noteOn(midi: number, velocity: number): void;
  noteOff(): void;
  /**
   * Multiplies the sounding frequency relative to the noteOn pitch (1 =
   * unbent). Cheap; intended to be called at control rate. Ratio persists
   * until the next call or noteOn (noteOn resets it to 1).
   */
  setPitchRatio(ratio: number): void;
  render(out: Float32Array, frames: number): void;
  readonly finished: boolean;
}
