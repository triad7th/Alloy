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
