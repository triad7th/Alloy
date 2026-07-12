// Algorithmic reverb send unit — an 8-line feedback delay network (FDN) with
// input diffusion, per-line HF damping, a normalized Hadamard feedback mix,
// and modulated lines for density. Zero sample bytes; identical on both
// platforms. Fed by the reverb send tap; outputs 100% wet. Twin: Reverb.swift.

import { type ReverbParams, type SendEffect } from './effect-types.js';

// Delay-line lengths in samples at 48 kHz (mutually near-prime, ~24..58 ms),
// the plate's fixed character. Rescaled by sampleRate/48000 at construction.
const LINE_LEN_48K = [1153, 1327, 1559, 1801, 2063, 2311, 2543, 2801];
const DIFFUSER_LEN_48K = [229, 173];
const DIFFUSER_COEF = 0.7;
const PREDELAY_MAX_48K = 4800; // 100 ms
const MOD_MAX_SAMPLES = 16; // peak modulation excursion on lines 0 and 4
const CONTROL_TWO_PI = Math.PI * 2;
const HADAMARD_STEPS = [1, 2, 4];

function scaleLen(len48k: number, sampleRate: number): number {
  return Math.max(1, Math.round((len48k * sampleRate) / 48000));
}

/** Fixed-length circular delay line with integer and fractional reads. */
class Line {
  private readonly buf: Float32Array;
  private pos = 0;
  constructor(readonly length: number, extra: number) {
    this.buf = new Float32Array(length + extra);
  }
  /** Sample written `length` samples ago. */
  readInt(): number {
    return this.buf[this.pos];
  }
  /** Sample written `length + delta` samples ago, linear-interpolated
   * (delta >= 0, delta <= extra). */
  readFrac(delta: number): number {
    const size = this.buf.length;
    const d = Math.floor(delta);
    const f = delta - d;
    let i0 = this.pos - d;
    if (i0 < 0) i0 += size;
    let i1 = i0 - 1;
    if (i1 < 0) i1 += size;
    return this.buf[i0] * (1 - f) + this.buf[i1] * f;
  }
  write(v: number): void {
    this.buf[this.pos] = Math.abs(v) < 1e-20 ? 0 : v; // denormal flush
    this.pos++;
    if (this.pos >= this.buf.length) this.pos = 0;
  }
  clear(): void {
    this.buf.fill(0);
    this.pos = 0;
  }
}

/** Schroeder allpass diffuser: y = -g*x + z; z_next = x + g*y. */
class Allpass {
  private readonly buf: Float32Array;
  private pos = 0;
  constructor(length: number, private readonly g: number) {
    this.buf = new Float32Array(length);
  }
  process(x: number): number {
    const z = this.buf[this.pos];
    const y = -this.g * x + z;
    const w = x + this.g * y;
    this.buf[this.pos] = Math.abs(w) < 1e-20 ? 0 : w;
    this.pos++;
    if (this.pos >= this.buf.length) this.pos = 0;
    return y;
  }
  clear(): void {
    this.buf.fill(0);
    this.pos = 0;
  }
}

export class Reverb implements SendEffect {
  private readonly lines: Line[];
  private readonly diffusers: Allpass[];
  private readonly predelay: Float32Array;
  private predelayPos = 0;
  private readonly predelaySamples: number;
  private readonly damp = new Float64Array(8); // one-pole LPF state per line
  private readonly h = new Float64Array(8); // Hadamard scratch
  private readonly s = new Float64Array(8); // per-sample line-read scratch
  private lfoPhase = 0;
  private readonly lfoInc: number;
  private readonly g: number;
  private readonly dampCoef: number;
  private readonly bwCoef: number;
  private bwState = 0;
  private readonly modSamples: number;

