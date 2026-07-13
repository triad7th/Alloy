// Mono PCM WAV I/O for the samplepack pipeline. Reads 8/16/24/32-bit integer
// and 32/64-bit float PCM at any channel count (channels are averaged to mono);
// writes 16- or 24-bit mono. 24-bit matters: the Salamander sources are 24-bit,
// and the pack's per-zone gain amplifies quiet velocity layers at load time, so
// the encoder must not be handed 16-bit-quantized input.

export function writeWavMono(samples, sampleRate, bitsPerSample = 16) {
  if (bitsPerSample !== 16 && bitsPerSample !== 24) {
    throw new Error(`writeWavMono: unsupported bitsPerSample ${bitsPerSample}`);
  }
  const bytes = bitsPerSample / 8;
  const n = samples.length;
  const data = Buffer.alloc(n * bytes);
  // Asymmetric full-scale (…32768 negative / …32767 positive) with truncation,
  // exactly as the 16-bit path has always done — keeps 16-bit output identical.
  const negFs = bitsPerSample === 16 ? 32768 : 8388608;
  const posFs = bitsPerSample === 16 ? 32767 : 8388607;
  for (let i = 0; i < n; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    const v = (s < 0 ? s * negFs : s * posFs) | 0;
    if (bitsPerSample === 16) data.writeInt16LE(v, i * 2);
    else data.writeIntLE(v, i * 3, 3);
  }
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(1, 22); // mono
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * bytes, 28); // byte rate
  header.writeUInt16LE(bytes, 32); // block align
  header.writeUInt16LE(bitsPerSample, 34);
  header.write('data', 36);
  header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}

/** First chunk with this id, or null. Chunks are word-aligned. */
function findChunk(buffer, id) {
  let offset = 12;
  while (offset + 8 <= buffer.length) {
    const size = buffer.readUInt32LE(offset + 4);
    if (buffer.toString('ascii', offset, offset + 4) === id) return { offset: offset + 8, size };
    offset += 8 + size + (size & 1);
  }
  return null;
}

/** Per-sample decoder for a (audioFormat, bitsPerSample) pair, normalized to
 *  -1..1. Throws rather than silently misreading an unexpected format. */
function pcmReader(audioFormat, bits) {
  // 0xFFFE (WAVE_FORMAT_EXTENSIBLE) carries the real format in an extension
  // block; every source we ingest is integer PCM, so treat it as PCM.
  const isFloat = audioFormat === 3;
  if (isFloat) {
    if (bits === 32) return (b, o) => b.readFloatLE(o);
    if (bits === 64) return (b, o) => b.readDoubleLE(o);
  } else {
    if (bits === 8) return (b, o) => (b.readUInt8(o) - 128) / 128;
    if (bits === 16) return (b, o) => b.readInt16LE(o) / 32768;
    if (bits === 24) return (b, o) => b.readIntLE(o, 3) / 8388608;
    if (bits === 32) return (b, o) => b.readInt32LE(o) / 2147483648;
  }
  throw new Error(`readWavMono: unsupported WAV format ${audioFormat} at ${bits}-bit`);
}

export function readWavMono(buffer) {
  if (buffer.toString('ascii', 0, 4) !== 'RIFF' || buffer.toString('ascii', 8, 12) !== 'WAVE') {
    throw new Error('not a RIFF/WAVE file');
  }
  const fmt = findChunk(buffer, 'fmt ');
  if (!fmt) throw new Error('no fmt chunk');
  const audioFormat = buffer.readUInt16LE(fmt.offset);
  const channels = buffer.readUInt16LE(fmt.offset + 2);
  const sampleRate = buffer.readUInt32LE(fmt.offset + 4);
  const bitsPerSample = buffer.readUInt16LE(fmt.offset + 14);
  const data = findChunk(buffer, 'data');
  if (!data) throw new Error('no data chunk');
  if (channels < 1) throw new Error(`readWavMono: bad channel count ${channels}`);

  const read = pcmReader(audioFormat, bitsPerSample);
  const bytes = bitsPerSample / 8;
  const frames = Math.floor(data.size / bytes / channels);
  const samples = new Float32Array(frames);
  for (let i = 0; i < frames; i++) {
    let acc = 0; // downmix to mono by averaging channels
    for (let c = 0; c < channels; c++) acc += read(buffer, data.offset + (i * channels + c) * bytes);
    samples[i] = acc / channels;
  }
  return { sampleRate, samples, channels, bitsPerSample };
}
