// ─────────────────────────────────────────────────────────────────────────────
// vacuity-c.test.mjs — the empty-subject regression for the two guards in the
// assert-t*–assert-z* range that passed over a subject that had gone to zero:
// assert-web-cache-policy.mjs and assert-workspace-coverage.mjs.
//
// 🔴 THE DEFECT: ONE FLOOR OVER A UNION WHOSE OTHER HALF IS A CONSTANT.
// Both guards scanned several roots and then asserted a SINGLE count over the
// union of them. `assert-web-cache-policy` walks `apps/*/web`, the BRICK
// template's `web/`, and `sites/*` — and the brick is always there, so
// `bundles.length === 0` can never fire no matter what leaves `apps/`. Its own
// comment said so out loud — "The brick template alone is always one" — which is
// exactly the sentence that should have been read as a defect report.
// `assert-workspace-coverage` scans `packages/` and `apps/` and floors the sum
// at 5, and `packages/` holds 9 of the 10 members on its own.
//
// A floor is only a coverage check if it is attached to the thing that can
// disappear. Both guards now carry one floor PER ROOT.
//
// ⚠️ MEASURED BY MUTATING A REAL TREE, 2026-08-17 — a `git clone --local
// --no-hardlinks` of this repository at `chore/close-pt3-pt4-pt5`, never a
// fixture. Each mutation emptied a root and KEPT the directory (so a walk
// matches zero entries rather than erroring on a missing path), then ran the
// guard exactly as ci.yml runs it. The BEFORE column is the HEAD version of the
// guard against the same mutated tree.
//
//   M1  web-cache · apps/ emptied            BEFORE EXIT 0   AFTER exit 1
//       🔴 BEFORE printed: `ok  web cache policy — 3 bundle(s): 1 flutter-web
//       (entry points + 2 shipped file(s) must revalidate), 2 static-site`.
//       The entry-point limb, the shipped-file limb and the icons limb had all
//       silently fallen back to the TEMPLATE, and nothing in the run said so.
//       The caller-claim check does not cover this either: ci.yml claims the two
//       SITES on the run line, never an app.
//   M2  web-cache · apps/ REMOVED entirely   BEFORE EXIT 0   AFTER exit 1
//       🔴 AND THE FIRST DRAFT OF THE REPAIR ALSO EXITED 0 HERE. It was written
//       `existsSync(appsDir) && …`, copying the `sitesDirExists` device one line
//       below it, and that device is only sound where the subject may
//       legitimately be absent. Found by accident when the empty directory
//       itself went away between two runs and the guard went quiet again.
//       Absence and emptiness are different bugs; the gated draft saw one.
//   M3  web-cache · sites/ emptied           BEFORE exit 1   AFTER exit 1
//       The pre-existing per-kind floor. Kept below as a regression lock: it is
//       the check the apps floor was modelled on, and it must not be traded away
//       when someone next simplifies this discovery block.
//   M4  workspace · apps/ emptied AND `- apps/subly` dropped from `workspace:`
//                                            BEFORE EXIT 0   AFTER exit 1
//       🔴 BEFORE printed: `ok  workspace coverage — 9 dart package(s) on disk,
//       all gated`. Section 4's two directions are both RELATIONSHIPS between
//       the declaration and the disk, so when a root empties on both sides at
//       once they go quiet together — which is precisely the moment the count
//       is the only thing still watching, and the count was over the union.
//   M5  workspace · packages/ emptied        BEFORE exit 1   AFTER exit 1
//       The union floor is what fires here (1 package left, floor 5), not the
//       per-root limb. Said plainly because this repository's shape CANNOT
//       isolate the packages limb today: `apps/` holds one member, so packages
//       going quiet always drags the sum under 5 as well. That limb becomes
//       independently provable the moment `apps/` holds five packages, and
//       until then this case is a lock on the union floor, nothing more.
//
// 🔴 AND THE COARSE MUTATION HID BOTH DEFECTS. Emptying apps/, packages/, sites/
// and tooling/bricks together made both guards refuse, which is how they sat
// inside a "proven safe" count. It is the brick surviving that makes the union
// floor unfalsifiable, so a mutation that also deletes the brick proves the
// opposite of what it looks like it proves.
//
// WHY THIS FILE DOES NOT MUTATE THE REAL TREE ITSELF: `node --test` runs test
// FILES CONCURRENTLY, so emptying apps/ here would corrupt every sibling test
// mid-run and make failures depend on scheduling. The real-tree mutations are
// the recorded evidence above — the convention this corpus already uses — and
// the automated regression below runs against a MIRROR BUILT FROM THE REAL
// TRACKED FILES at test time via `git ls-files` + copy. That distinction is the
// point: the mirror is not a tree invented by the author of the guard, which is
// the failure mode that shipped a broken assert-seams-wired.mjs here with all
// six of its own fixtures green.
//
// 🔴 AND THE MIRROR IS ITSELF FLOORED, TWICE. A mirror that quietly copied
// nothing would make every "the guard refuses" assertion below pass for exactly
// the wrong reason — the vacuity this file exists to police. So: the copy is
// floored on file count, `emptyRoot` refuses to empty something already empty,
// and test 1 asserts the UNMUTATED mirror still reproduces the real tree's
// verdict and its counts. If test 1 fails, nothing else in this file means
// anything, and it is listed first for that reason.
//
// Run:  node --test "tooling/ci/test/vacuity-c.test.mjs"
// ─────────────────────────────────────────────────────────────────────────────

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  mkdtempSync,
  mkdirSync,
  rmSync,
  cpSync,
  readFileSync,
  writeFileSync,
  readdirSync,
  existsSync,
} from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..', '..', '..');
const WEB_CACHE = join(ROOT, 'tooling', 'ci', 'assert-web-cache-policy.mjs');
const WORKSPACE = join(ROOT, 'tooling', 'ci', 'assert-workspace-coverage.mjs');

