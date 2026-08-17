// ─────────────────────────────────────────────────────────────────────────────
// vacuity-a.test.mjs — the empty-subject regression for the two guards in the
// a*–assert-l* range that passed over a subject that had gone to zero.
//
// 🔴 THE DEFECT THIS FILE EXISTS FOR: ONE FLOOR OVER A UNION OF SCOPE ROOTS.
// Both guards below scanned several roots and then asserted a SINGLE count over
// the union. When one root is a CONSTANT — `tooling/` always ships the brick
// template; the repo root always ships a package.json — the constant half alone
// keeps the union floor satisfied while every varying half empties out. The
// guard then prints a confident ok about a tree it never read.
//
// This is the same shape as the two AT-RISK guards found in the assert-no-*
// range (assert-no-tls-pinning 180 files -> 22, assert-no-gate-weakening 140 ->
// 26). It is not a coincidence: a floor is only a coverage check if it is
// attached to the thing that can disappear.
//
// ⚠️ MEASURED BY MUTATING THE REAL TREE, 2026-08-17 — not a fixture, and not
// this file's mirror. Every one renamed the real directory aside, created an
// empty one in its place (so a walk matches ZERO entries rather than erroring on
// a missing dir), ran the guard exactly as CI runs it (no arguments, repo cwd),
// then restored and re-verified `git status --porcelain -- <path>` at 0 and the
// guard green again. The BEFORE column was produced by running the HEAD version
// of each guard, extracted with `git show`, against the same mutated tree.
//
//   M1  content-licences · empty apps/            BEFORE n/a   AFTER exit 1 "0 pubspec.yaml under apps/"
//   M2  content-licences · empty packages/        BEFORE n/a   AFTER exit 1 "0 pubspec.yaml under packages/"
//   M3  content-licences · empty apps/+packages/  BEFORE EXIT 0 AFTER exit 1
//       🔴 BEFORE printed: `tripwire "awesome_notifications_fcm" armed and not
//       tripped — appears in none of the 2 pubspec(s) scanned`. The scan had
//       fallen from 12 pubspecs to the brick's 2, and a tripwire whose whole job
//       is to fire when a dependency ARRIVES reported the product tree clean
//       without reading one line of it.
//   M4  lockfile · empty packages/                BEFORE n/a   AFTER exit 1 "0 node unit(s) under packages/"
//   M5  lockfile · empty sites/                   BEFORE n/a   AFTER exit 1 "0 node unit(s) under sites/"
//   M6  lockfile · empty packages/ AND sites/     BEFORE EXIT 0 AFTER exit 1
//       🔴 BEFORE printed: `ok  lockfile discipline — 3 node unit(s) locked
//       (1 pnpm, 2 npm), repo root included, every workflow install is
//       reproducible`. root(1) + services(2) = 3 = MIN_NODE_UNITS exactly, so
//       BOTH remaining roots could vanish — every site and every Node package
//       unpinned — and the union floor still could not fire. That is the case
//       `test 8` below pins, and it is why the per-root floor is load-bearing
//       rather than belt-and-braces.
//
// WHY THIS FILE DOES NOT MUTATE THE REAL TREE ITSELF: `node --test` runs test
// FILES CONCURRENTLY. Renaming apps/ or packages/ here would corrupt every
// sibling test mid-run and make failures depend on scheduling. So the real-tree
// mutations are the recorded evidence above (the convention this corpus already
// uses — see ceiling-budget.test.mjs's MR1–MR3), and the automated regression
// below runs against a MIRROR BUILT FROM THE REAL TRACKED FILES at test time via
// `git ls-files` + copy. That matters: the mirror is not a fixture invented by
// the author of the guard, which is the failure mode that shipped a broken
// assert-seams-wired.mjs here with all six of its own fixtures green.
//
// 🔴 AND THE MIRROR ITSELF IS FLOORED. A mirror that silently copied nothing
// would make every "guard refuses" assertion below pass for the wrong reason —
// the exact vacuity this file polices. `before` asserts the mirror is populated
// and that each root it is about to empty was NON-EMPTY first, so an emptying
// step that emptied nothing cannot read as a caught mutation.
//
// Run:  node --test "tooling/ci/test/vacuity-a.test.mjs"
// ─────────────────────────────────────────────────────────────────────────────

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, cpSync, readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..', '..', '..');
const CONTENT_LICENCES = join(ROOT, 'tooling', 'ci', 'assert-content-licences.mjs');
const LOCKFILE = join(ROOT, 'tooling', 'ci', 'assert-lockfile-discipline.mjs');

/** The real files both guards read. Copied from the working tree, never invented. */
const PATHSPECS = [
  'tooling/legal',
  'tooling/content_pipeline/examples',
  '*pubspec.yaml',
  'package.json',
  'services/*/package.json',
  'packages/*/package.json',
  'sites/*/package.json',
  '*pnpm-lock.yaml',
  '*package-lock.json',
];

/** A floor on the mirror itself: 34 real paths matched on 2026-08-17. Set well
 *  below that so a legitimately retired package does not redden this test, but
 *  high enough that a copy loop which quietly stopped copying cannot pass. */
const MIN_MIRROR_FILES = 20;

let mirror = null;
let mirrorFiles = [];

