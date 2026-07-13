# Rompler Phase 3b — Salamander Piano (Tiny Tier) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the real Salamander-derived tiny-tier piano pack through the proven 3a pipeline, close the Swift decode gap so both platforms can load it, and audition it in the workbench.

**Architecture:** Four moving parts, in dependency order. (1) The offline pipeline gains a *polish* stage — 24-bit WAV ingest, attack-preserving silence trim, truncate + baked fade-out — because piano is **one-shot**, not looped: 3a's `findLoop`/`bakeCrossfade` go entirely unused here. (2) A new `build-piano-pack.mjs` orchestrator runs 120 selected source samples (30 roots × 4 velocity layers) through ingest → polish → peak-normalize → AAC 128k → decode-and-verify → `manifest.json` + `CREDITS.md`. (3) Swift gets a concrete `AVAudioFileDecoder`, since 3a shipped only the `SampleDecoder` protocol plus test fakes — without it Swift literally cannot decode a real pack. (4) The workbench loads the pack over the existing `PackLoader` → `setZoneSet` wire path and plays a new `piano` patch.

**Tech Stack:** Node ESM (`.mjs`) + `node:test` for the offline tools (web-only, no Swift twin — same category as `tools/release.mjs`). TypeScript + Vitest and Swift + XCTest for the twinned runtime. `afconvert` (preferred) / `ffmpeg` (fallback) for AAC. Angular 21 for the workbench harness.

**Design spec:** `docs/superpowers/specs/2026-07-13-rompler-piano-3b-design.md`
**Predecessor:** `docs/superpowers/specs/2026-07-12-rompler-pack-pipeline-3a-design.md`

---

## Global Constraints

Every task's requirements implicitly include this section.

- **Do NOT run formatters or linters.** The repo has **no** prettier, eslint, or swiftformat config. Running one reformats 100+ files to non-repo style. Match the surrounding file's existing style by hand.
- **Do NOT modify the DSP core.** `sample-zone-generator.ts`/`.swift`, `tone-generator`, `voice.ts`/`Voice.swift`, `patch-engine.ts`/`PatchEngine.swift` are **off limits** in 3b. The mono voice bus is locked; stereo sample playback is a separate roadmap phase. If a task appears to need a DSP-core change, that is a plan bug — escalate, do not edit.
- **Determinism is absolute in the DSP core**: no `Date.now()`, no `Math.random()`. (The offline tools and the host-edge decoder are not DSP core — a temp-file UUID in the decoder is fine.)
- **The pack is a build artifact and is NEVER committed.** No `.m4a`, no `manifest.json` from a pack build, in any commit. The one sanctioned binary in the repo is the ~8 KB Swift test fixture in Task 2.
- **CC-BY 3.0 attribution to Alexander Holm is a license obligation.** The emitted `CREDITS.md` must carry the source name, the license name, and the source URL.
- Piano is **one-shot**: every emitted zone omits `loopStart`/`loopEnd`. `validateManifest` already accepts this (loop fields are both-or-neither).
- **Twin rule:** runtime code is mirrored TS + Swift, shipped in the same change set (`docs/mirroring.md`). Offline tools under `tools/` are **web-only, no Swift twin**.
- Commit style: conventional commits (`feat:`, `fix:`, `docs:`, `test:`, `chore:`), imperative subject ≤ 72 chars.

## Commands

| What | Command (from repo root) |
| --- | --- |
| Tool tests | `node --test tools/samplepack/*.test.mjs` |
| Web tests | `cd web && npm test` |
| Swift tests | `swift build && swift test` (`Package.swift` is at the **repo root**) |
| Build alloy-audio dist | `npm --prefix web/packages/alloy-audio run build` |

**The tool test command needs the glob.** `node --test tools/samplepack/` fails on Node 25 ("Cannot find module") because it tries to load the directory as a module. Always pass `*.test.mjs`.

## Source archive

Already downloaded, xz integrity verified: `/tmp/salamander/salamander-48k24.tar.xz` (1.2 GB).

Layout: `SalamanderGrandPianoV3_48khz24bit/48khz24bit/{Note}{Octave}v{1..16}.wav` —
**480 note samples = 30 roots × 16 velocities**. The 30 roots are every 3rd
semitone from A0 (MIDI 21) to C8 (MIDI 108). Also present and **excluded** (no
engine support): 88 `rel*.wav` release samples, 69 `harm*.wav` sympathetic
resonance samples.

## Known consequences to report, not hide

- **The tiny tier is ~23 MB on disk but ~276 MB decoded in RAM.** 120 zones × 12 s × 48 kHz × 4 B mono float ≈ 276 MB. That is the honest cost of 4 velocity layers × 12-second one-shots. It is fine for a desktop workbench; it is a real number the user should hear before this shape ships to a phone. Task 7 measures and reports it. Do not quietly shrink the pack to make the number look better — the user chose this budget.
- **Green tests do not mean success here.** Everything below verifies the pack loads, renders, is deterministic, does not clip, and does not click. Whether it *sounds fantastic* is the user's ear. Expect a tuning iteration after Task 7.

---

## File Structure

| File | Responsibility |
| --- | --- |
| `tools/samplepack/wav.mjs` (modify) | WAV I/O. Extended to **read** 8/16/24/32-bit int + 32/64-bit float, any channel count (downmix to mono), with a proper chunk scan; and to **write** 16- or 24-bit mono. |
| `swift/Sources/AlloyAudio/Pack/AVAudioFileDecoder.swift` (create) | Concrete Swift `SampleDecoder` — the platform edge that lets Swift decode a real pack. |
| `swift/Tests/AlloyAudioTests/Fixtures/tone440.m4a` (create) | ~8 KB committed AAC fixture so the Swift decoder is tested against real encoded bytes. |
| `tools/samplepack/salamander.mjs` (create) | Everything Salamander-specific: filename → `{rootMidi, velocityIndex}`, the 30-root grid, the velocity-band selection config, and the 120 archive member paths. |
| `tools/samplepack/polish.mjs` (create) | One-shot polish: attack-preserving silence trim, truncate + baked equal-power fade-out. |
| `tools/samplepack/encode-verify.mjs` (modify) | Add a bitrate parameter to `encodeAac`; add `pickProbe` so the integrity verifier correlates against a window that still has signal. |
| `tools/samplepack/build-piano-pack.mjs` (create) | The orchestrator: ingest → polish → assemble → encode → verify → manifest + CREDITS. |
| `examples/web-harness/src/app/sections/rompler-section.component.ts` (modify) | Piano patch + pack load over `PackLoader` → `setZoneSet`. |
| `.gitignore` (modify) | Keep every pack build artifact out of the tree. |

---

### Task 1: WAV reader/writer — real bit depths

3a's `readWavMono` hard-codes 16-bit (`readInt16LE`, `dataLen / 2 / channels`) and reads `channels`/`sampleRate` from fixed header offsets. Salamander is **24-bit**, so today the pipeline would read its files as garbage. It also needs to scan for the `fmt ` chunk rather than assume it sits at byte 12, and to write 24-bit WAVs into the encoder (the pack's per-zone gain amplifies quiet velocity layers on load, so handing the encoder 16-bit-quantized input would bake in quantization noise we then multiply up).

**Files:**
- Modify: `tools/samplepack/wav.mjs`
- Test: `tools/samplepack/wav.test.mjs` (extend the existing file)

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `writeWavMono(samples: Float32Array, sampleRate: number, bitsPerSample = 16): Buffer` — **16-bit output must remain byte-identical to today's** (3a's `build-pack.mjs` depends on it).
  - `readWavMono(buffer: Buffer): { sampleRate: number, samples: Float32Array, channels: number, bitsPerSample: number }` — always mono (channels averaged). The extra `channels`/`bitsPerSample` fields are additive; existing destructuring keeps working.