// Every real file the two guards read, as git pathspecs.
// ⚠️ The trailing `/*` on the two directory specs is load-bearing, not
// decorative: git wildmatches a pathspec against the WHOLE path, so a spec that
// stops at the `web` segment matches NOTHING and the mirror comes out empty.
// Measured — the first draft returned 0 rows for both app specs and only the
// MIN_MIRROR_FILES floor below said so.
const PATHSPECS = [
  'apps/*/web/*',
  'tooling/bricks/app/__brick__/apps/*/web/*',
  'sites/*/index.html',
  'sites/*/_headers',
  '*pubspec.yaml',
];

/** A floor on the MIRROR: 29 real paths matched on 2026-08-17. Set below that so
 *  a retired package does not redden this file, and far enough above zero that a
 *  copy loop which stopped copying cannot pass itself off as a caught mutation. */
const MIN_MIRROR_FILES = 20;

/** What ci.yml:1186 passes on the run line. Not a guess and not decoration: the
 *  guard fails when a claimed bundle is not among the ones it scanned, so if a
 *  site is ever renamed, test 1 goes red naming the dangling claim rather than
 *  this file drifting quietly out of step with the workflow. */
const CLAIMED = ['sites/nikatru', 'sites/rajasekarselvam'];

let TMP;
let TRACKED = [];
let seq = 0;

before(() => {
  TMP = mkdtempSync(join(tmpdir(), 'vacuity-c-'));
  const r = spawnSync('git', ['-C', ROOT, 'ls-files', '--', ...PATHSPECS], { encoding: 'utf8' });
  assert.equal(r.status, 0, `git ls-files failed, so no mirror can be built: ${r.stderr}`);
  TRACKED = r.stdout.split('\n').map((s) => s.trim()).filter(Boolean);
  assert.ok(
    TRACKED.length >= MIN_MIRROR_FILES,
    `git ls-files matched only ${TRACKED.length} path(s), floor ${MIN_MIRROR_FILES}. ` +
      'The pathspecs stopped matching the tree, so every refusal asserted below would be a refusal ' +
      'over an empty mirror — which is the defect this file tests for, reproduced in the test.',
  );
});

after(() => {
  if (TMP) rmSync(TMP, { recursive: true, force: true });
});

