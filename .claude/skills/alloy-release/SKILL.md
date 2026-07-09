---
name: alloy-release
description: Cut an Alloy release — tag the repo and attach npm tarballs to a GitHub Release via tools/release.mjs. Use when the user asks to release, cut a release, tag a version, publish a new version, ship alloy-time or alloy-ui, or attach release tarballs.
---

# Alloy Release

Cut a release using `tools/release.mjs` — never run the tag/pack/upload
steps by hand; the script guards the invariants (clean pushed tree, green
suites, fresh generated outputs, correct packing directories).

## Workflow

1. Decide the version and which packages ride it:
   - One repo tag per release (release train). Packages under
     `web/packages/*` whose `package.json` version equals the tag get
     tarballs attached; unchanged packages keep their old version.
2. Prepare:
   - Bump `package.json` for each package being released to the new version.
   - Commit (conventional style) and push, so `main` == `origin/main`.
3. Sanity-check without side effects:
   - `node tools/release.mjs <version> --dry-run`
   - Dry run downgrades tree-state guards to warnings and stops before
     tagging; it still runs both suites and packs tarballs.
4. Release:
   - `node tools/release.mjs <version>` (add `--notes "..."` for custom
     release notes; default is `--generate-notes`).
5. Verify:
   - `gh release view <version>` — confirm title and expected asset(s).

## Rules

- Never `npm pack` alloy-ui from `web/packages/alloy-ui` — the script packs
  from the ng-packagr output at `web/dist/alloy-ui`; packing from src ships
  a broken tarball.
- If the script fails a guard (dirty tree, stale generated outputs, failing
  suite, existing tag), fix the cause and re-run; do not work around a guard
  by hand.
- Do not bump a package version and leave it unreleased on `main` — bump and
  release in the same sitting.

## Final Response

Report:

- Tag and release title created, with URL.
- Which packages/tarballs were attached.
- Test suite results the script ran.
