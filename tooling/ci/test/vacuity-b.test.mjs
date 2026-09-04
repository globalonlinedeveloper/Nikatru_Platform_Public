// ─────────────────────────────────────────────────────────────────────────────
// vacuity-b.test.mjs — the three guards in the assert-m*…assert-s* range whose
// coverage floor ranged over a UNION with a CONSTANT in it, each proven able to
// refuse an emptied subject BY MUTATING A COPY OF THE REAL TREE.
//
// ── WHY THIS FILE IS NOT A FIXTURE SUITE, AND THAT IS THE WHOLE POINT ────────
// This repository has already shipped a guard that was broken while all six of
// its fixture tests were green: `assert-seams-wired.mjs` matched the function's
// own DECLARATION, so deleting every real caller still passed. A fixture you
// write encodes the same misunderstanding as the guard you write — if you had
// understood the subject well enough to build the failing input, you would have
// built the guard right.
//
// The failure this file exists to catch is worse than that, because it is
// invisible from inside a fixture BY CONSTRUCTION. Each of these three guards
// scans several trees and asserts ONE floor over their SUM. A fixture models one
// tree with a dozen files in it, so the sum and the parts are the same number
// and the bug cannot be expressed. It only appears at the ratio the real tree
// has: `tooling/bricks` contributes a constant that no product change can shrink
// (22, 26 and 29 files to the three guards respectively), so `apps/` and
// `packages/` — the entire shipped product — could go to ZERO underneath a floor
// that never moved.
//
// So the subject here is the actual tracked tree, copied and then damaged.
//
// 🔴 AND THE COARSE VERSION OF THIS TEST HID BOTH DEFECTS. The scoping pass that
// found them first emptied EVERY product tree at once; that makes the brick
// vanish too, the union really does reach zero, both guards refuse, and both sat
// inside a "104 guards proven safe" number. The mutation has to leave the
// constant STANDING and remove only the variable. Every case below does.
//
// ── THE LEDGER: measured 2026-08-17 on a copy of this repository ─────────────
// Each row was run by hand before it was written down, and restored after.
//
//   assert-no-tls-pinning        baseline 180 shipped [apps=54, packages=104,
//                                tooling/bricks=22], exit 0
//     rm -rf apps packages      → BEFORE the fix: exit 0, "ok no TLS pinning —
//                                 22 shipped .dart file(s) scanned across apps,
//                                 packages, tooling/bricks". 88% of the subject
//                                 gone, and the passing line still named all
//                                 three roots as though it had read them.
//                                 AFTER: exit 1, COVERAGE LOST naming both.
//     packages → 25 shipped     → exit 1, below its floor of 40
//     tooling/bricks → 1        → exit 1, below its floor of 10
//     rm -rf packages/core      → exit 0. THE CONTROL: 43 files is a real
//                                 shrink that clears the floor, and a floor that
//                                 fired here would be switched off within a week.
//
//   assert-no-gate-weakening     baseline 140 tracked [apps=114 in 1 root,
//                                brick=26], exit 0
//     rm -rf apps (unstaged)    → BEFORE: exit 0, printing "note 117 tracked
//                                 path(s) are not on disk and were skipped …
//                                 the REQUIRED_COVERAGE floors below still see
//                                 it if coverage really left" — a sentence the
//                                 same run then falsified. AFTER: exit 1.
//     rm -rf apps (committed)   → exit 1, same reason, index or no index
//     apps → 1 tracked .dart    → exit 1, floor 40
//     brick → 1 tracked .dart   → exit 1, floor 10
//     rm apps/subly/integration_test → exit 0. THE CONTROL.
//
// ── RE-MEASURED 2026-09-05 (ADR 065 chassis step 3) ─────────────────────────
// 🔴 TWO THINGS WERE WRONG WITH THE ROW ABOVE, AND ONLY ONE OF THEM WAS A GUARD
// DEFECT. First, the numbers had ROTTED: run on main 4ab17a24 the guard printed
// 174 tracked [apps=148, brick=26], not 140 [apps=114, brick=26]. The ledger was
// three weeks stale, and a ledger nobody re-runs is the same failure mode as a
// floor nobody re-measures. Every figure below was re-run rather than copied.
//
// Second, and worse: a THIRD root had appeared underneath the guard. Chassis
// step 2 moved the generic chassis into `packages/`, which the guard did not
// read at all — `git ls-files -- packages` returned 181 tracked .dart and the
// guard's own passing line said "174 tracked Dart file(s)" without mentioning
// that the shared, shipped half of the product was not in the number. That is
// the same defect this file is named after, in a new tree: `apps/` and the brick
// were the constants keeping the total healthy while `packages/` contributed
// zero, and no floor could tell.
//
//   assert-no-gate-weakening     baseline 354 tracked [apps=148 in 1 root,
//                                packages=180 in 9 roots, brick=26], exit 0
//     rm -rf apps (unstaged)    → exit 1, "NOT ONE real app under apps/"
//     rm -rf apps (committed)   → exit 1, same reason, index or no index
//     apps → 1 tracked .dart    → exit 1, floor 40
//     rm -rf packages (unstaged) → BEFORE (main 4ab17a24): exit 0, and the note
//                                 it printed did not mention packages/ at all
//                                 because packages/ was never in the domain.
//                                 AFTER: exit 1, "NOT ONE package under
//                                 packages/".
//     packages → 1 tracked .dart → exit 1, floor 60
//     brick → 1 tracked .dart   → exit 1, floor 10
//     rm apps/subly/integration_test → exit 0. THE APPS CONTROL.
//     rm -rf packages/design_system  → exit 0, packages=140/floor 60.
//                                 THE PACKAGES CONTROL: retiring a whole package
//                                 is an honest shrink, and a floor that fired on
//                                 it would be switched off within a week.
//
//   assert-no-clone-tells        baseline 132 shared [packages=103,
//                                tooling/bricks=29], exit 0
//     rm -rf packages           → BEFORE: exit 0, "ok no clone tells — 29 shared
//                                 file(s) scanned". 78% of the subject, and the
//                                 tree C-10 is actually ABOUT. Not caught by the
//                                 existing MIN_APPS floor, which watches apps/ —
//                                 a different tree, and the only collapse anyone
//                                 had tested. AFTER: exit 1.
//     packages → 42 (core only) → exit 1, floor 60
//     rm -rf tooling/bricks     → exit 1, floor 10
//     rm -rf packages/design_system → exit 0. THE CONTROL.
//
// ── THE NEGATIVE TEST OF THIS FILE ITSELF ────────────────────────────────────
// A test suite is a check, and it needs the same proof as anything else it is
// checking: run it once against something you KNOW is broken and confirm it goes
// red. Done, and it is repeatable by anyone reading this, because the pre-fix
// guards are still in git history:
//
//   for g in assert-no-tls-pinning assert-no-gate-weakening assert-no-clone-tells; do
//     git show 7e38477:tooling/ci/$g.mjs > tooling/ci/$g.mjs
//   done
//   node --test tooling/ci/test/vacuity-b.test.mjs     # must go RED
//   git checkout -- tooling/ci                          # restore
//
// The result of that run is recorded at the bottom of this header. Without it,
// every green run below could mean "the mutation was caught" or "the copy was
// broken and the guard was failing for an unrelated reason" — indistinguishable,
// and this repo has three recorded cases of a compile error being mistaken for a
// caught mutation. That is also why EVERY case here asserts the baseline is
// GREEN on the same copy before asserting the mutation is red, and why each
// mutation asserts the SPECIFIC coverage sentence rather than merely exit != 0.
//
// MEASURED against 7e38477 (the pre-fix guards), 2026-08-17 — 19 cases, 14 RED
// and 5 GREEN, and WHICH five is the result that matters:
//   RED   all 11 mutation cases, every one on the assertion "accepted an emptied
//         subject". The tls-pinning defect case reported the pre-fix guard's own
//         words back: "ok  no TLS pinning — 22 shipped .dart file(s) scanned
//         across apps, packages, tooling/bricks", exit 0, with apps/ and
//         packages/ deleted. The defect reproduces from this file alone.
//   RED   the 3 passing-line cases, which assert the per-root split the pre-fix
//         guards did not print.
//   GREEN the 2 harness self-checks and ALL 3 controls — so the suite is not
//         merely allergic to old code, and its no-crying-wolf half holds under
//         both versions.
// ⚠️ The first draft of this file had the tls control assert the output FORMAT as
// well as the exit code, and it went red in this run for a reason that had
// nothing to do with crying wolf. That is a control testing two things and
// reporting one verdict; the format assertion was moved to the passing-line case
// where it belongs. Recorded because the fix came from running the negative test,
// which is the entire argument for running it.
//
// ── AND THE NEGATIVE TEST OF THE 2026-09-05 CASES, run before they were kept ─
// The three new `assert-no-gate-weakening` cases need the same proof as the ones
// above, and they get a sharper version of it: the "broken" guard is not a
// commit from three weeks ago, it is MAIN — 4ab17a24, the version these cases
// were written against.
//
//   cp tooling/ci/assert-no-gate-weakening.mjs /tmp/new.mjs
//   git checkout -- tooling/ci/assert-no-gate-weakening.mjs
//   node --test tooling/ci/test/vacuity-b.test.mjs        # must go RED
//   cp /tmp/new.mjs tooling/ci/assert-no-gate-weakening.mjs
//
// MEASURED: 22 cases, 19 green and 3 RED, and WHICH three is the result that
// matters — the passing-line split, "packages/ deleted while apps/ and the brick
// stand", and "packages/ thinned to one file". BOTH controls stayed GREEN, the
// new one included: `rm -rf packages/design_system` is green under main and green
// under the change, so the packages floor is proven not to fire on an honest
// shrink rather than merely asserted to. The other two guards' 12 cases were
// untouched by the revert, which is the check that the revert hit only what it
// was supposed to.
//
// Run:  node --test "tooling/ci/test/vacuity-b.test.mjs"
// ─────────────────────────────────────────────────────────────────────────────
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, copyFileSync, existsSync, rmSync, readdirSync, statSync, unlinkSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..', '..', '..');
const CI_DIR = resolve(HERE, '..');

