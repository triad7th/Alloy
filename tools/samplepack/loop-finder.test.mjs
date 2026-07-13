import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findLoop, bakeCrossfade, wrapDiscontinuity, extendLoop } from './loop-finder.mjs';

function makeSine(n, sampleRate, freq) {
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = Math.sin((2 * Math.PI * freq * i) / sampleRate);
  return out;
}

test('findLoop locks onto the true period of a pure sine with high correlation', () => {
  const sampleRate = 48000;
  const freq = 200; // true period = 240 samples
  const samples = makeSine(4096, sampleRate, freq);
  const { loopStart, loopEnd, score } = findLoop(samples, sampleRate);
  const lag = loopEnd - loopStart;
  assert.ok(Math.abs(lag - 240) <= 2, `expected lag within 2 of 240, got ${lag}`);
  assert.ok(score > 0.99, `expected score > 0.99, got ${score}`);
});

test('findLoop throws when the buffer is too short for the window + lag range', () => {
  const sampleRate = 48000;
  const samples = makeSine(100, sampleRate, 200);
  assert.throws(() => findLoop(samples, sampleRate));
});

test('bakeCrossfade reduces wrap discontinuity versus the raw slice for an off-period loop', () => {
  const sampleRate = 48000;
  const freq = 200; // true period = 240 samples
  const samples = makeSine(6000, sampleRate, freq);
  const loopStart = 5000;
  const loopEnd = loopStart + 250; // 10 samples off the true 240-sample period
  const fadeLen = 20;

  const rawDiscontinuity = wrapDiscontinuity(samples, loopStart, loopEnd);
  const baked = bakeCrossfade(samples, loopStart, loopEnd, fadeLen);
  const bakedDiscontinuity = wrapDiscontinuity(baked, loopStart, loopEnd);

  assert.ok(
    bakedDiscontinuity < rawDiscontinuity,
    `expected baked (${bakedDiscontinuity}) < raw (${rawDiscontinuity})`,
  );
});

test('bakeCrossfade throws when loopStart < fadeLen', () => {
  const sampleRate = 48000;
  const samples = makeSine(1000, sampleRate, 200);
  assert.throws(() => bakeCrossfade(samples, 10, 300, 20));
});

test('extendLoop grows a 367-sample period to the smallest multiple >= 4096', () => {
  const loopStart = 1000;
  const period = 367;
  const loopEnd = extendLoop(loopStart, loopStart + period, 4096, 1_000_000);
  assert.equal(loopEnd, loopStart + 4404); // k = 12: 12 * 367 = 4404
  assert.equal((loopEnd - loopStart) % period, 0);
  assert.ok(loopEnd - loopStart >= 4096);
});

test('extendLoop leaves an already-long-enough loop unchanged (k = 1)', () => {
  const loopStart = 500;
  const loopEnd = extendLoop(loopStart, loopStart + 5000, 4096, 1_000_000);
  assert.equal(loopEnd, loopStart + 5000);
});

test('extendLoop clamps growth to maxEnd, never running past the buffer', () => {
  const loopStart = 1000;
  const period = 367;
  const maxEnd = loopStart + 1200; // room for only k = 3 (1101), k = 4 would exceed
  const loopEnd = extendLoop(loopStart, loopStart + period, 4096, maxEnd);
  assert.ok(loopEnd <= maxEnd, `expected loopEnd (${loopEnd}) <= maxEnd (${maxEnd})`);
  assert.equal((loopEnd - loopStart) % period, 0);
});

test('extendLoop throws when loopEnd <= loopStart', () => {
  assert.throws(() => extendLoop(1000, 1000, 4096, 1_000_000));
  assert.throws(() => extendLoop(1000, 900, 4096, 1_000_000));
});
