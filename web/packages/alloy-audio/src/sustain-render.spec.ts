import { describe, expect, it } from 'vitest';
import { InstrumentSynthEngine } from './instrument-synth-engine.js';
import { PatchSynthEngine } from './patch-synth-engine.js';
import { WorkletHostCore } from './worklet-host-core.js';

describe('sustained sample playback', () => {
  it('renders a new sample attack on every re-press after the previous sample ends', () => {
    const host = new WorkletHostCore(48000, 0);
    host.onMessage({ type: 'setZoneSet', id: 'piano', layers: [{ topVelocity: 1, zones: [{
      rootMidi: 69, sampleRate: 48000,
      samples: Float32Array.from({ length: 2048 }, (_, i) =>
        0.5 * Math.sin(2 * Math.PI * 440 * i / 48000) * (1 - i / 2048)),
    }] }] });
    host.onMessage({ type: 'setPatch', patch: {
      schemaVersion: 1, meta: { id: 'test.sustain', name: 'Sustain', category: 'melodic' },
      layers: [{ keyRange: { lowMidi: 0, highMidi: 127 }, velRange: { low: 0, high: 1 },
        generator: { kind: 'sample', zoneSetId: 'piano', crossfade: 0 },
        tva: { level: 1, adsr: { attack: 0, decay: 0, sustain: 1, release: 0.1 }, velCurve: 1 },
      }], sends: { reverb: 0, delay: 0 },
    } });
    const patch = new PatchSynthEngine({
      noteOn: (midi, velocity) => host.onMessage({ type: 'noteOn', midi, velocity }),
      noteOff: midi => host.onMessage({ type: 'noteOff', midi }),
      allNotesOff: () => host.onMessage({ type: 'allNotesOff' }),
    }, 0.7);
    const router = new InstrumentSynthEngine(new Map([['piano', patch]]), 'piano');
    router.setSustain(true);
    for (let strike = 0; strike < 3; strike++) {
      router.noteOn(69);
      router.noteOff(69);
      const left = new Float32Array(4096), right = new Float32Array(4096);
      const errors: unknown[] = [];
      host.render(left, right, 4096, error => errors.push(error));
      expect(errors).toEqual([]);
      expect(Math.max(...left.map(Math.abs))).toBeGreaterThan(0.1);
      expect(Math.max(...left.subarray(3072).map(Math.abs))).toBeLessThan(0.00001);
    }
  });
});
