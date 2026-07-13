import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { writeWavMono } from './wav.mjs';

const DEFAULT_CONFIG = {
  sampleRate: 48000,
  roots: [36, 48, 60, 72], // C2..C5
  velocities: [0.4, 0.9], // two layers: soft, hard (topVelocity bands 0.6, 1.0)
  durationSec: 1.5,
};

function midiToHz(m) {
  return 440 * 2 ** ((m - 69) / 12);
}

/** Deterministic decaying-harmonic tone with a short attack and a long steady
 *  sustain (so the loop finder has a clean periodic region). No randomness. */
function renderTone(rootMidi, velocity, sampleRate, durationSec) {
  const n = Math.round(sampleRate * durationSec);
  const freq = midiToHz(rootMidi);
  const out = new Float32Array(n);
  const attack = Math.round(sampleRate * 0.01);
  for (let i = 0; i < n; i++) {
    const t = i / sampleRate;
    let s = 0;
    for (let h = 1; h <= 5; h++) s += (1 / h) * Math.sin(2 * Math.PI * freq * h * t);
    const env = i < attack ? i / attack : 1; // attack then flat sustain (steady loop region)
    out[i] = 0.2 * env * (0.4 + 0.6 * velocity) * s;
  }
  return out;
}

export function genTestPack(config = DEFAULT_CONFIG) {
  const { sampleRate, roots, velocities, durationSec } = config;
  const sources = [];
  for (const root of roots) {
    velocities.forEach((vel, vi) => {
      sources.push({
        name: `zone_${root}_v${vi}.wav`,
        rootMidi: root,
        velocity: vel,
        layerIndex: vi,
        sampleRate,
        samples: renderTone(root, vel, sampleRate, durationSec),
      });
    });
  }
  const credits = [{ source: 'Alloy generated test pack (procedural harmonics)', license: 'CC0' }];
  return { sources, credits, sampleRate, velocities };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const outDir = process.argv[2] ?? 'build/test-pack-src';
  mkdirSync(outDir, { recursive: true });
  const pack = genTestPack();
  const index = pack.sources.map(({ samples, ...meta }) => meta);
  for (const src of pack.sources) writeFileSync(join(outDir, src.name), writeWavMono(src.samples, src.sampleRate));
  writeFileSync(join(outDir, 'sources.json'), JSON.stringify({ ...pack, sources: index }, null, 2));
  console.log(`wrote ${pack.sources.length} source WAVs + sources.json to ${outDir}`);
}
