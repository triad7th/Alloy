// Golden patch-render twin tests: the flagship cross-platform guarantee.
// Four patches (one per generator kind) rendered through the full engine
// with an identical event script; each is checked for determinism,
// non-silence during the sustain window, tail silence after every voice's
// release ends, and byte-for-byte-equivalent (within tolerance) output
// against the Swift twin at three probe windows. Twin: GoldenRenderTests.swift.

import { describe, expect, it } from 'vitest';
import { renderPatch } from './patch-engine.js';
import {
  GOLDEN_EVENTS,
  GOLDEN_FRAMES,
  GOLDEN_FS,
  PATCH_FM,
  PATCH_VA,
  PATCH_ORGAN,
  PATCH_SAMPLE,
  goldenZoneSetProvider,
} from './testing/golden-patches.js';
import type { Patch } from './patch.js';
import type { ZoneSetProvider } from './voice.js';

function rms(samples: ArrayLike<number>, from: number, to: number): number {
  let sum = 0;
  for (let i = from; i < to; i++) {
    sum += samples[i] * samples[i];
  }
  return Math.sqrt(sum / (to - from));
}

function probe(samples: ArrayLike<number>, start: number, length = 8): number[] {
  return Array.from({ length }, (_, i) => samples[start + i]);
}

const TWIN_FM_AT_0: number[] = [
  0, 0.00006746291182935238, 0.0003615731548052281, 0.0009718443034216762, 0.0017700649332255125,
  0.0023916626814752817, 0.002249075099825859, 0.0007100654183886945,
];
const TWIN_FM_AT_12000: number[] = [
  0.11054803431034088, 0.17245441675186157, 0.2001546025276184, 0.1871742457151413,
  0.13872912526130676, 0.07269862294197083, 0.023765740916132927, 0.01684357039630413,
];
const TWIN_FM_AT_30000: number[] = [
  -0.0005669677630066872, -0.00021138858573976904, 0.00014202739112079144, 0.0004905309760943055,
  0.0008330991840921342, 0.0011703576892614365, 0.0015036676777526736, 0.001833861111663282,
];

const TWIN_VA_AT_0: number[] = [
  -0.00000528768669028068, -0.00011583104060264304, -0.0006340973195619881, -0.001822814461775124,
  -0.0037135493475943804, -0.006206805817782879, -0.009122508578002453, -0.012244155630469322,
];
const TWIN_VA_AT_12000: number[] = [
  -0.3694263994693756, -0.3372212052345276, -0.30703914165496826, -0.2798972725868225,
  -0.25608959794044495, -0.2354125678539276, -0.2173682451248169, -0.20132917165756226,
];
const TWIN_VA_AT_30000: number[] = [
  0.0005263532511889935, 0.0005169602809473872, 0.0005355137982405722, 0.0005767068360000849,
  0.0006321268738247454, 0.00066895637428388, 0.0006399331614375114, 0.0005355597822926939,
];

const TWIN_ORGAN_AT_0: number[] = [
  0, 0.0010849360842257738, 0.003230514470487833, 0.006402547005563974, 0.01055749598890543,
  0.015643175691366196, 0.021599583327770233, 0.02835986763238907,
];
const TWIN_ORGAN_AT_12000: number[] = [
  -0.03137022629380226, -0.016154028475284576, -0.0013940362259745598, 0.012484954670071602,
  0.025078928098082542, 0.036016833037137985, 0.04497161880135536, 0.051669541746377945,
];
const TWIN_ORGAN_AT_30000: number[] = [
  -0.000032754018320702016, 0.000045224074710858986, 0.00012247786798980087, 0.0001981708046514541,
  0.0002715051523409784, 0.00034174195025116205, 0.0004082187369931489, 0.0004703648737631738,
];