/**
 * The harness's own coverage floor. If the copy is a handful of files, every
 * "the guard refused" below is true of an empty room and this suite is the exact
 * thing it exists to prevent. The repository tracked 1213 paths on 2026-08-17;
 * `assert-no-dead-files.mjs` floors the same quantity at 900, so this matches it
 * rather than inventing a second opinion about the same number.
 */
const TRACKED_FLOOR = 900;

/** The brick tree, whose files are the CONSTANT half of every union below. Never
 *  removed by a mutation here — removing it is what hid these defects. */
const BRICK_APP = 'tooling/bricks/app/__brick__/apps/{{app_id}}';

let COPY;
let COPIED = 0;

/**
 * A copy of the TRACKED tree, taken from the WORKING tree rather than from a
 * commit: the guards under test are themselves tracked files, and a copy from
 * HEAD would silently test the previous version of them. In CI the two are the
 * same thing; on a developer's machine they are not, and the version that
 * matters is the one about to be pushed.
 *
 * Made into a git repository because `assert-no-gate-weakening.mjs` derives its
 * domain from `git ls-files` — deliberately, since a filesystem walk there fails
 * the build on generated files nobody wrote.
 */
function buildCopy() {
  const dir = mkdtempSync(join(tmpdir(), 'nikatru-vacb-'));
  const ls = spawnSync('git', ['-C', ROOT, 'ls-files', '-z'], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  assert.equal(ls.status, 0, `git ls-files failed in ${ROOT}: ${ls.stderr}`);

  let copied = 0;
  for (const rel of ls.stdout.split('\0').filter(Boolean)) {
    const src = join(ROOT, rel);
    // Tracked but absent from the working tree — a deletion applied and not yet
    // staged. Skipped rather than fatal; the floor below is what notices if that
    // ever stops being a handful of files.
    if (!existsSync(src)) continue;
    const dst = join(dir, rel);
    mkdirSync(dirname(dst), { recursive: true });
    copyFileSync(src, dst);
    copied++;
  }

  const git = (...args) => spawnSync('git', ['-C', dir, ...args], { encoding: 'utf8' });
  git('init', '-q');
  git('config', 'user.email', 'vacuity-b@example.invalid');
  git('config', 'user.name', 'vacuity-b');
  // -f because the repo's own .gitignore came along in the copy, and a tracked
  // file that matches it would otherwise be dropped on the way in.
  git('add', '-A', '-f');
  git('commit', '-q', '-m', 'real-tree copy', '--no-gpg-sign');
  git('tag', '-f', 'pristine');
  return { dir, copied };
}

before(() => {
  const built = buildCopy();
  COPY = built.dir;
  COPIED = built.copied;
});

after(() => {
  if (COPY) rmSync(COPY, { recursive: true, force: true });
});

/** Undo whatever the last case did. Every mutation is followed by this. */
function restore() {
  spawnSync('git', ['-C', COPY, 'reset', '-q', '--hard', 'pristine'], { encoding: 'utf8' });
  spawnSync('git', ['-C', COPY, 'clean', '-qfdx'], { encoding: 'utf8' });
}

function run(guard) {
  const r = spawnSync(process.execPath, [join(CI_DIR, guard), COPY], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  return { code: r.status, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

const rm = (rel) => rmSync(join(COPY, rel), { recursive: true, force: true });

/** Every `.dart` under `rel`, relative to the copy. */
function dartUnder(rel, out = [], base = rel) {
  const abs = join(COPY, rel);
  if (!existsSync(abs)) return out;
  for (const name of readdirSync(abs)) {
    const child = `${rel}/${name}`;
    if (statSync(join(COPY, child)).isDirectory()) dartUnder(child, out, base);
    else if (name.endsWith('.dart')) out.push(child);
  }
  return out;
}

/** Delete every `.dart` under `rel` except the first `keep` of them, so the tree
 *  and its roots survive and ONLY the count falls. This is the shape a union
 *  floor cannot see and a per-root floor can. */
function thinDart(rel, keep) {
  const all = dartUnder(rel).sort();
  for (const f of all.slice(keep)) unlinkSync(join(COPY, f));
  return all.length - Math.max(0, all.length - keep);
}

/** Keep only the named packages; delete the rest of `packages/`. */
function keepOnlyPackages(names) {
  for (const name of readdirSync(join(COPY, 'packages'))) {
    if (!names.includes(name)) rm(`packages/${name}`);
  }
}

/**
 * The shared shape of every case: assert the copy is GREEN first, then mutate,
 * then assert the SPECIFIC coverage sentence. Without the green baseline a red
 * result is unattributable — a broken copy fails every guard for reasons that
 * have nothing to do with coverage, and this repo has three recorded cases of a
 * compile error being read as a caught mutation.
 */
function provesRefusal(guard, mutate, expected) {
  const before_ = run(guard);
  assert.equal(before_.code, 0, `the unmutated copy must be green first, else the mutation proves nothing:\n${before_.out}`);
  mutate();
  const after_ = run(guard);
  restore();
  assert.equal(after_.code, 1, `${guard} accepted an emptied subject:\n${after_.out}`);
  assert.match(after_.out, /COVERAGE LOST/, after_.out);
  for (const re of expected) assert.match(after_.out, re, after_.out);
}

/** …and the other half: a real shrink that clears the floor must stay green. A
 *  floor that fires on any change is a floor somebody deletes. */
function staysGreen(guard, mutate) {
  mutate();
  const after_ = run(guard);
  restore();
  assert.equal(after_.code, 0, `${guard} cried wolf on a shrink that clears its floor:\n${after_.out}`);
  return after_.out;
}

describe('the harness itself is looking at something', () => {
  test(`the copy carries at least ${TRACKED_FLOOR} tracked file(s)`, () => {
    assert.ok(
      COPIED >= TRACKED_FLOOR,
      `copied only ${COPIED} tracked file(s) into ${COPY}. Every refusal proven below would then be a ` +
        'refusal over an empty room, which is the exact defect this file exists to rule out.',
    );
  });

  test('the brick tree — the CONSTANT half of every union here — survived the copy', () => {
    assert.ok(
      existsSync(join(COPY, BRICK_APP)),
      'these defects are only expressible while the brick is present: it is the half that keeps a union ' +
        'floor satisfied after the product half has gone. A copy without it cannot express them.',
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('assert-no-tls-pinning refuses a subject that emptied under it', () => {
  const G = 'assert-no-tls-pinning.mjs';

  test('the passing line reports EVERY root separately, not one union total', () => {
    const { code, out } = run(G);
    assert.equal(code, 0, out);
    // The old line was "N shipped .dart file(s) scanned across apps, packages,
    // tooling/bricks" — still literally true at 22 files with two of the three
    // roots deleted. A per-root split cannot be true of a collapsed tree.
    assert.match(out, /apps=\d+\/floor \d+/, out);
    assert.match(out, /packages=\d+\/floor \d+/, out);
    assert.match(out, /tooling\/bricks=\d+\/floor \d+/, out);
  });

  test('THE DEFECT: apps/ and packages/ both deleted while the brick stands', () => {
    provesRefusal(G, () => { rm('apps'); rm('packages'); }, [
      /`apps` is not a directory/,
      /`packages` is not a directory/,
    ]);
  });

  test('apps/ alone deleted — the brick and packages/ cannot vouch for it', () => {
    provesRefusal(G, () => rm('apps'), [/`apps` is not a directory/]);
  });

  test('packages/ thinned BELOW its floor while every root still exists', () => {
    provesRefusal(G, () => keepOnlyPackages(['design_system', 'api_client']), [
      /`packages` yielded only \d+ shipped \.dart file\(s\), below its floor of \d+/,
    ]);
  });

  test('the brick thinned below ITS floor — the constant is floored too', () => {
    provesRefusal(G, () => thinDart('tooling/bricks', 1), [
      /`tooling\/bricks` yielded only \d+ shipped \.dart file\(s\), below its floor of \d+/,
    ]);
  });

  test('THE CONTROL: deleting packages/core is a real shrink that clears the floor', () => {
    // Asserts the exit code and NOTHING about the wording: a control is about
    // not crying wolf, and folding an output-format assertion into it makes it
    // go red for a reason that has nothing to do with crying wolf. Measured —
    // this case was the one false red when the suite was run against the
    // pre-fix guards, and it was the format match that failed, not the exit.
    staysGreen(G, () => rm('packages/core'));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('assert-no-gate-weakening refuses a subject that emptied under it', () => {
  const G = 'assert-no-gate-weakening.mjs';

  test('the passing line splits the real apps, the packages and the brick', () => {
    const { code, out } = run(G);
    assert.equal(code, 0, out);
    assert.match(out, /apps=\d+\/floor \d+ in \d+ real root\(s\)/, out);
    // Added 2026-09-05. Without this term the line read "174 tracked Dart
    // file(s) [apps=…; brick=…]" while 181 tracked .dart under packages/ were
    // outside the scan entirely — the sentence was true and the reader was not
    // told which trees it was true OF.
    assert.match(out, /packages=\d+\/floor \d+ in \d+ package root\(s\)/, out);
    assert.match(out, /brick=\d+\/floor \d+/, out);
  });

  test('THE DEFECT: apps/ deleted and NOT staged — tracked-but-missing, the shape a half-applied patch leaves', () => {
    provesRefusal(G, () => rm('apps'), [/NOT ONE real app under apps\//]);
  });

  test('…and with the deletion committed too, so the index agrees', () => {
    provesRefusal(
      G,
      () => {
        rm('apps');
        spawnSync('git', ['-C', COPY, 'add', '-A'], { encoding: 'utf8' });
        spawnSync('git', ['-C', COPY, 'commit', '-q', '-m', 'drop apps', '--no-gpg-sign'], { encoding: 'utf8' });
      },
      [/NOT ONE real app under apps\//],
    );
  });

  test('apps/ thinned to one file — the root still exists, so only the floor sees it', () => {
    provesRefusal(G, () => thinDart('apps', 1), [
      /only \d+ tracked Dart file\(s\) were scanned across apps\/ \(floor \d+\)/,
    ]);
  });

  test('the brick thinned to one file — the anchor passes, the floor does not', () => {
    provesRefusal(G, () => thinDart(BRICK_APP, 1), [
      /only \d+ tracked Dart file\(s\) were scanned under tooling\/bricks/,
    ]);
  });

  // ── packages/, the third root, added 2026-09-05 (ADR 065 chassis step 3) ──
  //
  // 🔴 THE DEFECT THIS FILE IS NAMED AFTER, IN A NEW TREE. Chassis step 2 moved
  // the generic chassis into `packages/` and this guard's domain stayed `apps`
  // plus the brick, so `packages/` contributed ZERO to every count it printed —
  // which is worse than a union floor, because there was no term to be satisfied
  // in the first place. `apps=148` and `brick=26` were the constants standing in
  // for a tree the guard had never opened.
  //
  // These two mutations LEAVE apps/ AND THE BRICK STANDING, for the same reason
  // every case above leaves the brick standing: a mutation that empties every
  // tree at once is caught by a check that has nothing to do with this one.
  test('THE DEFECT: packages/ deleted while apps/ and the brick stand', () => {
    provesRefusal(G, () => rm('packages'), [/NOT ONE package under packages\//]);
  });

  test('packages/ thinned to one file — the roots still exist, so only the floor sees it', () => {
    provesRefusal(G, () => thinDart('packages', 1), [
      /only \d+ tracked Dart file\(s\) were scanned across packages\/ \(floor \d+\)/,
    ]);
  });

  test('THE CONTROL: dropping apps/subly/integration_test clears the floor and stays green', () => {
    staysGreen(G, () => rm('apps/subly/integration_test'));
  });

  // The other half for the new floor. Retiring a whole package is a real,
  // legitimate shrink — design_system is 40 of the 180 tracked Dart files under
  // packages/ — and a floor that fired on it is a floor somebody deletes. Asserts
  // the exit code and NOTHING about the wording: folding a format assertion into
  // a control makes it go red for a reason that has nothing to do with crying
  // wolf, which is exactly what happened to the tls control in the 2026-08-17 run.
  test('THE PACKAGES CONTROL: dropping packages/design_system clears the floor and stays green', () => {
    staysGreen(G, () => rm('packages/design_system'));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('assert-no-clone-tells refuses a subject that emptied under it', () => {
  const G = 'assert-no-clone-tells.mjs';

  test('the passing line names each shared tree and its own count', () => {
    const { code, out } = run(G);
    assert.equal(code, 0, out);
    assert.match(out, /packages=\d+\/floor \d+/, out);
    assert.match(out, /tooling\/bricks=\d+\/floor \d+/, out);
  });

  test('THE DEFECT: packages/ deleted — the tree C-10 is actually about — while apps/ and the brick stand', () => {
    // Deliberately leaves apps/ alone: the pre-existing MIN_APPS floor watches
    // apps/, so a mutation that empties apps/ too is caught by a check that has
    // nothing to do with this one and proves nothing about it.
    provesRefusal(G, () => rm('packages'), [
      /packages — 0 \.dart scanned, floor \d+/,
      /The union floor \(MIN_SCANNED=\d+\) was SATISFIED here/,
    ]);
  });

  test('packages/ thinned below its floor with the tree still present', () => {
    provesRefusal(G, () => keepOnlyPackages(['core']), [/packages — \d+ \.dart scanned, floor \d+/]);
  });

  test('the brick deleted while packages/ alone clears the union floor', () => {
    provesRefusal(G, () => rm('tooling/bricks'), [/tooling\/bricks — 0 \.dart scanned, floor \d+/]);
  });

  test('THE CONTROL: dropping packages/design_system clears the floor and stays green', () => {
    staysGreen(G, () => rm('packages/design_system'));
  });
});
