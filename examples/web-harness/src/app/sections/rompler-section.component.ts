import {
  ChangeDetectionStrategy,
  Component,
  OnDestroy,
  computed,
  signal,
} from '@angular/core';
import {
  BasePathPackSource,
  MinimalDecodeContext,
  MinimalWorkletContext,
  MinimalWorkletNode,
  PackLoader,
  Patch,
  PATCH_SCHEMA_VERSION,
  VelocityLayerData,
  WebAudioDecoder,
  WireZoneLayer,
  WorkletSynthHost,
  isBlackKey,
  midiToNoteName,
  validatePatch,
} from '@allyworld/alloy-audio';
import { KnobSegmentComponent, KnobSegmentOption } from '@allyworld/alloy-ui';
import { PatchEditorComponent } from '../rompler/patch-editor.component.js';
import { fromJson, toJson, toTypeScript } from '../rompler/patch-serialize.js';
import { DEFAULT_ZONE_SET_ID } from '../rompler/patch-edit.js';

// ---------------------------------------------------------------------------
// Worklet module URL. The worklet runs the BUILT package dist, served as an
// Angular asset: the project-root symlink ./alloy-audio-dist points at
// ../../web/packages/alloy-audio/dist (the builder rejects asset inputs
// outside the workspace root, so the link stands in for the real path) and
// angular.json globs it to /alloy-audio-dist with followSymlinks. The whole
// dist tree must be served — the module's import graph reaches
// ../worklet-host-core.js and ./dsp/*.js. The prestart/prebuild hooks keep
// the dist fresh.
// ---------------------------------------------------------------------------
const WORKLET_MODULE_URL = '/alloy-audio-dist/worklet/alloy-patch-processor.js';

// ---------------------------------------------------------------------------
// Context adapter: the real AudioContext satisfies MinimalWorkletContext's
// shape except createWorkletNode, which we provide (with explicit stereo
// output — the engine renders L/R). DOM types bridge via `unknown`, same as
// the synth section's createWebSynthEngine.
// ---------------------------------------------------------------------------
function wrapAudioContext(raw: AudioContext): MinimalWorkletContext {
  return {
    get sampleRate() {
      return raw.sampleRate;
    },
    get currentTime() {
      return raw.currentTime;
    },
    audioWorklet: { addModule: (url: string) => raw.audioWorklet.addModule(url) },
    createWorkletNode: (name, options) =>
      new AudioWorkletNode(raw, name, {
        ...options,
        outputChannelCount: [2],
      }) as unknown as MinimalWorkletNode,
    destination: raw.destination,
  };
}

// ---------------------------------------------------------------------------
// Baked sample-zone set: a harmonically flavored single-cycle-exact loop
// (440/880/1760 Hz over one second at 48 kHz — all integer cycle counts, so
// the loop is click-free). No sample assets needed; exercises the
// setZoneSet wire path (buffer transfer) and the sample generator kind.
// ---------------------------------------------------------------------------
// One source of truth: patch-edit.ts owns the workbench glass zone-set id, so
// the baked default patch and this harness's setZoneSet call cannot drift.
const GLASS_ZONE_SET_ID = DEFAULT_ZONE_SET_ID;

function bakeGlassZoneLayers(): WireZoneLayer[] {
  const sampleRate = 48_000;
  const length = 48_000;
  const samples = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    const t = i / length;
    samples[i] =
      0.72 * Math.sin(2 * Math.PI * 440 * t) +
      0.22 * Math.sin(2 * Math.PI * 880 * t) +
      0.06 * Math.sin(2 * Math.PI * 1760 * t);
  }
  return [
    {
      topVelocity: 1,
      zones: [{ rootMidi: 69, sampleRate, samples, loopStart: 0, loopEnd: length }],
    },
  ];
}

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

// ---------------------------------------------------------------------------
// Patch catalog — app-side by design (AlloyAudio ships none). Hand-authored
// to be musical first: velocity curves matter, filter envelopes shape the
// attacks, inserts stay tasteful. Every generator kind (fm / additive / va /
// sample) and all six insert kinds appear across the set.
// ---------------------------------------------------------------------------
interface CatalogEntry {
  patch: Patch;
  /** Base velocity the keyboard plays this patch at. */
  velocity: number;
  label: string;
}

const FULL_KEY = { lowMidi: 0, highMidi: 127 };
const FULL_VEL = { low: 0, high: 1 };

