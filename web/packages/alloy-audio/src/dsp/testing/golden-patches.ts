// Golden patch-render fixtures: one full Patch per generator kind, a shared
// event script, and a baked sine sample-zone set. Consumed by
// golden-render.spec.ts (the flagship cross-platform render guarantee) and
// available for future workbench/harness tooling. Not exported from the
// public index — test-only. Twin: swift/Tests/AlloyAudioTests/GoldenPatchFixtures.swift.

import { PATCH_SCHEMA_VERSION, type Patch } from '../patch.js';
import { TWO_PI } from '../dsp-types.js';
import type { EngineEvent } from '../patch-engine.js';
import type { VelocityLayerData } from '../sample-zone-generator.js';
import type { ZoneSetProvider } from '../voice.js';

const FULL_KEY = { lowMidi: 0, highMidi: 127 };
const FULL_VEL = { low: 0, high: 1 };

export const GOLDEN_EVENTS: EngineEvent[] = [
  { frame: 0, kind: 'noteOn', midi: 60, velocity: 0.8 },
  { frame: 6000, kind: 'noteOn', midi: 67, velocity: 0.6 },
  { frame: 12000, kind: 'noteOff', midi: 60 },
  { frame: 18000, kind: 'noteOff', midi: 67 },
];

// Last release (0.3 s after noteOff@18000) ends ≈ frame 32 400.
export const GOLDEN_FRAMES = 36_000;
export const GOLDEN_FS = 48_000;

/** Single fm layer: the Task 2 fixture's FM layer promoted to full key/vel range. */
export const PATCH_FM: Patch = {
  schemaVersion: PATCH_SCHEMA_VERSION,
  meta: { id: 'golden.fm', name: 'Golden FM', category: 'melodic' },
  layers: [
    {
      keyRange: FULL_KEY,
      velRange: FULL_VEL,
      generator: {
        kind: 'fm',
        fm: {
          operators: [
            { ratio: 1, level: 1, adsr: { attack: 0.002, decay: 0.6, sustain: 0, release: 0.3 } },
            { ratio: 14, level: 0.4, adsr: { attack: 0.001, decay: 0.08, sustain: 0, release: 0.05 } },
          ],
          algorithm: { routes: [{ from: 1, to: 0 }], carriers: [0] },
        },
      },
      tva: { level: 0.5, adsr: { attack: 0.002, decay: 0.5, sustain: 0.4, release: 0.15 }, velCurve: 1.5 },
    },
  ],
  sends: { reverb: 0, delay: 0 },
};

/** Single va layer + tvf + mod: the Task 2 fixture's VA layer (already full range). */
export const PATCH_VA: Patch = {
  schemaVersion: PATCH_SCHEMA_VERSION,
  meta: { id: 'golden.va', name: 'Golden VA', category: 'melodic' },
  layers: [
    {
      keyRange: FULL_KEY,
      velRange: FULL_VEL,
      generator: { kind: 'va', va: { shape: 'saw', unison: 3, detuneCents: 18, pulseWidth: 0.5 }, seed: 7 },
      tvf: {
        mode: 'lowpass',
        cutoffHz: 900,
        q: 0.9,
        envAmountHz: 2200,
        env: { attack: 0.004, decay: 0.18, sustain: 0.25, release: 0.2 },
        keyTrack: 0.5,
        velAmountHz: 1200,
      },
      // Faster release than the Task 2 fixture's 0.25 s: the golden event
      // script needs every layer's release tail to be inaudible by
      // GOLDEN_FRAMES (36 000), and a 0.25 s time constant does not decay
      // far enough in the ~0.35 s available after the last noteOff@18000.
      tva: { level: 0.8, adsr: { attack: 0.005, decay: 0.3, sustain: 0.7, release: 0.05 }, velCurve: 2 },
      mod: { lfo: { shape: 'sine', rateHz: 5.5, delay: 0.3, fadeIn: 0.4 }, toPitchCents: 8, toCutoffHz: 0, toAmpDepth: 0 },
    },
  ],
  sends: { reverb: 0, delay: 0 },
};

/** Single additive layer (drawbar-organ partial bank) + amplitude-tremolo mod. */
export const PATCH_ORGAN: Patch = {
  schemaVersion: PATCH_SCHEMA_VERSION,
  meta: { id: 'golden.organ', name: 'Golden Organ', category: 'melodic' },
  layers: [
    {
      keyRange: FULL_KEY,
      velRange: FULL_VEL,
      generator: {
        kind: 'additive',
        partials: [
          { ratio: 0.5, level: 0.7 },
          { ratio: 1, level: 1 },
          { ratio: 1.5, level: 0.35 },
          { ratio: 2, level: 0.25 },
          { ratio: 3, level: 0.12 },
          { ratio: 4, level: 0.08 },
        ],
      },
      tva: { level: 0.6, adsr: { attack: 0.003, decay: 0.05, sustain: 1, release: 0.04 }, velCurve: 1 },
      mod: { lfo: { shape: 'sine', rateHz: 6.8, delay: 0, fadeIn: 0.1 }, toPitchCents: 0, toCutoffHz: 0, toAmpDepth: 0.35 },
    },
  ],
  sends: { reverb: 0, delay: 0 },
};

/** Single sample layer over the baked golden.sine zone set. */
export const PATCH_SAMPLE: Patch = {
  schemaVersion: PATCH_SCHEMA_VERSION,
  meta: { id: 'golden.sample', name: 'Golden Sample', category: 'melodic' },
  layers: [
    {
      keyRange: FULL_KEY,
      velRange: FULL_VEL,
      generator: { kind: 'sample', zoneSetId: 'golden.sine', crossfade: 0.2 },
      tva: { level: 0.8, adsr: { attack: 0.001, decay: 0.2, sustain: 0.8, release: 0.1 }, velCurve: 2 },
    },
  ],
  sends: { reverb: 0, delay: 0 },
};

const GOLDEN_ZONE_LENGTH = 48_000;
const goldenSineData = new Float32Array(GOLDEN_ZONE_LENGTH);
for (let i = 0; i < GOLDEN_ZONE_LENGTH; i++) {
  goldenSineData[i] = Math.sin((TWO_PI * 440 * i) / GOLDEN_ZONE_LENGTH);
}

/** 'golden.sine': one velocity layer, one zone, a baked 440 Hz sine (deterministic, no assets). */
export const GOLDEN_ZONES: VelocityLayerData[] = [
  {
    topVelocity: 1,
    zones: [
      {
        rootMidi: 69,
        sampleRate: GOLDEN_FS,
        data: goldenSineData,
        loopStart: 0,
        loopEnd: GOLDEN_ZONE_LENGTH,
      },
    ],
  },
];

/** Resolves 'golden.sine' to GOLDEN_ZONES; everything else is unresolved. */
export const goldenZoneSetProvider: ZoneSetProvider = (zoneSetId) =>
  zoneSetId === 'golden.sine' ? GOLDEN_ZONES : null;
