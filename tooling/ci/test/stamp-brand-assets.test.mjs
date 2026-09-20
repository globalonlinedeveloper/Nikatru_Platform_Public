// ─────────────────────────────────────────────────────────────────────────────
// stamp-brand-assets.test.mjs — assert-stamp-brand-assets.mjs must be able to FAIL.
//
// [pipeline S-14] A stamp carries the app's brand assets, never Flutter's.
//
// ⚠️ REAL-STAMP MUTATIONS FIRST (2026-07-29, six, against a freshly stamped
// `apps/probe` and the real Flutter 3.44.7 SDK, predictions written first):
//   M1 SDK stock Icon-192 copied over the generated one -> caught, byte-identical
//   M2 Icon-maskable-512.png deleted                    -> caught, MISSING
//   M3 an icon truncated to 10 bytes                    -> caught, not a valid PNG
//   M4 asserted against the wrong seed                  -> caught on all 5 assets
//   M5 the Flutter SDK hidden from PATH + FLUTTER_ROOT  -> COVERAGE LOST, exit 1
//      (exit 2 since 2026-09-11: coverage loss is never the finding exit code)
//   M6 the platform claim emptied in apps.json          -> COVERAGE LOST
//
// 🔬 M5 IS THE ONE THAT MATTERED AND IT FAILED ITS FIRST ATTEMPT — stripping
// PATH to hide Flutter also hid `node`, so the command produced NO output and
// "no failure message" briefly looked like a pass. A mutation that runs nothing
// proves nothing. Re-run with node's directory kept on PATH, it exits 1.
//
// 🔴 M7, 2026-08-04 — THE FIXTURE ITSELF WAS THE BUG, and it hid a real one for
// the whole life of this guard. It built a synthetic SDK template tree and wrote
// REAL PNG BYTES into files it named `.img.tmpl`. In a real Flutter install
// every `.img.tmpl` is ZERO BYTES, so the guard's two MASKABLE comparisons ran
// against empty buffers and could never have matched — while it printed
// `5 stock asset(s) compared` and exited 0. All six tests here passed the whole
// time, because a fixture written by whoever wrote the guard encodes the same
// misunderstanding as the guard.
//
// Proven on the REAL tree, not here: the stock `Icon-maskable-512.png` copied
// over apps/subscriptiontracker's left the guard AT HEAD printing ok / exit 0, and the
// repaired guard exits 1.
//
// 🔴 M8, 2026-09-21 — THE GUARD GRADED THE FOLDER, NOT AN APP, AND HAD DONE SO
// IN EVERY WORKTREE SINCE IT WAS WRITTEN. `basename(appDir)` as the app id plus
// `appDir/../../catalog/apps.json` as the catalogue: run with no argument, which
// is how guard-sweep.mjs's bare-invocation fallback runs it, both guesses were
// wrong at once — it looked up the WORKTREE'S folder name in the MAIN
// checkout's catalogue. Observed by two independent lanes on 2026-09-20
// (`.worktrees/donut`, `.worktrees/replay-fixture`). Six cases at the end of
// this file pin the repair; the mutation is in their comment.
//
// These fixtures now supply a FAKE `flutter` executable (FLUTTER_ROOT is
// injected) which copies out a reference app, because the guard now establishes
// stock bytes by RUNNING `flutter create`. There is no template layout left for
// a fixture to model wrongly.
//
// Run:  node --test "tooling/ci/test/*.test.mjs"
// ─────────────────────────────────────────────────────────────────────────────
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, chmodSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';
// The one bounded directory listing — used to prove where the reader's cache lands.
import { listDir } from '../tree-walk.mjs';

const CI_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const GUARD = join(CI_DIR, 'assert-stamp-brand-assets.mjs');

let TMP;
before(() => { TMP = mkdtempSync(join(tmpdir(), 'nikatru-brand-')); });
after(() => { rmSync(TMP, { recursive: true, force: true }); });