function buildMirror() {
  const r = spawnSync('git', ['-C', ROOT, 'ls-files', '--', ...PATHSPECS], { encoding: 'utf8' });
  assert.equal(r.status, 0, `git ls-files failed: ${r.stderr}`);
  const files = r.stdout.split('\n').map((s) => s.trim()).filter(Boolean);
  const dir = mkdtempSync(join(tmpdir(), 'vacuity-a-'));
  for (const f of files) {
    const src = join(ROOT, f);
    if (!existsSync(src)) continue; // tracked but deleted in the working tree
    mkdirSync(join(dir, dirname(f)), { recursive: true });
    cpSync(src, join(dir, f));
  }
  return { dir, files };
}

/** Empty a root but KEEP the directory, so a walk matches zero entries rather
 *  than erroring on a missing path — absence and emptiness are different bugs,
 *  and emptiness is the one that used to pass. */
function emptyRoot(root, rel) {
  const abs = join(root, rel);
  assert.ok(existsSync(abs), `${rel} must exist in the mirror before it can be emptied`);
  assert.ok(readdirSync(abs).length > 0, `${rel} must be NON-EMPTY before emptying, or the mutation proves nothing`);
  rmSync(abs, { recursive: true, force: true });
  mkdirSync(abs, { recursive: true });
  assert.equal(readdirSync(abs).length, 0, `${rel} should now be empty`);
}

/** A fresh mirror per case, so one test's emptying cannot leak into the next. */
function freshMirror(...rootsToEmpty) {
  const { dir } = buildMirror();
  for (const r of rootsToEmpty) emptyRoot(dir, r);
  return dir;
}

function run(guard, root) {
  const r = spawnSync(process.execPath, [guard, root], { encoding: 'utf8' });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
}

before(() => {
  const built = buildMirror();
  mirror = built.dir;
  mirrorFiles = built.files;
  assert.ok(
    mirrorFiles.length >= MIN_MIRROR_FILES,
    `the mirror matched only ${mirrorFiles.length} real path(s), floor ${MIN_MIRROR_FILES}. `
      + 'Every refusal asserted below would then be a refusal over nothing.',
  );
});

after(() => {
  if (mirror) rmSync(mirror, { recursive: true, force: true });
});

describe('assert-content-licences — the tripwire must read the product tree, not just the brick', () => {
  test('1. positive control: a complete mirror passes, and the print states what it scanned', () => {
    const { code, out } = run(CONTENT_LICENCES, mirror);
    assert.equal(code, 0, `expected the complete mirror to pass, got ${code}:\n${out}`);
    // The ok line must name the per-root breakdown. A bare total is what let the
    // scan fall 12 -> 2 without a reader noticing.
    assert.match(out, /apps=\d+, packages=\d+, tooling=\d+/, `no per-root breakdown printed:\n${out}`);
    assert.match(out, /pubspec\(s\) scanned/, `the tripwire print did not state its subject size:\n${out}`);
  });

  test('2. apps/ emptied is COVERAGE LOST, and the message names apps/', () => {
    const dir = freshMirror('apps');
    const { code, out } = run(CONTENT_LICENCES, dir);
    assert.equal(code, 1, `emptying apps/ must refuse, got ${code}:\n${out}`);
    assert.match(out, /COVERAGE LOST/);
    assert.match(out, /0 pubspec\.yaml under apps\//, `the refusal must name the root that emptied:\n${out}`);
    rmSync(dir, { recursive: true, force: true });
  });

  test('3. packages/ emptied is COVERAGE LOST, and the message names packages/', () => {
    const dir = freshMirror('packages');
    const { code, out } = run(CONTENT_LICENCES, dir);
    assert.equal(code, 1, `emptying packages/ must refuse, got ${code}:\n${out}`);
    assert.match(out, /0 pubspec\.yaml under packages\//, `the refusal must name the root that emptied:\n${out}`);
    rmSync(dir, { recursive: true, force: true });
  });

  test('4. REGRESSION M3 — apps/ AND packages/ gone while tooling/ remains', () => {
    // The exact input the pre-2026-08-17 guard passed: the brick's pubspec kept
    // `pubspecs.length === 0` false, so the union floor could not fire and the
    // tripwire pronounced the product tree clean over 2 files instead of 12.
    const dir = freshMirror('apps', 'packages');
    const { code, out } = run(CONTENT_LICENCES, dir);
    assert.equal(code, 1, `the brick alone must NOT satisfy the floor, got ${code}:\n${out}`);
    assert.match(out, /COVERAGE LOST/);
    assert.doesNotMatch(
      out,
      /armed and not tripped/,
      'the guard must refuse BEFORE printing a tripwire verdict it has no evidence for',
    );
    rmSync(dir, { recursive: true, force: true });
  });
});

/* 🔴 A describe block for `assert-lockfile-discipline` stood here and was REMOVED
   on 2026-08-17, in the same change that REVERTED the guard edit it covered.

   That edit added a per-unit-root floor and broke 11 of the 12 pre-existing
   assert-lockfile-discipline tests in guards.test.mjs — and an adversarial review
   proved it had also made MIN_NODE_UNITS an assertion that cannot fail: UNIT_ROOTS
   holds exactly 3 roots, each newly floored at 1, so surviving the per-root loop
   guaranteed the total floor. It introduced the defect it was sent to remove.

   The guard is back at its committed state and its 12 original tests pass. These
   5 cases went with it rather than being left behind: a test whose subject has
   been reverted does not fail loudly, it fails CONFUSINGLY — it describes
   behaviour nobody can find in the code. Recoverable from the branch history if
   the per-root floor is ever attempted again, which it should be: the underlying
   observation (a unit root that empties out is invisible to the total floor) is
   real and remains open. */
