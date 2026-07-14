import { describe, expect, it } from 'vitest';
import { FM_DECIMATION_TAPS, FM_OVERSAMPLING, FmDecimator, chooseOversampling } from './fm-oversampling.js';

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
    const at = (hz: number) => 20 * Math.log10(rms(decimate(hz, 4096).subarray(64)) / 0.707);
    expect(at(1_000)).toBeGreaterThan(-0.5);
    expect(at(10_000)).toBeGreaterThan(-0.5);
    expect(at(15_000)).toBeGreaterThan(-2); // -1.2 dB measured
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
});
