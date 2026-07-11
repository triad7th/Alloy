import { describe, expect, it } from 'vitest';
import { PATCH_SCHEMA_VERSION, type Patch } from './dsp/patch.js';
import { WORKLET_PROCESSOR_NAME, type WireZoneLayer, type WorkletInMessage } from './worklet-host-core.js';
import { WorkletSynthHost, type MinimalWorkletContext, type MinimalWorkletNode, type MinimalWorkletPort } from './worklet-synth-host.js';

const SAMPLE_RATE = 48_000;

function makePatch(): Patch {
  return {
    schemaVersion: PATCH_SCHEMA_VERSION,
    meta: { id: 'test.worklet-synth-host', name: 'Worklet Synth Host Test', category: 'melodic' },
    layers: [
      {
        keyRange: { lowMidi: 0, highMidi: 127 },
        velRange: { low: 0, high: 1 },
        generator: { kind: 'additive', partials: [{ ratio: 1, level: 1 }] },
        tva: { level: 0.8, adsr: { attack: 0.001, decay: 0.2, sustain: 0.7, release: 0.03 }, velCurve: 1 },
      },
    ],
    sends: { reverb: 0, delay: 0 },
  };
}

interface Posted {
  message: WorkletInMessage;
  transfer: Transferable[] | undefined;
}

class FakePort implements MinimalWorkletPort {
  readonly posted: Posted[] = [];
  onmessage: ((event: { data: unknown }) => void) | null = null;

  postMessage(message: unknown, transfer?: Transferable[]): void {
    this.posted.push({ message: message as WorkletInMessage, transfer });
  }
}

class FakeNode implements MinimalWorkletNode {
  readonly port = new FakePort();
  readonly connectedTo: unknown[] = [];
  disconnected = false;

  connect(destination: unknown): void {
    this.connectedTo.push(destination);
  }

  disconnect(): void {
    this.disconnected = true;
  }
}

interface CreateWorkletNodeCall {
  name: string;
  options: { processorOptions?: unknown };
}

class FakeContext implements MinimalWorkletContext {
  readonly sampleRate = SAMPLE_RATE;
  readonly currentTime = 0;
  readonly destination = { fake: 'destination' };
  readonly addModuleCalls: string[] = [];
  readonly createWorkletNodeCalls: CreateWorkletNodeCall[] = [];
  readonly node = new FakeNode();

  audioWorklet = {
    addModule: async (url: string): Promise<void> => {
      this.addModuleCalls.push(url);
    },
  };

  createWorkletNode(name: string, options: { processorOptions?: unknown }): MinimalWorkletNode {
    this.createWorkletNodeCalls.push({ name, options });
    return this.node;
  }
}

function zoneLayer(buffer: ArrayBuffer, rootMidi: number): WireZoneLayer {
  return {
    topVelocity: 1,
    zones: [{ rootMidi, sampleRate: SAMPLE_RATE, samples: new Float32Array(buffer) }],
  };
}

