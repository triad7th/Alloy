// One-shot polish. Piano is unlooped (see the 3b design), so both artifacts live
// at the ends: strip the pre-attack silence WITHOUT clipping the transient, then
// cap the length and bake a fade-out so the asset ends in true silence.
// SampleZoneGenerator will not fade for us — noteOff is a no-op and unlooped
// content simply rings out — so the fade has to be in the asset.

/** Frames kept BEFORE the first sample that crosses the threshold. A piano
 *  attack has real energy in the few dozen frames leading up to its peak;
 *  trimming flush to the threshold shaves the hammer strike into a click. */
export const DEFAULT_LOOKBACK = 64;

/** Strip leading silence: return a copy starting `lookback` frames before the
 *  first sample whose |amplitude| >= threshold. An all-silent input returns an
 *  empty buffer. */
export function trimLeadingSilence(samples, { threshold = 1e-4, lookback = DEFAULT_LOOKBACK } = {}) {
  let first = -1;
  for (let i = 0; i < samples.length; i++) {
    if (Math.abs(samples[i]) >= threshold) {
      first = i;
      break;
    }
  }
  if (first < 0) return new Float32Array(0);
  return samples.slice(Math.max(0, first - lookback));
}

/** Cap at `maxFrames` and bake a cosine (equal-power) fade-out over the last
 *  `fadeFrames`. The final frame is forced to exactly 0 — cos(pi/2) is 6e-17 in
 *  floating point, not zero, and "almost silent" is still a click. */
export function truncateWithFade(samples, maxFrames, fadeFrames) {
  const n = Math.min(samples.length, maxFrames);
  const out = samples.slice(0, n);
  const fade = Math.min(fadeFrames, n);
  if (fade <= 0) return out;
  for (let i = 0; i < fade; i++) {
    const t = (i + 1) / fade; // (0, 1]
    out[n - fade + i] *= Math.cos((t * Math.PI) / 2);
  }
  out[n - 1] = 0;
  return out;
}
