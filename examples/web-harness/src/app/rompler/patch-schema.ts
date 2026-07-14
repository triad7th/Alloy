// The parameter descriptor table. This is what the editor UI renders — it knows
// nothing about the Patch schema beyond what describePatch() hands it.
//
// RANGES HERE ARE MUSICAL, NOT LEGAL. validatePatch enforces what is legal (a
// route's `from` must exceed its `to`); this table declares what is useful to
// turn a knob through. Where the library DOES impose a bound, this table must
// stay inside it — patch-schema.spec.ts's bounds-safety tests enforce that, and
// they are the reason the editor cannot build a patch the engine would throw on.
import type { Patch } from '@allyworld/alloy-audio';

export interface ParamDescriptor {
  /** Absolute path into a Patch, e.g. 'layers.0.tvf.cutoffHz'. */
  path: string;
  label: string;
  kind: 'number' | 'enum' | 'text';
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  /** Render with a logarithmic taper (frequencies). */
  log?: boolean;
  options?: readonly (string | number)[];
}

export interface ParamGroup {
  title: string;
  params: ParamDescriptor[];
}

/** Leaf paths with bespoke structural UI rather than a generic control — the
 *  editor handles them with dedicated widgets (kind pickers, a route matrix, a
 *  carrier checkbox row). Regexes, matched against a full leaf path.
 *  Anything NOT listed here MUST have a descriptor: patch-schema.spec.ts fails
 *  otherwise, which is what stops this table going stale as the schema grows. */
export const STRUCTURAL_PATHS: readonly string[] = [
  '^schemaVersion$',
  '^meta\\.', // id / name / category / gmProgram — a header form, not knobs
  '\\.generator\\.kind$',
  '\\.generator\\.seed$', // VA PRNG seed: an identity, not a knob
  '\\.algorithm\\.routes\\.', // the FM route matrix
  '\\.algorithm\\.carriers\\.', // the FM carrier row
  '^inserts\\.\\d+\\.kind$',
];

const num = (
  path: string,
  label: string,
  min: number,
  max: number,
  step: number,
  extra: Partial<ParamDescriptor> = {},
): ParamDescriptor => ({ path, label, kind: 'number', min, max, step, ...extra });

const enumOf = (path: string, label: string, options: readonly (string | number)[]): ParamDescriptor => ({
  path,
  label,
  kind: 'enum',
  options,
});

/** ADSR is the same four fields everywhere it appears (operator, TVF, TVA). */
function adsrParams(base: string): ParamDescriptor[] {
  return [
    num(`${base}.attack`, 'Attack', 0, 10, 0.001, { unit: 's' }),
    num(`${base}.decay`, 'Decay', 0, 10, 0.001, { unit: 's' }),
    num(`${base}.sustain`, 'Sustain', 0, 1, 0.01),
    num(`${base}.release`, 'Release', 0, 10, 0.001, { unit: 's' }),
  ];
}

function generatorGroups(patch: Patch, li: number): ParamGroup[] {
  const layer = patch.layers[li];
  const g = layer.generator;
  const base = `layers.${li}.generator`;

  switch (g.kind) {
    case 'fm': {
      const groups: ParamGroup[] = g.fm.operators.map((_, oi) => ({
        title: `Operator ${oi + 1}`,
        params: [
          // Ratio's ceiling is musical: 32 x a top-octave fundamental is far past
          // Nyquist, but phase 3c's adaptive oversampling now renders it cleanly.
          num(`${base}.fm.operators.${oi}.ratio`, 'Ratio', 0.25, 32, 0.01),
          num(`${base}.fm.operators.${oi}.level`, 'Level', 0, 10, 0.01),
          ...adsrParams(`${base}.fm.operators.${oi}.adsr`),
        ],
      }));
      if (g.fm.algorithm.feedback) {
        groups.push({
          title: 'Feedback',
          params: [
            num(`${base}.fm.algorithm.feedback.op`, 'Operator', 0, g.fm.operators.length - 1, 1),
            num(`${base}.fm.algorithm.feedback.amount`, 'Amount', 0, 2, 0.01, { unit: 'cyc' }),
          ],
        });
      }
      return groups;
    }
    case 'additive':
      return [
        {
          title: 'Partials',
          params: g.partials.flatMap((_, pi) => [
            num(`${base}.partials.${pi}.ratio`, `${pi + 1}: Ratio`, 0.25, 32, 0.01),
            num(`${base}.partials.${pi}.level`, `${pi + 1}: Level`, 0, 2, 0.01),
          ]),
        },
      ];
    case 'va': {
      const params = [
        enumOf(`${base}.va.shape`, 'Shape', ['sine', 'saw', 'pulse']),
        num(`${base}.va.unison`, 'Unison', 1, 8, 1),
        num(`${base}.va.detuneCents`, 'Detune', 0, 100, 0.1, { unit: '¢' }),
      ];
      if (g.va.pulseWidth !== undefined) {
        params.push(num(`${base}.va.pulseWidth`, 'Pulse width', 0.05, 0.95, 0.01));
      }
      return [{ title: 'Virtual analog', params }];
    }
    case 'sample':
      return [
        {
          title: 'Sample',
          params: [
            { path: `${base}.zoneSetId`, label: 'Zone set', kind: 'text' },
            num(`${base}.crossfade`, 'Crossfade', 0, 1, 0.01),
          ],
        },
      ];
  }
}