describe('WorkletSynthHost', () => {
  // 1. create(): awaits addModule(moduleUrl) exactly once, constructs node
  // with WORKLET_PROCESSOR_NAME and processorOptions {maxVoices}, connects
  // to ctx.destination.
  it('creates the node via addModule + createWorkletNode and connects it to the destination', async () => {
    const ctx = new FakeContext();
    const host = await WorkletSynthHost.create(ctx, 'worklet-url.js', { maxVoices: 32 });

    expect(ctx.addModuleCalls).toEqual(['worklet-url.js']);
    expect(ctx.createWorkletNodeCalls).toEqual([{ name: WORKLET_PROCESSOR_NAME, options: { processorOptions: { maxVoices: 32 } } }]);
    expect(ctx.node.connectedTo).toEqual([ctx.destination]);
    expect(host).toBeInstanceOf(WorkletSynthHost);
  });

  // 2. setPatch posts {type:'setPatch', patch} verbatim; noteOn(60, 0.8)
  // posts atFrame === undefined; noteOn(60, 0.8, when) posts atFrame ===
  // Math.round(when * sampleRate).
  it('posts setPatch verbatim and converts noteOn `when` seconds to absolute context frames', async () => {
    const ctx = new FakeContext();
    const host = await WorkletSynthHost.create(ctx, 'worklet-url.js');
    const patch = makePatch();

    host.setPatch(patch);
    expect(ctx.node.port.posted[0]?.message).toEqual({ type: 'setPatch', patch });

    host.noteOn(60, 0.8);
    expect(ctx.node.port.posted[1]?.message).toEqual({ type: 'noteOn', midi: 60, velocity: 0.8, atFrame: undefined });

    const when = 1.25;
    host.noteOn(60, 0.8, when);
    expect(ctx.node.port.posted[2]?.message).toEqual({
      type: 'noteOn',
      midi: 60,
      velocity: 0.8,
      atFrame: Math.round(when * SAMPLE_RATE),
    });

    host.noteOff(60, when);
    expect(ctx.node.port.posted[3]?.message).toEqual({ type: 'noteOff', midi: 60, atFrame: Math.round(when * SAMPLE_RATE) });

    host.allNotesOff();
    expect(ctx.node.port.posted[4]?.message).toEqual({ type: 'allNotesOff', atFrame: undefined });
  });

  // 3. setZoneSet posts the layers AND the transfer list contains every
  // zone's samples.buffer exactly once (deduped across shared buffers).
  it('posts setZoneSet with a transfer list containing every distinct buffer exactly once', async () => {
    const ctx = new FakeContext();
    const host = await WorkletSynthHost.create(ctx, 'worklet-url.js');

    const sharedBuffer = new ArrayBuffer(16);
    const otherBuffer = new ArrayBuffer(8);
    const layers: WireZoneLayer[] = [
      { topVelocity: 0.5, zones: [{ rootMidi: 60, sampleRate: SAMPLE_RATE, samples: new Float32Array(sharedBuffer) }] },
      {
        topVelocity: 1,
        zones: [
          { rootMidi: 61, sampleRate: SAMPLE_RATE, samples: new Float32Array(sharedBuffer) },
          { rootMidi: 62, sampleRate: SAMPLE_RATE, samples: new Float32Array(otherBuffer) },
        ],
      },
    ];

    host.setZoneSet('zoneset.a', layers);

    const posted = ctx.node.port.posted[0];
    expect(posted?.message).toEqual({ type: 'setZoneSet', id: 'zoneset.a', layers });
    expect(posted?.transfer).toHaveLength(2);
    expect(new Set(posted?.transfer)).toEqual(new Set([sharedBuffer, otherBuffer]));
  });

  it('dedupes a single zone layer built from one buffer too', async () => {
    const ctx = new FakeContext();
    const host = await WorkletSynthHost.create(ctx, 'worklet-url.js');
    const buffer = new ArrayBuffer(16);

    host.setZoneSet('zoneset.b', [zoneLayer(buffer, 60)]);

    expect(ctx.node.port.posted[0]?.transfer).toEqual([buffer]);
  });

  // 4. patchRejected reply from the fake port fires onPatchRejected with the
  // errors array.
  it('surfaces a patchRejected reply through onPatchRejected', async () => {
    const ctx = new FakeContext();
    const host = await WorkletSynthHost.create(ctx, 'worklet-url.js');
    const received: string[][] = [];
    host.onPatchRejected = (errors) => received.push(errors);

    ctx.node.port.onmessage?.({ data: { type: 'patchRejected', errors: ['schemaVersion 2 !== 1'] } });

    expect(received).toEqual([['schemaVersion 2 !== 1']]);
  });

  // 5. dispose() disconnects and clears port.onmessage.
  it('disconnects the node and clears port.onmessage on dispose', async () => {
    const ctx = new FakeContext();
    const host = await WorkletSynthHost.create(ctx, 'worklet-url.js');
    expect(ctx.node.port.onmessage).not.toBeNull();

    host.dispose();

    expect(ctx.node.disconnected).toBe(true);
    expect(ctx.node.port.onmessage).toBeNull();
  });
});
