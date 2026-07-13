import { test } from 'node:test';
import assert from 'node:assert/strict';
import { peakGain, assembleLayers } from './layer-assembler.mjs';
import { genTestPack } from './gen-test-pack.mjs';

test('peakGain brings a 0.5-peak buffer to ~0.9 (gain ~1.8)', () => {
  const samples = new Float32Array([0, 0.5, -0.3, 0.2]);
  const gain = peakGain(samples, 0.9);
  assert.ok(Math.abs(gain - 1.8) < 1e-9, `expected ~1.8, got ${gain}`);
});

test('peakGain returns 1 for an all-zero buffer', () => {
  const samples = new Float32Array([0, 0, 0]);
  assert.equal(peakGain(samples, 0.9), 1);
});

test('assembleLayers groups a 2-layer x 4-root test pack into ascending layers', () => {
  const { sources } = genTestPack();
  const { layers } = assembleLayers(sources, { topVelocities: [0.6, 1.0] });

  assert.equal(layers.length, 2);
  assert.equal(layers[0].topVelocity, 0.6);
  assert.equal(layers[1].topVelocity, 1.0);

  for (const layer of layers) {
    assert.equal(layer.zones.length, 4);
    const roots = layer.zones.map((z) => z.rootMidi);
    const sorted = [...roots].sort((a, b) => a - b);
    assert.deepEqual(roots, sorted, 'zones must be sorted by rootMidi');
    for (const zone of layer.zones) {
      assert.ok(zone.file.endsWith('.m4a'), `expected .m4a file name, got ${zone.file}`);
      assert.ok(zone.gain > 0, `expected positive gain, got ${zone.gain}`);
      assert.equal(zone.tuneCents, 0);
    }
  }
});

test('assembleLayers attaches loop points only for sources with a loops entry', () => {
  const { sources } = genTestPack();
  const looped = sources[0];
  const oneShot = sources[1];
  const loops = { [looped.name]: { loopStart: 100, loopEnd: 2000 } };

  const { layers } = assembleLayers(sources, { topVelocities: [0.6, 1.0], loops });

  const findZone = (source) =>
    layers.flatMap((l) => l.zones).find((z) => z.file === source.name.replace(/\.wav$/, '.m4a'));

  const loopedZone = findZone(looped);
  assert.equal(loopedZone.loopStart, 100);
  assert.equal(loopedZone.loopEnd, 2000);

  const oneShotZone = findZone(oneShot);
  assert.equal('loopStart' in oneShotZone, false);
  assert.equal('loopEnd' in oneShotZone, false);
});