// 🔴 THE READER'S CACHE GOES INTO THIS FILE'S OWN TEMP ROOT. flutter-stock-assets
// caches one `flutter create` per SDK under os.tmpdir(), keyed by the SDK's path,
// and every fixture below is a NEW SDK path — so each run used to leave a
// `nikatru-flutter-stock-*` folder in the shared temp directory for ever: 10
// after one run of this file, measured 2026-09-11 in a private TMPDIR. Pointing
// the guard's temp directory at TMP (removed in `after`) leaves the guard's real
// caching untouched. All three names: os.tmpdir() reads TMPDIR on POSIX and
// TEMP, then TMP, on Windows.
const fixtureTemp = () => ({ TMPDIR: TMP, TEMP: TMP, TMP });

let seq = 0;

// ── a minimal real PNG, so "valid PNG" is exercised rather than assumed ──────
function u32(v) { return Buffer.from([(v >> 24) & 255, (v >> 16) & 255, (v >> 8) & 255, v & 255]); }
function crc32(buf) {
  let c;
  const table = [];
  for (let n = 0; n < 256; n++) {
    c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  let crc = 0xffffffff;
  for (const b of buf) crc = table[(crc ^ b) & 255] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  return Buffer.concat([u32(data.length), body, u32(crc32(body))]);
}
/** Solid-colour 8-bit truecolour PNG, filter 0 — the shape the brick generates. */
function png(size, rgbHex) {
  const r = parseInt(rgbHex.slice(0, 2), 16);
  const g = parseInt(rgbHex.slice(2, 4), 16);
  const b = parseInt(rgbHex.slice(4, 6), 16);
  const rows = [];
  for (let y = 0; y < size; y++) {
    const row = Buffer.alloc(1 + size * 3);
    for (let x = 0; x < size; x++) { row[1 + x * 3] = r; row[2 + x * 3] = g; row[3 + x * 3] = b; }
    rows.push(row);
  }
  const ihdr = Buffer.concat([u32(size), u32(size), Buffer.from([8, 2, 0, 0, 0])]);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(Buffer.concat(rows))),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const ASSETS = [
  ['web/favicon.png', 'favicon.png'],
  ['web/icons/Icon-192.png', 'Icon-192.png'],
  ['web/icons/Icon-512.png', 'Icon-512.png'],
  ['web/icons/Icon-maskable-192.png', 'Icon-maskable-192.png'],
  ['web/icons/Icon-maskable-512.png', 'Icon-maskable-512.png'],
];

const STOCK_COLOUR = '0175c2'; // Flutter's default blue, standing in for stock

function world({
  appColour = '6459f5',
  omit = [],
  corrupt = [],
  useStock = [],
  platforms = ['web'],
  emptyStock = false,
  noStockIcons = false,
  // ── the three options that exist for O-STAMP-GUARD-READS-THE-DIRECTORY-NAME-AS-AN-APP-ID ──
  // `worktreeName` puts the whole checkout at `<base>/.worktrees/<name>`, which
  // is the real shape the defect was observed in: a lane's branch workspace,
  // whose directory name is not an app and never will be.
  worktreeName = null,
  // An enclosing checkout ABOVE that worktree, with a catalogue of its OWN.
  // `appDir/../../catalog/apps.json` reached it, so the guard graded one tree
  // out of another tree's facts.
  enclosingCatalogue = false,
  // No catalogue anywhere: nothing can say which directories are apps.
  omitCatalogue = false,
} = {}) {
  const base = join(TMP, `r${seq++}`);
  const root = worktreeName ? join(base, '.worktrees', worktreeName) : base;
  const appDir = join(root, 'apps', 'probe');

  // ── the SDK: a FAKE `flutter` that emits a reference app ──────────────────
  // 🔴 THIS FIXTURE USED TO BUILD A SYNTHETIC TEMPLATE TREE, and it is why all
  // six of its tests passed while two of the guard's five comparisons were
  // against empty buffers. In a real Flutter install every `.img.tmpl` is ZERO
  // BYTES — `Icon-maskable-192/512` among them — and this fixture wrote real PNG
  // bytes into files it NAMED `.img.tmpl`. A fixture written by whoever wrote
  // the guard encodes the same misunderstanding as the guard; this repo has that
  // rule on record, and this was it happening.
  //
  // Modelling the template layout more carefully was the wrong repair (it was
  // tried, and CI killed it: a prebuilt SDK resolves the images package
  // differently). The guard now RUNS `flutter create`, so the fixture supplies a
  // fake `flutter` that copies out a reference app — no layout to model at all.
  const sdkRoot = join(root, 'sdk');
  const reference = join(root, 'reference', 'stockref');
  mkdirSync(join(reference, 'web', 'icons'), { recursive: true });
  if (!noStockIcons) {
    writeFileSync(join(reference, 'web', 'favicon.png'), png(8, STOCK_COLOUR));
    for (const n of ['Icon-192', 'Icon-512', 'Icon-maskable-192', 'Icon-maskable-512']) {
      writeFileSync(join(reference, 'web', 'icons', `${n}.png`), emptyStock ? Buffer.alloc(0) : png(8, STOCK_COLOUR));
    }
  }
  const bin = join(sdkRoot, 'bin');
  mkdirSync(bin, { recursive: true });
  if (process.platform === 'win32') {
    writeFileSync(join(bin, 'flutter.bat'), `@echo off\r\nxcopy /E /I /Q /Y "${reference}" "stockref" >nul\r\nexit /b 0\r\n`);
  } else {
    const p = join(bin, 'flutter');
    writeFileSync(p, `#!/bin/sh\ncp -R "${reference}" "./stockref"\nexit 0\n`);
    chmodSync(p, 0o755);
  }

  mkdirSync(join(appDir, 'web', 'icons'), { recursive: true });
  for (const [rel] of ASSETS) {
    if (omit.includes(rel)) continue;
    const p = join(appDir, rel);
    if (corrupt.includes(rel)) { writeFileSync(p, Buffer.from('not a png')); continue; }
    writeFileSync(p, useStock.includes(rel) ? png(8, STOCK_COLOUR) : png(8, appColour));
  }

  if (!omitCatalogue) {
    mkdirSync(join(root, 'catalog'), { recursive: true });
    writeFileSync(
      join(root, 'catalog', 'apps.json'),
      JSON.stringify([{ slug: 'probe', url: 'https://probe.nikatru.com', platforms, status: 'preview' }]),
    );
  }
  if (enclosingCatalogue) {
    // A DIFFERENT app set, so a guard reading this one instead is caught by the
    // slug it names rather than by an accident of both being identical.
    mkdirSync(join(base, 'catalog'), { recursive: true });
    writeFileSync(
      join(base, 'catalog', 'apps.json'),
      JSON.stringify([{ slug: 'outerapp', url: 'https://outerapp.nikatru.com', platforms: ['web'], status: 'live' }]),
    );
  }
  return { base, root, appDir, sdkRoot: join(root, 'sdk') };
}

// BOUNDED, so a guard that hangs at exit (nodejs/node#54918, reproduced on this
// guard 2026-09-11) fails its case BY NAME instead of holding the job open until CI
// cancels it with no name at all. `status null` beside the complete output means
// the guard was still alive when the bound fired: an exit hang, not a slow scan.
// The guard's own `flutter create` is bounded and group-killed inside
// flutter-stock-assets.mjs; this is the backstop for the guard process itself.
const RUN_TIMEOUT_MS = 120_000;
/** The one spawn. `argv` is what the guard is given and `cwd` where it is given
 *  it — the two things the app-id defect turned on, so neither is hidden inside
 *  a helper that only ever passes an app directory. */
const spawnGuard = (argv, { sdkRoot, cwd, env = {} }) => {
  const r = spawnSync(process.execPath, [GUARD, ...argv], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, ...fixtureTemp(), FLUTTER_ROOT: sdkRoot, ...env },
    timeout: RUN_TIMEOUT_MS,
    killSignal: 'SIGKILL',
  });
  const died =
    r.error || r.signal
      ? `\n[stamp-brand-assets.test] guard did not finish — ${r.error ? r.error.message : 'no spawn error'} · ` +
        `status ${r.status} · signal ${r.signal} · bound ${RUN_TIMEOUT_MS} ms`
      : '';
  return { code: r.status, out: `${r.stdout ?? ''}${r.stderr ?? ''}${died}` };
};
const run = ({ appDir, sdkRoot }, seed = '6459F5', env = {}) =>
  spawnGuard([appDir, '--seed', seed], { sdkRoot, env });