  constructor(
    private readonly params: ReverbParams,
    sampleRate: number,
  ) {
    this.lines = LINE_LEN_48K.map((l) => new Line(scaleLen(l, sampleRate), MOD_MAX_SAMPLES + 2));
    this.diffusers = DIFFUSER_LEN_48K.map((l) => new Allpass(scaleLen(l, sampleRate), DIFFUSER_COEF));
    this.predelaySamples = Math.min(scaleLen(PREDELAY_MAX_48K, sampleRate), Math.max(1, Math.round((params.predelayMs / 1000) * sampleRate)));
    this.predelay = new Float32Array(scaleLen(PREDELAY_MAX_48K, sampleRate) + 1);
    this.g = 0.7 + 0.28 * params.decay;
    this.dampCoef = params.damping; // one-pole: lp += damp*(x - lp)
    this.bwCoef = params.bandwidth; // one-pole: bw += bwCoef*(x - bw)
    this.lfoInc = (CONTROL_TWO_PI * params.modRateHz) / sampleRate;
    this.modSamples = params.modDepth * MOD_MAX_SAMPLES;
  }

  reset(): void {
    for (const l of this.lines) l.clear();
    for (const d of this.diffusers) d.clear();
    this.predelay.fill(0);
    this.predelayPos = 0;
    this.damp.fill(0);
    this.h.fill(0);
    this.lfoPhase = 0;
    this.bwState = 0;
  }

  private hadamard(): void {
    const h = this.h;
    for (const step of HADAMARD_STEPS) {
      for (let i = 0; i < 8; i++) {
        if ((i & step) === 0) {
          const a = h[i];
          const b = h[i + step];
          h[i] = a + b;
          h[i + step] = a - b;
        }
      }
    }
    const norm = 1 / Math.sqrt(8);
    for (let i = 0; i < 8; i++) h[i] *= norm;
  }

  process(inL: Float32Array, inR: Float32Array, outL: Float32Array, outR: Float32Array, frames: number): void {
    const size = this.predelay.length;
    for (let n = 0; n < frames; n++) {
      // Mono send, input bandwidth roll-off.
      let x = (inL[n] + inR[n]) * 0.5;
      this.bwState += this.bwCoef * (x - this.bwState);
      x = this.bwState;

      // Predelay.
      let rp = this.predelayPos - this.predelaySamples;
      if (rp < 0) rp += size;
      const pre = this.predelay[rp];
      this.predelay[this.predelayPos] = x;
      this.predelayPos++;
      if (this.predelayPos >= size) this.predelayPos = 0;

      // Input diffusion.
      let d = pre;
      d = this.diffusers[0].process(d);
      d = this.diffusers[1].process(d);

      // Read line outputs (lines 0 and 4 modulated).
      const mod = this.modSamples * Math.sin(this.lfoPhase);
      this.lfoPhase += this.lfoInc;
      if (this.lfoPhase >= CONTROL_TWO_PI) this.lfoPhase -= CONTROL_TWO_PI;
      const s0 = this.lines[0].readFrac(mod < 0 ? 0 : mod);
      const s4 = this.lines[4].readFrac(mod < 0 ? -mod : 0);
      const s = this.s;
      s[0] = s0;
      s[1] = this.lines[1].readInt();
      s[2] = this.lines[2].readInt();
      s[3] = this.lines[3].readInt();
      s[4] = s4;
      s[5] = this.lines[5].readInt();
      s[6] = this.lines[6].readInt();
      s[7] = this.lines[7].readInt();

      // Per-line damping in the feedback path.
      for (let k = 0; k < 8; k++) {
        this.damp[k] += this.dampCoef * (s[k] - this.damp[k]);
        this.h[k] = this.damp[k];
      }

      // Feedback mix, write back input + g * mixed.
      this.hadamard();
      for (let k = 0; k < 8; k++) {
        this.lines[k].write(d + this.g * this.h[k]);
      }

      // Output taps.
      outL[n] = (s[0] + s[2] + s[4] + s[6]) * 0.5;
      outR[n] = (s[1] + s[3] + s[5] + s[7]) * 0.5;
    }
  }
}
