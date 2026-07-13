import { describe, expect, it } from 'vitest';
import type { EngineEvent } from '../dsp/patch-engine.js';
import { renderPatch } from '../dsp/patch-engine.js';
import { PATCH_SAMPLE } from '../dsp/testing/golden-patches.js';
import { PACK_SCHEMA_VERSION, type PackManifest } from './manifest.js';
import { buildZone, PackLoader } from './pack-loader.js';
import type { DecodedPcm, EncodedBytes, PackSource, SampleDecoder } from './pack-source.js';

const FS = 48_000;
const ZONE_LENGTH = 4800;

/** Mono sine test asset: `cycles` full cycles over `length` samples. */
function sinePcm(length: number, cycles: number): Float32Array {
  const data = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    data[i] = Math.sin((2 * Math.PI * cycles * i) / length);
  }
  return data;
}

function piano2LayerManifest(): PackManifest {
  return {
    schemaVersion: PACK_SCHEMA_VERSION,
    id: 'test-piano',
    tier: 'tiny',
    sampleRate: FS,
    format: 'm4a',
    zoneSets: {
      piano: {
        layers: [
          { topVelocity: 0.5, zones: [{ rootMidi: 60, file: 'soft.m4a', gain: 1, tuneCents: 0 }] },
          {
            topVelocity: 1,
            zones: [
              {
                rootMidi: 60,
                file: 'loud.m4a',
                gain: 2,
                tuneCents: 50,
                loopStart: 0,
                loopEnd: ZONE_LENGTH,
              },
            ],
          },
        ],
      },
    },
    credits: [],
  };
}

/** In-memory PackSource: files map name -> a one-byte marker. */
class FakePackSource implements PackSource {
  constructor(
    private readonly manifest: PackManifest,
    private readonly files: ReadonlyMap<string, EncodedBytes>,
  ) {}

  async fetchManifest(): Promise<PackManifest> {
    return this.manifest;
  }

  async fetchZone(file: string): Promise<EncodedBytes> {
    const bytes = this.files.get(file);
    if (!bytes) throw new Error(`FakePackSource: no fixture for '${file}'`);
    return bytes;
  }
}

/** SampleDecoder that maps a one-byte marker to a known, non-silent DecodedPcm. */
class FakeDecoder implements SampleDecoder {
  constructor(private readonly pcmByMarker: ReadonlyMap<number, DecodedPcm>) {}

  async decode(bytes: EncodedBytes): Promise<DecodedPcm> {
    const pcm = this.pcmByMarker.get(bytes[0]);
    if (!pcm) throw new Error(`FakeDecoder: no fixture for marker ${bytes[0]}`);
    return pcm;
  }
}

function makeLoader(): PackLoader {
  const files = new Map<string, EncodedBytes>([
    ['soft.m4a', new Uint8Array([0])],
    ['loud.m4a', new Uint8Array([1])],
  ]);
  const pcmByMarker = new Map<number, DecodedPcm>([
    [0, { sampleRate: FS, data: new Float32Array(10).fill(0.3) }],
    [1, { sampleRate: FS, data: sinePcm(ZONE_LENGTH, 44) }],
  ]);
  const source = new FakePackSource(piano2LayerManifest(), files);
  const decoder = new FakeDecoder(pcmByMarker);
  return new PackLoader(source, decoder);
}