const PATCH_CATALOG: CatalogEntry[] = [
  {
    label: 'EP Ens',
    velocity: 0.72,
    patch: {
      schemaVersion: PATCH_SCHEMA_VERSION,
      meta: { id: 'wb.ep-ensemble', name: 'EP Ensemble', category: 'melodic' },
      layers: [
        {
          keyRange: FULL_KEY,
          velRange: FULL_VEL,
          generator: {
            kind: 'fm',
            fm: {
              operators: [
                // Carrier: the tine body.
                { ratio: 1, level: 1, adsr: { attack: 0.002, decay: 1.3, sustain: 0.16, release: 0.4 } },
                // Warm 1:1 body modulation, fades as the note blooms.
                { ratio: 1, level: 0.55, adsr: { attack: 0.001, decay: 0.5, sustain: 0.1, release: 0.3 } },
                // The hammer "clank". Ratio 14 runs this operator at 23.3 kHz on
                // G#6 — right at Nyquist — which used to fold back as inharmonic
                // bass junk (-24.7 dB below the fundamental). It no longer does:
                // FmGenerator oversamples any voice whose stack reaches past
                // sampleRate/4. See fm-oversampling.ts.
                { ratio: 14, level: 0.3, adsr: { attack: 0.001, decay: 0.06, sustain: 0, release: 0.05 } },
              ],
              algorithm: {
                routes: [
                  { from: 1, to: 0 },
                  { from: 2, to: 0 },
                ],
                carriers: [0],
              },
            },
          },
          tva: {
            level: 0.6,
            adsr: { attack: 0.002, decay: 1.1, sustain: 0.3, release: 0.28 },
            velCurve: 1.6,
          },
        },
      ],
      sends: { reverb: 0.25, delay: 0 },
      inserts: [
        { kind: 'chorus', chorus: { mode: 'ensemble', rateHz: 0.6, depthMs: 2.4, mix: 0.4 } },
        {
          kind: 'compressor',
          compressor: { thresholdDb: -20, ratio: 3, attackMs: 12, releaseMs: 140, makeupDb: 3 },
        },
      ],
    },
  },
  {
    label: 'Organ',
    velocity: 0.8,
    patch: {
      schemaVersion: PATCH_SCHEMA_VERSION,
      meta: { id: 'wb.drawbar-organ', name: 'Drawbar Organ', category: 'melodic' },
      layers: [
        {
          keyRange: FULL_KEY,
          velRange: FULL_VEL,
          generator: {
            kind: 'additive',
            // 16' 8' 5-1/3' 4' 2-2/3' 2' drawbars, jazz-ish registration.
            partials: [
              { ratio: 0.5, level: 0.8 },
              { ratio: 1, level: 1 },
              { ratio: 1.5, level: 0.5 },
              { ratio: 2, level: 0.3 },
              { ratio: 3, level: 0.15 },
              { ratio: 4, level: 0.1 },
            ],
          },
          tva: {
            level: 0.5,
            adsr: { attack: 0.004, decay: 0.05, sustain: 1, release: 0.05 },
            // Organs are barely velocity sensitive.
            velCurve: 0.35,
          },
        },
      ],
      sends: { reverb: 0.15, delay: 0 },
      inserts: [
        { kind: 'rotary', rotary: { speed: 'fast', depth: 0.6, mix: 0.85 } },
        {
          kind: 'driveEq',
          driveEq: { drive: 0.3, lowDb: 0.5, midDb: 1.5, highDb: 1, levelDb: -3 },
        },
      ],
    },
  },
  {
    label: 'Pad',
    velocity: 0.65,
    patch: {
      schemaVersion: PATCH_SCHEMA_VERSION,
      meta: { id: 'wb.analog-pad', name: 'Analog Pad', category: 'melodic' },
      layers: [
        {
          keyRange: FULL_KEY,
          velRange: FULL_VEL,
          generator: {
            kind: 'va',
            va: { shape: 'saw', unison: 5, detuneCents: 16, pulseWidth: 0.5 },
            seed: 11,
          },
          tvf: {
            mode: 'lowpass',
            cutoffHz: 650,
            q: 0.7,
            envAmountHz: 1100,
            env: { attack: 0.9, decay: 1.6, sustain: 0.55, release: 1.3 },
            keyTrack: 0.4,
            velAmountHz: 500,
          },
          tva: {
            level: 0.5,
            adsr: { attack: 0.6, decay: 1.2, sustain: 0.85, release: 1.5 },
            velCurve: 1.2,
          },
          mod: {
            lfo: { shape: 'sine', rateHz: 0.25, delay: 0.5, fadeIn: 1.5 },
            toPitchCents: 0,
            toCutoffHz: 250,
            toAmpDepth: 0,
          },
        },
      ],
      sends: { reverb: 0.4, delay: 0.1 },
      inserts: [
        {
          kind: 'phaser',
          phaser: { stages: 4, rateHz: 0.3, depth: 0.7, feedback: 0.4, mix: 0.4 },
        },
      ],
    },
  },
  {
    label: 'Brass',
    velocity: 0.78,
    patch: {
      schemaVersion: PATCH_SCHEMA_VERSION,
      meta: { id: 'wb.synth-brass', name: 'Synth Brass', category: 'melodic' },
      layers: [
        {
          keyRange: FULL_KEY,
          velRange: FULL_VEL,
          generator: {
            kind: 'va',
            va: { shape: 'saw', unison: 3, detuneCents: 10, pulseWidth: 0.5 },
            seed: 23,
          },
          tvf: {
            mode: 'lowpass',
            cutoffHz: 480,
            q: 0.8,
            envAmountHz: 2600,
            // The slight filter-attack lag is the classic brass "blat".
            env: { attack: 0.05, decay: 0.28, sustain: 0.45, release: 0.2 },
            keyTrack: 0.5,
            // Velocity-bright: hard playing opens the filter wide.
            velAmountHz: 2200,
          },
          tva: {
            level: 0.55,
            adsr: { attack: 0.03, decay: 0.3, sustain: 0.8, release: 0.18 },
            velCurve: 1.8,
          },
          mod: {
            lfo: { shape: 'sine', rateHz: 5.2, delay: 0.3, fadeIn: 0.6 },
            toPitchCents: 6,
            toCutoffHz: 0,
            toAmpDepth: 0,
          },
        },
      ],
      sends: { reverb: 0.2, delay: 0 },
      inserts: [
        {
          kind: 'driveEq',
          driveEq: { drive: 0.35, lowDb: 1, midDb: 2, highDb: 1.5, levelDb: -3.5 },
        },
        {
          kind: 'compressor',
          compressor: { thresholdDb: -16, ratio: 4, attackMs: 6, releaseMs: 180, makeupDb: 4 },
        },
      ],
    },
  },
  {
    label: 'MusicBox',
    velocity: 0.68,
    patch: {
      schemaVersion: PATCH_SCHEMA_VERSION,
      meta: { id: 'wb.music-box', name: 'Music Box', category: 'melodic' },
      layers: [
        {
          keyRange: FULL_KEY,
          velRange: FULL_VEL,
          generator: {
            kind: 'fm',
            fm: {
              operators: [
                { ratio: 1, level: 1, adsr: { attack: 0.001, decay: 0.9, sustain: 0, release: 0.45 } },
                // Inharmonic bell partial; decays faster than the carrier so
                // the tail turns pure.
                { ratio: 3.53, level: 0.55, adsr: { attack: 0.001, decay: 0.14, sustain: 0, release: 0.1 } },
              ],
              algorithm: { routes: [{ from: 1, to: 0 }], carriers: [0] },
            },
          },
          tva: {
            level: 0.6,
            adsr: { attack: 0.001, decay: 0.85, sustain: 0, release: 0.5 },
            velCurve: 1.4,
          },
        },
      ],
      sends: { reverb: 0.35, delay: 0.15 },
      inserts: [{ kind: 'tremolo', tremolo: { rateHz: 4.2, depth: 0.25, spread: 0.65 } }],
    },
  },
  {
    label: 'Glass',
    velocity: 0.7,
    patch: {
      schemaVersion: PATCH_SCHEMA_VERSION,
      meta: { id: 'wb.glass-keys', name: 'Glass Keys', category: 'melodic' },
      layers: [
        {
          keyRange: FULL_KEY,
          velRange: FULL_VEL,
          // Sample kind over the baked wavetable zone set sent via setZoneSet.
          generator: { kind: 'sample', zoneSetId: GLASS_ZONE_SET_ID, crossfade: 0.15 },
          tvf: {
            mode: 'lowpass',
            cutoffHz: 1800,
            q: 0.6,
            envAmountHz: 1400,
            env: { attack: 0.002, decay: 0.5, sustain: 0.2, release: 0.3 },
            keyTrack: 0.6,
            velAmountHz: 900,
          },
          tva: {
            level: 0.7,
            adsr: { attack: 0.002, decay: 0.7, sustain: 0.3, release: 0.35 },
            velCurve: 1.6,
          },
        },
      ],
      sends: { reverb: 0.3, delay: 0.1 },
      inserts: [
        { kind: 'chorus', chorus: { mode: 'chorus', rateHz: 0.9, depthMs: 1.8, mix: 0.3 } },
      ],
    },
  },
  {
    label: 'Piano',
    // With crossfade 0 (hard velocity switch, see the generator comment below)
    // pickLayers always returns a single layer, so any velocity is "mid-layer"
    // now. 0.7 is a deliberate mezzo default: the pack's layer boundaries sit
    // at 0.25/0.5/0.75/1, and findIndex(topVelocity >= velocity) puts 0.7 in
    // the v12 layer (0.5 < 0.7 < 0.75) rather than on an edge or in the v16
    // fortissimo layer, so the default keypress plays a comfortably mid-layer
    // take even if a crossfade is re-enabled later.
    velocity: 0.7,
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
          // crossfade 0 (hard velocity switch) is DELIBERATE and measured. The four
          // layers are four different takes of the same string, so they are
          // phase-incoherent: summing two of them does not blend, it interferes.
          // Measured on this pack, sweeping velocity across a layer boundary
          // (worst adjacent level step, 0.01 velocity apart; the velocity curve
          // itself accounts for ~1.04x):
          //   crossfade 0.1, linear gains       -> -5.3 dB NOTCH at the boundary
          //   crossfade 0.1, equal-power gains  -> +2.8 dB bump at the window edge (1.37x)
          //   crossfade 0   (this)              -> smooth (1.12x), no artifact
          // The layers are peak-normalized and the TVA owns loudness, so a hard
          // switch costs no level — it gives purely the intended timbre change,
          // which is what hardware romplers do. (The equal-power gain law in
          // SampleZoneGenerator is still the correct law, and matters for zone
          // sets whose layers ARE meant to blend; it is just wrong to blend
          // incoherent takes at all.)
          generator: { kind: 'sample', zoneSetId: PIANO_ZONE_SET_ID, crossfade: 0 },
          // Gentle velocity -> brightness ON TOP of the sampled layers (which
          // already carry most of the timbral change). First thing to dial to
          // taste — including to zero.
          tvf: { mode: 'lowpass', cutoffHz: 6000, q: 0.7, envAmountHz: 0, keyTrack: 0.3, velAmountHz: 6000 },
          // The SAMPLE carries the piano's decay (and its baked fade-out), so
          // the TVA holds at sustain 1 and only supplies the key-up damper.
          // velCurve is the TOTAL velocity exponent (voice.ts:39-41); ~1.8
          // gives a piano-like ~35 dB dynamic span.
          // level 0.5, not 1: each zone is peak-normalized to 0.9, so at level 1 a
          // hard low note arrived at the master already at ~0.9 and pinned the
          // brickwall limiter (measured: midi 36 at velocity 0.95 output exactly
          // 0.9661 = the ceiling). The limiter was squashing SINGLE NOTES, which
          // is most of what "heavily compressed" was. Halving the level buys ~6 dB
          // of headroom so the limiter only catches genuine polyphonic peaks.
          tva: { level: 0.5, adsr: { attack: 0.001, decay: 0.1, sustain: 1, release: 0.25 }, velCurve: 1.8 },
        },
      ],
      // The reverb's delay lines are LFO-modulated, which chorused the piano's
      // own unison-string beating (measured: reverb raised spectral-centroid
      // wobble on C3 from 2.56% to 3.73%). A real grand already beats; it does
      // not need help. Keep the send subtle — it is only here for stereo width,
      // since the voice bus is mono.
      sends: { reverb: 0.08, delay: 0 },
    },
  },
];

