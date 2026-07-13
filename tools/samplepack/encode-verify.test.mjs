import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { genTestPack } from './gen-test-pack.mjs';
import { writeWavMono, readWavMono } from './wav.mjs';
import { findLoop } from './loop-finder.mjs';
import { encodeAac, decodeToWav, measureOffset, loopDrift, verifyZone } from './encode-verify.mjs';

function hasBin(bin) {
  try {
    execSync(`command -v ${bin}`, { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

const hasEncoders = hasBin('afconvert') || hasBin('ffmpeg');

test('measureOffset recovers a known shift (decoded delayed by 137 samples)', () => {
  const { samples: original } = genTestPack().sources[0];
  const shift = 137;
  const decoded = new Float32Array(original.length);
  for (let i = 0; i < original.length - shift; i++) decoded[i + shift] = original[i];

  const offset = measureOffset(original, decoded, Math.floor(original.length * 0.4));
  assert.equal(offset, shift);
});

test('loopDrift is the absolute difference between two offsets', () => {
  assert.equal(loopDrift(5, 5), 0);
  assert.equal(loopDrift(5, 18), 13);
});

test('verifyZone fires (ok: false) when the loop region is drifted relative to the early region', () => {
  const { samples: original, sampleRate } = genTestPack().sources[0];
  const { loopStart } = findLoop(original, sampleRate);

  const shift = 50;
  const decoded = new Float32Array(original.length + shift);
  for (let i = 0; i < decoded.length; i++) {
    if (i < loopStart) {
      decoded[i] = original[i] ?? 0;
    } else {
      decoded[i] = i - shift >= 0 ? (original[i - shift] ?? 0) : 0;
    }
  }

  const v = verifyZone(original, decoded, loopStart);
  assert.equal(v.ok, false, `expected the drift gate to fire, got ok=${v.ok} drift=${v.drift}`);
  // correlation on a periodic tone can land a sample or two off the true shift
  assert.ok(Math.abs(v.drift - shift) <= 2, `expected drift near ${shift}, got ${v.drift}`);
});

test(
  'encodeAac -> decodeToWav round trip preserves loop alignment (small priming delay, no drift)',
  { skip: !hasEncoders },
  () => {
    const pack = genTestPack();
    const { samples: original, sampleRate } = pack.sources[0];
    const dir = mkdtempSync(join(tmpdir(), 'samplepack-encode-'));
    const wavPath = join(dir, 'original.wav');
    const m4aPath = join(dir, 'encoded.m4a');
    const decodedWavPath = join(dir, 'decoded.wav');
    try {
      writeFileSync(wavPath, writeWavMono(original, sampleRate));
      encodeAac(wavPath, m4aPath);
      decodeToWav(m4aPath, decodedWavPath);
      const { samples: decoded } = readWavMono(readFileSync(decodedWavPath));

      // afconvert writes a packet-table (priming/remainder sample count) into the
      // m4a's edit list, which ffmpeg's demuxer honors on decode — so the
      // *measured* offset can legitimately be 0 (fully delay-compensated by the
      // container) rather than the raw ~2048-sample AAC encoder priming delay.
      // Either way it must be small and non-negative, well under one window.
      const offset = measureOffset(original, decoded, Math.floor(original.length * 0.1));
      console.log(`measured AAC priming delay (post edit-list compensation): ${offset} samples`);
      // measureOffset structurally returns a value in [0, maxLag], so an
      // `offset >= 0` assertion would be tautological; the informative bound
      // is the upper one. This measures 0 here because afconvert writes a
      // packet-table (priming/remainder sample count) into the m4a's edit
      // list, which ffmpeg's demuxer honors on decode — the decoded WAV is
      // already delay-compensated by the container, not by our code.
      assert.ok(offset < 4096, `expected small priming delay, got ${offset}`);

      const { loopStart } = findLoop(original, sampleRate);
      const verify = verifyZone(original, decoded, loopStart);
      assert.ok(verify.ok, `expected verifyZone.ok, got drift=${verify.drift} offset=${verify.offset}`);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  },
);
