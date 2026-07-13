import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { mkdtempSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildPack, renderCredits } from './build-pack.mjs';

function hasBin(bin) {
  try {
    execSync(`command -v ${bin}`, { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

const hasEncoders = hasBin('afconvert') || hasBin('ffmpeg');

/** Inline replica of the key structural rules from
 *  web/packages/alloy-audio/src/pack/manifest.ts's validateManifest, so this
 *  Node tool test can prove the emitted manifest is loadable without taking a
 *  TS build dependency. */
function assertManifestStructurallyValid(manifest, packDir) {
  assert.equal(manifest.schemaVersion, 1);
  assert.ok(manifest.id.length > 0);
  assert.equal(manifest.tier, 'tiny');
  assert.ok(manifest.sampleRate > 0);
  assert.equal(manifest.format, 'm4a');
  const zoneSetIds = Object.keys(manifest.zoneSets);
  assert.ok(zoneSetIds.length >= 1);
  for (const id of zoneSetIds) {
    const { layers } = manifest.zoneSets[id];
    assert.ok(layers.length >= 1);
    let prevTop = -Infinity;
    for (const layer of layers) {
      assert.ok(layer.topVelocity > 0 && layer.topVelocity <= 1, `topVelocity ${layer.topVelocity} outside (0,1]`);
      assert.ok(layer.topVelocity > prevTop, `topVelocity ${layer.topVelocity} not strictly ascending`);
      prevTop = layer.topVelocity;
      assert.ok(layer.zones.length >= 1);
      for (const z of layer.zones) {
        assert.ok(z.rootMidi >= 0 && z.rootMidi <= 127);
        assert.ok(z.file.length > 0);
        assert.ok(existsSync(join(packDir, z.file)), `missing m4a file ${z.file}`);
        assert.ok(z.gain > 0);
        const hasStart = z.loopStart !== undefined;
        const hasEnd = z.loopEnd !== undefined;
        assert.equal(hasStart, hasEnd, 'loopStart/loopEnd must both be set or both omitted');
        if (hasStart && hasEnd) assert.ok(z.loopStart < z.loopEnd);
      }
    }
  }
}

test(
  'buildPack runs the full offline pipeline and emits a loadable pack',
  { skip: !hasEncoders },
  () => {
    const dir = mkdtempSync(join(tmpdir(), 'samplepack-build-'));
    try {
      const { manifest, packDir } = buildPack({ packDir: dir });
      assert.equal(packDir, dir);

      const zoneSet = manifest.zoneSets.piano;
      assert.ok(zoneSet, 'expected a piano zoneSet');
      assert.equal(zoneSet.layers.length, 2);

      let prevTop = -Infinity;
      for (const layer of zoneSet.layers) {
        assert.ok(layer.topVelocity > prevTop, 'topVelocity must be strictly ascending');
        prevTop = layer.topVelocity;
        assert.equal(layer.zones.length, 4);
        for (const zone of layer.zones) {
          assert.ok(Number.isFinite(zone.loopStart));
          assert.ok(Number.isFinite(zone.loopEnd));
          assert.ok(zone.loopStart < zone.loopEnd);
          assert.match(zone.file, /\.m4a$/);
          assert.ok(existsSync(join(dir, zone.file)), `expected ${zone.file} to exist on disk`);
        }
      }

      const manifestPath = join(dir, 'manifest.json');
      assert.ok(existsSync(manifestPath));
      const reparsed = JSON.parse(readFileSync(manifestPath, 'utf8'));
      assert.deepEqual(reparsed, manifest);
      assertManifestStructurallyValid(reparsed, dir);

      const creditsPath = join(dir, 'CREDITS.md');
      assert.ok(existsSync(creditsPath));
      const credits = readFileSync(creditsPath, 'utf8');
      assert.match(credits, /CC0/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  },
);

test('renderCredits formats a known credits array with source and license', () => {
  const md = renderCredits([
    { source: 'Alloy generated test pack (procedural harmonics)', license: 'CC0' },
    { source: 'Third-party sample', license: 'CC-BY 4.0', url: 'https://example.com/license' },
  ]);
  assert.match(md, /^# Credits\n\n/);
  assert.match(md, /- \*\*Alloy generated test pack \(procedural harmonics\)\*\* — CC0/);
  assert.match(md, /- \*\*Third-party sample\*\* — CC-BY 4\.0 \(https:\/\/example\.com\/license\)/);
});