// Dev assertion at module init: every catalog patch must pass validatePatch.
// The worklet would reject a bad patch at setPatch time anyway (surfaced via
// onPatchRejected), but authoring mistakes should be loud at load.
for (const entry of PATCH_CATALOG) {
  const errors = validatePatch(entry.patch);
  if (errors.length > 0) {
    console.error(`[rompler-workbench] patch '${entry.patch.meta.id}' failed validatePatch:`, errors);
  }
}

// ---------------------------------------------------------------------------
// Keyboard model (same white-key-unit layout as the synth section).
// ---------------------------------------------------------------------------
interface HarnessKey {
  midi: number;
  label: string;
  black: boolean;
  /** Position in white-key units (black keys sit on the following boundary). */
  left: number;
}

function buildKeys(fromMidi: number, toMidi: number): HarnessKey[] {
  const keys: HarnessKey[] = [];
  let white = 0;
  for (let midi = fromMidi; midi <= toMidi; midi++) {
    const black = isBlackKey(midi);
    keys.push({ midi, label: midiToNoteName(midi), black, left: white });
    if (!black) {
      white++;
    }
  }
  return keys;
}

/** Computer-keyboard note map: A/W/S/E/D/F/T/G/Y/H/U/J = C..B of the base octave. */
const KEY_OFFSETS: Readonly<Record<string, number>> = {
  a: 0,
  w: 1,
  s: 2,
  e: 3,
  d: 4,
  f: 5,
  t: 6,
  g: 7,
  y: 8,
  h: 9,
  u: 10,
  j: 11,
};

