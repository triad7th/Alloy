/**
 * Xorshift32 — the DSP core's only randomness source (engine determinism
 * is a hard constraint). Integer ops only, so the TS and Swift twins
 * produce bit-identical sequences. Twin: DspPrng.swift.
 */
export class DspPrng {
  private state: number;

  constructor(seed: number) {
    const s = seed >>> 0;
    this.state = s === 0 ? 0x9e3779b9 : s;
  }

  /** Uniform double in [0, 1). */
  next(): number {
    let x = this.state;
    x = (x ^ (x << 13)) >>> 0;
    x = (x ^ (x >>> 17)) >>> 0;
    x = (x ^ (x << 5)) >>> 0;
    this.state = x;
    return x / 4294967296;
  }
}
