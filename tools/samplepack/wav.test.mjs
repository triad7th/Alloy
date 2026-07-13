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

// --- helper: build an arbitrary WAV so the reader is tested against real bytes ---
function makeWav({ audioFormat = 1, channels = 1, sampleRate = 48000, bits = 16, frames = [], junkFirst = false }) {
  const bytes = bits / 8;
  const data = Buffer.alloc(frames.length * bytes);
  frames.forEach((v, i) => {
    const o = i * bytes;
    if (audioFormat === 3 && bits === 32) data.writeFloatLE(v, o);
    else if (bits === 16) data.writeInt16LE(Math.round(v * 32767), o);
    else if (bits === 24) data.writeIntLE(Math.round(v * 8388607), o, 3);
    else if (bits === 32) data.writeInt32LE(Math.round(v * 2147483647), o);
    else throw new Error(`test helper: unsupported ${audioFormat}/${bits}`);
  });
  const fmt = Buffer.alloc(24);
  fmt.write('fmt ', 0);
  fmt.writeUInt32LE(16, 4);
  fmt.writeUInt16LE(audioFormat, 8);
  fmt.writeUInt16LE(channels, 10);
  fmt.writeUInt32LE(sampleRate, 12);
  fmt.writeUInt32LE(sampleRate * channels * bytes, 16);
  fmt.writeUInt16LE(channels * bytes, 20);
  fmt.writeUInt16LE(bits, 22);
  const dataChunk = Buffer.alloc(8);
  dataChunk.write('data', 0);
  dataChunk.writeUInt32LE(data.length, 4);
  // A JUNK chunk BEFORE fmt is legal and appears in real-world files; the
  // reader must scan for chunks, not assume fmt starts at byte 12.
  const junk = Buffer.alloc(8 + 16);
  junk.write('JUNK', 0);
  junk.writeUInt32LE(16, 4);
  const body = junkFirst
    ? Buffer.concat([junk, fmt, dataChunk, data])
    : Buffer.concat([fmt, dataChunk, data]);
  const riff = Buffer.alloc(12);
  riff.write('RIFF', 0);
  riff.writeUInt32LE(4 + body.length, 4);
  riff.write('WAVE', 8);
  return Buffer.concat([riff, body]);
}

test('readWavMono decodes 24-bit PCM', () => {
  const wav = makeWav({ bits: 24, frames: [0, 0.5, -0.5, 0.999] });
  const { samples, sampleRate, bitsPerSample } = readWavMono(wav);
  assert.equal(sampleRate, 48000);
  assert.equal(bitsPerSample, 24);
  assert.equal(samples.length, 4);
  assert.ok(Math.abs(samples[1] - 0.5) < 1e-5, `got ${samples[1]}`);
  assert.ok(Math.abs(samples[2] + 0.5) < 1e-5, `got ${samples[2]}`);
});

test('readWavMono downmixes a 24-bit stereo file by averaging channels', () => {
  // interleaved L,R: L is +0.8 throughout, R is -0.4 throughout -> mono +0.2
  const wav = makeWav({ bits: 24, channels: 2, frames: [0.8, -0.4, 0.8, -0.4] });
  const { samples, channels } = readWavMono(wav);
  assert.equal(channels, 2);
  assert.equal(samples.length, 2);
  for (const s of samples) assert.ok(Math.abs(s - 0.2) < 1e-5, `got ${s}`);
});

test('readWavMono decodes 32-bit float PCM', () => {
  const wav = makeWav({ audioFormat: 3, bits: 32, frames: [0.25, -0.75] });
  const { samples } = readWavMono(wav);
  assert.ok(Math.abs(samples[0] - 0.25) < 1e-6);
  assert.ok(Math.abs(samples[1] + 0.75) < 1e-6);
});

test('readWavMono finds fmt even when another chunk precedes it', () => {
  const wav = makeWav({ bits: 24, frames: [0.5, 0.5], junkFirst: true });
  const { samples, bitsPerSample } = readWavMono(wav);
  assert.equal(bitsPerSample, 24);
  assert.equal(samples.length, 2);
  assert.ok(Math.abs(samples[0] - 0.5) < 1e-5);
});

test('readWavMono rejects an unsupported bit depth instead of silently misreading it', () => {
  const wav = makeWav({ bits: 16, frames: [0.5] });
  wav.writeUInt16LE(12, 34); // claim 12-bit
  assert.throws(() => readWavMono(wav), /unsupported/i);
});

test('writeWavMono can emit 24-bit, and 24-bit survives a round trip', () => {
  const src = new Float32Array([0, 0.5, -0.5, 0.25]);
  const { samples, bitsPerSample } = readWavMono(writeWavMono(src, 48000, 24));
  assert.equal(bitsPerSample, 24);
  for (let i = 0; i < src.length; i++) {
    assert.ok(Math.abs(samples[i] - src[i]) < 1e-5, `frame ${i}: ${samples[i]} vs ${src[i]}`);
  }
});

test('writeWavMono 16-bit output is unchanged (3a build-pack depends on it)', () => {
  const src = new Float32Array([0, 0.5, -0.5]);
  const buf = writeWavMono(src, 48000);
  assert.equal(buf.readUInt16LE(34), 16);
  assert.equal(buf.readInt16LE(44 + 2), Math.trunc(0.5 * 32767));
  assert.equal(buf.readInt16LE(44 + 4), Math.trunc(-0.5 * 32768));
});