const OCTAVE_BASE_MIN = 24; // C1
const OCTAVE_BASE_MAX = 72; // C5 (top key C7)

type RomplerStatus = 'idle' | 'loading' | 'ready' | 'error';

/** Rompler workbench: WorkletSynthHost + hand-authored patch catalog,
 *  the first live consumer of the patch engine and the documented
 *  dist-as-asset worklet-serving path. */
@Component({
  selector: 'hx-rompler-section',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [KnobSegmentComponent, PatchEditorComponent],
  host: {
    '(document:keydown)': 'onKeyDown($event)',
    '(document:keyup)': 'onKeyUp($event)',
  },
  template: `
    <section class="demo">
      <h2 class="demo-title">Rompler</h2>
      <p class="demo-caption">
        WorkletSynthHost driving the patch engine in an AudioWorklet (loaded from the built
        alloy-audio dist served as an asset). Hand-authored patches cover every generator kind
        and all six inserts, plus a real sampled piano. Computer keys: A W S E D F T G Y H U J =
        C..B, Z/X shift octave.
      </p>

      <div class="rompler-controls">
        <div class="rompler-control">
          <span class="knobs-section-label">Patch</span>
          <app-knob-segment
            segmentLabel="Patch"
            [options]="patchOptions"
            [selection]="patchId()"
            (changed)="setPatch($event)"
          />
        </div>
        <div class="rompler-control">
          <span class="knobs-section-label">Octave ({{ rangeLabel() }})</span>
          <div class="rompler-buttons">
            <button type="button" class="rompler-button" (click)="shiftOctave(-1)">Oct −</button>
            <button type="button" class="rompler-button" (click)="shiftOctave(1)">Oct +</button>
            <button type="button" class="rompler-button" (click)="allNotesOff()">
              All notes off
            </button>
          </div>
        </div>
        <div class="rompler-control">
          <span class="knobs-section-label">Engine</span>
          <span class="rompler-status" [class.error]="status() === 'error' || patchError()">
            {{ statusLabel() }}
          </span>
        </div>
      </div>

      @if (packStatus() !== 'idle' && packStatus() !== 'ready') {
        <p class="hint">
          Piano pack: {{ packStatus() }}@if (packError()) { — {{ packError() }} }
        </p>
      }

      <div class="keyboard" [style.width.rem]="whiteKeyCount() * 3">
        @for (key of keys(); track key.midi) {
          <button
            type="button"
            class="key"
            [class.black]="key.black"
            [class.down]="pressed().has(key.midi)"
            [style.left.rem]="key.black ? key.left * 3 - 0.9 : key.left * 3"
            [attr.aria-label]="'Play ' + key.label"
            (pointerdown)="pointerNoteOn(key.midi, $event)"
            (pointerup)="noteOff(key.midi)"
            (pointerleave)="noteOff(key.midi)"
            (pointercancel)="noteOff(key.midi)"
          >
            <span class="key-label">{{ key.label }}</span>
          </button>
        }
      </div>

      <div class="rompler__workbench">
        <div class="rompler__slots">
          <button type="button" (click)="swapSlot()">Slot {{ activeSlot() }} — compare</button>
          <button type="button" (click)="copyActiveToOther()">
            Copy {{ activeSlot() }} &rarr; {{ activeSlot() === 'A' ? 'B' : 'A' }}
          </button>
          <label>
            <input type="checkbox" [checked]="reStrike()" (change)="reStrike.set($any($event.target).checked)" />
            Re-strike on edit
          </label>
          <button type="button" (click)="copyAsTs()">Copy as TS</button>
          <button type="button" (click)="copyAsJson()">Copy as JSON</button>
          <button type="button" (click)="pasteFromJson()">Paste JSON</button>
          <button type="button" (click)="revertToCatalog()">Revert</button>
          <span class="rompler__notice">{{ exportNotice() }}</span>
        </div>

        <app-patch-editor
          [patch]="editedPatch()"
          [errors]="editorErrors()"
          (patchChange)="onPatchChange($event)"
        />
      </div>
    </section>
  `,
  styles: `
    .rompler-controls {
      display: flex;
      align-items: flex-end;
      flex-wrap: wrap;
      gap: 2rem;
    }
    .rompler-control {
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
      min-width: 10rem;
    }
    .rompler-buttons {
      display: flex;
      gap: 0.5rem;
    }
    .rompler-button {
      padding: 0.35rem 0.7rem;
      border: 1px solid rgba(255, 255, 255, 0.14);
      border-radius: 6px;
      background: #1d1d22;
      color: #d7d7dc;
      font-size: 0.75rem;
      cursor: pointer;

      &:hover {
        background: #26262c;
      }
    }
    .rompler-status {
      font-size: 0.75rem;
      color: #8e8e96;
      padding: 0.45rem 0;

      &.error {
        color: #ff6b6b;
      }
    }
    .hint {
      font-size: 0.75rem;
      color: #8e8e96;
      margin: 0.5rem 0 0;
    }
    .keyboard {
      position: relative;
      height: 11rem;
      max-width: 100%;
      touch-action: none;
      user-select: none;
      -webkit-user-select: none;
    }
    .key {
      position: absolute;
      top: 0;
      width: 3rem;
      height: 100%;
      display: flex;
      align-items: flex-end;
      justify-content: center;
      padding: 0 0 0.4rem;
      border: 1px solid #0c0c0f;
      border-radius: 0 0 6px 6px;
      background: #f4f4f6;
      color: #55555c;
      cursor: pointer;
      font-size: 0.65rem;

      &.down {
        background: #c9dcf5;
      }

      &.black {
        width: 1.8rem;
        height: 62%;
        background: #26262b;
        color: #98989e;
        z-index: 2;
        border-radius: 0 0 4px 4px;

        &.down {
          background: #0a84ff;
          color: #fff;
        }
      }
    }
    .key-label {
      pointer-events: none;
    }
    .rompler__workbench { display: flex; flex-direction: column; gap: 0.6rem; margin-top: 1rem; }
    .rompler__slots { display: flex; flex-wrap: wrap; gap: 0.4rem; align-items: center; font-size: 0.75rem; }
    .rompler__notice { opacity: 0.6; }
  `,
})
export class RomplerSectionComponent implements OnDestroy {
  readonly patchId = signal(PATCH_CATALOG[0].patch.meta.id);
  readonly pressed = signal<ReadonlySet<number>>(new Set());
  readonly status = signal<RomplerStatus>('idle');
  readonly errorDetail = signal('');
  readonly patchError = signal('');
  readonly packStatus = signal<'idle' | 'loading' | 'ready' | 'error'>('idle');
  /** Why the pack failed, rendered next to packStatus. Separate from errorDetail,
   *  which the engine owns and which only renders when status() === 'error'. */
  readonly packError = signal('');

