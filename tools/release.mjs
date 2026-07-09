#!/usr/bin/env node
// Release train for Alloy. One repo tag per release; npm packages whose
// package.json version equals the tag ride the train and get tarballs
// attached to the GitHub Release. Usage:
//
//   node tools/release.mjs <version> [--dry-run] [--notes "..."]
//
// The script is the release procedure — it guards the invariants that are
// easy to get wrong by hand (packing alloy-ui from ng-packagr output, stale
// generated tables, tagging a dirty or unpushed tree).
import { execSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const notesIdx = args.indexOf('--notes');
const notes = notesIdx !== -1 ? args[notesIdx + 1] : null;
const version = args.find((a) => !a.startsWith('--') && a !== notes);

const fail = (msg) => {
  console.error(`✗ ${msg}`);
  process.exit(1);
};
const run = (cmd, opts = {}) =>
  execSync(cmd, { cwd: root, encoding: 'utf8', stdio: ['inherit', 'pipe', 'inherit'], ...opts })
    ?.toString()
    .trim();
const step = (msg) => console.log(`— ${msg}`);

if (!version || !/^\d+\.\d+\.\d+$/.test(version)) {
  fail('usage: node tools/release.mjs <major.minor.patch> [--dry-run] [--notes "..."]');
}

// ---- Guards: released code is exactly what's on origin/main ----
// In --dry-run these are warnings so the packaging can be sanity-checked
// before committing; a real release never proceeds past them.
const guard = (msg) => (dryRun ? console.warn(`⚠ ${msg} (continuing: dry run)`) : fail(msg));
step('checking repository state');
if (run('git status --porcelain')) guard('working tree is not clean');
if (run('git rev-parse --abbrev-ref HEAD') !== 'main') guard('not on main');
run('git fetch origin --tags');
if (run('git rev-parse HEAD') !== run('git rev-parse origin/main')) {
  guard('HEAD is not in sync with origin/main — push (or pull) first');
}
if (run(`git tag -l ${version}`)) fail(`tag ${version} already exists`);

// ---- Which packages ride this train? ----
const packagesDir = join(root, 'web/packages');
const releasing = readdirSync(packagesDir)
  .map((name) => {
    const manifestPath = join(packagesDir, name, 'package.json');
    if (!existsSync(manifestPath)) return null;
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    return { dir: name, name: manifest.name, version: manifest.version };
  })
  .filter((p) => p && p.version === version);
if (releasing.length === 0) {
  fail(`no package under web/packages has version ${version} — bump the package.json(s) first`);
}
step(`releasing: ${releasing.map((p) => `${p.name}@${p.version}`).join(', ')}`);

// ---- Validate: both suites green, generated outputs fresh ----
if (!existsSync(join(root, 'web/node_modules'))) {
  step('installing web dependencies (npm ci)');
  run('npm ci', { cwd: join(root, 'web') });
}
step('running Swift suite');
run('swift test');
step('running web suites');
run('npm test', { cwd: join(root, 'web') });
step('checking generated outputs are fresh');
const generated = [
  'web/packages/alloy-ui/src/styles/_tokens.scss',
  'web/packages/alloy-ui/src/lib/tokens.ts',
  'swift/Sources/AlloyUI/AlloyTokens.swift',
  'swift/Sources/AlloyTime/ZoneCountry.swift',
];
run('node tools/generate-tokens.mjs');
run('node tools/generate-zone-country.mjs');
try {
  run(`git diff --exit-code -- ${generated.join(' ')}`);
} catch {
  fail('generated outputs are stale — regenerate, commit, and push before releasing');
}

// ---- Pack. Each package's strategy is explicit; unknown packages fail. ----
step('packing tarballs');
const tarballs = releasing.map((pkg) => {
  let packDir;
  if (pkg.dir === 'alloy-time' || pkg.dir === 'alloy-audio') {
    // Plain tsc packages: prepack compiles, packs from the package directory.
    packDir = join(packagesDir, pkg.dir);
  } else if (pkg.dir === 'alloy-ui') {
    // Angular library: MUST pack from the ng-packagr output, never from src.
    run('npx ng build alloy-ui', { cwd: join(root, 'web') });
    packDir = join(root, 'web/dist/alloy-ui');
  } else {
    fail(`don't know how to pack ${pkg.name} — teach tools/release.mjs first`);
  }
  const tarball = run(`npm pack --pack-destination "${root}"`, { cwd: packDir })
    .split('\n')
    .pop();
  return join(root, tarball);
});
tarballs.forEach((t) => console.log(`  ${t}`));

// ---- Tag + GitHub Release ----
// 'alloy-time' -> 'AlloyTime' etc.; multi-package trains title as 'Alloy'.
const productName = (dir) =>
  'Alloy' + dir.replace(/^alloy-/, '').replace(/(^|-)(\w)/g, (_, __, c) => c.toUpperCase());
const title =
  releasing.length === 1 ? `${productName(releasing[0].dir)} ${version}` : `Alloy ${version}`;
if (dryRun) {
  step(`dry run — would create release "${title}" (tag ${version}) with ${tarballs.length} asset(s)`);
} else {
  step(`creating release "${title}" (tag ${version})`);
  const notesFlag = notes ? `--notes ${JSON.stringify(notes)}` : '--generate-notes';
  run(
    `gh release create ${version} ${tarballs.map((t) => JSON.stringify(t)).join(' ')} ` +
      `--target ${run('git rev-parse HEAD')} --title ${JSON.stringify(title)} ${notesFlag}`
  );
  run('git fetch origin --tags');
}

tarballs.forEach((t) => rmSync(t, { force: true }));
step(dryRun ? 'dry run complete' : `released ${version}`);