/** A copy of the real tracked files. Never invented, never edited on the way in. */
function mirror() {
  const dir = join(TMP, `m${seq++}`);
  let copied = 0;
  for (const f of TRACKED) {
    const src = join(ROOT, f);
    if (!existsSync(src)) continue; // tracked but deleted in the working tree
    mkdirSync(join(dir, dirname(f)), { recursive: true });
    cpSync(src, join(dir, f));
    copied++;
  }
  assert.ok(copied >= MIN_MIRROR_FILES, `mirror copied only ${copied} file(s), floor ${MIN_MIRROR_FILES}`);
  return dir;
}

/** Empty a root but KEEP the directory: a walk then matches zero entries instead
 *  of erroring on a missing path, and emptiness is the case that used to pass. */
function emptyRoot(dir, rel) {
  const abs = join(dir, rel);
  assert.ok(existsSync(abs), `${rel} must exist in the mirror before it can be emptied`);
  assert.ok(readdirSync(abs).length > 0, `${rel} must be NON-EMPTY first, or emptying it proves nothing`);
  rmSync(abs, { recursive: true, force: true });
  mkdirSync(abs, { recursive: true });
  assert.equal(readdirSync(abs).length, 0, `${rel} should be empty now`);
}

/** Delete a root outright — the sibling case, and the one a gated floor misses. */
function removeRoot(dir, rel) {
  const abs = join(dir, rel);
  assert.ok(existsSync(abs), `${rel} must exist in the mirror before it can be removed`);
  rmSync(abs, { recursive: true, force: true });
  assert.ok(!existsSync(abs), `${rel} should be gone now`);
}

/** Drop every `workspace:` member under `prefix/` from the mirror's root pubspec,
 *  so the declaration goes quiet at the same moment the disk does. That pairing
 *  is the whole point: either side alone is caught by section 4 already. */
function undeclare(dir, prefix) {
  const p = join(dir, 'pubspec.yaml');
  const before = readFileSync(p, 'utf8');
  const after = before
    .split('\n')
    .filter((l) => !new RegExp(`^\\s*-\\s+${prefix}/`).test(l))
    .join('\n');
  assert.notEqual(after, before, `no \`- ${prefix}/…\` member was declared, so undeclaring one changed nothing`);
  writeFileSync(p, after);
}

