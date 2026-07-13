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