  /** Base MIDI of the two-octave keyboard (C3 by default). */
  readonly octaveBase = signal(48);
  readonly keys = computed(() => buildKeys(this.octaveBase(), this.octaveBase() + 24));
  readonly whiteKeyCount = computed(() => this.keys().filter((k) => !k.black).length);
  readonly rangeLabel = computed(
    () => `${midiToNoteName(this.octaveBase())}–${midiToNoteName(this.octaveBase() + 24)}`,
  );

  readonly statusLabel = computed(() => {
    const rejected = this.patchError();
    if (rejected) {
      return `patch rejected: ${rejected}`;
    }
    switch (this.status()) {
      case 'idle':
        return 'idle — press a key to start audio';
      case 'loading':
        return 'loading worklet…';
      case 'ready':
        return 'ready';
      case 'error':
        return `error: ${this.errorDetail()}`;
    }
  });

  readonly patchOptions: KnobSegmentOption[] = PATCH_CATALOG.map((entry) => ({
    value: entry.patch.meta.id,
    label: entry.label,
  }));

  /** Two independent slots. setAt() never mutates, so A and B cannot alias. */
  protected readonly slotA = signal<Patch>(this.currentEntry().patch);
  protected readonly slotB = signal<Patch>(this.currentEntry().patch);
  protected readonly activeSlot = signal<'A' | 'B'>('A');
  protected readonly editorErrors = signal<readonly string[]>([]);
  /** A knob turn is inaudible on a sustaining note — voices capture their
   *  generator/TVF/TVA params at noteOn. So replay the last note on every edit. */
  protected readonly reStrike = signal(true);
  protected readonly exportNotice = signal('');
  private lastNote = 60;

