// Anti-aliasing for the FM generator. Phase modulation generates sidebands far
// above Nyquist; rendered at the output rate they fold back as inharmonic
// low-frequency junk (measured -25 dB below the fundamental on G#6 with a
// ratio-14 modulator, -21 dB on C8). Oversampling the operator loop and
// band-limiting before decimation removes them.
//
// The cost is paid per VOICE, only where it is needed: below the threshold,
// oversampling was measured to be a no-op (C4: -53 dB at 1x, -51 dB at 4x), so
// those notes run the original code path at the original cost.
// Twin: FmOversampling.swift.

/** Oversampling factor used above the threshold. 4x puts everything through C7
 *  at the measurement floor; 8x would be needed for a fully clean C8 and costs
 *  ~9x the FM CPU, which the <25%-of-a-core envelope will not absorb. */
export const FM_OVERSAMPLING = 4;

/** 32-tap Blackman-windowed sinc, cutoff 0.45/4 of the oversampled rate,
 *  normalized to unity DC gain. Generated once and pinned here: computing it at
 *  runtime would risk a last-ulp divergence between the JS and Swift math
 *  libraries, and these coefficients are part of the twin contract.
 *  64 taps measured no better than 32. Group delay is 15.5 oversampled samples
 *  = 3.875 output samples (~83 us) — an oversampled voice sits a hair behind a
 *  non-oversampled one in a layered patch. Inaudible, but real. */
export const FM_DECIMATION_TAPS: readonly number[] = [
  2.8477986181713758e-19, -6.047798834019103e-5, -4.3340271636890365e-5, 5.2916070916784888e-4,
  1.9038353814484067e-3, 3.3115968607472083e-3, 2.6042373642096179e-3, -2.7237870035835541e-3,
  -1.2906466905783016e-2, -2.3118576278907177e-2, -2.3226872620304369e-2, -1.9606343826616681e-3,
  4.5690838648908765e-2, 1.1232751779472532e-1, 1.7825129611097032e-1, 2.1942167258103942e-1,
  2.1942167258103948e-1, 1.7825129611097032e-1, 1.1232751779472533e-1, 4.5690838648908771e-2,
  -1.9606343826616690e-3, -2.3226872620304369e-2, -2.3118576278907201e-2, -1.2906466905783032e-2,
  -2.7237870035835541e-3, 2.6042373642096179e-3, 3.3115968607472083e-3, 1.9038353814484074e-3,
  5.2916070916784867e-4, -4.3340271636890290e-5, -6.0477988340191701e-5, 2.8477986181713758e-19,
];

/** The oversampling factor a voice needs, from the highest frequency anywhere in
 *  its operator stack. A pure function of the note and the patch, so it is
 *  deterministic and twin-identical, and it is decided ONCE per note rather than
 *  per sample.
 *
 *  The threshold is sampleRate/4, placed from measurement: sweeping the highest
 *  operator frequency, 1x and 4x are indistinguishable up to 13.1 kHz and
 *  diverge by +9..+38 dB from 14.7 kHz upward. 12 kHz sits just below that,
 *  which also leaves ~2 semitones of upward pitch-bend headroom — setPitchRatio
 *  does NOT re-pick the factor mid-note (that would glitch), so the margin
 *  matters. */
export function chooseOversampling(maxOpFrequency: number, sampleRate: number): number {
  return maxOpFrequency > sampleRate / 4 ? FM_OVERSAMPLING : 1;
}

/** Ring-buffered FIR: push every oversampled sample, read one output per
 *  FM_OVERSAMPLING pushes. */
export class FmDecimator {
  private readonly history = new Float64Array(FM_DECIMATION_TAPS.length);
  private pos = 0;

  reset(): void {
    this.history.fill(0);
    this.pos = 0;
  }

  push(x: number): void {
    this.history[this.pos] = x;
    this.pos = (this.pos + 1) % this.history.length;
  }

  /** Convolve the window. After push(), `pos` indexes the OLDEST sample, so
   *  tap j lines up with history[(pos + j) % n] — oldest to newest.
   *
   *  NOTE: applying taps[0] to the OLDEST sample is the time-REVERSE of textbook
   *  convolution. It is numerically inert only because FM_DECIMATION_TAPS is
   *  exactly palindromic. Swap in an asymmetric table and this filter silently
   *  becomes its own time reversal — reverse the tap index if you ever do.
   *
   *  The window is walked as two contiguous runs (pos..<n, then 0..<pos) rather
   *  than with a `% n` per tap: 32 modulos per output sample was the dominant
   *  added cost for a 2-op voice. Same samples, same taps, same summation order,
   *  so it is BIT-identical to the modulo form — pinned by a test. */
  output(): number {
    const n = this.history.length;
    const p = this.pos;
    let y = 0;
    let j = 0;
    for (let i = p; i < n; i++, j++) {
      y += FM_DECIMATION_TAPS[j] * this.history[i];
    }
    for (let i = 0; i < p; i++, j++) {
      y += FM_DECIMATION_TAPS[j] * this.history[i];
    }
    return y;
  }
}