- [ ] **Step 1: Write the failing tests**

Append to `tools/samplepack/wav.test.mjs` (keep the existing tests and imports; add `writeWavMono` to the import if it isn't already there):

```js
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
```

- [ ] **Step 2: Run the tests and watch them fail**

Run: `node --test tools/samplepack/*.test.mjs`
Expected: the new 24-bit/float/JUNK/unsupported tests FAIL (the reader misreads 24-bit as 16-bit and `writeWavMono` ignores a third argument). The pre-existing `wav.test.mjs` tests still PASS.

- [ ] **Step 3: Rewrite `tools/samplepack/wav.mjs`**

```js
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
```

- [ ] **Step 4: Run the tests and verify they pass**

Run: `node --test tools/samplepack/*.test.mjs`
Expected: PASS — every new test, and every pre-existing test in the whole `tools/samplepack` suite (`wav`, `gen-test-pack`, `loop-finder`, `layer-assembler`, `encode-verify`, `build-pack`). The 3a `build-pack` test is the regression net proving 16-bit output did not change.

- [ ] **Step 5: Commit**

```bash
git add tools/samplepack/wav.mjs tools/samplepack/wav.test.mjs
git commit -m "feat(samplepack): read 24-bit/float WAVs and write 24-bit mono"
```

---

### Task 2: Swift `AVAudioFileDecoder`

3a shipped Swift's `SampleDecoder` **protocol** plus test fakes and no concrete
implementation — the doc comment even says "An `AVAudioFile`-backed
implementation may be added later." That "later" is now: without it, Swift
cannot decode a real pack, and the twin is only half-built. This is the platform
edge (host I/O), so AVFoundation stays out of the DSP core, exactly as
`BundleSampleSource.swift:61-90` already does for bundled samples.

`AVAudioFile` reads from a URL, not from memory, so the bytes are staged in a
unique temp file and removed afterwards.

**Files:**
- Create: `swift/Sources/AlloyAudio/Pack/AVAudioFileDecoder.swift`
- Create: `swift/Tests/AlloyAudioTests/AVAudioFileDecoderTests.swift`
- Create: `swift/Tests/AlloyAudioTests/Fixtures/tone440.m4a` (generated in Step 1; ~8 KB)
- Modify: `Package.swift` (test target gains `resources:`)
- Modify: `swift/Sources/AlloyAudio/Pack/SampleDecoder.swift` (doc comment only — the "may be added later" note is now false)

**Interfaces:**
- Consumes: `SampleDecoder` / `DecodedPcm` (`swift/Sources/AlloyAudio/Pack/SampleDecoder.swift`), `PackLoader` + `PackSource` (`.../Pack/`).
- Produces: `public struct AVAudioFileDecoder: SampleDecoder` with `public init()`; `public enum SampleDecoderError: Error, Equatable { case decodeFailed }`. Task 7 does **not** consume these (the web twin has `WebAudioDecoder`); this closes the Swift half of the twin.

- [ ] **Step 1: Generate the test fixture**

A real AAC fixture is the point — a fake decoder proves nothing about
AVFoundation. 0.5 s of 440 Hz at 0.5 amplitude, encoded by the same
`encodeAac` the pipeline uses.

```bash
mkdir -p swift/Tests/AlloyAudioTests/Fixtures
node --input-type=module -e "
import { writeFileSync } from 'node:fs';
import { writeWavMono } from './tools/samplepack/wav.mjs';
import { encodeAac } from './tools/samplepack/encode-verify.mjs';
const sr = 48000, n = 24000;
const s = new Float32Array(n);
for (let i = 0; i < n; i++) s[i] = 0.5 * Math.sin((2 * Math.PI * 440 * i) / sr);
writeFileSync('/tmp/tone440.wav', writeWavMono(s, sr));
encodeAac('/tmp/tone440.wav', 'swift/Tests/AlloyAudioTests/Fixtures/tone440.m4a');
console.log('fixture written');
"
ls -l swift/Tests/AlloyAudioTests/Fixtures/tone440.m4a
```

Expected: `fixture written`, and a file on the order of 8–20 KB.

- [ ] **Step 2: Register the fixture as a test resource**

In `Package.swift`, change the `AlloyAudioTests` target (currently
`Package.swift:21-22`) to:

```swift
    .testTarget(name: "AlloyAudioTests", dependencies: ["AlloyAudio"],
                path: "swift/Tests/AlloyAudioTests",
                resources: [.copy("Fixtures")]),
```

Adding `resources:` is what makes `Bundle.module` available inside the test target.

- [ ] **Step 3: Write the failing test**

Create `swift/Tests/AlloyAudioTests/AVAudioFileDecoderTests.swift`. The suite
uses **XCTest** (see `PackLoaderTests.swift`), not swift-testing.

```swift
@testable import AlloyAudio
import Foundation
import XCTest

/// The Swift half of the pack decode path. 3a shipped only fakes on this side,
/// so this is the first test that proves Swift can turn real encoded bytes into
/// PCM — and, through PackLoader, into a resolvable zone set.
final class AVAudioFileDecoderTests: XCTestCase {
    /// 0.5 s of 440 Hz at amplitude 0.5, AAC-encoded by the samplepack pipeline.
    private func fixtureBytes() throws -> Data {
        let url = try XCTUnwrap(
            Bundle.module.url(forResource: "tone440", withExtension: "m4a", subdirectory: "Fixtures"),
        )
        return try Data(contentsOf: url)
    }

    func testDecodesRealAacBytesToMonoPcm() async throws {
        let pcm = try await AVAudioFileDecoder().decode(fixtureBytes())

        XCTAssertEqual(pcm.sampleRate, 48000, accuracy: 1)
        // AAC adds priming/padding frames, so the length is near — not equal to —
        // the 24000 source frames.
        XCTAssertGreaterThan(pcm.data.count, 21000)
        XCTAssertLessThan(pcm.data.count, 28000)

        let peak = pcm.data.reduce(0) { max($0, abs($1)) }
        XCTAssertGreaterThan(peak, 0.3, "decoded a silent buffer")
        XCTAssertLessThan(peak, 0.75, "decoded signal is far hotter than the 0.5 source")
    }

    func testDecodeThrowsOnBytesThatAreNotAudio() async {
        let garbage = Data(repeating: 0x7f, count: 512)
        do {
            _ = try await AVAudioFileDecoder().decode(garbage)
            XCTFail("expected a decode failure")
        } catch {
            // any error is acceptable — AVFoundation's or ours
        }
    }

    /// The whole point of the task: a real decoder behind the real loader.
    func testPackLoaderResolvesAZoneSetUsingTheRealDecoder() async throws {
        let bytes = try fixtureBytes()
        let manifest = PackManifest(
            schemaVersion: PACK_SCHEMA_VERSION,
            id: "fixture-pack",
            tier: "tiny",
            sampleRate: 48000,
            format: "m4a",
            zoneSets: [
                "piano": ZoneSetSpec(layers: [
                    LayerSpec(topVelocity: 1, zones: [
                        ZoneSpec(rootMidi: 60, file: "tone440.m4a", gain: 0.5, tuneCents: 0),
                    ]),
                ]),
            ],
            credits: [],
        )
        let loader = PackLoader(
            source: InMemoryPackSource(manifest: manifest, zones: ["tone440.m4a": bytes]),
            decoder: AVAudioFileDecoder(),
        )

        XCTAssertNil(loader.provide("piano"), "must be nil before load (progressive delivery)")
        try await loader.load()

        let layers = try XCTUnwrap(loader.provide("piano"))
        XCTAssertEqual(layers.count, 1)
        let zone = try XCTUnwrap(layers.first?.zones.first)
        XCTAssertEqual(zone.rootMidi, 60, accuracy: 1e-9)
        XCTAssertEqual(zone.sampleRate, 48000, accuracy: 1)
        // gain 0.5 was folded into the PCM at load: the 0.5-amplitude tone halves.
        let peak = zone.data.reduce(0) { max($0, abs($1)) }
        XCTAssertGreaterThan(peak, 0.15)
        XCTAssertLessThan(peak, 0.4)
    }
}

/// Serves a manifest + encoded bytes from memory, so the test never touches the
/// network or the filesystem beyond the bundled fixture.
private struct InMemoryPackSource: PackSource {
    let manifest: PackManifest
    let zones: [String: Data]

    func fetchManifest() async throws -> PackManifest { manifest }

    func fetchZone(_ file: String) async throws -> Data {
        guard let bytes = zones[file] else { throw PackSourceError.invalidManifest(["no such zone: \(file)"]) }
        return bytes
    }
}
```

**Before writing this file, open `swift/Sources/AlloyAudio/Pack/PackManifest.swift`
and use its ACTUAL type names, memberwise initializers, and schema-version
constant** (the TS twin calls it `PACK_SCHEMA_VERSION`; Swift may spell it
differently — use whatever is really there, or just pass `1`). The names above are what
`PackLoader.swift` refers to (`spec.layers`, `layer.topVelocity`, `layer.zones`,
`z.file`, `z.rootMidi`, `z.gain`, `z.tuneCents`, `z.loopStart`, `z.loopEnd`), but
adjust the constructor calls to match the real memberwise inits — do not change
`PackManifest.swift` itself.

- [ ] **Step 4: Run the test to verify it fails**

Run: `swift build && swift test --filter AVAudioFileDecoderTests`
Expected: FAIL to **compile** — "cannot find 'AVAudioFileDecoder' in scope".

- [ ] **Step 5: Write the decoder**

Create `swift/Sources/AlloyAudio/Pack/AVAudioFileDecoder.swift`:

```swift
#if canImport(AVFoundation)
import AVFoundation
import Foundation

/// `SampleDecoder` backed by AVFoundation: encoded (.m4a) bytes -> mono Float
/// PCM. Platform edge — host I/O, never reached from the DSP core, mirroring
/// the decode path `BundleSampleSource` already uses for bundled samples.
/// Twin of web `WebAudioDecoder` (pack-source.ts): same contract, so any
/// channel count is averaged to mono and the file's own sample rate is reported.
///
/// `AVAudioFile` reads from a URL rather than from memory, so the bytes are
/// staged in a uniquely-named temporary file and removed afterwards.
public struct AVAudioFileDecoder: SampleDecoder {
    public init() {}

    public func decode(_ bytes: Data) async throws -> DecodedPcm {
        let url = FileManager.default.temporaryDirectory
            .appendingPathComponent("alloy-pack-\(UUID().uuidString).m4a")
        try bytes.write(to: url)
        defer { try? FileManager.default.removeItem(at: url) }

        let file = try AVAudioFile(forReading: url)
        let format = file.processingFormat
        guard
            let buffer = AVAudioPCMBuffer(
                pcmFormat: format, frameCapacity: AVAudioFrameCount(file.length),
            )
        else { throw SampleDecoderError.decodeFailed }
        try file.read(into: buffer)
        guard let channels = buffer.floatChannelData else { throw SampleDecoderError.decodeFailed }

        let frames = Int(buffer.frameLength)
        let channelCount = Int(format.channelCount)
        guard frames > 0, channelCount > 0 else { throw SampleDecoderError.decodeFailed }

        var mono = [Float](repeating: 0, count: frames)
        for channel in 0..<channelCount {
            let data = channels[channel]
            for frame in 0..<frames {
                mono[frame] += data[frame]
            }
        }
        if channelCount > 1 {
            let scale = 1 / Float(channelCount)
            for frame in 0..<frames {
                mono[frame] *= scale
            }
        }
        return DecodedPcm(sampleRate: format.sampleRate, data: mono)
    }
}

public enum SampleDecoderError: Error, Equatable {
    case decodeFailed
}
#endif
```

- [ ] **Step 6: Correct the now-false doc comment**

In `swift/Sources/AlloyAudio/Pack/SampleDecoder.swift`, replace the sentence
"An `AVAudioFile`-backed implementation may be added later (mirroring
`BundleSampleSource`'s decode path); it is not required here — tests inject a
fake." with:

```swift
/// `AVAudioFileDecoder` is the production implementation; tests may inject a fake.
```

- [ ] **Step 7: Run the tests and verify they pass**

Run: `swift build && swift test`
Expected: PASS — the three new tests plus the entire existing `AlloyAudioTests`
suite (goldens, benchmarks, pack loader) unchanged.

- [ ] **Step 8: Commit**

```bash
git add Package.swift swift/Sources/AlloyAudio/Pack/AVAudioFileDecoder.swift \
        swift/Sources/AlloyAudio/Pack/SampleDecoder.swift \
        swift/Tests/AlloyAudioTests/AVAudioFileDecoderTests.swift \
        swift/Tests/AlloyAudioTests/Fixtures/tone440.m4a
git commit -m "feat(audio): add AVAudioFileDecoder so Swift can load a real pack"
```

---

### Task 3: Salamander source mapping

Everything Salamander-specific in one file, so the velocity selection is a single
constant a listening pass can re-roll cheaply. The filenames are the
authoritative key/velocity map (`A0v10.wav` = root A0, velocity layer 10 of 16).

**Deliberate deviation from the design spec:** the spec said to cross-check the
filename-derived root map "against the `.sfz`". Parsing the SFZ is a weaker check
than it sounds — the engine only needs `rootMidi`, and the archive's actual
layout (30 roots, MIDI 21…108, every 3 semitones) is a *stronger*, simpler
assertion than re-reading the same fact out of a second file. This task asserts
the derived grid against that layout directly, and does not parse the SFZ.

**Files:**
- Create: `tools/samplepack/salamander.mjs`
- Test: `tools/samplepack/salamander.test.mjs`

**Interfaces:**
- Consumes: nothing.
- Produces (all consumed by Task 6):
  - `ARCHIVE_DIR: string`
  - `SALAMANDER_ROOTS: number[]` — 30 entries, `[21, 24, …, 108]`
  - `VELOCITY_INDICES: number[]` — `[4, 8, 12, 16]`
  - `TOP_VELOCITIES: number[]` — `[0.25, 0.5, 0.75, 1.0]`
  - `parseSampleName(name: string): { rootMidi: number, velocityIndex: number } | null`
  - `noteStem(midi: number): string`
  - `salamanderMembers(): string[]` — the 120 archive-relative paths, for `tar -T`
  - `selectSources(files: {name, samples, sampleRate}[]): {name, samples, sampleRate, rootMidi, layerIndex}[]` — the shape `assembleLayers` consumes

- [ ] **Step 1: Write the failing test**

Create `tools/samplepack/salamander.test.mjs`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ARCHIVE_DIR,
  SALAMANDER_ROOTS,
  TOP_VELOCITIES,
  VELOCITY_INDICES,
  noteStem,
  parseSampleName,
  salamanderMembers,
  selectSources,
} from './salamander.mjs';