function insertGroup(patch: Patch, ii: number): ParamGroup {
  const insert = (patch.inserts ?? [])[ii];
  const base = `inserts.${ii}`;
  // Every bound below mirrors validateInsert in dsp/effects/effect-types.ts.
  switch (insert.kind) {
    case 'chorus':
      return {
        title: `Insert ${ii + 1}: Chorus`,
        params: [
          enumOf(`${base}.chorus.mode`, 'Mode', ['chorus', 'ensemble']),
          num(`${base}.chorus.rateHz`, 'Rate', 0.01, 20, 0.01, { unit: 'Hz' }),
          // depthMs must stay within BASE_DELAY_MS (7): a larger depth makes the
          // swept delay negative, i.e. acausal, and validateInsert rejects it.
          num(`${base}.chorus.depthMs`, 'Depth', 0.1, 7, 0.1, { unit: 'ms' }),
          num(`${base}.chorus.mix`, 'Mix', 0, 1, 0.01),
        ],
      };
    case 'tremolo':
      return {
        title: `Insert ${ii + 1}: Tremolo`,
        params: [
          num(`${base}.tremolo.rateHz`, 'Rate', 0.01, 40, 0.01, { unit: 'Hz' }),
          num(`${base}.tremolo.depth`, 'Depth', 0, 1, 0.01),
          num(`${base}.tremolo.spread`, 'Auto-pan', 0, 1, 0.01),
        ],
      };
    case 'phaser':
      return {
        title: `Insert ${ii + 1}: Phaser`,
        params: [
          enumOf(`${base}.phaser.stages`, 'Stages', [4, 8]),
          num(`${base}.phaser.rateHz`, 'Rate', 0.01, 10, 0.01, { unit: 'Hz' }),
          num(`${base}.phaser.depth`, 'Depth', 0, 1, 0.01),
          num(`${base}.phaser.feedback`, 'Feedback', 0, 0.9, 0.01),
          num(`${base}.phaser.mix`, 'Mix', 0, 1, 0.01),
        ],
      };
    case 'rotary':
      return {
        title: `Insert ${ii + 1}: Rotary`,
        params: [
          enumOf(`${base}.rotary.speed`, 'Speed', ['slow', 'fast']),
          num(`${base}.rotary.depth`, 'Depth', 0, 1, 0.01),
          num(`${base}.rotary.mix`, 'Mix', 0, 1, 0.01),
        ],
      };
    case 'driveEq':
      return {
        title: `Insert ${ii + 1}: Drive EQ`,
        params: [
          num(`${base}.driveEq.drive`, 'Drive', 0, 1, 0.01),
          num(`${base}.driveEq.lowDb`, 'Low', -12, 12, 0.1, { unit: 'dB' }),
          num(`${base}.driveEq.midDb`, 'Mid', -12, 12, 0.1, { unit: 'dB' }),
          num(`${base}.driveEq.highDb`, 'High', -12, 12, 0.1, { unit: 'dB' }),
          num(`${base}.driveEq.levelDb`, 'Level', -12, 12, 0.1, { unit: 'dB' }),
        ],
      };
    case 'compressor':
      return {
        title: `Insert ${ii + 1}: Compressor`,
        params: [
          num(`${base}.compressor.thresholdDb`, 'Threshold', -60, 0, 0.1, { unit: 'dB' }),
          num(`${base}.compressor.ratio`, 'Ratio', 1, 20, 0.1),
          num(`${base}.compressor.attackMs`, 'Attack', 0.1, 100, 0.1, { unit: 'ms' }),
          num(`${base}.compressor.releaseMs`, 'Release', 1, 1000, 1, { unit: 'ms' }),
          num(`${base}.compressor.makeupDb`, 'Makeup', 0, 24, 0.1, { unit: 'dB' }),
        ],
      };
  }
}