  protected readonly editedPatch = computed(() =>
    this.activeSlot() === 'A' ? this.slotA() : this.slotB(),
  );

  private readonly storageKey = computed(() => `alloy.workbench.${this.patchId()}`);

  // Lazy host: the AudioContext + worklet module load happen on the first
  // key press, inside a user gesture (browsers gate audio start on one).
  private host: WorkletSynthHost | null = null;
  private hostPromise: Promise<WorkletSynthHost | null> | null = null;
  private rawCtx: AudioContext | null = null;

  /** key (e.g. 'a') -> sounding midi, so octave shifts can't strand notes. */
  private readonly heldComputerKeys = new Map<string, number>();

  protected pointerNoteOn(midi: number, event: PointerEvent): void {
    // Keep receiving pointerup even if the pointer wanders off the key.
    (event.target as HTMLElement).releasePointerCapture?.(event.pointerId);
    this.noteOn(midi);
  }

  protected noteOn(midi: number): void {
    this.lastNote = midi;
    if (this.pressed().has(midi)) {
      return;
    }
    this.pressed.update((set) => new Set(set).add(midi));
    const velocity = this.currentEntry().velocity;
    // Fire-and-forget: callbacks on the shared host promise run in
    // registration order, so a fast noteOff still lands after this noteOn.
    void this.ensureHost().then((host) => host?.noteOn(midi, velocity));
  }

