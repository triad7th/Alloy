import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readWavMono, writeWavMono } from './wav.mjs';
import { decodeToWav } from './encode-verify.mjs';
import { buildPianoPack, SALAMANDER_CREDITS } from './build-piano-pack.mjs';

const SR = 48000;

// Deterministic LCG, shared across writeSource calls so the whole fixture is
// reproducible run-to-run without depending on Math.random.
let rngState = 7;
function rnd() {
  rngState = (rngState * 1103515245 + 12345) & 0x7fffffff;
  return (rngState / 0x7fffffff) * 2 - 1;
}

/** A decaying tone with 0.05 s of leading silence, written as a 24-bit WAV.
 *  A small broadband noise floor rides under the tone: a PURE sinusoid is
 *  exactly self-similar at multiples of its own period, which makes
 *  encode-verify's cross-correlation genuinely ambiguous about which
 *  period-multiple is the true AAC delay (real Salamander recordings never
 *  hit this — piano strings are inharmonic and noisy, not pure tones). The
 *  noise breaks that periodicity without changing what's under test. */
function writeSource(dir, name, midi, amplitude) {
  const silence = Math.round(0.05 * SR);
  const body = SR; // 1 s
  const s = new Float32Array(silence + body);
  const hz = 440 * 2 ** ((midi - 69) / 12);
  for (let i = 0; i < body; i++) {
    const env = amplitude * Math.exp(-i / (SR * 0.4));
    s[silence + i] = env * Math.sin((2 * Math.PI * hz * i) / SR) + env * 0.1 * rnd();
  }
  writeFileSync(join(dir, name), writeWavMono(s, SR, 24));
}

function makeSourceTree() {
  const dir = mkdtempSync(join(tmpdir(), 'alloy-piano-src-'));
  const roots = [
    [21, 'A0'],
    [60, 'C4'],
    [108, 'C8'],
  ];
  for (const [midi, stem] of roots) {
    // v4/v8/v12/v16 are selected; v7 must be ignored, rel*/harm* must be ignored.
    for (const [v, amp] of [[4, 0.15], [8, 0.35], [12, 0.6], [16, 0.9]]) {
      writeSource(dir, `${stem}v${v}.wav`, midi, amp);
    }
    writeSource(dir, `${stem}v7.wav`, midi, 0.3);
  }
  writeSource(dir, 'rel79.wav', 60, 0.2);
  writeSource(dir, 'harmSA4.wav', 60, 0.2);
  return dir;
}

test('buildPianoPack emits a valid one-shot 4-layer pack', (t) => {
  const srcDir = makeSourceTree();
  const packDir = mkdtempSync(join(tmpdir(), 'alloy-piano-pack-'));
  t.after(() => {
    rmSync(srcDir, { recursive: true, force: true });
    rmSync(packDir, { recursive: true, force: true });
  });

  const { manifest, zoneCount } = buildPianoPack({ srcDir, packDir });

  assert.equal(zoneCount, 12, 'v7 / rel* / harm* must not be selected');
  assert.equal(manifest.schemaVersion, 1);
  assert.equal(manifest.id, 'piano-tiny');
  assert.equal(manifest.tier, 'tiny');
  assert.equal(manifest.format, 'm4a');
  assert.equal(manifest.sampleRate, SR);

  const layers = manifest.zoneSets.piano.layers;
  assert.equal(layers.length, 4);
  assert.deepEqual(
    layers.map((l) => l.topVelocity),
    [0.25, 0.5, 0.75, 1.0],
  );
  for (const layer of layers) {
    assert.deepEqual(
      layer.zones.map((z) => z.rootMidi),
      [21, 60, 108],
      'zones must be ascending by root',
    );
    for (const zone of layer.zones) {
      assert.equal(zone.loopStart, undefined, 'piano is ONE-SHOT — no loop points');
      assert.equal(zone.loopEnd, undefined);
      assert.ok(zone.gain > 0, 'every zone is peak-normalized');
      assert.ok(existsSync(join(packDir, zone.file)), `${zone.file} was not encoded`);
    }
  }
});

test('buildPianoPack writes the CC-BY attribution the license requires', (t) => {
  const srcDir = makeSourceTree();
  const packDir = mkdtempSync(join(tmpdir(), 'alloy-piano-pack-'));
  t.after(() => {
    rmSync(srcDir, { recursive: true, force: true });
    rmSync(packDir, { recursive: true, force: true });
  });

  const { manifest } = buildPianoPack({ srcDir, packDir });
  const credits = readFileSync(join(packDir, 'CREDITS.md'), 'utf8');

  assert.match(credits, /Alexander Holm/);
  assert.match(credits, /CC-BY 3\.0/);
  assert.match(credits, /https?:\/\//);
  assert.deepEqual(manifest.credits, SALAMANDER_CREDITS);
});

test('an emitted zone ends in silence after a real encode/decode round trip', (t) => {
  // The end-to-end proof that the baked fade survives AAC: an unlooped one-shot
  // whose last frames are not silent is a click, every single note.
  const srcDir = makeSourceTree();
  const packDir = mkdtempSync(join(tmpdir(), 'alloy-piano-pack-'));
  const scratch = mkdtempSync(join(tmpdir(), 'alloy-piano-dec-'));
  t.after(() => {
    for (const d of [srcDir, packDir, scratch]) rmSync(d, { recursive: true, force: true });
  });

  buildPianoPack({ srcDir, packDir });
  const decoded = join(scratch, 'zone.wav');
  decodeToWav(join(packDir, 'C4v16.m4a'), decoded);
  const { samples } = readWavMono(readFileSync(decoded));

  const tail = samples.slice(-100);
  const peak = Math.max(...tail.map(Math.abs));
  assert.ok(peak < 0.01, `zone tail peaks at ${peak} — the fade-out did not survive encoding`);
});

test('buildPianoPack cleans up its scratch directory', (t) => {
  const srcDir = makeSourceTree();
  const packDir = mkdtempSync(join(tmpdir(), 'alloy-piano-pack-'));
  t.after(() => {
    rmSync(srcDir, { recursive: true, force: true });
    rmSync(packDir, { recursive: true, force: true });
  });

  buildPianoPack({ srcDir, packDir });
  assert.equal(existsSync(join(packDir, '.tmp')), false, 'the pack must ship only .m4a + json + md');
});

test('buildPianoPack refuses an empty source directory instead of writing an empty pack', (t) => {
  const srcDir = mkdtempSync(join(tmpdir(), 'alloy-piano-empty-'));
  const packDir = mkdtempSync(join(tmpdir(), 'alloy-piano-pack-'));
  t.after(() => {
    rmSync(srcDir, { recursive: true, force: true });
    rmSync(packDir, { recursive: true, force: true });
  });
  mkdirSync(srcDir, { recursive: true });
  assert.throws(() => buildPianoPack({ srcDir, packDir }), /no selectable sources/);
});