describe('buildZone', () => {
  it('folds gain by scaling the PCM', () => {
    const spec = { rootMidi: 60, file: 'x.m4a', gain: 2, tuneCents: 0 };
    const pcm = new Float32Array([0.1, -0.2, 0.3]);
    const zone = buildZone(spec, FS, pcm);
    const scaled = Array.from(zone.data);
    [0.2, -0.4, 0.6].forEach((expected, i) => expect(scaled[i]).toBeCloseTo(expected, 5));
  });

  it('folds tuneCents into a fractional rootMidi', () => {
    const spec = { rootMidi: 60, file: 'x.m4a', gain: 1, tuneCents: 50 };
    const zone = buildZone(spec, FS, new Float32Array([0]));
    expect(zone.rootMidi).toBeCloseTo(60.5, 10);
  });

  it('carries loop points only when both are set', () => {
    const withLoop = buildZone(
      { rootMidi: 60, file: 'x.m4a', gain: 1, tuneCents: 0, loopStart: 5, loopEnd: 10 },
      FS,
      new Float32Array(10),
    );
    expect(withLoop.loopStart).toBe(5);
    expect(withLoop.loopEnd).toBe(10);

    const oneShot = buildZone({ rootMidi: 60, file: 'x.m4a', gain: 1, tuneCents: 0 }, FS, new Float32Array(10));
    expect(oneShot.loopStart).toBeUndefined();
    expect(oneShot.loopEnd).toBeUndefined();
  });
});

describe('PackLoader', () => {
  it('provide is null before load()', () => {
    const loader = makeLoader();
    expect(loader.provide('piano')).toBeNull();
  });

  it('provide resolves the zone set after load(), with correct zone counts, roots, and loop points', async () => {
    const loader = makeLoader();
    await loader.load();

    const layers = loader.provide('piano');
    expect(layers).not.toBeNull();
    expect(layers).toHaveLength(2);

    expect(layers![0].topVelocity).toBe(0.5);
    expect(layers![0].zones).toHaveLength(1);
    expect(layers![0].zones[0].rootMidi).toBe(60);
    expect(layers![0].zones[0].loopStart).toBeUndefined();

    expect(layers![1].topVelocity).toBe(1);
    expect(layers![1].zones).toHaveLength(1);
    expect(layers![1].zones[0].rootMidi).toBe(60.5); // 60 + 50/100
    expect(layers![1].zones[0].loopStart).toBe(0);
    expect(layers![1].zones[0].loopEnd).toBe(ZONE_LENGTH);
  });

  it('provide stays null for an unrelated zoneSetId after load()', async () => {
    const loader = makeLoader();
    await loader.load();
    expect(loader.provide('nonexistent')).toBeNull();
  });
});

describe('PackLoader + renderPatch (progressive delivery)', () => {
  const patch = { ...PATCH_SAMPLE, layers: [{ ...PATCH_SAMPLE.layers[0], generator: { kind: 'sample' as const, zoneSetId: 'piano', crossfade: 0.2 } }] };
  const FRAMES = 20_000;
  const events: EngineEvent[] = [
    { frame: 0, kind: 'noteOn', midi: 60, velocity: 0.8 },
    { frame: 12_000, kind: 'noteOff', midi: 60 },
  ];

  it('renders non-silent, deterministic audio once the pack has loaded', async () => {
    const loader = makeLoader();
    await loader.load();

    const first = renderPatch(patch, events, FRAMES, FS, loader.provide);
    const second = renderPatch(patch, events, FRAMES, FS, loader.provide);

    // Sustain window: well past attack+decay (0.001s + 0.2s ≈ 9648 samples), before noteOff@12000.
    let nonSilent = false;
    for (let i = 10_000; i < 12_000; i++) {
      if (first.left[i] !== 0 || first.right[i] !== 0) {
        nonSilent = true;
        break;
      }
    }
    expect(nonSilent).toBe(true);

    expect(Array.from(second.left)).toEqual(Array.from(first.left));
    expect(Array.from(second.right)).toEqual(Array.from(first.right));
  });

  it('is silent without calling load() first (progressive fallback: unresolved zoneSetId = inactive layer)', () => {
    const loader = makeLoader(); // load() intentionally not called

    const { left, right } = renderPatch(patch, events, FRAMES, FS, loader.provide);

    expect(left.every((v) => v === 0)).toBe(true);
    expect(right.every((v) => v === 0)).toBe(true);
  });
});
