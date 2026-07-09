import { ChangeDetectionStrategy, Component, OnDestroy, signal } from '@angular/core';
import {
  InstrumentDescriptor,
  MinimalAudioContext,
  SynthEngine,
  WebSynthEngine,
  isBlackKey,
  midiToNoteName,
} from '@allyworld/alloy-audio';
import { KnobSegmentComponent, KnobSegmentOption, KnobToggleComponent } from '@allyworld/alloy-ui';

// The instrument catalog is app-side by design — AlloyAudio ships none.
// 'lead' exercises the supersaw player; 'pluck' declares a sampled voice with
// no sample zones, so it always plays its triangle synth fallback (no sample
// assets needed in the harness).
const INSTRUMENTS: InstrumentDescriptor[] = [
  {
    id: 'lead',
    voice: {
      kind: 'supersaw',
      unison: 5,
      detuneCents: 24,
      filter: { baseHz: 900, envHz: 2600, decay: 0.35, q: 0.9 },
      amp: { waveform: 'sawtooth', attack: 0.005, decay: 0.25, sustain: 0.5, release: 0.35 },
    },
    sends: { reverb: 0.3, delay: 0.18 },
  },
  {
    id: 'pluck',
    voice: {
      kind: 'sampled',
      sampleBaseUrl: 'samples/pluck',
      sampleMidis: [],
      release: 0.25,
      fallback: { waveform: 'triangle', attack: 0.005, decay: 0.12, sustain: 0.6, release: 0.25 },
    },
    sends: { reverb: 0.2, delay: 0 },
  },
];

const NO_OP_ENGINE: SynthEngine = {
  noteOn() {},
  noteOff() {},
  setSustain() {},
  setInstrument() {},
  allNotesOff() {},
};

// AllyPiano's engine-construction pattern: the real AudioContext satisfies the
// engine's MinimalAudioContext contract at runtime; bridge the structurally
// stricter DOM type through `unknown`. Null when Web Audio is unavailable.
function createWebSynthEngine(defaultInstrumentId: string): SynthEngine | null {
  const Ctx =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctx) {
    return null;
  }
  try {
    return new WebSynthEngine(
      new Ctx() as unknown as MinimalAudioContext,
      INSTRUMENTS,
      defaultInstrumentId,
    );
  } catch {
    return null;
  }
}

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

/** Section 4: a clickable one-octave keyboard driving WebSynthEngine, with a
 *  sustain KnobToggle and an instrument KnobSegment. */
@Component({
  selector: 'hx-synth-section',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [KnobToggleComponent, KnobSegmentComponent],
  template: `
    <section class="demo">
      <h2 class="demo-title">Synth</h2>
      <p class="demo-caption">
        WebSynthEngine + SynthEngineCore with a harness-side catalog: 'lead' is a supersaw, 'pluck'
        is a sampled voice with no zones (always on its triangle fallback).
      </p>

      <div class="synth-controls">
        <div class="synth-control">
          <span class="knobs-section-label">Instrument</span>
          <app-knob-segment
            segmentLabel="Instrument"
            [options]="instrumentOptions"
            [selection]="instrument()"
            (changed)="setInstrument($event)"
          />
        </div>
        <div class="synth-control">
          <span class="knobs-section-label">Sustain</span>
          <button
            appKnobToggle
            [on]="sustain()"
            [attr.aria-label]="sustain() ? 'Sustain on' : 'Sustain off'"
            (toggled)="toggleSustain()"
          ></button>
        </div>
      </div>

      <div class="keyboard" [style.width.rem]="whiteKeyCount * 3">
        @for (key of keys; track key.midi) {
          <button
            type="button"
            class="key"
            [class.black]="key.black"
            [class.down]="pressed().has(key.midi)"
            [style.left.rem]="key.black ? key.left * 3 - 0.9 : key.left * 3"
            [attr.aria-label]="'Play ' + key.label"
            (pointerdown)="noteOn(key.midi, $event)"
            (pointerup)="noteOff(key.midi)"
            (pointerleave)="noteOff(key.midi)"
            (pointercancel)="noteOff(key.midi)"
          >
            <span class="key-label">{{ key.label }}</span>
          </button>
        }
      </div>
    </section>
  `,
  styles: `
    .synth-controls {
      display: flex;
      align-items: flex-end;
      gap: 2rem;
    }
    .synth-control {
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
      min-width: 10rem;
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
  `,
})
export class SynthSectionComponent implements OnDestroy {
  readonly instrument = signal('lead');
  readonly sustain = signal(false);
  readonly pressed = signal<ReadonlySet<number>>(new Set());

  readonly instrumentOptions: KnobSegmentOption[] = [
    { value: 'lead', label: 'Lead' },
    { value: 'pluck', label: 'Pluck' },
  ];

  readonly keys = buildKeys(60, 72); // C4..C5
  readonly whiteKeyCount = this.keys.filter((k) => !k.black).length;

  // Lazy: the AudioContext is only constructed on the first key press, inside
  // a user gesture (and WebSynthEngine resumes a suspended context on noteOn).
  private engineInstance: SynthEngine | null = null;
  private get engine(): SynthEngine {
    this.engineInstance ??= createWebSynthEngine(this.instrument()) ?? NO_OP_ENGINE;
    return this.engineInstance;
  }

  protected noteOn(midi: number, event: PointerEvent): void {
    // Keep receiving pointerup even if the pointer wanders off the key.
    (event.target as HTMLElement).releasePointerCapture?.(event.pointerId);
    if (this.pressed().has(midi)) {
      return;
    }
    this.engine.noteOn(midi, 1);
    this.pressed.update((set) => new Set(set).add(midi));
  }

  protected noteOff(midi: number): void {
    if (!this.pressed().has(midi)) {
      return;
    }
    this.engine.noteOff(midi);
    this.pressed.update((set) => {
      const next = new Set(set);
      next.delete(midi);
      return next;
    });
  }

  protected setInstrument(id: string): void {
    this.instrument.set(id);
    this.engineInstance?.setInstrument(id);
  }

  protected toggleSustain(): void {
    const on = !this.sustain();
    this.sustain.set(on);
    this.engineInstance?.setSustain(on);
  }

  ngOnDestroy(): void {
    this.engineInstance?.allNotesOff();
  }
}