  protected noteOff(midi: number): void {
    if (!this.pressed().has(midi)) {
      return;
    }
    this.pressed.update((set) => {
      const next = new Set(set);
      next.delete(midi);
      return next;
    });
    void this.ensureHost().then((host) => host?.noteOff(midi));
  }

  protected setPatch(id: string): void {
    this.patchId.set(id);
    this.patchError.set('');
    this.host?.allNotesOff();
    this.host?.setPatch(this.currentEntry().patch);
    this.pressed.set(new Set());
    this.heldComputerKeys.clear();

    const saved = localStorage.getItem(this.storageKey());
    const restored = saved ? fromJson(saved) : null;
    const patch = restored && 'patch' in restored ? restored.patch : this.currentEntry().patch;
    this.slotA.set(patch);
    this.slotB.set(this.currentEntry().patch);
    this.activeSlot.set('A');
    this.editorErrors.set([]);
    this.host?.setPatch(patch);
  }

  protected onPatchChange(next: Patch): void {
    (this.activeSlot() === 'A' ? this.slotA : this.slotB).set(next);

    // PatchEngine.setPatch THROWS on an invalid patch. Surface the errors and
    // keep the last good patch sounding rather than tearing down the audio.
    const errors = validatePatch(next);
    this.editorErrors.set(errors);
    if (errors.length > 0) return;

    this.host?.setPatch(next);
    localStorage.setItem(this.storageKey(), toJson(next));
    if (this.reStrike()) this.strikeLastNote();
  }

  private strikeLastNote(): void {
    const midi = this.lastNote;
    void this.ensureHost().then((host) => {
      host?.noteOff(midi);
      host?.noteOn(midi, this.currentEntry().velocity);
    });
  }

  protected swapSlot(): void {
    this.activeSlot.update((slot) => (slot === 'A' ? 'B' : 'A'));
    const patch = this.editedPatch();
    this.editorErrors.set(validatePatch(patch));
    this.host?.setPatch(patch);
    if (this.reStrike()) this.strikeLastNote();
  }

  protected copyActiveToOther(): void {
    const patch = this.editedPatch();
    (this.activeSlot() === 'A' ? this.slotB : this.slotA).set(patch);
  }

  protected revertToCatalog(): void {
    const patch = this.currentEntry().patch;
    (this.activeSlot() === 'A' ? this.slotA : this.slotB).set(patch);
    localStorage.removeItem(this.storageKey());
    this.editorErrors.set([]);
    this.host?.setPatch(patch);
  }

  protected async copyAsTs(): Promise<void> {
    // This is the bridge to phase 4b: the factory bank is authored by pasting
    // this output into factory-bank.ts.
    const name = this.currentEntry().patch.meta.id.replace(/[^A-Za-z0-9]+/g, '_').toUpperCase();
    await navigator.clipboard.writeText(toTypeScript(this.editedPatch(), name));
    this.exportNotice.set('Copied as TypeScript');
  }

  protected async copyAsJson(): Promise<void> {
    await navigator.clipboard.writeText(toJson(this.editedPatch()));
    this.exportNotice.set('Copied as JSON');
  }

  protected async pasteFromJson(): Promise<void> {
    const text = await navigator.clipboard.readText();
    const result = fromJson(text);
    if ('errors' in result) {
      this.editorErrors.set(result.errors);
      this.exportNotice.set('Paste rejected');
      return;
    }
    this.exportNotice.set('Imported from JSON');
    this.onPatchChange(result.patch);
  }

  protected shiftOctave(direction: -1 | 1): void {
    this.octaveBase.update((base) =>
      Math.min(OCTAVE_BASE_MAX, Math.max(OCTAVE_BASE_MIN, base + direction * 12)),
    );
  }