/** Run a guard the way CI runs it: real subprocess, real exit code, root by arg. */
function run(guard, root, ...extra) {
  const r = spawnSync(process.execPath, [guard, root, ...extra], { encoding: 'utf8', cwd: ROOT });
  return { code: r.status, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

// ─────────────────────────────────────────────────────────────────────────────
describe('vacuity-c — per-root coverage floors', () => {
  // 1. THE CONTROL. Listed first because every refusal below is meaningless
  //    without it: a mirror that reproduced nothing would make them all pass.
  test('the unmutated mirror reproduces the real tree, for both guards', () => {
    const dir = mirror();

    const web = run(WEB_CACHE, dir, ...CLAIMED);
    assert.equal(web.code, 0, `assert-web-cache-policy should pass on a faithful mirror:\n${web.out}`);
    const flutter = web.out.match(/(\d+) flutter-web/);
    const statics = web.out.match(/(\d+) static-site/);
    assert.ok(flutter, `no flutter-web count in the summary:\n${web.out}`);
    assert.ok(statics, `no static-site count in the summary:\n${web.out}`);
    // >= 2 flutter-web means the brick AND at least one real app were scanned —
    // the exact relationship every case below destroys on purpose.
    assert.ok(Number(flutter[1]) >= 2, `expected >= 2 flutter-web bundles, saw ${flutter[1]}`);
    assert.ok(Number(statics[1]) >= 2, `expected >= 2 static-site bundles, saw ${statics[1]}`);

    const ws = run(WORKSPACE, dir);
    assert.equal(ws.code, 0, `assert-workspace-coverage should pass on a faithful mirror:\n${ws.out}`);
    const pkgs = ws.out.match(/(\d+) dart package\(s\) on disk/);
    assert.ok(pkgs, `no package count in the summary:\n${ws.out}`);
    assert.ok(Number(pkgs[1]) >= 6, `expected >= 6 dart packages in the mirror, saw ${pkgs[1]}`);
  });

  // 2. THE DEFECT ITSELF (M1).
  test('web-cache-policy REFUSES when apps/ is present but yields no web bundle', () => {
    const dir = mirror();
    emptyRoot(dir, 'apps');
    const { code, out } = run(WEB_CACHE, dir, ...CLAIMED);
    assert.equal(code, 1, `expected a refusal, got exit ${code}:\n${out}`);
    assert.match(out, /COVERAGE LOST/);
    assert.match(out, /produced ZERO flutter-web bundles of its own/);
    // The brick is named, because the brick surviving is the whole mechanism.
    assert.match(out, /tooling\/bricks\/app\/__brick__\/apps\/\{\{app_id\}\}\/web/);
    // 🔴 THE LOAD-BEARING NEGATIVE. The union floor must still be SATISFIED here:
    // if `found no deployed bundle` ever fires on this input, the mirror lost the
    // brick and the sites too, and this test would be passing for the wrong
    // reason while proving nothing about the per-root floor.
    assert.doesNotMatch(out, /found no deployed bundle/);
    assert.doesNotMatch(out, /is not in the scan/);
  });

  // 3. THE CASE THE FIRST DRAFT OF THE FIX MISSED (M2).
  test('web-cache-policy REFUSES when apps/ is gone altogether, not merely empty', () => {
    const dir = mirror();
    removeRoot(dir, 'apps');
    const { code, out } = run(WEB_CACHE, dir, ...CLAIMED);
    assert.equal(code, 1, `expected a refusal, got exit ${code}:\n${out}`);
    assert.match(out, /produced ZERO flutter-web bundles of its own/);
    assert.doesNotMatch(out, /found no deployed bundle/);
  });

  // 4. REGRESSION LOCK on the floor that already existed (M3). It is the model
  //    the apps floor copies, and the two must live or die together.
  test('web-cache-policy still REFUSES when sites/ goes quiet', () => {
    const dir = mirror();
    emptyRoot(dir, 'sites');
    const { code, out } = run(WEB_CACHE, dir, ...CLAIMED);
    assert.equal(code, 1, `expected a refusal, got exit ${code}:\n${out}`);
    assert.match(out, /produced ZERO static-site deploy roots/);
  });

  // 5. THE SECOND DEFECT (M4) — and the negative that proves WHICH floor fired.
  test('workspace-coverage REFUSES when apps/ empties on the disk AND in the declaration', () => {
    const dir = mirror();
    emptyRoot(dir, 'apps');
    undeclare(dir, 'apps');
    const { code, out } = run(WORKSPACE, dir);
    assert.equal(code, 1, `expected a refusal, got exit ${code}:\n${out}`);
    assert.match(out, /COVERAGE LOST/);
    assert.match(out, /apps\/ exist\(s\) but yielded ZERO dart package\(s\)/);
    // 🔴 THE UNION FLOOR MUST NOT BE WHAT FIRED. Nine packages are still there,
    // which is the entire reason this input used to exit 0. If `found only N`
    // appears, the mirror is too small and this case has stopped testing the
    // per-root limb.
    assert.doesNotMatch(out, /found only \d+ dart package/);
    // Nor may section 4 be doing the work: undeclaring is what silences it.
    assert.doesNotMatch(out, /listed but missing from disk/);
  });

  // 6. THE LIMB THAT CANNOT BE ISOLATED YET (M5), asserted for what it IS.
  test('workspace-coverage REFUSES when packages/ goes quiet — via the union floor', () => {
    const dir = mirror();
    emptyRoot(dir, 'packages');
    undeclare(dir, 'packages');
    const { code, out } = run(WORKSPACE, dir);
    assert.equal(code, 1, `expected a refusal, got exit ${code}:\n${out}`);
    assert.match(out, /COVERAGE LOST/);
    // Named deliberately: `apps/` holds ONE member, so emptying packages/ drags
    // the sum under 5 and the union floor fires first. Asserting which one fires
    // means that if the shape ever changes — a fifth app arrives, or someone
    // reorders the checks — this test says so instead of quietly re-pointing at
    // a different guarantee than the one it was written for.
    assert.match(out, /found only \d+ dart package/);
  });
});
