import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeWavMono, readWavMono } from './wav.mjs';

function makeSine(n, sampleRate, freq) {
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = Math.sin((2 * Math.PI * freq * i) / sampleRate);
  return out;
}

test('writeWavMono -> readWavMono round-trips a sine within 1/32768 tolerance', () => {
  const sampleRate = 44100;
  const samples = makeSine(300, sampleRate, 440);
  const buffer = writeWavMono(samples, sampleRate);
  const { sampleRate: readSampleRate, samples: readSamples } = readWavMono(buffer);

  assert.equal(readSampleRate, sampleRate);
  assert.equal(readSamples.length, samples.length);
  // writeWavMono truncates (not rounds) toward zero when quantizing to int16,
  // and positive samples are scaled by 32767 while readWavMono divides by
  // 32768, so the worst-case round-trip error is just under 2/32768.
  const tolerance = 2 / 32768;
  for (let i = 0; i < samples.length; i++) {
    assert.ok(
      Math.abs(readSamples[i] - samples[i]) <= tolerance,
      `sample ${i}: expected ${samples[i]}, got ${readSamples[i]}`,
    );
  }
});

test('readWavMono throws on a non-RIFF buffer', () => {
  const buffer = Buffer.from('not a wav file at all');
  assert.throws(() => readWavMono(buffer));
});