  protected allNotesOff(): void {
    this.host?.allNotesOff();
    this.pressed.set(new Set());
    this.heldComputerKeys.clear();
  }

  protected onKeyDown(event: KeyboardEvent): void {
    if (event.repeat || event.metaKey || event.ctrlKey || event.altKey || isEditable(event)) {
      return;
    }
    const key = event.key.toLowerCase();
    if (key === 'z' || key === 'x') {
      this.shiftOctave(key === 'z' ? -1 : 1);
      event.preventDefault();
      return;
    }
    const offset = KEY_OFFSETS[key];
    if (offset === undefined || this.heldComputerKeys.has(key)) {
      return;
    }
    const midi = this.octaveBase() + offset;
    this.heldComputerKeys.set(key, midi);
    this.noteOn(midi);
    event.preventDefault();
  }

  protected onKeyUp(event: KeyboardEvent): void {
    const key = event.key.toLowerCase();
    const midi = this.heldComputerKeys.get(key);
    if (midi === undefined) {
      return;
    }
    this.heldComputerKeys.delete(key);
    this.noteOff(midi);
  }

  ngOnDestroy(): void {
    this.host?.allNotesOff();
    this.host?.dispose();
    this.host = null;
    void this.rawCtx?.close();
    this.rawCtx = null;
  }

  /** Fetch + decode the piano pack on the main thread, then transfer its zone
   *  buffers to the worklet. Until this resolves the piano patch is silent —
   *  the engine's progressive-delivery path, not an error. */
  private async loadPianoPack(ctx: AudioContext, host: WorkletSynthHost): Promise<void> {
    this.packStatus.set('loading');
    this.packError.set('');
    try {
      const loader = new PackLoader(
        new BasePathPackSource(PIANO_PACK_BASE, (url) => fetch(url)),
        new WebAudioDecoder(ctx as unknown as MinimalDecodeContext),
      );
      await loader.load();
      const layers = loader.provide(PIANO_ZONE_SET_ID);
      if (layers === null) throw new Error(`pack has no zone set "${PIANO_ZONE_SET_ID}"`);
      // setZoneSet TRANSFERS (detaches) the zone ArrayBuffers to the worklet, so
      // this call CONSUMES `loader`: its buffers are gone afterwards and it must
      // never be reused or have provide() called again. Safe today only because
      // `loader` is method-local and createHost() (our only caller) is memoized.
      host.setZoneSet(PIANO_ZONE_SET_ID, toWireLayers(layers));
      this.packStatus.set('ready');
    } catch (err) {
      // The pack is gitignored, so "missing on a fresh clone" is the EXPECTED
      // failure. Surface the reason in the pack hint line: errorDetail only
      // renders when status() === 'error', and a pack failure leaves the engine
      // status at 'ready' — so writing there alone shows a bare, unexplained
      // "error". errorDetail is still set for the engine's own reporting.
      this.packStatus.set('error');
      this.packError.set(String(err));
      this.errorDetail.set(`piano pack: ${String(err)}`);
    }
  }

  private currentEntry(): CatalogEntry {
    return PATCH_CATALOG.find((entry) => entry.patch.meta.id === this.patchId()) ?? PATCH_CATALOG[0];
  }

  private ensureHost(): Promise<WorkletSynthHost | null> {
    this.hostPromise ??= this.createHost();
    return this.hostPromise;
  }

  private async createHost(): Promise<WorkletSynthHost | null> {
    const Ctx =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) {
      this.status.set('error');
      this.errorDetail.set('Web Audio unavailable');
      return null;
    }
    this.status.set('loading');
    try {
      // Construct the context synchronously inside the triggering gesture.
      const raw = new Ctx();
      this.rawCtx = raw;
      const host = await WorkletSynthHost.create(wrapAudioContext(raw), WORKLET_MODULE_URL, {
        maxVoices: 24,
      });
      host.onPatchRejected = (errors) => this.patchError.set(errors.join('; '));
      host.setZoneSet(GLASS_ZONE_SET_ID, bakeGlassZoneLayers());
      void this.loadPianoPack(raw, host);
      host.setPatch(this.currentEntry().patch);
      if (raw.state === 'suspended') {
        void raw.resume();
      }
      this.host = host;
      this.status.set('ready');
      return host;
    } catch (error) {
      this.status.set('error');
      this.errorDetail.set(error instanceof Error ? error.message : String(error));
      return null;
    }
  }
}

function isEditable(event: KeyboardEvent): boolean {
  const target = event.target;
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable ||
      target.tagName === 'INPUT' ||
      target.tagName === 'TEXTAREA' ||
      target.tagName === 'SELECT')
  );
}
