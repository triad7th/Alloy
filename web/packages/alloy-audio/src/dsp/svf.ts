// Topology-preserving-transform state variable filter (Zavalishin, "The
// Art of VA Filter Design"). Chosen over biquads because it stays stable
// under audio-rate cutoff modulation — this is the patch TVF, and filter
// envelopes sweep it constantly. Constructed fully open; call setParams to
// shape. Twin: Svf.swift.

export type SvfMode = 'lowpass' | 'bandpass' | 'highpass';

export class Svf {
  private ic1 = 0;
  private ic2 = 0;
  private k = 1;
  private a1 = 0;
  private a2 = 0;
  private a3 = 0;

  constructor(
    private readonly mode: SvfMode,
    private readonly sampleRate: number,
  ) {
    this.setParams(sampleRate * 0.49, 0.707);
  }

  setParams(cutoffHz: number, q: number): void {
    const clamped = Math.min(Math.max(cutoffHz, 10), this.sampleRate * 0.49);
    const g = Math.tan((Math.PI * clamped) / this.sampleRate);
    this.k = 1 / Math.max(q, 0.5);
    this.a1 = 1 / (1 + g * (g + this.k));
    this.a2 = g * this.a1;
    this.a3 = g * this.a2;
  }

  process(x: number): number {
    const v3 = x - this.ic2;
    const v1 = this.a1 * this.ic1 + this.a2 * v3;
    const v2 = this.ic2 + this.a2 * this.ic1 + this.a3 * v3;
    this.ic1 = 2 * v1 - this.ic1;
    this.ic2 = 2 * v2 - this.ic2;
    switch (this.mode) {
      case 'lowpass':
        return v2;
      case 'bandpass':
        return v1;
      case 'highpass':
        return x - this.k * v1 - v2;
    }
  }
}
