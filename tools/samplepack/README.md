# samplepack

Offline build tooling for Alloy instrument packs. Pure Node (`.mjs`,
`node:test`) — web-only, no Swift twin (see `../../docs/mirroring.md`; this
tooling is out of scope for the twin-API contract).

## Build a pack

```
node tools/samplepack/build-pack.mjs <packDir>
```

This runs the full offline pipeline end to end against the procedurally
generated test pack (`gen-test-pack.mjs`): find a loop point per source
(`loop-finder.mjs`), extend it (`extendLoop`) to the smallest integer
multiple of the detected period that is at least `MIN_LOOP` (4096 samples,
~85 ms) — `findLoop` alone returns a single fundamental period, which is both
musically unusable (buzzy) and too short to fit the crossfade, and an integer
multiple keeps the loop phase-aligned so it stays seamless — bake an
equal-power crossfade at the wrap, encode to AAC (`.m4a`), decode it back and
verify the loop survived the round trip within tolerance
(`encode-verify.mjs`), assemble the per-velocity-layer zones
(`layer-assembler.mjs`), and write `<packDir>/manifest.json` +
`<packDir>/CREDITS.md` alongside the `.m4a` files. `buildPack` throws if any
zone fails loop-drift verification — the integrity gate rejects a bad pack
rather than shipping it.

Requires an AAC encoder: `afconvert` (preferred, macOS-native) or `ffmpeg`
(fallback for encode, and required for decode/verify either way).

The emitted `manifest.json` follows the `PackManifest` schema defined in
`web/packages/alloy-audio/src/pack/manifest.ts` (`validateManifest`) — that
file is the source of truth for what a loadable manifest looks like.

## Test

```
node --test tools/samplepack/*.test.mjs
```

Use the glob, not a bare directory argument — Node 25's test runner does not
recurse into a directory path the same way. The `build-pack.test.mjs`
integration test actually runs the encoder pipeline (not skipped, since this
environment has both `afconvert` and `ffmpeg`) and asserts the manifest is
structurally loadable per the same rules as `validateManifest`.

## Build the piano pack (Salamander Grand Piano V3)

```
node tools/samplepack/build-piano-pack.mjs <srcDir> <packDir>
```

The tiny tier's piano zones come from the [Salamander Grand Piano
V3](https://freepats.zenvoid.org/Piano/acoustic-grand-piano.html), recorded
by Alexander Holm and released CC-BY 3.0. The archive (~1.2 GB, 48 kHz/24-bit,
xz-compressed) is **not in the repo** — download it from that page and keep it
wherever you like locally.

`salamander.mjs` encodes the archive's naming scheme (`{Note}{Octave}v{1..16}.wav`
over 30 roots, MIDI 21..108, every 3 semitones) and picks the 120 files
(30 roots x 4 velocities) the tiny tier needs. Extract just those:

```
node tools/samplepack/build-piano-pack.mjs --print-members > members.txt
tar -xJf <archive>.tar.xz -C build/salamander-src --strip-components=2 -T members.txt
```

The archive is xz-compressed, so even a selective extract has to stream the
whole 1.2 GB once — expect 1-3 minutes. `build/salamander-src/` is gitignored;
this is a one-time local setup step, not something CI or a teammate needs to
repeat per build.

Then build the pack:

```
node tools/samplepack/build-piano-pack.mjs build/salamander-src build/piano-tiny
```

This ingests the 120 source WAVs, trims leading silence, truncates each to
`MAX_SECONDS` (12 s) with a baked fade-out, peak-normalizes, encodes to AAC,
decodes and verifies the round trip, and writes `manifest.json` +
`CREDITS.md` — the same `renderCredits` used by `build-pack.mjs`, carrying
the CC-BY 3.0 attribution to Alexander Holm and the source URL. Takes about
25 seconds and produces 120 zones (30 roots x 4 layers) at roughly 18 MB.

Piano is **one-shot**: notes are truncated-with-fade rather than looped, so
`loop-finder.mjs` is deliberately unused for this pack (`assembleLayers` is
called with an empty `loops` map). Piano decay is inharmonic — looping it
produces the buzzy "cheap ROMpler piano" sound this project rejects.
`loop-finder.mjs` stays in the tree for the looped instruments of a later
phase.

`VELOCITY_INDICES` in `salamander.mjs` is the tuning knob: it picks which 4 of
the 16 recorded velocity layers ship (currently the quartiles: 4, 8, 12, 16).
Re-rolling the selection is a one-line change to `VELOCITY_INDICES` (keep
`TOP_VELOCITIES` index-aligned with it) plus a re-extract and rebuild.

`build/piano-tiny/` (and `build/` generally) is gitignored — the pack is a
build artifact, never committed. Apps consume it from
`examples/web-harness/public/packs/`, also gitignored, or from wherever the
release pipeline eventually places it.
