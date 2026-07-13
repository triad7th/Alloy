import { describe, expect, it } from 'vitest';
import { PACK_SCHEMA_VERSION, validateManifest, type PackManifest } from './manifest.js';

function goodManifest(): PackManifest {
  return {
    schemaVersion: PACK_SCHEMA_VERSION,
    id: 'grand-piano',
    tier: 'standard',
    sampleRate: 48000,
    format: 'm4a',
    zoneSets: {
      main: {
        layers: [
          {
            topVelocity: 0.5,
            zones: [{ rootMidi: 60, file: 'c4-soft.m4a', gain: 1, tuneCents: 0 }],
          },
          {
            topVelocity: 1,
            zones: [
              {
                rootMidi: 60,
                file: 'c4-loud.m4a',
                loopStart: 100,
                loopEnd: 200,
                gain: 0.9,
                tuneCents: -3,
              },
            ],
          },
        ],
      },
    },
    credits: [{ source: 'Acme Samples', license: 'CC0', url: 'https://example.com' }],
  };
}

describe('validateManifest', () => {
  it('accepts a well-formed manifest', () => {
    expect(validateManifest(goodManifest())).toEqual([]);
  });

  it('rejects wrong schemaVersion', () => {
    const m = { ...goodManifest(), schemaVersion: 2 };
    expect(validateManifest(m)).not.toHaveLength(0);
  });

  it('rejects empty id', () => {
    const m = { ...goodManifest(), id: '' };
    expect(validateManifest(m)).not.toHaveLength(0);
  });

  it('rejects bad tier', () => {
    const m = { ...goodManifest(), tier: 'ultra' } as unknown as PackManifest;
    expect(validateManifest(m)).not.toHaveLength(0);
  });

  it('rejects sampleRate 0', () => {
    const m = { ...goodManifest(), sampleRate: 0 };
    expect(validateManifest(m)).not.toHaveLength(0);
  });

  it('rejects non-m4a format', () => {
    const m = { ...goodManifest(), format: 'wav' } as unknown as PackManifest;
    expect(validateManifest(m)).not.toHaveLength(0);
  });

  it('rejects empty zoneSets', () => {
    const m = { ...goodManifest(), zoneSets: {} };
    expect(validateManifest(m)).not.toHaveLength(0);
  });

  it('rejects empty layers', () => {
    const base = goodManifest();
    const m = { ...base, zoneSets: { main: { layers: [] } } };
    expect(validateManifest(m)).not.toHaveLength(0);
  });

  it('rejects non-ascending topVelocity', () => {
    const base = goodManifest();
    const layers = base.zoneSets.main.layers;
    const m = { ...base, zoneSets: { main: { layers: [layers[1], layers[0]] } } };
    expect(validateManifest(m)).not.toHaveLength(0);
  });

  it('rejects empty zones', () => {
    const base = goodManifest();
    const layers = [{ ...base.zoneSets.main.layers[0], zones: [] }, base.zoneSets.main.layers[1]];
    const m = { ...base, zoneSets: { main: { layers } } };
    expect(validateManifest(m)).not.toHaveLength(0);
  });

  it('rejects rootMidi 200', () => {
    const base = goodManifest();
    const zones = [{ ...base.zoneSets.main.layers[0].zones[0], rootMidi: 200 }];
    const layers = [{ ...base.zoneSets.main.layers[0], zones }, base.zoneSets.main.layers[1]];
    const m = { ...base, zoneSets: { main: { layers } } };
    expect(validateManifest(m)).not.toHaveLength(0);
  });

  it('rejects empty file', () => {
    const base = goodManifest();
    const zones = [{ ...base.zoneSets.main.layers[0].zones[0], file: '' }];
    const layers = [{ ...base.zoneSets.main.layers[0], zones }, base.zoneSets.main.layers[1]];
    const m = { ...base, zoneSets: { main: { layers } } };
    expect(validateManifest(m)).not.toHaveLength(0);
  });

  it('rejects gain 0', () => {
    const base = goodManifest();
    const zones = [{ ...base.zoneSets.main.layers[0].zones[0], gain: 0 }];
    const layers = [{ ...base.zoneSets.main.layers[0], zones }, base.zoneSets.main.layers[1]];
    const m = { ...base, zoneSets: { main: { layers } } };
    expect(validateManifest(m)).not.toHaveLength(0);
  });

  it('rejects half-specified loop', () => {
    const base = goodManifest();
    const zones = [{ ...base.zoneSets.main.layers[0].zones[0], loopStart: 10 }];
    const layers = [{ ...base.zoneSets.main.layers[0], zones }, base.zoneSets.main.layers[1]];
    const m = { ...base, zoneSets: { main: { layers } } };
    expect(validateManifest(m)).not.toHaveLength(0);
  });

  it('rejects inverted loop', () => {
    const base = goodManifest();
    const zones = [{ ...base.zoneSets.main.layers[1].zones[0], loopStart: 200, loopEnd: 100 }];
    const layers = [base.zoneSets.main.layers[0], { ...base.zoneSets.main.layers[1], zones }];
    const m = { ...base, zoneSets: { main: { layers } } };
    expect(validateManifest(m)).not.toHaveLength(0);
  });

  it('round-trips through JSON and still validates clean', () => {
    const roundTripped = JSON.parse(JSON.stringify(goodManifest())) as PackManifest;
    expect(validateManifest(roundTripped)).toEqual([]);
  });
});
