// Autocorrelation loop-point search over a steady sustain window, plus an
// equal-power crossfade bake so the loop wrap is seamless.

/** Find the best single-period loop lag in [sampleRate/maxHz, sampleRate/minHz]
 *  by maximizing normalized correlation of a sustain window against itself
 *  shifted by the lag. loopStart is winStart; loopEnd = winStart + bestLag. */
export function findLoop(samples, sampleRate, opts = {}) {
  const minHz = opts.minHz ?? 40;
  const maxHz = opts.maxHz ?? 2000;
  const winStart = opts.winStart ?? Math.floor(samples.length * 0.4);
  const winLen = opts.winLen ?? Math.floor(samples.length * 0.2);
  const minLag = Math.max(1, Math.floor(sampleRate / maxHz));
  const maxLag = Math.ceil(sampleRate / minHz);
  if (winStart + winLen + maxLag > samples.length) {
    throw new Error('sample too short for the requested loop window + lag range');
  }
  let bestLag = minLag;
  let bestScore = -Infinity;
  for (let lag = minLag; lag <= maxLag; lag++) {
    let num = 0;
    let e1 = 0;
    let e2 = 0;
    for (let i = 0; i < winLen; i++) {
      const a = samples[winStart + i];
      const b = samples[winStart + i + lag];
      num += a * b;
      e1 += a * a;
      e2 += b * b;
    }
    const score = num / Math.sqrt(e1 * e2 + 1e-20);
    if (score > bestScore) {
      bestScore = score;
      bestLag = lag;
    }
  }
  return { loopStart: winStart, loopEnd: winStart + bestLag, score: bestScore };
}

/** Equal-power crossfade the fadeLen samples approaching loopEnd with those
 *  approaching loopStart, so wrapping loopEnd -> loopStart is continuous.
 *  Requires loopStart >= fadeLen and loopEnd - loopStart >= fadeLen. */
export function bakeCrossfade(samples, loopStart, loopEnd, fadeLen) {
  if (loopStart < fadeLen || loopEnd - loopStart < fadeLen) {
    throw new Error('loop too short for the requested crossfade length');
  }
  const out = Float32Array.from(samples);
  for (let i = 0; i < fadeLen; i++) {
    const f = (i + 1) / fadeLen; // 0..1 across the fade
    const wEnd = Math.cos((f * Math.PI) / 2); // fade out the pre-loopEnd tail
    const wStart = Math.sin((f * Math.PI) / 2); // fade in the pre-loopStart tail
    const dst = loopEnd - fadeLen + i;
    const src = loopStart - fadeLen + i;
    out[dst] = wEnd * samples[dst] + wStart * samples[src];
  }
  return out;
}

/** Discontinuity magnitude at the loop wrap: |out[loopStart] - out[loopEnd-1]|. */
export function wrapDiscontinuity(samples, loopStart, loopEnd) {
  return Math.abs(samples[loopStart] - samples[loopEnd - 1]);
}

/** Grow a single-period loop to the smallest integer number of periods that is
 *  at least `minLength` samples, without running past `maxEnd`. Integer
 *  multiples of the detected period keep the loop phase-aligned (seamless). */
export function extendLoop(loopStart, loopEnd, minLength, maxEnd) {
  const period = loopEnd - loopStart;
  if (period <= 0) throw new Error('extendLoop: loopEnd must be greater than loopStart');
  let k = Math.max(1, Math.ceil(minLength / period));
  while (k > 1 && loopStart + k * period > maxEnd) k--;
  return loopStart + k * period;
}
