import { execFileSync, execSync } from 'node:child_process';

function has(bin) {
  try {
    execSync(`command -v ${bin}`, { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

/** Encode a WAV to AAC (.m4a). Prefer afconvert (Apple native), fall back to
 *  ffmpeg. Throws if neither is available. The 192k default is what 3a's
 *  build-pack has always used; the piano tiny tier passes 128000. */
export function encodeAac(wavPath, m4aPath, bitrate = 192000) {
  if (has('afconvert')) {
    execFileSync('afconvert', ['-f', 'm4af', '-d', 'aac', '-b', String(bitrate), wavPath, m4aPath], {
      stdio: 'ignore',
    });
  } else if (has('ffmpeg')) {
    execFileSync('ffmpeg', ['-y', '-i', wavPath, '-c:a', 'aac', '-b:a', `${Math.round(bitrate / 1000)}k`, m4aPath], {
      stdio: 'ignore',
    });
  } else {
    throw new Error('no AAC encoder found (need afconvert or ffmpeg)');
  }
}

/** Decode an .m4a back to a mono 16-bit WAV via ffmpeg (deterministic decode
 *  path for the verifier). Throws if ffmpeg is absent. */
export function decodeToWav(m4aPath, wavPath) {
  if (!has('ffmpeg')) throw new Error('ffmpeg required to decode for verification');
  execFileSync('ffmpeg', ['-y', '-i', m4aPath, '-ac', '1', '-c:a', 'pcm_s16le', wavPath], { stdio: 'ignore' });
}

/** Cross-correlation lag (0..maxLag) that best aligns `decoded` onto
 *  `original` within a window starting at `winStart` — recovers the AAC
 *  encoder/priming delay at that point in the signal without hardcoding it. */
export function measureOffset(original, decoded, winStart, winLen = 4096, maxLag = 4096) {
  const wl = Math.min(winLen, original.length - winStart);
  let bestLag = 0;
  let bestScore = -Infinity;
  for (let lag = 0; lag <= maxLag; lag++) {
    let num = 0;
    let e1 = 0;
    let e2 = 0;
    for (let i = 0; i < wl; i++) {
      const a = original[winStart + i];
      const b = decoded[winStart + i + lag] ?? 0;
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
  return bestLag;
}

/** Drift = disagreement (in samples) between two alignment offsets measured at
 *  different points in the signal. Zero drift means the encode/decode kept the
 *  timeline rigid, so loop points expressed in original coordinates stay valid. */
export function loopDrift(offsetEarly, offsetLate) {
  return Math.abs(offsetLate - offsetEarly);
}

/** Verify one zone survived encode/decode without the loop region shifting
 *  relative to the rest of the signal: the encoder delay measured early must
 *  match the delay measured around the loop, within `tolerance` samples. A
 *  constant global delay is fine (compensated); a DIFFERENT delay near the
 *  loop means the content drifted and the loop points would click. */
export function verifyZone(original, decoded, loopStart, tolerance = 8) {
  const early = measureOffset(original, decoded, Math.floor(original.length * 0.1));
  const atLoop = measureOffset(original, decoded, loopStart);
  const drift = loopDrift(early, atLoop);
  return { offset: early, drift, ok: drift <= tolerance };
}

/** RMS over `winLen` frames from `start` (clipped to the buffer). */
function windowRms(samples, start, winLen) {
  const end = Math.min(start + winLen, samples.length);
  let acc = 0;
  for (let i = start; i < end; i++) acc += samples[i] * samples[i];
  const n = end - start;
  return n > 0 ? Math.sqrt(acc / n) : 0;
}

/** Where verifyZone should take its SECOND alignment measurement.
 *
 *  The gate works by comparing the encoder delay measured early against the
 *  delay measured somewhere else: equal means the timeline stayed rigid.
 *  For a looped sample that second point was the loop. A one-shot has no loop,
 *  and naively probing "late" is a trap — a high piano note truncated at 12 s
 *  has decayed into near-silence by then, and correlating silence measures
 *  noise, not delay, which would reject a perfectly good pack.
 *
 *  So: scan back from 80% of the buffer and take the LATEST window whose RMS is
 *  still at least `minRatio` of the early window's. If nothing qualifies (a very
 *  short, fast-decaying sample), fall back to the window immediately after the
 *  early one — a weaker but still honest second measurement.
 *
 *  A buffer too short to hold a second, distinct, in-bounds window after
 *  `earlyStart` cannot be verified at all: THROW rather than silently return
 *  an out-of-bounds probe or (worse) `earlyStart` itself, which would make
 *  verifyZone compare the early measurement against itself and always report
 *  ok: true — a gate that can never fail is worse than no gate. */
export function pickProbe(samples, earlyStart, winLen = 4096, minRatio = 0.1) {
  const maxStart = samples.length - winLen;
  if (maxStart <= earlyStart) {
    throw new Error(
      `pickProbe: buffer of ${samples.length} frames cannot hold a second ${winLen}-frame window after ${earlyStart}`,
    );
  }
  const reference = windowRms(samples, earlyStart, winLen);
  for (let pct = 80; pct >= 30; pct -= 5) {
    const start = Math.floor((samples.length * pct) / 100);
    if (start <= earlyStart || start + winLen > samples.length) continue;
    if (windowRms(samples, start, winLen) >= minRatio * reference) return start;
  }
  // Both terms are > earlyStart and <= maxStart (guarded above), so the
  // returned window is always in bounds AND always a genuinely different
  // measurement point from the early one — the gate stays able to fail.
  return Math.min(earlyStart + winLen, maxStart);
}