/** Expands the table against a CONCRETE patch: one set of groups per layer, per
 *  operator, per partial, per insert. The UI renders exactly what comes back. */
export function describePatch(patch: Patch): ParamGroup[] {
  const groups: ParamGroup[] = [];

  patch.layers.forEach((layer, li) => {
    groups.push({
      title: `Layer ${li + 1}: Range`,
      params: [
        num(`layers.${li}.keyRange.lowMidi`, 'Key low', 0, 127, 1),
        num(`layers.${li}.keyRange.highMidi`, 'Key high', 0, 127, 1),
        num(`layers.${li}.velRange.low`, 'Vel low', 0, 1, 0.01),
        num(`layers.${li}.velRange.high`, 'Vel high', 0, 1, 0.01),
      ],
    });

    groups.push(...generatorGroups(patch, li));

    if (layer.tvf) {
      const tvf = [
        enumOf(`layers.${li}.tvf.mode`, 'Mode', ['lowpass', 'bandpass', 'highpass']),
        num(`layers.${li}.tvf.cutoffHz`, 'Cutoff', 20, 20000, 1, { unit: 'Hz', log: true }),
        num(`layers.${li}.tvf.q`, 'Resonance', 0.5, 20, 0.01),
        num(`layers.${li}.tvf.envAmountHz`, 'Env amount', 0, 20000, 1, { unit: 'Hz' }),
        num(`layers.${li}.tvf.keyTrack`, 'Key track', 0, 2, 0.01),
        num(`layers.${li}.tvf.velAmountHz`, 'Vel amount', 0, 20000, 1, { unit: 'Hz' }),
      ];
      if (layer.tvf.env) tvf.push(...adsrParams(`layers.${li}.tvf.env`));
      groups.push({ title: `Layer ${li + 1}: Filter`, params: tvf });
    }

    groups.push({
      title: `Layer ${li + 1}: Amp`,
      params: [
        // tva.level must stay > 0 (validatePatch); 0.01 is the smallest audible step.
        num(`layers.${li}.tva.level`, 'Level', 0.01, 2, 0.01),
        num(`layers.${li}.tva.velCurve`, 'Vel curve', 0.1, 4, 0.05),
        ...adsrParams(`layers.${li}.tva.adsr`),
      ],
    });

    if (layer.mod) {
      groups.push({
        title: `Layer ${li + 1}: LFO`,
        params: [
          enumOf(`layers.${li}.mod.lfo.shape`, 'Shape', ['sine', 'triangle']),
          num(`layers.${li}.mod.lfo.rateHz`, 'Rate', 0.01, 20, 0.01, { unit: 'Hz' }),
          num(`layers.${li}.mod.lfo.delay`, 'Delay', 0, 5, 0.01, { unit: 's' }),
          num(`layers.${li}.mod.lfo.fadeIn`, 'Fade in', 0, 5, 0.01, { unit: 's' }),
          // Pitch depth feeds phase 3c's K-selection: a deep vibrato makes the FM
          // generator oversample, which is correct and costs CPU. See the 3c spec.
          num(`layers.${li}.mod.toPitchCents`, 'To pitch', -1200, 1200, 1, { unit: '¢' }),
          num(`layers.${li}.mod.toCutoffHz`, 'To cutoff', -10000, 10000, 1, { unit: 'Hz' }),
          num(`layers.${li}.mod.toAmpDepth`, 'To amp', 0, 1, 0.01),
        ],
      });
    }
  });

  (patch.inserts ?? []).forEach((_, ii) => groups.push(insertGroup(patch, ii)));

  groups.push({
    title: 'Sends',
    params: [
      num('sends.reverb', 'Reverb', 0, 1, 0.01),
      num('sends.delay', 'Delay', 0, 1, 0.01),
    ],
  });

  return groups;
}