test('parseSampleName maps real archive filenames to root + velocity', () => {
  assert.deepEqual(parseSampleName('A0v10.wav'), { rootMidi: 21, velocityIndex: 10 });
  assert.deepEqual(parseSampleName('C1v1.wav'), { rootMidi: 24, velocityIndex: 1 });
  assert.deepEqual(parseSampleName('D#1v3.wav'), { rootMidi: 27, velocityIndex: 3 });
  assert.deepEqual(parseSampleName('C4v8.wav'), { rootMidi: 60, velocityIndex: 8 });
  assert.deepEqual(parseSampleName('F#5v16.wav'), { rootMidi: 78, velocityIndex: 16 });
  assert.deepEqual(parseSampleName('C8v5.wav'), { rootMidi: 108, velocityIndex: 5 });
});

test('parseSampleName rejects the samples the engine cannot use', () => {
  // release samples and sympathetic-resonance harmonics: no engine support
  assert.equal(parseSampleName('rel79.wav'), null);
  assert.equal(parseSampleName('harmSA4.wav'), null);
  assert.equal(parseSampleName('README'), null);
  assert.equal(parseSampleName('SalamanderGrandPianoV3.sfz'), null);
});

test('the derived root grid is the archive layout: 30 roots, MIDI 21..108, every 3 semitones', () => {
  assert.equal(SALAMANDER_ROOTS.length, 30);
  assert.equal(SALAMANDER_ROOTS[0], 21);
  assert.equal(SALAMANDER_ROOTS.at(-1), 108);
  for (let i = 1; i < SALAMANDER_ROOTS.length; i++) {
    assert.equal(SALAMANDER_ROOTS[i] - SALAMANDER_ROOTS[i - 1], 3);
  }
  // Max pitch-shift at playback is half the spacing: +-1.5 semitones.
});

