import { describe, expect, it } from 'vitest';
import {
  FM_DECIMATION_TAPS,
  FM_OVERSAMPLING,
  FmDecimator,
  chooseOversampling,
  maxPitchModRatio,
} from './fm-oversampling.js';

const FS = 48_000;
const FS_OS = FS * FM_OVERSAMPLING; // 192 kHz

/** Push a sine at `hz` through the decimator and return the decimated output. */
function decimate(hz: number, frames: number): Float64Array {
  const dec = new FmDecimator();
  const out = new Float64Array(frames);
  let n = 0;
  for (let i = 0; i < frames; i++) {
    for (let k = 0; k < FM_OVERSAMPLING; k++) {
      dec.push(Math.sin((2 * Math.PI * hz * n) / FS_OS));
      n++;
    }
    out[i] = dec.output();
  }
  return out;
}

const rms = (x: Float64Array) => Math.sqrt(x.reduce((s, v) => s + v * v, 0) / x.length);

describe('fm oversampling', () => {
  it('the decimation table is 32 taps and sums to unity', () => {
    expect(FM_DECIMATION_TAPS.length).toBe(32);
    const sum = FM_DECIMATION_TAPS.reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(1, 12); // unity DC gain: the filter must not change level
  });

  it('passes a tone well inside the audio band at essentially unity gain', () => {
    // 1 kHz is far below the 24 kHz output Nyquist — it must survive untouched.
    const y = decimate(1000, 4096).subarray(64); // skip the FIR's fill-in
    expect(rms(y)).toBeGreaterThan(0.65); // a unit sine has RMS 0.707
    expect(rms(y)).toBeLessThan(0.75);
  });

  it('CRUSHES the frequencies that fold into the AUDIBLE midrange', () => {
    // What matters is not the response at a frequency, but where that frequency
    // FOLDS TO once we drop to 48 kHz. These are the dangerous ones:
    //   40 kHz -> folds to  8 kHz  (squarely audible)
    //   36 kHz -> folds to 12 kHz  (squarely audible)
    const at = (hz: number) => 20 * Math.log10(rms(decimate(hz, 4096).subarray(64)) / 0.707);
    expect(at(40_000)).toBeLessThan(-60);
    expect(at(36_000)).toBeLessThan(-45);
  });

  it('is deliberately soft right at the transition band, which folds where nobody hears', () => {
    // 30 kHz folds to 18 kHz — the very top of hearing — and sits in a 32-tap
    // filter's transition band, where it only gets ~-23 dB. That is the accepted
    // cost of 32 taps, and it is why the end-to-end alias floor still measures
    // -63 dB on G#6. Pinned so a future "improvement" that narrows the passband
    // to chase this number has to argue with a test: narrowing the cutoff to
    // crush 30 kHz would lowpass the OUTPUT and gut the brightness this whole
    // phase exists to recover.
    const attenuationDb = 20 * Math.log10(rms(decimate(30_000, 4096).subarray(64)) / 0.707);
    expect(attenuationDb).toBeLessThan(-15);
    expect(attenuationDb).toBeGreaterThan(-35);
  });

  it('keeps the audio band intact — the brightness must survive', () => {
    // Two-sided: a passband BOOST is a defect too (in-band ripple), so bound the
    // response from above as well. Measured: -0.0 dB at 1 kHz, -0.1 at 10 kHz,
    // -1.2 at 15 kHz.
    const at = (hz: number) => 20 * Math.log10(rms(decimate(hz, 4096).subarray(64)) / 0.707);
    expect(at(1_000)).toBeGreaterThan(-0.5);
    expect(at(10_000)).toBeGreaterThan(-0.5);
    expect(at(10_000)).toBeLessThan(0.5);
    expect(at(15_000)).toBeGreaterThan(-2); // -1.2 dB measured
    expect(at(15_000)).toBeLessThan(0.5);
  });

  it('chooseOversampling switches at sampleRate/4 and nowhere else', () => {
    // Below the threshold oversampling is a measured no-op, so do not pay for it.
    expect(chooseOversampling(1000, FS)).toBe(1);
    expect(chooseOversampling(11_999, FS)).toBe(1);
    expect(chooseOversampling(FS / 4, FS)).toBe(1); // boundary is exclusive
    expect(chooseOversampling(12_001, FS)).toBe(FM_OVERSAMPLING);
    expect(chooseOversampling(23_300, FS)).toBe(FM_OVERSAMPLING); // G#6 x ratio 14
  });

  it('chooseOversampling scales with the sample rate rather than hardcoding 12 kHz', () => {
    expect(chooseOversampling(20_000, 96_000)).toBe(1); // 96k/4 = 24 kHz
    expect(chooseOversampling(25_000, 96_000)).toBe(FM_OVERSAMPLING);
  });

  it('maxPitchModRatio is the LFO peak, is one without vibrato, and ignores the sign', () => {
    // No pitch route: exactly 1, so K (and the CPU bill) is unchanged for every
    // patch that has no vibrato.
    expect(maxPitchModRatio(0)).toBe(1);
    expect(maxPitchModRatio(1200)).toBeCloseTo(2, 12); // an octave of vibrato peaks at 2x
    // A negative depth still bends UP on the LFO's -1 half-cycle: same worst case.
    expect(maxPitchModRatio(-1200)).toBe(maxPitchModRatio(1200));
    expect(maxPitchModRatio(100)).toBeCloseTo(2 ** (1 / 12), 12); // a semitone
  });

  it('the modulo-free tap loop is BIT-identical to the naive modulo convolution', () => {
    // output() walks the ring as two contiguous runs instead of doing `% n` per
    // tap. That is only allowed because it visits the same samples with the same
    // taps in the SAME summation order — so the float result must be equal to the
    // last bit, not merely close. Object.is, no tolerance: if this ever needs a
    // tolerance, the summation order has changed and the optimization is wrong.
    //
    // The reference is textbook convolution — y[n] = sum_j h[j]*x[n-j], taps[0] on
    // the NEWEST sample — written with `% n` addressing. It does not assume the
    // tap table is symmetric (it is not, to the last ulp).
    const n = FM_DECIMATION_TAPS.length;
    const history = new Float64Array(n); // the naive reference: ring + `% n`
    let pos = 0;
    const refPush = (x: number) => {
      history[pos] = x;
      pos = (pos + 1) % n;
    };
    const refOutput = () => {
      let y = 0;
      // x[n-j] lives at (pos - 1 - j) mod n; walk j downward so the samples are
      // summed oldest-first, matching output()'s order exactly.
      for (let j = n - 1; j >= 0; j--) y += FM_DECIMATION_TAPS[j] * history[(pos + n - 1 - j) % n];
      return y;
    };

    const dec = new FmDecimator();
    // An FM-shaped signal (asymmetric, wideband) rather than a pure sine, and a
    // varying number of pushes per output so `pos` lands on every offset 0..n-1
    // — including 0, where the second run is empty.
    let t = 0;
    let peak = 0;
    for (let i = 0; i < 500; i++) {
      const pushes = 1 + (i % 7);
      for (let k = 0; k < pushes; k++) {
        const x = Math.sin(0.031 * t + 3.7 * Math.sin(0.0017 * t)) * (1 - 0.001 * (t % 400));
        dec.push(x);
        refPush(x);
        t++;
      }
      const got = dec.output();
      const want = refOutput();
      expect(Object.is(got, want)).toBe(true);
      peak = Math.max(peak, Math.abs(got));
    }
    expect(peak).toBeGreaterThan(0.1); // the equality above was on real signal, not silence
  });
});
