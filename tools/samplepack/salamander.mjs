// Salamander Grand Piano V3 (Alexander Holm, CC-BY 3.0) source mapping. The
// filenames ARE the key/velocity map: `{Note}{Octave}v{1..16}.wav` over 30 roots
// spaced 3 semitones apart, A0 (MIDI 21) to C8 (MIDI 108) — so the worst-case
// pitch shift at playback is +-1.5 semitones. Release samples (`rel*`) and
// sympathetic-resonance harmonics (`harm*`) have no engine support and are
// never selected.

const SEMITONE = { C: 0, 'C#': 1, D: 2, 'D#': 3, E: 4, F: 5, 'F#': 6, G: 7, 'G#': 8, A: 9, 'A#': 10, B: 11 };
const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

/** Archive-relative directory holding the note WAVs. */
export const ARCHIVE_DIR = 'SalamanderGrandPianoV3_48khz24bit/48khz24bit';

/** The 30 recorded roots: MIDI 21 (A0) to 108 (C8), every 3 semitones. */
export const SALAMANDER_ROOTS = Array.from({ length: 30 }, (_, i) => 21 + i * 3);

/** Which of the 16 recorded velocity layers the tiny tier keeps: the quartiles,
 *  evenly spaced across the source's dynamic range. THIS IS A TUNING KNOB —
 *  changing this one constant (and TOP_VELOCITIES to match) re-rolls the
 *  velocity selection and rebuilds the pack. */
export const VELOCITY_INDICES = [4, 8, 12, 16];

/** Inclusive top velocity of each kept layer, ascending; index-aligned with
 *  VELOCITY_INDICES. */
export const TOP_VELOCITIES = [0.25, 0.5, 0.75, 1.0];

/** `A0v10.wav` -> { rootMidi: 21, velocityIndex: 10 }. null for anything that is
 *  not a note sample (rel*, harm*, README, .sfz, ...). */
export function parseSampleName(name) {
  const m = /^([A-G]#?)(-?\d+)v(\d+)\.wav$/.exec(name);
  if (!m) return null;
  const [, note, octave, velocity] = m;
  return { rootMidi: (Number(octave) + 1) * 12 + SEMITONE[note], velocityIndex: Number(velocity) };
}

/** MIDI note -> Salamander file stem: 21 -> 'A0', 108 -> 'C8'. */
export function noteStem(midi) {
  return `${NAMES[midi % 12]}${Math.floor(midi / 12) - 1}`;
}

/** The 120 archive members the tiny tier needs (30 roots x 4 velocities), as
 *  paths relative to the archive root — feed straight to `tar -T`. */
export function salamanderMembers() {
  const members = [];
  for (const root of SALAMANDER_ROOTS) {
    for (const v of VELOCITY_INDICES) members.push(`${ARCHIVE_DIR}/${noteStem(root)}v${v}.wav`);
  }
  return members;
}

/** Ingested `{name, samples, sampleRate}` -> the `{..., rootMidi, layerIndex}`
 *  shape `assembleLayers` consumes. Drops anything outside the selection and
 *  sorts by (layerIndex, rootMidi) so pack output is deterministic. */
export function selectSources(files) {
  const selected = [];
  for (const file of files) {
    const parsed = parseSampleName(file.name);
    if (!parsed) continue;
    const layerIndex = VELOCITY_INDICES.indexOf(parsed.velocityIndex);
    if (layerIndex < 0) continue;
    selected.push({ ...file, rootMidi: parsed.rootMidi, layerIndex });
  }
  selected.sort((a, b) => a.layerIndex - b.layerIndex || a.rootMidi - b.rootMidi);
  return selected;
}
