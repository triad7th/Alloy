// Golden patch-render twin tests: the flagship cross-platform guarantee.
// Four patches (one per generator kind) rendered through the full engine
// with an identical event script; each is checked for determinism (both
// channels), non-silence during the sustain window (left channel), tail
// silence after every voice's release ends (both channels), and
// byte-for-byte-equivalent (within tolerance) output against the Swift twin
// at three probe windows, per channel. PATCH_FM and PATCH_ORGAN carry an
// insert (chorus / tremolo respectively), so their L and R differ; PATCH_VA
// and PATCH_SAMPLE stay insert-free, so L === R exactly and the same probe
// arrays apply to both channels. Twin: GoldenRenderTests.swift.

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

const TWIN_FM_L_AT_0: number[] = [
  0, 0.00004385089414427057, 0.00023502255498897284, 0.0006316988146863878, 0.0011505421716719866,
  0.0015545807546004653, 0.001461898791603744, 0.0004615425132215023,
];
const TWIN_FM_R_AT_0: number[] = [
  0, 0.00004385089414427057, 0.00023502255498897284, 0.0006316988146863878, 0.0011505421716719866,
  0.0015545807546004653, 0.001461898791603744, 0.0004615425132215023,
];
const TWIN_FM_L_AT_12000: number[] = [
  0.09767042100429535, 0.1319395899772644, 0.14433124661445618, 0.1342770755290985,
  0.10536986589431763, 0.06848285347223282, 0.044441405683755875, 0.043092530220746994,
];
const TWIN_FM_R_AT_12000: number[] = [
  0.06892663240432739, 0.1115599200129509, 0.14111073315143585, 0.14879755675792694,
  0.13041824102401733, 0.09379544109106064, 0.06045583263039589, 0.045510582625865936,
];
const TWIN_FM_L_AT_30000: number[] = [
  -0.0002945534943137318, 0.00003405138704692945, 0.0003620763018261641, 0.0006869593635201454,
  0.0010074613383039832, 0.001323775970377028, 0.001636893255636096, 0.0019475476583465934,
];
const TWIN_FM_R_AT_30000: number[] = [
  -0.0006600169581361115, -0.0003977482265327126, -0.00013420407776720822, 0.00012850291386712343,
  0.00038940913509577513, 0.00064875278621912, 0.0009073815308511257, 0.0011658334406092763,
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

const TWIN_ORGAN_L_AT_0: number[] = [
  0, 0.0008677557343617082, 0.0025832613464444876, 0.005118618253618479, 0.008438479155302048,
  0.01250061672180891, 0.017256595194339752, 0.022652553394436836,
];
const TWIN_ORGAN_R_AT_0: number[] = [
  0, 0.0007405632641166449, 0.00220557302236557, 0.004372142255306244, 0.007210978772491217,
  0.010686858557164669, 0.014759184792637825, 0.019382648169994354,
];
const TWIN_ORGAN_L_AT_12000: number[] = [
  -0.031063152477145195, -0.015996789559721947, -0.0013805433409288526, 0.012364795431494713,
  0.024838926270604134, 0.035674113780260086, 0.04454612731933594, 0.05118346959352493,
];
const TWIN_ORGAN_R_AT_12000: number[] = [
  -0.021408390253782272, -0.011021876707673073, -0.0009509489173069596, 0.008514880202710629,
  0.017100509256124496, 0.024553539231419563, 0.030651777982711792, 0.0352095402777195,
];
const TWIN_ORGAN_L_AT_30000: number[] = [
  -0.00001965241062862333, 0.00002713444882829208, 0.00007348675717366859, 0.00011890262248925865,
  0.00016290343774016947, 0.00020504584244918078, 0.00024493239470757544, 0.0002822207461576909,
];
const TWIN_ORGAN_R_AT_30000: number[] = [
  -0.00003150292468490079, 0.000043501397158252075, 0.00011782522778958082, 0.00019066344248130918,
  0.00026124794385395944, 0.00032886682311072946, 0.000392881513107568, 0.00045274157309904695,
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

interface ChannelProbes {
  at0: number[];
  at12000: number[];
  at30000: number[];
}

interface GoldenCase {
  name: string;
  patch: Patch;
  provider?: ZoneSetProvider;
  left: ChannelProbes;
  right: ChannelProbes;
  /** Mirrors GoldenRenderTests.swift's explicit `insertFree` parameter: an
   * intentional, tamper-evident declaration (not inferred from whether left
   * and right happen to be the same object reference) of whether this patch
   * carries no insert chain, and therefore must render bit-exact L === R. */
  insertFree: boolean;
}

// PATCH_VA and PATCH_SAMPLE stay insert-free, so L === R === the old mono
// output and the same probe arrays apply to both channels verbatim (not
// re-captured — see golden-patches.ts).
const VA_PROBES: ChannelProbes = { at0: TWIN_VA_AT_0, at12000: TWIN_VA_AT_12000, at30000: TWIN_VA_AT_30000 };
const SAMPLE_PROBES: ChannelProbes = {
  at0: TWIN_SAMPLE_AT_0,
  at12000: TWIN_SAMPLE_AT_12000,
  at30000: TWIN_SAMPLE_AT_30000,
};

const CASES: GoldenCase[] = [
  {
    name: 'fm',
    patch: PATCH_FM,
    left: { at0: TWIN_FM_L_AT_0, at12000: TWIN_FM_L_AT_12000, at30000: TWIN_FM_L_AT_30000 },
    right: { at0: TWIN_FM_R_AT_0, at12000: TWIN_FM_R_AT_12000, at30000: TWIN_FM_R_AT_30000 },
    insertFree: false,
  },
  { name: 'va', patch: PATCH_VA, left: VA_PROBES, right: VA_PROBES, insertFree: true },
  {
    name: 'organ',
    patch: PATCH_ORGAN,
    left: { at0: TWIN_ORGAN_L_AT_0, at12000: TWIN_ORGAN_L_AT_12000, at30000: TWIN_ORGAN_L_AT_30000 },
    right: { at0: TWIN_ORGAN_R_AT_0, at12000: TWIN_ORGAN_R_AT_12000, at30000: TWIN_ORGAN_R_AT_30000 },
    insertFree: false,
  },
  {
    name: 'sample',
    patch: PATCH_SAMPLE,
    provider: goldenZoneSetProvider,
    left: SAMPLE_PROBES,
    right: SAMPLE_PROBES,
    insertFree: true,
  },
];

describe('golden patch renders', () => {
  for (const { name, patch, provider, left: leftProbes, right: rightProbes, insertFree } of CASES) {
    describe(name, () => {
      it('renders deterministically across repeat calls on both channels', () => {
        const a = renderPatch(patch, GOLDEN_EVENTS, GOLDEN_FRAMES, GOLDEN_FS, provider);
        const b = renderPatch(patch, GOLDEN_EVENTS, GOLDEN_FRAMES, GOLDEN_FS, provider);
        expect(a.left.length).toBe(GOLDEN_FRAMES);
        expect(a.right.length).toBe(GOLDEN_FRAMES);
        for (let i = 0; i < GOLDEN_FRAMES; i++) {
          expect(b.left[i]).toBe(a.left[i]);
          expect(b.right[i]).toBe(a.right[i]);
        }
      });

      it('is non-silent during the sustain window (left) and silent after the release tail (both channels)', () => {
        const { left, right } = renderPatch(patch, GOLDEN_EVENTS, GOLDEN_FRAMES, GOLDEN_FS, provider);
        expect(rms(left, 6000, 12000)).toBeGreaterThan(0.01);
        expect(rms(left, GOLDEN_FRAMES - 1000, GOLDEN_FRAMES)).toBeLessThan(0.01);
        expect(rms(right, GOLDEN_FRAMES - 1000, GOLDEN_FRAMES)).toBeLessThan(0.01);
      });

      it('matches the twin reference at three probe windows on both channels', () => {
        const { left, right } = renderPatch(patch, GOLDEN_EVENTS, GOLDEN_FRAMES, GOLDEN_FS, provider);
        for (const [channel, out, probes] of [
          ['left', left, leftProbes],
          ['right', right, rightProbes],
        ] as const) {
          expect(probes.at0, channel).toHaveLength(8);
          expect(probes.at12000, channel).toHaveLength(8);
          expect(probes.at30000, channel).toHaveLength(8);
          probe(out, 0).forEach((v, i) => expect(v, `${channel} at0[${i}]`).toBeCloseTo(probes.at0[i], 4));
          probe(out, 12000).forEach((v, i) => expect(v, `${channel} at12000[${i}]`).toBeCloseTo(probes.at12000[i], 4));
          probe(out, 30000).forEach((v, i) => expect(v, `${channel} at30000[${i}]`).toBeCloseTo(probes.at30000[i], 4));
        }
      });

      // Insert-free patches (VA, SAMPLE) declare insertFree: true because the
      // bypass path pins L === R bit-exactly across the full render, not just
      // at the probe windows (and share the same probe arrays for both
      // channels as a consequence — see the `insertFree` field's doc comment
      // on GoldenCase for why the gate itself is the explicit flag, not that
      // reference equality).
      if (insertFree) {
        it('is bit-exact L === R across the full render (insert-free bypass path)', () => {
          const { left, right } = renderPatch(patch, GOLDEN_EVENTS, GOLDEN_FRAMES, GOLDEN_FS, provider);
          for (let i = 0; i < GOLDEN_FRAMES; i++) {
            expect(right[i], `frame ${i}`).toBe(left[i]);
          }
        });
      }
    });
  }
});
