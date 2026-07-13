import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_LOOKBACK, trimLeadingSilence, truncateWithFade } from './polish.mjs';

/** Silence, then an abrupt full-scale transient, then a decaying tail. */
function attackAt(silentFrames, totalFrames) {
  const s = new Float32Array(totalFrames);
  for (let i = silentFrames; i < totalFrames; i++) {
    const t = i - silentFrames;
    s[i] = Math.exp(-t / 2000) * Math.sin((2 * Math.PI * 440 * t) / 48000);
  }
  s[silentFrames] = 0.95; // the transient's leading edge — must survive the trim
  return s;
}

test('trimLeadingSilence keeps the attack transient intact, with lookback', () => {
  const src = attackAt(1000, 1500);
  const out = trimLeadingSilence(src);
  assert.equal(out.length, 1500 - (1000 - DEFAULT_LOOKBACK));
  // The first loud sample now sits exactly `lookback` frames in — not at 0,
  // and not clipped off.
  assert.equal(out[DEFAULT_LOOKBACK], src[1000]);
  // Float32Array can't hold 0.95 exactly; compare against its float32 rounding
  // (Math.fround), not the float64 literal, or this assertion fails on any
  // correct implementation.
  assert.equal(out[DEFAULT_LOOKBACK], Math.fround(0.95));
});

test('trimLeadingSilence preserves the signal peak (it never clips the attack)', () => {
  const src = attackAt(1000, 1500);
  const peakBefore = Math.max(...src.map(Math.abs));
  const peakAfter = Math.max(...trimLeadingSilence(src).map(Math.abs));
  assert.equal(peakAfter, peakBefore);
});

test('trimLeadingSilence clamps the lookback at the start of the buffer', () => {
  const src = attackAt(10, 500); // attack is closer to 0 than the lookback
  const out = trimLeadingSilence(src);
  assert.equal(out.length, 500); // nothing dropped, no negative offset
  assert.equal(out[10], Math.fround(0.95));
});

test('trimLeadingSilence returns empty for an all-silent buffer', () => {
  assert.equal(trimLeadingSilence(new Float32Array(1000)).length, 0);
});

test('truncateWithFade caps the length and ends at TRUE zero', () => {
  const src = new Float32Array(10000).fill(1);
  const out = truncateWithFade(src, 5000, 512);
  assert.equal(out.length, 5000);
  assert.equal(out[out.length - 1], 0, 'an unlooped one-shot must end in silence, not a click');
});

test('truncateWithFade leaves everything before the fade window untouched', () => {
  const src = new Float32Array(10000).fill(1);
  const out = truncateWithFade(src, 5000, 512);
  for (let i = 0; i < 5000 - 512; i++) assert.equal(out[i], 1, `frame ${i} was altered`);
});

test('truncateWithFade decays monotonically across the fade window', () => {
  const src = new Float32Array(10000).fill(1); // DC: the output IS the fade curve
  const out = truncateWithFade(src, 5000, 512);
  for (let i = 5000 - 512 + 1; i < 5000; i++) {
    assert.ok(out[i] <= out[i - 1], `fade curve rose at frame ${i}`);
  }
  assert.ok(out[5000 - 512] > 0.99, 'the fade must start at (near) unity, not duck');
});

test('truncateWithFade still fades a sample shorter than the cap', () => {
  const src = new Float32Array(1000).fill(1);
  const out = truncateWithFade(src, 5000, 512);
  assert.equal(out.length, 1000);
  assert.equal(out[999], 0);
});

test('truncateWithFade handles a sample shorter than the fade window', () => {
  const src = new Float32Array(100).fill(1);
  const out = truncateWithFade(src, 5000, 512);
  assert.equal(out.length, 100);
  assert.equal(out[99], 0);
});
