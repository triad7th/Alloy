import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ARCHIVE_DIR,
  SALAMANDER_ROOTS,
  TOP_VELOCITIES,
  VELOCITY_INDICES,
  noteStem,
  parseSampleName,
  salamanderMembers,
  selectSources,
} from './salamander.mjs';

test('parseSampleName maps real archive filenames to root + velocity', () => {
  assert.deepEqual(parseSampleName('A0v10.wav'), { rootMidi: 21, velocityIndex: 10 });
  assert.deepEqual(parseSampleName('C1v1.wav'), { rootMidi: 24, velocityIndex: 1 });
  assert.deepEqual(parseSampleName('D#1v3.wav'), { rootMidi: 27, velocityIndex: 3 });
  assert.deepEqual(parseSampleName('C4v8.wav'), { rootMidi: 60, velocityIndex: 8 });
  assert.deepEqual(parseSampleName('F#5v16.wav'), { rootMidi: 78, velocityIndex: 16 });
  assert.deepEqual(parseSampleName('C8v5.wav'), { rootMidi: 108, velocityIndex: 5 });
});

test('parseSampleName rejects the samples the engine cannot use', () => {
  // release samples and sympathetic-resonance harmonics: no engine support
  assert.equal(parseSampleName('rel79.wav'), null);
  assert.equal(parseSampleName('harmSA4.wav'), null);
  assert.equal(parseSampleName('README'), null);
  assert.equal(parseSampleName('SalamanderGrandPianoV3.sfz'), null);
});

test('the derived root grid is the archive layout: 30 roots, MIDI 21..108, every 3 semitones', () => {
  assert.equal(SALAMANDER_ROOTS.length, 30);
  assert.equal(SALAMANDER_ROOTS[0], 21);
  assert.equal(SALAMANDER_ROOTS.at(-1), 108);
  for (let i = 1; i < SALAMANDER_ROOTS.length; i++) {
    assert.equal(SALAMANDER_ROOTS[i] - SALAMANDER_ROOTS[i - 1], 3);
  }
  // Max pitch-shift at playback is half the spacing: +-1.5 semitones.
});

test('noteStem round-trips through parseSampleName for every root', () => {
  for (const root of SALAMANDER_ROOTS) {
    const parsed = parseSampleName(`${noteStem(root)}v1.wav`);
    assert.equal(parsed.rootMidi, root, `stem ${noteStem(root)} did not map back to ${root}`);
  }
});

test('salamanderMembers lists exactly the 120 files the tiny tier needs', () => {
  const members = salamanderMembers();
  assert.equal(members.length, SALAMANDER_ROOTS.length * VELOCITY_INDICES.length);
  assert.equal(members.length, 120);
  assert.equal(members[0], `${ARCHIVE_DIR}/A0v4.wav`);
  assert.equal(members.at(-1), `${ARCHIVE_DIR}/C8v16.wav`);
  assert.equal(new Set(members).size, 120, 'members must be unique');
});

test('TOP_VELOCITIES is ascending, ends at 1, and matches VELOCITY_INDICES', () => {
  assert.equal(TOP_VELOCITIES.length, VELOCITY_INDICES.length);
  assert.equal(TOP_VELOCITIES.at(-1), 1);
  for (let i = 1; i < TOP_VELOCITIES.length; i++) {
    assert.ok(TOP_VELOCITIES[i] > TOP_VELOCITIES[i - 1]);
  }
});

test('selectSources keeps only the selected velocity bands and orders output deterministically', () => {
  const files = [
    { name: 'C4v8.wav', samples: new Float32Array(1), sampleRate: 48000 },
    { name: 'A0v4.wav', samples: new Float32Array(1), sampleRate: 48000 },
    { name: 'C4v7.wav', samples: new Float32Array(1), sampleRate: 48000 }, // not a quartile
    { name: 'rel79.wav', samples: new Float32Array(1), sampleRate: 48000 },
    { name: 'A0v16.wav', samples: new Float32Array(1), sampleRate: 48000 },
  ];
  const selected = selectSources(files);
  assert.deepEqual(
    selected.map((s) => [s.name, s.rootMidi, s.layerIndex]),
    [
      ['A0v4.wav', 21, 0],
      ['C4v8.wav', 60, 1],
      ['A0v16.wav', 21, 3],
    ],
  );
});