describe('assert-stamp-brand-assets', () => {
  test('passes when every asset is present, valid, non-stock and on-seed', () => {
    const { code, out } = run(world());
    assert.equal(code, 0, out);
    assert.match(out, /5\/5 asset\(s\) present/);
    assert.match(out, /5 carry seed #6459f5/);
  });

  // 🔴 THE TEMP-CACHE LEAK, PINNED. Remove `fixtureTemp()` from `run` and the
  // cache lands in the shared temp directory instead: this count stays put, and
  // the case is RED.
  test("the reader's `flutter create` cache lands in this file's temp root, which is removed afterwards", () => {
    const stockCaches = () => listDir(TMP).filter((n) => n.startsWith('nikatru-flutter-stock-')).length;
    const before = stockCaches();
    const { code, out } = run(world());
    assert.equal(code, 0, out);
    assert.equal(stockCaches(), before + 1, 'a fresh SDK path must be cached under TMP, not in the shared temp dir');
  });

  // 🔴 THE EXIT HANG, PINNED. Spawned exactly as CI runs it — plain `node <guard>`,
  // no flags — the process that does the work must have started with
  // --single-threaded, so no V8 worker thread runs a background compile or GC
  // that Node's shutdown can deadlock on (nodejs/node#54918). Measured
  // 2026-09-11 on real-size brick icons: worker threads burned CPU in 7 of 8 runs
  // by default, 0 of 8 with the flag. Delete the relaunch and this line says ON.
  test('the working guard runs with V8 background tasks OFF, so its exit cannot deadlock', () => {
    const { code, out } = run(world());
    assert.equal(code, 0, out);
    assert.match(out, /V8 background tasks: OFF \(--single-threaded\)/);
  });

  // 🔴 M1 — the defect S-14 exists for.
  test('FAILS when an asset is byte-identical to the SDK stock asset', () => {
    const { code, out } = run(world({ useStock: ['web/icons/Icon-192.png'] }));
    assert.equal(code, 1);
    assert.match(out, /Icon-192\.png — is BYTE-IDENTICAL to Flutter's stock asset/);
  });

  // 🔴 THE CASE THAT SILENTLY PASSED FOR THE WHOLE LIFE OF THIS GUARD, until
  // 2026-08-04. `Icon-maskable-*` comes from an `.img.tmpl`, which is EMPTY in
  // the SDK — so the comparison was against a zero-byte buffer and could not
  // match whatever the stamp shipped. Confirmed by counterfactual on the REAL
  // tree, not here: the stock maskable-512 copied over apps/subscriptiontracker's left the
  // guard AT HEAD printing `ok … 5 stock asset(s) compared`, exit 0.
  test('FAILS when a MASKABLE asset is byte-identical to stock', () => {
    const { code, out } = run(world({ useStock: ['web/icons/Icon-maskable-512.png'] }));
    assert.equal(code, 1, 'the maskable pair is exactly the one the SDK ships as an empty placeholder');
    assert.match(out, /Icon-maskable-512\.png — is BYTE-IDENTICAL to Flutter's stock asset/);
  });

  // The other half of the same rule: with no overlay every maskable stock asset
  // is zero bytes, and comparing against one is an assertion that cannot fail.
  // It must be COVERAGE LOST, never a quiet pass over a smaller set.
  test('COVERAGE LOST when the stock assets are zero bytes', () => {
    const { code, out } = run(world({ emptyStock: true }));
    assert.equal(code, 2);
    assert.match(out, /ZERO BYTES/);
  });

  test('FAILS when a required asset is missing', () => {
    const { code, out } = run(world({ omit: ['web/icons/Icon-maskable-512.png'] }));
    assert.equal(code, 1);
    assert.match(out, /Icon-maskable-512\.png — MISSING/);
  });

  // Present is not the same as valid — a 0-byte file is "there".
  test('FAILS when an asset is not a readable PNG', () => {
    const { code, out } = run(world({ corrupt: ['web/favicon.png'] }));
    assert.equal(code, 1);
    assert.match(out, /favicon\.png — is not a readable PNG/);
  });

  // 🔴 "Not Flutter's" is not the same as "the app's" — a blank square passes
  // the identity check alone, which is why the colour limb exists.
  test('FAILS when the icons are non-stock but not the spec\'s seed colour', () => {
    const { code, out } = run(world({ appColour: '00ff00' }));
    assert.equal(code, 1, 'green icons are not Flutter\'s, and are not the app\'s either');
    assert.match(out, /dominant colour is #00ff00, but the spec's seed is #6459f5/);
  });

  // ── anti-vacuity: refusing to run blind ───────────────────────────────────
  // 🔴 M5. The tempting implementation skips the comparison when the SDK is
  // absent and prints ok, which turns "I could not check" into "nothing wrong".
  test('COVERAGE LOST when the Flutter SDK cannot be found', () => {
    const w = world();
    const { code, out } = run(w, '6459F5', { FLUTTER_ROOT: join(w.root, 'no-such-sdk'), PATH: '' });
    assert.equal(code, 2);
    assert.match(out, /COVERAGE LOST — could not establish the Flutter SDK's stock web assets/);
  });

  // A created app that has a web/ directory and no icons in it. The set to
  // compare against is then empty and every identity check passes by examining
  // nothing — the empty-domain shape, one level down from the zero-byte one.
  test('COVERAGE LOST when a created app has web/ but no PNGs in it', () => {
    const w = world({ noStockIcons: true });
    const { code, out } = run(w);
    assert.equal(code, 2, out);
    assert.match(out, /holding NO PNGs/);
  });

  // 🔴 M6 — the asset set is derived from the platform claim, so an empty claim
  // would require nothing. [3]S-3 owns the claim; this refuses to ride an empty one.
  test('COVERAGE LOST when the app claims no platform', () => {
    const { code, out } = run(world({ platforms: [] }));
    assert.equal(code, 2);
    assert.match(out, /COVERAGE LOST — no platform claim/);
  });

  test('FAILS loudly if a claim arrives that this guard has no asset list for', () => {
    const { code, out } = run(world({ platforms: ['windows'] }));
    assert.equal(code, 1, 'a native claim must not pass on the web asset list');
    assert.match(out, /claims \[windows\] and NOT web/);
  });

  // ── the app id comes from the CATALOGUE, never from a directory name ───────
  // O-STAMP-GUARD-READS-THE-DIRECTORY-NAME-AS-AN-APP-ID, observed 2026-09-20 by
  // two independent lanes: `basename(appDir)` made the guard grade the FOLDER a
  // lane happened to be standing in.
  //
  //   .worktrees/donut           ✗ COVERAGE LOST — no platform claim found for "donut"
  //   .worktrees/replay-fixture  ✗ COVERAGE LOST — … for "replay-fixture"
  //
  // 🔬 THE MUTATION THAT PINS THIS CASE: restore `const appId = basename(appDir)`
  // with `join(appDir, '..', '..', 'catalog', 'apps.json')` and it goes RED on
  // the exact sentence below, naming "donut".

  // 🔴 THE CASE THE ROW ASKS FOR: a path named after no app, required to grade the
  // REAL apps rather than report COVERAGE LOST. The enclosing catalogue is there
  // on purpose — `../..` from the checkout root walks OUT of the worktree and
  // reads the MAIN checkout's catalogue, so a guard that still does it grades one
  // tree out of another tree's facts, and names `outerapp` or `donut`, not `probe`.
  test('grades the catalogued apps when run from a checkout whose directory is named after no app', () => {
    const w = world({ worktreeName: 'donut', enclosingCatalogue: true });
    const { code, out } = spawnGuard([], { sdkRoot: w.sdkRoot, cwd: w.root });
    assert.equal(code, 0, out);
    assert.match(out, /5\/5 asset\(s\) present/);
    assert.match(out, /\[probe\]/, 'the catalogue of the tree being graded names `probe`');
    // NOT `doesNotMatch(/donut/)` — the ok line names the checkout it graded, and
    // that path legitimately contains the worktree's name. What must never appear
    // is `donut` standing in for an APP: these two are the verbatim shapes the
    // defect produced.
    assert.doesNotMatch(out, /no platform claim found for "donut"/, 'a worktree folder is not an app');
    assert.doesNotMatch(out, /\[donut\]/, 'a worktree folder must never be graded as an app');
    assert.doesNotMatch(out, /outerapp/, 'the ENCLOSING checkout\'s catalogue is not this tree\'s catalogue');
  });

  // The same resolution, from a lane whose folder is named after a fixture rather
  // than a dessert — the second independent observation, same shape.
  test('grades the catalogued apps from a checkout named `replay-fixture` too', () => {
    const w = world({ worktreeName: 'replay-fixture' });
    const { code, out } = spawnGuard([], { sdkRoot: w.sdkRoot, cwd: w.root });
    assert.equal(code, 0, out);
    assert.match(out, /\[probe\]/);
    assert.doesNotMatch(out, /no platform claim found for "replay-fixture"/);
  });

  // ⚠️ ANTI-VACUITY FOR THE NEW BRANCH. "Grade everything in the checkout" must
  // not become "grade nothing, quietly": a checkout whose catalogue lists apps
  // that have no directory is a broken tree, not a clean one.
  test('COVERAGE LOST when the checkout root holds no catalogued app directory', () => {
    const w = world();
    rmSync(join(w.root, 'apps'), { recursive: true, force: true });
    const { code, out } = spawnGuard([], { sdkRoot: w.sdkRoot, cwd: w.root });
    assert.equal(code, 2, out);
    assert.match(out, /NOT ONE has a directory under/);
  });

  // Pointed somewhere that is neither an app nor a checkout root, the honest
  // answer is "I cannot tell what you meant" — not a guess off the folder name.
  test('COVERAGE LOST when pointed at a directory that is neither a catalogued app nor the checkout root', () => {
    const w = world();
    const { code, out } = spawnGuard([join(w.root, 'apps')], { sdkRoot: w.sdkRoot });
    assert.equal(code, 2, out);
    assert.match(out, /is neither a catalogued app directory of/);
    assert.match(out, /knows 1 app\(s\): probe/);
  });

  test('COVERAGE LOST when no catalog/apps.json exists at or above the target', () => {
    const w = world({ omitCatalogue: true });
    const { code, out } = spawnGuard([w.appDir], { sdkRoot: w.sdkRoot });
    assert.equal(code, 2, out);
    assert.match(out, /no catalog\/apps\.json at or above/);
  });

  // shell-13, in this guard's own argv: the flag that carries a value was not
  // declared, so the SEED was taken as the directory to grade whenever it came
  // first — and `6459f5` resolved to a path that is not an app.
  test('reads --seed before the path as a seed, not as the app directory', () => {
    const w = world();
    const { code, out } = spawnGuard(['--seed', '6459F5', w.appDir], { sdkRoot: w.sdkRoot });
    assert.equal(code, 0, out);
    assert.match(out, /5 carry seed #6459f5/);
  });
});
