import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { writeWavMono, readWavMono } from './wav.mjs';
import { genTestPack } from './gen-test-pack.mjs';
import { findLoop, bakeCrossfade, extendLoop } from './loop-finder.mjs';
import { assembleLayers } from './layer-assembler.mjs';
import { encodeAac, decodeToWav, verifyZone } from './encode-verify.mjs';

export function renderCredits(credits) {
  const rows = credits.map((c) => `- **${c.source}** — ${c.license}${c.url ? ` (${c.url})` : ''}`);
  return `# Credits\n\n${rows.join('\n')}\n`;
}

const FADE = 512;
/** Minimum loop length in samples (~85 ms at 48k). findLoop returns a single
 *  fundamental period — 367 samples for C3, i.e. 7.6 ms — which is both
 *  musically unusable (buzzy) and too short to fit the 512-sample crossfade.
 *  extendLoop grows it to an integer multiple of that period (preserving
 *  phase alignment, so the loop stays seamless) of at least this length. */
const MIN_LOOP = 4096;

/** Build a full pack from the generated test sources into packDir. Finds a
 *  loop per source, extends it to a musical integer-period length,
 *  crossfade-bakes it, encodes to .m4a, verifies loop drift, and emits
 *  manifest.json + CREDITS.md. Throws if any zone fails verification. */
export function buildPack(config = {}) {
  const packDir = config.packDir ?? 'build/piano-tiny';
  const zoneSetId = config.zoneSetId ?? 'piano';
  const tmpDir = config.tmpDir ?? join(packDir, '.tmp');
  mkdirSync(packDir, { recursive: true });
  mkdirSync(tmpDir, { recursive: true });

  const pack = genTestPack(config.gen);
  const loops = {};
  for (const src of pack.sources) {
    const found = findLoop(src.samples, src.sampleRate);
    const loopStart = found.loopStart;
    const loopEnd = extendLoop(loopStart, found.loopEnd, MIN_LOOP, src.samples.length);
    // Defensive: never ask for a fade longer than the loop or the pre-roll.
    const fade = Math.min(FADE, loopEnd - loopStart, loopStart);
    const baked = bakeCrossfade(src.samples, loopStart, loopEnd, fade);
    const wavPath = join(tmpDir, src.name);
    const m4aName = src.name.replace(/\.wav$/, '.m4a');
    const m4aPath = join(packDir, m4aName);
    writeFileSync(wavPath, writeWavMono(baked, src.sampleRate));
    encodeAac(wavPath, m4aPath);
    const decWav = join(tmpDir, `dec_${src.name}`);
    decodeToWav(m4aPath, decWav);
    const decoded = readWavMono(readFileSync(decWav)).samples;
    const v = verifyZone(baked, decoded, loopStart);
    if (!v.ok) throw new Error(`loop drift too large for ${src.name}: ${v.drift} samples`);
    loops[src.name] = { loopStart, loopEnd };
  }

  const topVelocities = pack.velocities.map((_, i) => (i + 1) / pack.velocities.length);
  const zoneSet = assembleLayers(pack.sources, { topVelocities, loops });
  const manifest = {
    schemaVersion: 1,
    id: config.id ?? 'piano-tiny',
    tier: 'tiny',
    sampleRate: pack.sampleRate,
    format: 'm4a',
    zoneSets: { [zoneSetId]: zoneSet },
    credits: pack.credits,
  };
  writeFileSync(join(packDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
  writeFileSync(join(packDir, 'CREDITS.md'), renderCredits(pack.credits));
  return { manifest, packDir };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { packDir } = buildPack({ packDir: process.argv[2] });
  console.log(`built pack at ${packDir}`);
}
