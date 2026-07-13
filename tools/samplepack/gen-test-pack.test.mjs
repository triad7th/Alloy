import { test } from 'node:test';
import assert from 'node:assert/strict';
import { genTestPack } from './gen-test-pack.mjs';

function midiToHz(m) {
  return 440 * 2 ** ((m - 69) / 12);
}

test('genTestPack returns roots.length * velocities.length sources', () => {
  const pack = genTestPack();
  assert.equal(pack.sources.length, 8);
});

test('genTestPack is deterministic across calls', () => {
  const a = genTestPack();
  const b = genTestPack();
  const sa = a.sources[0].samples;
  const sb = b.sources[0].samples;
  for (let i = 0; i < 100; i++) {
    assert.equal(sa[i], sb[i]);
  }
});

test('each tone is non-silent (RMS of the sustain half > 0.01)', () => {
  const pack = genTestPack();
  for (const src of pack.sources) {
    const n = src.samples.length;
    const start = Math.floor(n / 2);
    let sumSq = 0;
    for (let i = start; i < n; i++) sumSq += src.samples[i] * src.samples[i];
    const rms = Math.sqrt(sumSq / (n - start));
    assert.ok(rms > 0.01, `source ${src.name} RMS ${rms} too low`);
  }
});

test('mid-sustain region is periodic for root 60', () => {
  const pack = genTestPack();
  const src = pack.sources.find((s) => s.rootMidi === 60);
  const freq = midiToHz(60);
  const period = Math.round(src.sampleRate / freq);
  const mid = Math.floor(src.samples.length / 2);
  for (let k = mid; k < mid + 50; k++) {
    assert.ok(
      Math.abs(src.samples[k] - src.samples[k + period]) < 0.02,
      `index ${k}: ${src.samples[k]} vs index ${k + period}: ${src.samples[k + period]}`,
    );
  }
});
