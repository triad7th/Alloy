import { describe, expect, it } from 'vitest';
import { InstrumentSynthEngine } from './instrument-synth-engine.js';
import { PatchSynthEngine, type PatchSynthHost } from './patch-synth-engine.js';
class Host implements PatchSynthHost {
  events: unknown[][] = [];
  noteOn(midi: number, velocity: number) { this.events.push(['on', midi, velocity]); }
  noteOff(midi: number) { this.events.push(['off', midi]); }
  allNotesOff() { this.events.push(['panic']); }
}
const engine = (host: Host) => new PatchSynthEngine(host, 0.7);
describe('patch adapters', () => {
  it('preserves omitted and explicit velocities through routing', () => {
    const host = new Host();
    const router = new InstrumentSynthEngine(new Map([['piano', engine(host)]]), 'piano');
    router.noteOn(60); router.noteOn(61, 0.2);
    expect(host.events).toEqual([['on', 60, 0.7], ['on', 61, 0.2]]);
  });
  it('holds pedal ownership across promotion and ignores duplicate held presses', () => {
    const old = new Host(), fresh = new Host();
    const router = new InstrumentSynthEngine(new Map([['piano', engine(old)]]), 'piano');
    router.setSustain(true); router.noteOn(60); router.noteOn(60); router.noteOff(60);
    router.replaceEngine('piano', engine(fresh));
    router.noteOn(60); router.setSustain(false);
    expect(old.events).toEqual([['on', 60, 0.7]]); expect(fresh.events).toEqual([]);
    router.noteOff(60); router.noteOn(60);
    expect(old.events).toEqual([['on', 60, 0.7], ['off', 60]]);
    expect(fresh.events).toEqual([['on', 60, 0.7]]);
  });
  it('forwards pedal and panic to replaced engines and clears ownership', () => {
    const old = new Host(), fresh = new Host();
    const router = new InstrumentSynthEngine(new Map([['piano', engine(old)]]), 'piano');
    router.setSustain(true); router.noteOn(60); router.noteOff(60);
    router.replaceEngine('piano', engine(fresh)); router.noteOn(61); router.noteOff(61);
    router.setSustain(false);
    expect(old.events).toContainEqual(['off', 60]); expect(fresh.events).toContainEqual(['off', 61]);
    router.allNotesOff(); router.noteOn(60);
    expect(old.events).toContainEqual(['panic']);
    expect(fresh.events).toEqual([['on', 61, 0.7], ['off', 61], ['panic'], ['on', 60, 0.7]]);
  });
  it('selects shared engines before new notes and ignores unknown selection', () => {
    const host = new Host(); const shared = engine(host); const selections: string[] = [];
    shared.setInstrument = id => { selections.push(id); };
    const router = new InstrumentSynthEngine(new Map([['a', shared], ['b', shared]]), 'a');
    router.noteOn(60); router.setInstrument('b'); router.noteOn(61);
    router.setInstrument('unknown'); router.noteOn(62); router.noteOff(60);
    expect(selections).toEqual(['a', 'b', 'b']); expect(host.events.at(-1)).toEqual(['off', 60]);
  });
  it('panic reaches host even after released voices have left core tracking', () => {
    const host = new Host(); const synth = engine(host);
    synth.noteOn(60); synth.noteOff(60); synth.allNotesOff();
    expect(host.events).toEqual([['on', 60, 0.7], ['off', 60], ['panic']]);
  });
});
