import { execFileSync } from 'node:child_process';

function has(bin) {
  try {
    execFileSync('command', ['-v', bin], { stdio: 'ignore', shell: '/bin/zsh' });
    return true;
  } catch {
    return false;
  }
}

/** Encode a WAV to AAC (.m4a). Prefer afconvert (Apple native), fall back to
 *  ffmpeg. Throws if neither is available. */
export function encodeAac(wavPath, m4aPath) {
  if (has('afconvert')) {
    execFileSync('afconvert', ['-f', 'm4af', '-d', 'aac', '-b', '192000', wavPath, m4aPath], { stdio: 'ignore' });
  } else if (has('ffmpeg')) {
    execFileSync('ffmpeg', ['-y', '-i', wavPath, '-c:a', 'aac', '-b:a', '192k', m4aPath], { stdio: 'ignore' });
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