test('noteStem round-trips through parseSampleName for every root', () => {
  for (const root of SALAMANDER_ROOTS) {
    const parsed = parseSampleName(`${noteStem(root)}v1.wav`);
    assert.equal(parsed.rootMidi, root, `stem ${noteStem(root)} did not map back to ${root}`);
  }
});

test('salamanderMembers lists exactly the 120 files the tiny tier needs', () => {
  const members = salamanderMembers();
  assert.equal(members.length, SALAMANDER_ROOTS.length * VELOCITY_INDICES.length);
  assert.equal(members.length, 120);
  assert.equal(members[0], `${ARCHIVE_DIR}/A0v4.wav`);
  assert.equal(members.at(-1), `${ARCHIVE_DIR}/C8v16.wav`);
  assert.equal(new Set(members).size, 120, 'members must be unique');
});

test('TOP_VELOCITIES is ascending, ends at 1, and matches VELOCITY_INDICES', () => {
  assert.equal(TOP_VELOCITIES.length, VELOCITY_INDICES.length);
  assert.equal(TOP_VELOCITIES.at(-1), 1);
  for (let i = 1; i < TOP_VELOCITIES.length; i++) {
    assert.ok(TOP_VELOCITIES[i] > TOP_VELOCITIES[i - 1]);
  }
});