const TWIN_SAMPLE_AT_0: number[] = [
  0, 0.0012398377293720841, 0.003989039454609156, 0.007852182723581791, 0.012874904088675976,
  0.018994592130184174, 0.02614615671336651, 0.03426505997776985,
];
const TWIN_SAMPLE_AT_12000: number[] = [
  0.24263130128383636, 0.24333973228931427, 0.24375347793102264, 0.24384763836860657,
  0.24360333383083344, 0.2430049031972885, 0.24202658236026764, 0.24065963923931122,
];
const TWIN_SAMPLE_AT_30000: number[] = [
  -0.0013253232464194298, -0.0006364962318912148, 0.000051807881391141564, 0.0007370639941655099,
  0.0014171609655022621, 0.0020897265058010817, 0.002752428175881505, 0.003403137670829892,
];

interface GoldenCase {
  name: string;
  patch: Patch;
  provider?: ZoneSetProvider;
  at0: number[];
  at12000: number[];
  at30000: number[];
}

const CASES: GoldenCase[] = [
  { name: 'fm', patch: PATCH_FM, at0: TWIN_FM_AT_0, at12000: TWIN_FM_AT_12000, at30000: TWIN_FM_AT_30000 },
  { name: 'va', patch: PATCH_VA, at0: TWIN_VA_AT_0, at12000: TWIN_VA_AT_12000, at30000: TWIN_VA_AT_30000 },
  {
    name: 'organ',
    patch: PATCH_ORGAN,
    at0: TWIN_ORGAN_AT_0,
    at12000: TWIN_ORGAN_AT_12000,
    at30000: TWIN_ORGAN_AT_30000,
  },
  {
    name: 'sample',
    patch: PATCH_SAMPLE,
    provider: goldenZoneSetProvider,
    at0: TWIN_SAMPLE_AT_0,
    at12000: TWIN_SAMPLE_AT_12000,
    at30000: TWIN_SAMPLE_AT_30000,
  },
];

describe('golden patch renders', () => {
  for (const { name, patch, provider, at0, at12000, at30000 } of CASES) {
    describe(name, () => {
      // NOTE: mono-era assertions run against the left channel — no golden
      // patch carries inserts yet, so L === R === the old mono output and
      // every twin array below stays valid verbatim. Task 4 re-baselines
      // these goldens as true stereo (FM/ORGAN gain inserts there).
      it('renders deterministically across repeat calls', () => {
        const a = renderPatch(patch, GOLDEN_EVENTS, GOLDEN_FRAMES, GOLDEN_FS, provider).left;
        const b = renderPatch(patch, GOLDEN_EVENTS, GOLDEN_FRAMES, GOLDEN_FS, provider).left;
        expect(a.length).toBe(GOLDEN_FRAMES);
        for (let i = 0; i < GOLDEN_FRAMES; i++) {
          expect(b[i]).toBe(a[i]);
        }
      });

      it('is non-silent during the sustain window and silent after the release tail', () => {
        const out = renderPatch(patch, GOLDEN_EVENTS, GOLDEN_FRAMES, GOLDEN_FS, provider).left;
        expect(rms(out, 6000, 12000)).toBeGreaterThan(0.01);
        expect(rms(out, GOLDEN_FRAMES - 1000, GOLDEN_FRAMES)).toBeLessThan(0.01);
      });

      it('matches the twin reference at three probe windows', () => {
        const out = renderPatch(patch, GOLDEN_EVENTS, GOLDEN_FRAMES, GOLDEN_FS, provider).left;
        expect(at0).toHaveLength(8);
        expect(at12000).toHaveLength(8);
        expect(at30000).toHaveLength(8);
        probe(out, 0).forEach((v, i) => expect(v).toBeCloseTo(at0[i], 4));
        probe(out, 12000).forEach((v, i) => expect(v).toBeCloseTo(at12000[i], 4));
        probe(out, 30000).forEach((v, i) => expect(v).toBeCloseTo(at30000[i], 4));
      });
    });
  }
});
