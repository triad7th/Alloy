import { afterEach, describe, expect, it, vi } from 'vitest';
import { WebPatchSynthEngine } from './web-patch-synth-engine.js';
import { PackLoader } from './pack/pack-loader.js';
import { FIXTURE_PATCH_JSON } from './dsp/testing/fixtures.js';
const patch = JSON.parse(FIXTURE_PATCH_JSON);
function setup(failLoad = false, failConnect = false) {
  const messages: any[] = [];
  const transfers: Transferable[][] = [];
  const node = { port: { onmessage: null, postMessage: (message: unknown, transfer: Transferable[] = []) => { messages.push(message); transfers.push(transfer); } },
    connect: vi.fn(() => { if (failConnect) throw Error('connect'); }), disconnect: vi.fn() };
  const context = { sampleRate: 48000, currentTime: 0, state: 'suspended', resume: vi.fn(async () => {}),
    destination: {}, audioWorklet: { addModule: vi.fn(async () => {}) }, createWorkletNode: vi.fn(() => node) };
  const loader = new PackLoader({ fetchManifest: async () => {
    if (failLoad) throw Error('load');
    return { schemaVersion: 1, id: 'test', tier: 'tiny', sampleRate: 48000, format: 'm4a',
      zoneSets: { piano: { layers: [{ topVelocity: 1, zones: [{ rootMidi: 60, file: 'c.m4a', gain: 1, tuneCents: 0 }] }] } }, credits: [] };
  }, fetchZone: async () => new ArrayBuffer(1) }, { decode: async () => ({ data: new Float32Array([0.1, 0.2]), sampleRate: 48000 }) });
  return { messages, transfers, node, context, loader };
}
describe('WebPatchSynthEngine', () => {
  afterEach(() => vi.unstubAllGlobals());
  it('constructs the raw browser worklet with stereo output', async () => {
    const s = setup();
    const { createWorkletNode: _, ...raw } = s.context;
    let options: unknown;
    vi.stubGlobal('AudioWorkletNode', class {
      constructor(_context: unknown, _name: string, passed: unknown) { options = passed; return s.node; }
    });
    const engine = await WebPatchSynthEngine.create(raw, patch, s.loader, ['piano'], '/w.js');
    expect(options).toMatchObject({ outputChannelCount: [2] });
    engine.dispose();
  });
  it('loads zones, transfers original buffers, applies patch, and resumes synchronously on gesture', async () => {
    const s = setup();
    const engine = await WebPatchSynthEngine.create(s.context, patch, s.loader, ['piano'], '/worklet.js', 0.7);
    expect(s.messages.map(x => x.type)).toEqual(['setZoneSet', 'setPatch']);
    const zone = s.messages[0].layers[0].zones[0];
    expect(zone.sampleRate).toBe(48000);
    expect(s.transfers[0]).toEqual([zone.samples.buffer]);
    expect(zone.samples.buffer).toBe(s.loader.provide('piano')![0].zones[0].data.buffer);
    engine.noteOn(60);
    expect(s.context.resume).toHaveBeenCalledTimes(1);
    expect(s.messages.at(-1)).toMatchObject({ type: 'noteOn', midi: 60, velocity: 0.7 });
    engine.dispose(); engine.dispose(); engine.noteOn(61);
    expect(s.node.disconnect).toHaveBeenCalledTimes(1);
    expect(s.messages.at(-1)).toEqual({ type: 'allNotesOff' });
  });
  it('disconnects graph when pack loading fails', async () => {
    const s = setup(true);
    await expect(WebPatchSynthEngine.create(s.context, patch, s.loader, ['piano'], '/w.js')).rejects.toThrow('load');
    expect(s.node.disconnect).toHaveBeenCalledTimes(1);
    expect(s.node.port.onmessage).toBeNull();
  });
  it('disconnects a partially created graph when connection fails', async () => {
    const s = setup(false, true);
    await expect(WebPatchSynthEngine.create(s.context, patch, s.loader, ['piano'], '/w.js')).rejects.toThrow('connect');
    expect(s.node.disconnect).toHaveBeenCalledTimes(1);
  });
  it('rejects absent requested zone sets and invalid patches', async () => {
    const s = setup();
    await expect(WebPatchSynthEngine.create(s.context, patch, s.loader, ['missing'], '/w.js')).rejects.toThrow('missing');
    expect(s.node.disconnect).toHaveBeenCalledTimes(1);
    const t = setup();
    await expect(WebPatchSynthEngine.create(t.context, { ...patch, schemaVersion: 99 }, t.loader, ['piano'], '/w.js')).rejects.toThrow();
    expect(t.context.createWorkletNode).not.toHaveBeenCalled();
  });
});