test('selectSources keeps only the selected velocity bands and orders output deterministically', () => {
  const files = [
    { name: 'C4v8.wav', samples: new Float32Array(1), sampleRate: 48000 },
    { name: 'A0v4.wav', samples: new Float32Array(1), sampleRate: 48000 },
    { name: 'C4v7.wav', samples: new Float32Array(1), sampleRate: 48000 }, // not a quartile
    { name: 'rel79.wav', samples: new Float32Array(1), sampleRate: 48000 },
    { name: 'A0v16.wav', samples: new Float32Array(1), sampleRate: 48000 },
  ];
  const selected = selectSources(files);
  assert.deepEqual(
    selected.map((s) => [s.name, s.rootMidi, s.layerIndex]),
    [
      ['A0v4.wav', 21, 0],
      ['C4v8.wav', 60, 1],
      ['A0v16.wav', 21, 3],
    ],
  );
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test tools/samplepack/salamander.test.mjs`
Expected: FAIL — "Cannot find module './salamander.mjs'".

- [ ] **Step 3: Write `tools/samplepack/salamander.mjs`**

```js
// Salamander Grand Piano V3 (Alexander Holm, CC-BY 3.0) source mapping. The
// filenames ARE the key/velocity map: `{Note}{Octave}v{1..16}.wav` over 30 roots
// spaced 3 semitones apart, A0 (MIDI 21) to C8 (MIDI 108) — so the worst-case
// pitch shift at playback is +-1.5 semitones. Release samples (`rel*`) and
// sympathetic-resonance harmonics (`harm*`) have no engine support and are
// never selected.

const SEMITONE = { C: 0, 'C#': 1, D: 2, 'D#': 3, E: 4, F: 5, 'F#': 6, G: 7, 'G#': 8, A: 9, 'A#': 10, B: 11 };
const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

/** Archive-relative directory holding the note WAVs. */
export const ARCHIVE_DIR = 'SalamanderGrandPianoV3_48khz24bit/48khz24bit';

/** The 30 recorded roots: MIDI 21 (A0) to 108 (C8), every 3 semitones. */
export const SALAMANDER_ROOTS = Array.from({ length: 30 }, (_, i) => 21 + i * 3);

/** Which of the 16 recorded velocity layers the tiny tier keeps: the quartiles,
 *  evenly spaced across the source's dynamic range. THIS IS A TUNING KNOB —
 *  changing this one constant (and TOP_VELOCITIES to match) re-rolls the
 *  velocity selection and rebuilds the pack. */
export const VELOCITY_INDICES = [4, 8, 12, 16];

/** Inclusive top velocity of each kept layer, ascending; index-aligned with
 *  VELOCITY_INDICES. */
export const TOP_VELOCITIES = [0.25, 0.5, 0.75, 1.0];

/** `A0v10.wav` -> { rootMidi: 21, velocityIndex: 10 }. null for anything that is
 *  not a note sample (rel*, harm*, README, .sfz, ...). */
export function parseSampleName(name) {
  const m = /^([A-G]#?)(-?\d+)v(\d+)\.wav$/.exec(name);
  if (!m) return null;
  const [, note, octave, velocity] = m;
  return { rootMidi: (Number(octave) + 1) * 12 + SEMITONE[note], velocityIndex: Number(velocity) };
}

/** MIDI note -> Salamander file stem: 21 -> 'A0', 108 -> 'C8'. */
export function noteStem(midi) {
  return `${NAMES[midi % 12]}${Math.floor(midi / 12) - 1}`;
}

/** The 120 archive members the tiny tier needs (30 roots x 4 velocities), as
 *  paths relative to the archive root — feed straight to `tar -T`. */
export function salamanderMembers() {
  const members = [];
  for (const root of SALAMANDER_ROOTS) {
    for (const v of VELOCITY_INDICES) members.push(`${ARCHIVE_DIR}/${noteStem(root)}v${v}.wav`);
  }
  return members;
}

/** Ingested `{name, samples, sampleRate}` -> the `{..., rootMidi, layerIndex}`
 *  shape `assembleLayers` consumes. Drops anything outside the selection and
 *  sorts by (layerIndex, rootMidi) so pack output is deterministic. */
export function selectSources(files) {
  const selected = [];
  for (const file of files) {
    const parsed = parseSampleName(file.name);
    if (!parsed) continue;
    const layerIndex = VELOCITY_INDICES.indexOf(parsed.velocityIndex);
    if (layerIndex < 0) continue;
    selected.push({ ...file, rootMidi: parsed.rootMidi, layerIndex });
  }
  selected.sort((a, b) => a.layerIndex - b.layerIndex || a.rootMidi - b.rootMidi);
  return selected;
}
```

- [ ] **Step 4: Run the tests and verify they pass**

Run: `node --test tools/samplepack/*.test.mjs`
Expected: PASS — all new tests plus the whole existing suite.

- [ ] **Step 5: Commit**

```bash
git add tools/samplepack/salamander.mjs tools/samplepack/salamander.test.mjs
git commit -m "feat(samplepack): map Salamander sources to roots and velocity bands"
```

---

### Task 4: One-shot polish stage

Piano is one-shot: no loop, so every artifact lives at the two ends. The **start**
needs the pre-attack silence stripped without clipping the transient (a clipped
piano attack is instantly audible — it turns a hammer strike into a click). The
**end** needs a baked fade-out, because an unlooped sample that is simply cut at
12 s ends on a non-zero value and clicks. `SampleZoneGenerator` does not fade for
us — its `noteOff` is a no-op and unlooped content just rings out — so the fade
must be **in the asset**.

**Files:**
- Create: `tools/samplepack/polish.mjs`
- Test: `tools/samplepack/polish.test.mjs`

**Interfaces:**
- Consumes: nothing.
- Produces (consumed by Task 6):
  - `DEFAULT_LOOKBACK: number` (= 64)
  - `trimLeadingSilence(samples: Float32Array, opts?: { threshold?: number, lookback?: number }): Float32Array`
  - `truncateWithFade(samples: Float32Array, maxFrames: number, fadeFrames: number): Float32Array`

- [ ] **Step 1: Write the failing test**

Create `tools/samplepack/polish.test.mjs`:

```js
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
  assert.equal(out[DEFAULT_LOOKBACK], 0.95);
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
  assert.equal(out[10], 0.95);
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test tools/samplepack/polish.test.mjs`
Expected: FAIL — "Cannot find module './polish.mjs'".

- [ ] **Step 3: Write `tools/samplepack/polish.mjs`**

```js
// One-shot polish. Piano is unlooped (see the 3b design), so both artifacts live
// at the ends: strip the pre-attack silence WITHOUT clipping the transient, then
// cap the length and bake a fade-out so the asset ends in true silence.
// SampleZoneGenerator will not fade for us — noteOff is a no-op and unlooped
// content simply rings out — so the fade has to be in the asset.

/** Frames kept BEFORE the first sample that crosses the threshold. A piano
 *  attack has real energy in the few dozen frames leading up to its peak;
 *  trimming flush to the threshold shaves the hammer strike into a click. */
export const DEFAULT_LOOKBACK = 64;

/** Strip leading silence: return a copy starting `lookback` frames before the
 *  first sample whose |amplitude| >= threshold. An all-silent input returns an
 *  empty buffer. */
export function trimLeadingSilence(samples, { threshold = 1e-4, lookback = DEFAULT_LOOKBACK } = {}) {
  let first = -1;
  for (let i = 0; i < samples.length; i++) {
    if (Math.abs(samples[i]) >= threshold) {
      first = i;
      break;
    }
  }
  if (first < 0) return new Float32Array(0);
  return samples.slice(Math.max(0, first - lookback));
}

/** Cap at `maxFrames` and bake a cosine (equal-power) fade-out over the last
 *  `fadeFrames`. The final frame is forced to exactly 0 — cos(pi/2) is 6e-17 in
 *  floating point, not zero, and "almost silent" is still a click. */
export function truncateWithFade(samples, maxFrames, fadeFrames) {
  const n = Math.min(samples.length, maxFrames);
  const out = samples.slice(0, n);
  const fade = Math.min(fadeFrames, n);
  if (fade <= 0) return out;
  for (let i = 0; i < fade; i++) {
    const t = (i + 1) / fade; // (0, 1]
    out[n - fade + i] *= Math.cos((t * Math.PI) / 2);
  }
  out[n - 1] = 0;
  return out;
}
```

- [ ] **Step 4: Run the tests and verify they pass**

Run: `node --test tools/samplepack/*.test.mjs`
Expected: PASS — all new tests plus the whole existing suite.

- [ ] **Step 5: Commit**

```bash
git add tools/samplepack/polish.mjs tools/samplepack/polish.test.mjs
git commit -m "feat(samplepack): add one-shot trim and truncate-with-fade polish"
```

---

### Task 5: Verifier and encoder, adapted for one-shots

Two small changes to 3a's `encode-verify.mjs`, both load-bearing for real content.

**Bitrate.** `encodeAac` hard-codes 192 kbps. The tiny tier is specified at **128
kbps**; at 120 files × 12 s that is the difference between ~23 MB and ~35 MB.

**Probe placement.** `verifyZone` is the pack-integrity gate: it measures the
encoder's alignment delay at an early window and again at a second window, and
rejects the pack if the two disagree (content drifted through the codec).
3a passed `loopStart` as the second window — but a one-shot has no loop, and the
obvious substitute ("some point late in the file") is a trap: a high piano note
truncated at 12 s is near-silence in its last third, and cross-correlating
silence measures noise, not delay. That would fail the pack for no reason.
`pickProbe` picks the **latest window that still carries enough signal to
correlate against**.

**Files:**
- Modify: `tools/samplepack/encode-verify.mjs`
- Test: `tools/samplepack/encode-verify.test.mjs` (extend the existing file)

**Interfaces:**
- Consumes: nothing new.
- Produces (consumed by Task 6):
  - `encodeAac(wavPath: string, m4aPath: string, bitrate = 192000): void` — the default keeps 3a's `build-pack.mjs` byte-for-byte unchanged.
  - `pickProbe(samples: Float32Array, earlyStart: number, winLen = 4096, minRatio = 0.1): number`
  - `verifyZone(original, decoded, probeStart, tolerance = 8)` is **unchanged** — only what Task 6 passes as its third argument changes.

- [ ] **Step 1: Write the failing test**

Append to `tools/samplepack/encode-verify.test.mjs` (add `pickProbe` to the import):

```js
/** An exponentially decaying tone: `tau` frames to fall to 1/e. */
function decayingTone(frames, tau) {
  const s = new Float32Array(frames);
  for (let i = 0; i < frames; i++) {
    s[i] = Math.exp(-i / tau) * Math.sin((2 * Math.PI * 220 * i) / 48000);
  }
  return s;
}

test('pickProbe puts the probe late when the tail still has signal', () => {
  const samples = decayingTone(100000, 200000); // barely decays
  const probe = pickProbe(samples, 10000);
  assert.equal(probe, 80000, 'a healthy tail should be probed at 80% of the buffer');
});

test('pickProbe backs off toward the head when the tail has decayed into noise', () => {
  // tau = 4000: by 30% of the buffer the signal is ~e^-5 of the early window.
  const samples = decayingTone(100000, 4000);
  const probe = pickProbe(samples, 10000);
  assert.ok(probe < 30000, `probe ${probe} landed in near-silence`);
  assert.ok(probe > 10000, 'probe must be a genuinely different window from the early one');
});

test('pickProbe on a steady signal probes the far end', () => {
  const samples = new Float32Array(100000).fill(0.5);
  assert.equal(pickProbe(samples, 10000), 80000);
});

test('encodeAac honors an explicit bitrate', (t) => {
  // 128k must produce a materially smaller file than the 192k default.
  const dir = mkdtempSync(join(tmpdir(), 'alloy-bitrate-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const wav = join(dir, 'tone.wav');
  writeFileSync(wav, writeWavMono(decayingTone(48000 * 4, 1e9), 48000));

  encodeAac(wav, join(dir, 'hi.m4a'));           // default 192000
  encodeAac(wav, join(dir, 'lo.m4a'), 128000);
  const hi = statSync(join(dir, 'hi.m4a')).size;
  const lo = statSync(join(dir, 'lo.m4a')).size;
  assert.ok(lo < hi * 0.85, `128k (${lo} B) should be well under 192k (${hi} B)`);
});
```

Add to the test file's imports whatever is not already there:

```js
import { mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeWavMono } from './wav.mjs';
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test tools/samplepack/encode-verify.test.mjs`
Expected: FAIL — `pickProbe` is not exported, and the bitrate test's two files come out the same size.

- [ ] **Step 3: Add the bitrate parameter**

In `tools/samplepack/encode-verify.mjs`, replace `encodeAac` (lines 12-22) with:

```js
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
```

- [ ] **Step 4: Add `pickProbe`**

Append to `tools/samplepack/encode-verify.mjs`:

```js
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
 *  early one — a weaker but still honest second measurement. */
export function pickProbe(samples, earlyStart, winLen = 4096, minRatio = 0.1) {
  const reference = windowRms(samples, earlyStart, winLen);
  for (let pct = 80; pct >= 30; pct -= 5) {
    const start = Math.floor((samples.length * pct) / 100);
    if (start <= earlyStart || start + winLen > samples.length) continue;
    if (windowRms(samples, start, winLen) >= minRatio * reference) return start;
  }
  return Math.min(earlyStart + winLen, Math.max(0, samples.length - winLen));
}
```

- [ ] **Step 5: Run the tests and verify they pass**

Run: `node --test tools/samplepack/*.test.mjs`
Expected: PASS — including 3a's `build-pack.test.mjs`, which proves the
`encodeAac` default is unchanged.

- [ ] **Step 6: Commit**

```bash
git add tools/samplepack/encode-verify.mjs tools/samplepack/encode-verify.test.mjs
git commit -m "feat(samplepack): parameterize AAC bitrate and probe one-shot tails"
```

---

### Task 6: Build the real piano pack

The orchestrator, and then the actual pack. Every core it uses is already tested;
this task wires them, proves the wiring on a synthetic source tree, and then runs
it for real on the 1.2 GB archive.

**Normalization is per-zone, not global**, and that is deliberate: `voice.ts:100`
applies `velocity^tva.velCurve` to every layer, so loudness comes from the TVA.
If we preserved the sources' natural velocity loudness *as well*, the dynamics
would be applied twice and the patch would be unplayable. Peak-normalizing each
zone to 0.9 (3a's `assembleLayers` default) makes the four velocity layers
contribute **timbre** — a soft strike really is darker — while the TVA
contributes level. That is how a hardware rompler does it, it removes any
loudness jump at a layer boundary, and it hands the encoder a hot signal.
`assembleLayers` therefore needs **no change**.

**Files:**
- Create: `tools/samplepack/build-piano-pack.mjs`
- Test: `tools/samplepack/build-piano-pack.test.mjs`
- Modify: `.gitignore`
- Modify: `tools/samplepack/README.md`

**Interfaces:**
- Consumes: `readWavMono` / `writeWavMono` (Task 1); `selectSources`, `salamanderMembers`, `TOP_VELOCITIES` (Task 3); `trimLeadingSilence`, `truncateWithFade` (Task 4); `encodeAac`, `decodeToWav`, `verifyZone`, `pickProbe` (Task 5); `assembleLayers` (`layer-assembler.mjs`, unchanged); `renderCredits` (`build-pack.mjs`, unchanged).
- Produces: `ingest(srcDir)`, `buildPianoPack(config) → { manifest, packDir, zoneCount }`, `SALAMANDER_CREDITS`, and the CLI (`--print-members` / `<srcDir> <packDir>`). Task 7 consumes the **pack**, not this module.

- [ ] **Step 1: Keep pack artifacts out of the tree — FIRST, before anything writes one**

Append to `.gitignore`:

```gitignore
# sample packs are build artifacts (multi-MB binaries): built, never committed
build/
examples/web-harness/public/packs/
```

Verify: `git check-ignore -v build/piano-tiny examples/web-harness/public/packs`
Expected: both paths reported as ignored.

- [ ] **Step 2: Write the failing test**

Create `tools/samplepack/build-piano-pack.test.mjs`. It builds a **synthetic**
source tree (3 roots × 4 velocities of short decaying tones, each with leading
silence) — the real 1.2 GB archive is far too slow for a unit test, and the point
here is the wiring, not the content.

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readWavMono, writeWavMono } from './wav.mjs';
import { decodeToWav } from './encode-verify.mjs';
import { buildPianoPack, SALAMANDER_CREDITS } from './build-piano-pack.mjs';

const SR = 48000;

/** A decaying tone with 0.05 s of leading silence, written as a 24-bit WAV. */
function writeSource(dir, name, midi, amplitude) {
  const silence = Math.round(0.05 * SR);
  const body = SR; // 1 s
  const s = new Float32Array(silence + body);
  const hz = 440 * 2 ** ((midi - 69) / 12);
  for (let i = 0; i < body; i++) {
    s[silence + i] = amplitude * Math.exp(-i / (SR * 0.4)) * Math.sin((2 * Math.PI * hz * i) / SR);
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
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `node --test tools/samplepack/build-piano-pack.test.mjs`
Expected: FAIL — "Cannot find module './build-piano-pack.mjs'".

- [ ] **Step 4: Write `tools/samplepack/build-piano-pack.mjs`**

```js
// Build the tiny-tier Salamander piano pack: ingest 24-bit sources -> trim ->
// truncate + fade -> peak-normalize -> AAC 128k -> decode-and-verify ->
// manifest.json + CREDITS.md. One-shot throughout: no loop points, so 3a's
// findLoop/bakeCrossfade are deliberately unused here.
//
// Nothing here downloads anything, and the pack it writes is a gitignored build
// artifact — see README.md for how to extract the sources from the archive.

import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { readWavMono, writeWavMono } from './wav.mjs';
import { TOP_VELOCITIES, salamanderMembers, selectSources } from './salamander.mjs';
import { trimLeadingSilence, truncateWithFade } from './polish.mjs';
import { assembleLayers } from './layer-assembler.mjs';
import { decodeToWav, encodeAac, pickProbe, verifyZone } from './encode-verify.mjs';
import { renderCredits } from './build-pack.mjs';

/** CC-BY 3.0 REQUIRES attribution. This is a license obligation, not a nicety:
 *  it ships inside the pack and must name the author, the license, and the
 *  source. */
export const SALAMANDER_CREDITS = [
  {
    source: 'Salamander Grand Piano V3 — recorded by Alexander Holm',
    license: 'CC-BY 3.0',
    url: 'https://freepats.zenvoid.org/Piano/acoustic-grand-piano.html',
  },
];

/** Longest note kept. The budget the tiny tier spends its headroom on. */
export const MAX_SECONDS = 12;
/** Baked fade-out. Long enough that a truncated 12 s decay dies away rather
 *  than being switched off. */
export const FADE_SECONDS = 0.5;
export const BITRATE = 128000;
export const PEAK_TARGET = 0.9;

/** Read every WAV in srcDir, keep the selected roots/velocities, and polish each
 *  into an encode-ready one-shot. */
export function ingest(srcDir) {
  const raw = readdirSync(srcDir)
    .filter((name) => name.endsWith('.wav'))
    .sort()
    .map((name) => {
      const { sampleRate, samples } = readWavMono(readFileSync(join(srcDir, name)));
      return { name, sampleRate, samples };
    });

  return selectSources(raw).map((src) => {
    const maxFrames = Math.round(MAX_SECONDS * src.sampleRate);
    const fadeFrames = Math.round(FADE_SECONDS * src.sampleRate);
    const trimmed = trimLeadingSilence(src.samples);
    return { ...src, samples: truncateWithFade(trimmed, maxFrames, fadeFrames) };
  });
}

export function buildPianoPack(config = {}) {
  const srcDir = config.srcDir ?? 'build/salamander-src';
  const packDir = config.packDir ?? 'build/piano-tiny';
  const tmpDir = join(packDir, '.tmp');
  mkdirSync(packDir, { recursive: true });
  mkdirSync(tmpDir, { recursive: true });

  const sources = ingest(srcDir);
  if (sources.length === 0) throw new Error(`no selectable sources in ${srcDir}`);
  const sampleRate = sources[0].sampleRate;
  for (const src of sources) {
    if (src.sampleRate !== sampleRate) {
      throw new Error(`mixed sample rates: ${src.name} is ${src.sampleRate}, expected ${sampleRate}`);
    }
  }

  for (const src of sources) {
    const wavPath = join(tmpDir, src.name);
    const m4aPath = join(packDir, src.name.replace(/\.wav$/, '.m4a'));
    // 24-bit into the encoder: the manifest's per-zone gain amplifies quiet
    // velocity layers at LOAD time, so 16-bit quantization noise here would be
    // multiplied up in the very layers that need to be cleanest.
    writeFileSync(wavPath, writeWavMono(src.samples, sampleRate, 24));
    encodeAac(wavPath, m4aPath, config.bitrate ?? BITRATE);

    // Pack-integrity gate: encode/decode must not shift the content timeline.
    const decodedPath = join(tmpDir, `dec_${src.name}`);
    decodeToWav(m4aPath, decodedPath);
    const decoded = readWavMono(readFileSync(decodedPath)).samples;
    const earlyStart = Math.floor(src.samples.length * 0.1);
    const result = verifyZone(src.samples, decoded, pickProbe(src.samples, earlyStart));
    if (!result.ok) {
      throw new Error(`content drifted through encode for ${src.name}: ${result.drift} samples`);
    }
  }

  // No `loops` — every zone is a one-shot. assembleLayers peak-normalizes each
  // zone to PEAK_TARGET and records the gain; loudness at playback comes from
  // the TVA's velocity curve, so the four layers carry timbre, not level.
  const zoneSet = assembleLayers(sources, { topVelocities: TOP_VELOCITIES, loops: {}, target: PEAK_TARGET });
  const manifest = {
    schemaVersion: 1,
    id: config.id ?? 'piano-tiny',
    tier: 'tiny',
    sampleRate,
    format: 'm4a',
    zoneSets: { [config.zoneSetId ?? 'piano']: zoneSet },
    credits: SALAMANDER_CREDITS,
  };
  writeFileSync(join(packDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
  writeFileSync(join(packDir, 'CREDITS.md'), renderCredits(SALAMANDER_CREDITS));
  rmSync(tmpDir, { recursive: true, force: true });
  return { manifest, packDir, zoneCount: sources.length };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  if (args[0] === '--print-members') {
    console.log(salamanderMembers().join('\n'));
  } else {
    const [srcDir, packDir] = args;
    const built = buildPianoPack({ srcDir, packDir });
    console.log(`built ${built.zoneCount} zones at ${built.packDir}`);
  }
}
```

- [ ] **Step 5: Run the tests and verify they pass**

Run: `node --test tools/samplepack/*.test.mjs`
Expected: PASS — the four new tests plus the entire existing suite.

- [ ] **Step 6: Extract the 120 source WAVs from the archive**

The archive is xz-compressed, so tar streams the whole 1.2 GB once even for a
selective extract — expect **1–3 minutes**, and use a generous timeout.

```bash
mkdir -p build/salamander-src
node tools/samplepack/build-piano-pack.mjs --print-members > /tmp/salamander/members.txt
wc -l /tmp/salamander/members.txt   # expect 120
tar -xJf /tmp/salamander/salamander-48k24.tar.xz \
    -C build/salamander-src --strip-components=2 -T /tmp/salamander/members.txt
ls build/salamander-src | wc -l     # expect 120
```

If `tar` rejects `-T`, use `xargs`:
`xargs -a /tmp/salamander/members.txt tar -xJf /tmp/salamander/salamander-48k24.tar.xz -C build/salamander-src --strip-components=2`

- [ ] **Step 7: Build the real pack**

```bash
time node tools/samplepack/build-piano-pack.mjs build/salamander-src build/piano-tiny
du -sh build/piano-tiny
ls build/piano-tiny/*.m4a | wc -l
```

Expected: `built 120 zones at build/piano-tiny`; **120** `.m4a` files; total size
in the **~20–30 MB** range (the design's estimate is ~23 MB). If the verifier
throws on any zone, that is a real integrity failure — report it, do not loosen
the tolerance.

- [ ] **Step 8: Prove the tool↔runtime contract closes on real content**

The pack the tool emits must satisfy the runtime's own validator — not a
reimplementation of it.

```bash
npm --prefix web/packages/alloy-audio run build
node --input-type=module -e "
import { readFileSync } from 'node:fs';
const { validateManifest } = await import('./web/packages/alloy-audio/dist/pack/manifest.js');
const manifest = JSON.parse(readFileSync('build/piano-tiny/manifest.json', 'utf8'));
const errors = validateManifest(manifest);
if (errors.length) { console.error('INVALID:', errors); process.exit(1); }
const layers = manifest.zoneSets.piano.layers;
console.log('manifest OK —', layers.length, 'layers,',
            layers.reduce((n, l) => n + l.zones.length, 0), 'zones,',
            'roots', layers[0].zones[0].rootMidi, '..', layers[0].zones.at(-1).rootMidi);
"
```

Expected: `manifest OK — 4 layers, 120 zones, roots 21 .. 108`.

- [ ] **Step 9: Document the pipeline**

Add a section to `tools/samplepack/README.md` covering: where the archive comes
from, the `--print-members` + `tar` extraction, the build command, that the
output is gitignored and never committed, that piano is one-shot (so `loop-finder`
is unused for this pack), and that `VELOCITY_INDICES` in `salamander.mjs` is the
knob for re-rolling the velocity selection. Match the file's existing tone and
heading style.

- [ ] **Step 10: Commit (source and docs only — NEVER the pack)**

```bash
git status --short   # build/ must not appear
git add tools/samplepack/build-piano-pack.mjs tools/samplepack/build-piano-pack.test.mjs \
        tools/samplepack/README.md .gitignore
git commit -m "feat(samplepack): build the Salamander tiny-tier piano pack"
```

---

### Task 7: Piano patch + workbench audition

The pack exists; now it has to be playable. The workbench already has the whole
wire path — `WorkletSynthHost.setZoneSet(id, layers)` transfers zone buffers to
the AudioWorklet, and the `glass` catalog entry already proves a `sample`-kind
patch works. This task adds a real pack behind it.

The pack is served from Angular's `public/` folder (already an asset input in
`angular.json`), so no build config changes and no symlinks: build the pack into
`examples/web-harness/public/packs/piano-tiny` and fetch it from
`/packs/piano-tiny`. That path is gitignored (Task 6, Step 1).

**Deliberate deviation from the design spec:** the spec called for "a TVA decay
matched to the truncation." That is now wrong — Task 4 bakes a fade-out **into
the asset**, so a TVA decay would attenuate a second time. The sample carries the
piano's decay; the TVA's job is only the key-up damper (`release`). The patch
below therefore uses `sustain: 1` with a short release.

**Files:**
- Modify: `examples/web-harness/src/app/sections/rompler-section.component.ts`

**Interfaces:**
- Consumes: `PackLoader`, `BasePathPackSource`, `WebAudioDecoder`, `MinimalDecodeContext` (all already exported from `@allyworld/alloy-audio` via `src/index.ts:35-37`); `WorkletSynthHost.setZoneSet(id: string, layers: WireZoneLayer[])`.
- Produces: nothing downstream — this is the audition surface.

- [ ] **Step 1: Put the pack where the harness can serve it**

```bash
mkdir -p examples/web-harness/public/packs
node tools/samplepack/build-piano-pack.mjs build/salamander-src examples/web-harness/public/packs/piano-tiny
du -sh examples/web-harness/public/packs/piano-tiny
git status --short   # must show NOTHING under examples/web-harness/public/packs
```

- [ ] **Step 2: Add the pack constants and the wire adapter**

In `examples/web-harness/src/app/sections/rompler-section.component.ts`, near the
existing `GLASS_ZONE_SET_ID` / `bakeGlassZoneLayers()` block, add:

```ts
// ---------------------------------------------------------------------------
// The real Salamander tiny-tier pack. Built by
// `node tools/samplepack/build-piano-pack.mjs <src> examples/web-harness/public/packs/piano-tiny`
// and served out of Angular's public/ asset folder. It is a gitignored build
// artifact — if it is missing, the piano patch simply stays silent (the engine
// treats an unresolvable zoneSetId as "layer not loaded yet", which is the same
// progressive-delivery path a slow network takes).
// ---------------------------------------------------------------------------
const PIANO_ZONE_SET_ID = 'piano';
const PIANO_PACK_BASE = '/packs/piano-tiny';

/** SampleZoneData (loader) -> WireZone (worklet message port). Same fields,
 *  different names: `data` crosses the port as `samples`. */
function toWireLayers(layers: readonly VelocityLayerData[]): WireZoneLayer[] {
  return layers.map((layer) => ({
    topVelocity: layer.topVelocity,
    zones: layer.zones.map((zone) => ({
      rootMidi: zone.rootMidi,
      sampleRate: zone.sampleRate,
      samples: zone.data,
      ...(zone.loopStart !== undefined ? { loopStart: zone.loopStart } : {}),
      ...(zone.loopEnd !== undefined ? { loopEnd: zone.loopEnd } : {}),
    })),
  }));
}
```

Extend the existing `@allyworld/alloy-audio` import with `BasePathPackSource`,
`MinimalDecodeContext`, `PackLoader`, `VelocityLayerData`, and `WebAudioDecoder`.
If `VelocityLayerData` or `SampleZoneData` is not re-exported from the package
index, add `export * from './dsp/sample-zone-generator.js';` to
`web/packages/alloy-audio/src/index.ts` — an additive export, no behavior change.

- [ ] **Step 3: Add the piano patch to the catalog**

Append a `CatalogEntry` to `PATCH_CATALOG` (match the surrounding entries' shape
exactly):

```ts
  {
    label: 'Piano',
    patch: {
      schemaVersion: PATCH_SCHEMA_VERSION,
      meta: { id: 'salamander-piano', name: 'Salamander Piano', category: 'melodic', gmProgram: 0 },
      layers: [
        {
          keyRange: { lowMidi: 21, highMidi: 108 },
          velRange: { low: 0, high: 1 },
          // The four velocity layers live INSIDE the zone set, not in patch
          // layers; SampleZoneGenerator picks and crossfades them. 0.1 blends
          // +-0.05 around each of the 0.25/0.5/0.75 boundaries.
          generator: { kind: 'sample', zoneSetId: PIANO_ZONE_SET_ID, crossfade: 0.1 },
          // Gentle velocity -> brightness ON TOP of the sampled layers (which
          // already carry most of the timbral change). First thing to dial to
          // taste — including to zero.
          tvf: { mode: 'lowpass', cutoffHz: 6000, q: 0.7, envAmountHz: 0, keyTrack: 0.3, velAmountHz: 6000 },
          // The SAMPLE carries the piano's decay (and its baked fade-out), so
          // the TVA holds at sustain 1 and only supplies the key-up damper.
          // velCurve is the TOTAL velocity exponent (voice.ts:39-41); ~1.8
          // gives a piano-like ~35 dB dynamic span.
          tva: { level: 1, adsr: { attack: 0.001, decay: 0.1, sustain: 1, release: 0.25 }, velCurve: 1.8 },
        },
      ],
      sends: { reverb: 0.18, delay: 0 },
    },
  },
```

- [ ] **Step 4: Load the pack when the host comes up**

Add a status signal beside the existing signals in `RomplerSectionComponent`:

```ts
  readonly packStatus = signal<'idle' | 'loading' | 'ready' | 'error'>('idle');
```

Add the loader method:

```ts
  /** Fetch + decode the piano pack on the main thread, then transfer its zone
   *  buffers to the worklet. Until this resolves the piano patch is silent —
   *  the engine's progressive-delivery path, not an error. */
  private async loadPianoPack(ctx: AudioContext, host: WorkletSynthHost): Promise<void> {
    this.packStatus.set('loading');
    try {
      const loader = new PackLoader(
        new BasePathPackSource(PIANO_PACK_BASE, (url) => fetch(url)),
        new WebAudioDecoder(ctx as unknown as MinimalDecodeContext),
      );
      await loader.load();
      const layers = loader.provide(PIANO_ZONE_SET_ID);
      if (layers === null) throw new Error(`pack has no zone set "${PIANO_ZONE_SET_ID}"`);
      host.setZoneSet(PIANO_ZONE_SET_ID, toWireLayers(layers));
      this.packStatus.set('ready');
    } catch (err) {
      this.packStatus.set('error');
      this.errorDetail.set(`piano pack: ${String(err)}`);
    }
  }
```

In `createHost()`, right after the existing
`host.setZoneSet(GLASS_ZONE_SET_ID, bakeGlassZoneLayers());`, kick the load off
**without awaiting it** — the other five patches must stay playable while ~23 MB
decodes:

```ts
      void this.loadPianoPack(rawCtx, host);
```

(Use whatever local variable `createHost` already holds the raw `AudioContext` in;
it assigns `this.rawCtx`.)

- [ ] **Step 5: Surface the status in the template**

Add one line to the component's template, next to the existing error display:

```html
    @if (packStatus() !== 'idle' && packStatus() !== 'ready') {
      <p class="hint">Piano pack: {{ packStatus() }}</p>
    }
```

Match the surrounding template's existing class names and control-flow style.

- [ ] **Step 6: Typecheck and run the web suite**

```bash
cd web && npm test
cd ../examples/web-harness && npx ng build
```

Expected: web tests PASS (unchanged — this task adds no library logic), and the
harness builds clean.

- [ ] **Step 7: Audition — the actual point of the phase**

Start the harness on a **free port** (4205 belongs to the human dev; if something
is already serving there, do not touch it):

```bash
cd examples/web-harness && npx ng serve --port 4210
```

Open `http://localhost:4210`, select the **Piano** patch, wait for the pack
status to reach `ready`, and check:

1. Notes sound. Low, middle, and high registers all speak.
2. **No click at the note tail** — hold a note through its full decay. This is
   what the baked fade buys.
3. **No click at the attack** — the strike is a hammer, not a pop. This is what
   the trim's lookback buys.
4. **No clipping** — hammer a fistful of low notes at full velocity; the master
   limiter should be catching peaks, not the output crackling.
5. Soft strikes are darker than hard ones, and there is no audible **level jump**
   at a velocity-layer boundary (sweep velocity slowly across 0.25 / 0.5 / 0.75).
6. Report the peak JS heap from DevTools' Memory panel after the pack loads. The
   expected number is **~276 MB** of decoded PCM (120 × 12 s × 48 kHz × 4 B). It
   is a real cost of this pack shape and the user needs to know it.

Report what you actually hear, including anything that sounds wrong. **A green
test suite is not success here** — this is the checkpoint where the user's ear is
the gate.

- [ ] **Step 8: Commit**

```bash
git status --short   # examples/web-harness/public/packs must NOT appear
git add examples/web-harness/src/app/sections/rompler-section.component.ts
git add web/packages/alloy-audio/src/index.ts   # only if Step 2 needed the export
git commit -m "feat(harness): load the Salamander piano pack and add the piano patch"
```

---

## After the plan

The pack now exists and plays. What remains is **tuning by ear**, which no
reviewer can do:

- `VELOCITY_INDICES` in `salamander.mjs` — are v4/v8/v12/v16 the right four of
  the sixteen? Change the constant, rebuild, listen.
- `MAX_SECONDS` / `FADE_SECONDS` — is 12 s enough decay? Is the fade audible?
- The patch's `tvf` — the velocity→brightness filter may be redundant on top of
  four real velocity layers. Dialing `velAmountHz` to 0 (or dropping `tvf`
  entirely) is a legitimate outcome.
- `tva.velCurve` — the dynamic span from pp to ff.
- `sends.reverb` — the mono dry piano's only source of stereo width.
- The ~276 MB decoded footprint, if it proves to be too much.

Each of those is a constant-and-rebuild loop, which is exactly why they were made
constants.
