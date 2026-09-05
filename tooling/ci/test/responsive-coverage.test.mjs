// ─────────────────────────────────────────────────────────────────────────────
// responsive-coverage.test.mjs — assert-responsive-coverage.mjs must be able to
// FAIL, and must be able to say YES.
//
// 🔴 THIS GUARD HAD NO TEST FILE OF ITS OWN UNTIL 2026-09-05, AND THAT ABSENCE
// WAS LOAD-BEARING IN THE WRONG DIRECTION. assert-a11y-coverage.mjs's header
// gives it as the reason a shared parse was NOT extracted: "the extraction edits
// assert-responsive-coverage.mjs, a 756-line guard with fifteen recorded failing
// cases, and this change could not verify that rewrite." Those fifteen cases
// were RECORDED — in prose, in the guard's own header — and executable only as a
// synthetic-fixture block inside `tooling/ci/test/guards.test.mjs`. A guard
// whose failing path is exercised only against a tree somebody wrote by hand is
// half-guarded: `assert-seams-wired.mjs` shipped broken and ALL SIX of its
// hand-written fixtures passed against the broken version. This file mutates the
// REAL tree.
//
// ⚠️ AND EVERY MUTATION ASSERTS ITS OWN ANCHOR WAS FOUND. `edit()` throws when
// the text it is asked to replace is not present, so a mutation that has drifted
// out of the tree FAILS LOUDLY instead of quietly testing nothing.
//
// ── WHAT IS A FAILURE AND WHAT IS A PRINT ────────────────────────────────────
// In `apps/subly` an uncovered surface FAILS the build — unchanged, and R1 pins
// it. In the two roots the 2026-09-05 widening added (the brick template and
// `packages/design_system`) the uncovered half is PRINTED and not failed,
// because those roots entered the domain that day carrying seventeen unmeasured
// surfaces between them and the files that would fix them were not files that
// change owned. Report mode is a DECISION with a date on it, not a default: R12
// asserts that an uncovered surface in the ENFORCED root still fails in the very
// same run in which a report-mode root's nine only print.
//
// 🔴 AND REPORT MODE IS NOT A SILENCE. R10 and R10b are the proof: the coverage
// those roots DO have is held by a `coveredSurfaces` floor, so it cannot leave
// quietly. Without those two tests, "printed, not failed" would be
// indistinguishable from "not checked".
//
// Run:  node --test "tooling/ci/test/responsive-coverage.test.mjs"
// ─────────────────────────────────────────────────────────────────────────────
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  cpSync,
  mkdtempSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
  renameSync,
  rmSync,
  existsSync,
} from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const CI_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REPO = resolve(CI_DIR, '..', '..');
const GUARD = join(CI_DIR, 'assert-responsive-coverage.mjs');

const APP = 'apps/subly';
const ROUTER = `${APP}/lib/core/router.dart`;
// 🔴 THE ROUTER IS A SPINE, NOT A FILE (2026-09-04, P1b) — `router.dart` is a
// BARREL over `lib/core/router/`, and copying only the barrel gives a fixture a
// router with NO ROUTES IN IT. That is not a copy of the real tree: the routed
// set parses empty and every mutation under it asserts against a subject that
// is not there.
const ROUTER_DIR = `${APP}/lib/core/router`;
const ROUTER_ROUTES = `${ROUTER_DIR}/routes.dart`;
const ROUTER_SHELL = `${ROUTER_DIR}/shell.dart`;
const FEATURES = `${APP}/lib/features`;
const TESTS = `${APP}/test`;
const HARNESS = `${TESTS}/support/width_harness.dart`;
const RESET_PW = `${TESTS}/width_reset_password_test.dart`;

// 🔴 THE MANIFESTS ARE PART OF THE SUBJECT. The guard's domain used to be
// `const APP = 'apps/subly'`; it is now DERIVED from `tooling/bricks/app/
// brick.yaml` plus the root `pubspec.yaml` `workspace:` list, so a fixture with
// no manifests derives NO ROOT and the guard correctly refuses it.
const WORKSPACE_MANIFEST = 'pubspec.yaml';
const APP_MANIFEST = `${APP}/pubspec.yaml`;

const SUBJECT = [WORKSPACE_MANIFEST, APP_MANIFEST, ROUTER, ROUTER_DIR, FEATURES, TESTS];

const BRICK = 'tooling/bricks/app/__brick__/apps/{{app_id}}';
const BRICK_MANIFEST = 'tooling/bricks/app/brick.yaml';
const DS = 'packages/design_system';
const NEW_ROOT_SUBJECT = [BRICK, BRICK_MANIFEST, DS];

let TMP;
let seq = 0;
before(() => {
  TMP = mkdtempSync(join(tmpdir(), 'nikatru-resp-'));
});
after(() => {
  rmSync(TMP, { recursive: true, force: true });
});

function tree(extra = []) {
  const root = join(TMP, `r${seq++}`);
  for (const rel of [...SUBJECT, ...extra]) {
    const src = join(REPO, rel);
    assert.ok(existsSync(src), `the real tree no longer has ${rel} — this suite's subject moved`);
    const dest = join(root, rel);
    mkdirSync(dirname(dest), { recursive: true });
    cpSync(src, dest, { recursive: true });
  }
  return root;
}

/** The same, plus the two roots added 2026-09-05 — AND the guard's own file,
 *  which is the FULL-CHECKOUT SENTINEL.
 *
 *  🔴 THE SENTINEL IS PART OF THE FIXTURE, NOT AN ACCIDENT OF ONE. The guard
 *  applies its "every DECLARED root must have been DERIVED" clause only when
 *  its own file is present under the root it is scanning, because a partial
 *  tree with one root in it is a legitimate thing to scan and this suite builds
 *  several. That sentinel sits OUTSIDE `apps/`, `packages/` and
 *  `tooling/bricks/`, so no mutation of a subject can move it — which is the
 *  whole reason it is the sentinel and a file inside a subject tree is not. */
function treeWithNewRoots() {
  const root = tree(NEW_ROOT_SUBJECT);
  mkdirSync(join(root, 'tooling', 'ci'), { recursive: true });
  cpSync(GUARD, join(root, 'tooling', 'ci', 'assert-responsive-coverage.mjs'));
  return root;
}

const readIn = (root, rel) => readFileSync(join(root, rel), 'utf8');
const writeIn = (root, rel, text) => writeFileSync(join(root, rel), text);

/** Replace `find` with `replace`, and THROW if it was not there `count` times.
 *  A mutation whose anchor has drifted out of the tree must break this suite,
 *  not silently apply zero edits. */
function edit(root, rel, find, replace, { count = 1 } = {}) {
  const before = readIn(root, rel);
  const hits = before.split(find).length - 1;
  assert.equal(
    hits,
    count,
    `mutation anchor appeared ${hits}×, expected ${count}×, in ${rel}:\n  ${find.slice(0, 120)}`,
  );
  writeIn(root, rel, before.split(find).join(replace));
}

function run(root) {
  const r = spawnSync(process.execPath, [GUARD, root], { encoding: 'utf8' });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
}

/** The ⬜ block of one report-mode root — the surfaces it prints as unmeasured. */
function printedUnmeasured(out, root) {
  const marker = `reachable surface(s) in ${root} have NO width measurement`;
  const start = out.indexOf(marker);
  if (start === -1) return [];
  const lines = [];
  for (const l of out.slice(start).split('\n').slice(1)) {
    if (!l.startsWith('   · ')) break;
    lines.push(l.trim().split(' ')[1]);
  }
  return lines;
}
const fails = (out) => out.split('\n').filter((l) => l.startsWith('FAIL '));

// ─────────────────────────────────────────────────────────────────────────────
// POSITIVE CONTROLS — without these, every failure below is consistent with a
// guard that can only ever say "uncovered".
// ─────────────────────────────────────────────────────────────────────────────
describe('the guard says YES on the tree as it is', () => {
  test('the REAL repository — 3 derived roots, subly EQUAL, exit 0', () => {
    const { code, out } = run(REPO);
    assert.equal(code, 0, out);
    // 🔴 THE ROOT LINE IS PINNED BECAUSE THE ROOT LINE IS THE FIX. The domain
    // being one hardcoded app is the defect this change exists to remove, and
    // nothing else in the output would say it had come back: `19 surface(s)
    // reachable … EQUAL` prints just as happily over a tree with two unchecked
    // roots in it.
    assert.match(out, /3 root\(s\) DERIVED, never listed/);
    assert.match(out, /apps\/subly \(workspace app member\)/);
    assert.match(
      out,
      /packages\/design_system \(workspace package member: declares flutter_test AND a public widget\)/,
    );
    assert.match(out, /\{\{app_id\}\} \(brick template, declared by tooling\/bricks\/app\/brick\.yaml\)/);
    assert.match(out, /FULL CHECKOUT: all 3 declared root\(s\) are required to be among them/);

    assert.match(out, /apps\/subly: 19 surface\(s\) reachable, 19 measured — the two sets are EQUAL/);
    assert.match(
      out,
      /apps\/subly: every measured surface is pumped at kPhone \(375\), kTablet \(768\), kDesktop \(1280\)/,
    );
    // The two report-mode roots, and the shape of what they report.
    assert.match(out, /\{\{app_id\}\}: 3 of 12 surface\(s\) measured — 9 PRINTED and not failed/);
    assert.match(out, /packages\/design_system: 11 of 19 surface\(s\) measured — 8 PRINTED and not failed/);
  });

  test('the copied subject tree reproduces the subly reading exactly — and derives ONE root', () => {
    const { code, out } = run(tree());
    assert.equal(code, 0, out);
    assert.match(out, /1 root\(s\) DERIVED, never listed — apps\/subly \(workspace app member\)/);
    assert.match(out, /PARTIAL TREE: the declared-root-must-exist clause is SKIPPED/);
    assert.match(out, /apps\/subly: 19 surface\(s\) reachable, 19 measured — the two sets are EQUAL/);
    assert.equal(fails(out).length, 0, out);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// THE TWO DIRECTIONS OF THE EQUALITY, IN THE ENFORCED ROOT
// ─────────────────────────────────────────────────────────────────────────────
describe('set equality, both directions, in apps/subly', () => {
  test('R1 · a routed screen whose width test stops constructing it — UNCOVERED SURFACE', () => {
    const root = tree();
    // The import stays, so provenance survives and the ONLY thing that changed
    // is whether any case pumps the screen. That is the axis under test.
    edit(root, RESET_PW, 'const ResetPasswordScreen()', 'const SizedBox()', { count: 4 });
    const { code, out } = run(root);
    assert.equal(code, 1, out);
    assert.match(out, /FAIL UNCOVERED SURFACE — `ResetPasswordScreen`/);
    // ⚠️ THE COVERED FLOOR CO-FIRES, AND IT IS PINNED RATHER THAN LEFT
    // UNSTATED. subly's `coveredSurfaces` floor is its WHOLE domain, so any
    // surface losing its measurement trips both limbs. The measured reading is
    // the record; a third finding appearing here means something else moved.
    //
    // 🔴 AND THE ORDER OF THOSE TWO WAS A REAL DEFECT FOR ONE DRAFT. The
    // covered floor originally ran BEFORE the parse gate, so tripping it
    // suppressed the whole equality section and the run reported "18 measured,
    // floor is 19" and NEVER NAMED THE SURFACE. This assertion is what pins
    // the fix: the specific finding must survive the general one.
    assert.match(out, /FAIL COVERAGE LOST — `apps\/subly` has 18 measured surface\(s\).*floor is 19/s);
    assert.equal(fails(out).length, 2, out);
  });

  test('R3 · DEAD COVERAGE — the unrouted twin defect, verbatim', () => {
    const root = tree();
    // The STAMPED twin: a second class called OnboardingScreen in a file no
    // route imports. This is the shape `responsive_width_test.dart` shipped —
    // the screen with the width cap had no user and the screen with the user
    // had no width cap, and the suite was green the entire time.
    mkdirSync(join(root, `${FEATURES}/firstrun`), { recursive: true });
    writeIn(
      root,
      `${FEATURES}/firstrun/onboarding_screen.dart`,
      'class OnboardingScreen extends StatelessWidget {\n' +
        '  const OnboardingScreen({super.key});\n' +
        '}\n',
    );
    // 🔴 A SWAP, NOT AN ADDITION. Two files declaring one symbol is AMBIGUOUS
    // SUBJECT, which fires FIRST and stops the guard ever computing DEAD
    // COVERAGE — the fixture would pass while proving a different limb.
    edit(
      root,
      `${TESTS}/width_onboarding_test.dart`,
      "import 'package:subly/features/onboarding/onboarding_screen.dart';",
      "import 'package:subly/features/firstrun/onboarding_screen.dart';",
    );
    const { code, out } = run(root);
    assert.equal(code, 1, out);
    assert.match(
      out,
      /FAIL DEAD COVERAGE — .* measures `OnboardingScreen` from `.*firstrun\/onboarding_screen\.dart`/,
    );
  });

  test('R12 · the ENFORCED root still fails in the same run a report-mode root only prints', () => {
    // Report mode is per root, dated and opt-in — never a default a new root
    // falls into. One tree, one run, both behaviours side by side.
    const root = treeWithNewRoots();
    edit(root, RESET_PW, 'const ResetPasswordScreen()', 'const SizedBox()', { count: 4 });
    const { code, out } = run(root);
    assert.equal(code, 1, out);
    assert.match(out, /FAIL UNCOVERED SURFACE — `ResetPasswordScreen`/);
    // The brick's nine unmeasured screens are in the SAME run and NOT failures.
    assert.ok(printedUnmeasured(out, BRICK).includes('HomeScreen'), out);
    assert.equal(
      fails(out).filter((l) => l.includes('{{app_id}}') && l.includes('UNCOVERED')).length,
      0,
      `a report-mode root produced an UNCOVERED failure:\n${out}`,
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// A FILE IS NOT A MEASUREMENT
// ─────────────────────────────────────────────────────────────────────────────
describe('the widths a case actually pumps', () => {
  test('R6 · the kTablet case is re-pointed at kPhone — UNMEASURED WIDTH', () => {
    const root = tree();
    // Both sets stay byte-identical and the equality still prints EQUAL: this
    // is the `width_home_test.dart` defect, which shipped three cases at 375,
    // 1500 and 1920 and measured neither window class between a phone and an
    // ultra-wide display.
    edit(root, RESET_PW, 'kTablet', 'kPhone', { count: 2 });
    const { code, out } = run(root);
    assert.equal(code, 1, out);
    assert.match(out, /FAIL UNMEASURED WIDTH — `ResetPasswordScreen`.*not one case pumps kTablet \(768\)/s);
    assert.equal(fails(out).length, 1, out);
  });

  test('R5 · the harness is renamed away — the required widths resolve to nothing', () => {
    const root = tree();
    renameSync(join(root, HARNESS), join(root, `${TESTS}/support/widths.dart`));
    const { code, out } = run(root);
    assert.equal(code, 1, out);
    // ⚠️ THE FALLBACK IS WHY THIS MESSAGE AND NOT THE EMPTY ONE. With no
    // harness the guard harvests window classes from the corpus itself (the
    // brick declares its four inline), and subly's width tests DO declare local
    // constants — kJustBelowLarge, kAtSplit, kShell. So the set is not empty;
    // it simply no longer contains the three that are required, which is a
    // requirement naming a constant that does not exist.
    assert.match(out, /FAIL `kPhone`, `kTablet`, `kDesktop` are required of every responsive surface/);
    assert.match(out, /ranges over nothing and reports clean/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// COVERAGE LOST — the scan reached nothing, and said so
// ─────────────────────────────────────────────────────────────────────────────
describe('an empty scan is COVERAGE LOST, never a pass', () => {
  test('R2 · an EMPTY routed set — no routes and no sheets', () => {
    const root = tree();
    writeIn(root, ROUTER, 'const int routerStub = 0;\n');
    for (const f of readdirSync(join(root, ROUTER_DIR))) {
      if (f.endsWith('.dart')) writeIn(root, `${ROUTER_DIR}/${f}`, 'const int routerStub = 0;\n');
    }
    for (const sheet of ['add/add_subscription_sheet.dart', 'cancel/cancel_sheet.dart']) {
      writeIn(root, `${FEATURES}/${sheet}`, 'const int stub = 0;\n');
    }
    const { code, out } = run(root);
    assert.equal(code, 1, out);
    assert.match(out, /COVERAGE LOST — the ROUTED set of `apps\/subly` parsed EMPTY/);
  });

  test('R4 · a screen AND its width test leave together — only the surfaces floor sees it', () => {
    const root = tree();
    // 🔴 THE MUTATION SET EQUALITY CANNOT SEE. Both sets shrink by one, they
    // stay EQUAL, and every message about the equality goes on being true.
    // Coverage left the tree and the guard would have applauded.
    edit(
      root,
      ROUTER_ROUTES,
      '  GoRoute(\n' +
        "    path: '/notifications',\n" +
        '    parentNavigatorKey: rootNavigatorKey,\n' +
        '    builder: (_, __) => const NotificationsScreen(),\n' +
        '  ),\n',
      '',
    );
    rmSync(join(root, `${TESTS}/width_notifications_test.dart`));
    const { code, out } = run(root);
    assert.equal(code, 1, out);
    assert.match(out, /COVERAGE LOST — `apps\/subly` has only 18 responsive surface\(s\).*floor is 19/s);
    // Proof the equality really did stay quiet — the thing this floor exists
    // for. If an UNCOVERED or DEAD line appears here the mutation stopped being
    // the silent one it is named for.
    assert.doesNotMatch(out, /UNCOVERED SURFACE/);
    assert.doesNotMatch(out, /DEAD COVERAGE/);
  });

  test('R13 · a NOT_A_PANE entry no route builds is judgement over nothing', () => {
    const root = tree();
    edit(
      root,
      ROUTER_SHELL,
      'AppShell(navigationShell: navShell)',
      'AppShellChrome(navigationShell: navShell)',
    );
    const { code, out } = run(root);
    assert.equal(code, 1, out);
    assert.match(out, /FAIL `AppShell` is excluded in NOT_A_PANE for `apps\/subly` but no route in .* builds it/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 🔴 THE WIDENING ITSELF — every test in this block was GREEN against the
// version of the guard this change replaces, WITH THE MUTATION APPLIED. Not a
// manner of speaking: `tooling/ci/assert-responsive-coverage.mjs` was copied out
// of git at a9b04696, renamed into tooling/ci so its relative imports resolved,
// and run against each mutated tree on 2026-09-05. It exited 0 on every one.
// The domain was one hardcoded string and none of these touched it.
// ─────────────────────────────────────────────────────────────────────────────
describe('the domain is DERIVED, and a root that stops being derived FAILS', () => {
  test('R7 · the brick DECLARES itself and its app directory is gone — COVERAGE LOST', () => {
    const root = treeWithNewRoots();
    renameSync(join(root, BRICK), join(root, 'tooling/bricks/app/__brick__/apps/renamed_away'));
    const { code, out } = run(root);
    assert.equal(code, 1, out);
    assert.match(out, /COVERAGE LOST — tooling\/bricks\/app\/brick\.yaml exists, so this tree DECLARES a brick/);
  });

  test('R8 · a package root cut from the workspace list — COVERAGE LOST', () => {
    const root = treeWithNewRoots();
    edit(root, WORKSPACE_MANIFEST, '\n  - packages/design_system', '');
    const { code, out } = run(root);
    assert.equal(code, 1, out);
    assert.match(out, /DECLARED root\(s\) were not among the 2 this run derived/);
    assert.match(out, /`packages\/design_system`/);
    // The reason the limb exists, asserted: nothing else could see it, because
    // the scan still read the other roots in full.
    assert.match(out, /every count above would print healthy/);
  });

  test('R9 · a package root that stops declaring flutter_test — COVERAGE LOST', () => {
    const root = treeWithNewRoots();
    edit(root, `${DS}/pubspec.yaml`, '\n  flutter_test:', '');
    const { code, out } = run(root);
    assert.equal(code, 1, out);
    assert.match(out, /DECLARED root\(s\) were not among the 2 this run derived/);
    assert.match(out, /`packages\/design_system`/);
  });

  test('R9b · the APP cut from the workspace list — COVERAGE LOST', () => {
    const root = treeWithNewRoots();
    edit(root, WORKSPACE_MANIFEST, '\n  - apps/subly', '');
    const { code, out } = run(root);
    assert.equal(code, 1, out);
    assert.match(out, /DECLARED root\(s\) were not among the 2 this run derived/);
    assert.match(out, /`apps\/subly`/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 🔴 REPORT MODE IS NOT A SILENCE — the backstop floors
// ─────────────────────────────────────────────────────────────────────────────
describe('a report-mode root can get better, never quietly worse', () => {
  test("R10 · the brick's width suite is deleted — the coveredSurfaces backstop fires", () => {
    const root = treeWithNewRoots();
    rmSync(join(root, `${BRICK}/test/responsive_width_test.dart`));
    const { code, out } = run(root);
    assert.equal(code, 1, out);
    assert.match(out, /COVERAGE LOST — `tooling\/bricks.*` has 0 measured surface\(s\) and its measured floor is 3/s);
    assert.match(out, /COVERAGE LOST — `tooling\/bricks.*` yielded only 0 width test file\(s\)/s);
  });

  test('R10b · one design_system width case is deleted — the same backstop fires there', () => {
    const root = treeWithNewRoots();
    rmSync(join(root, `${DS}/test/two_pane_test.dart`));
    const { code, out } = run(root);
    assert.equal(code, 1, out);
    assert.match(
      out,
      /COVERAGE LOST — `packages\/design_system` has 9 measured surface\(s\) and its measured floor is 11/s,
    );
  });

  test("R11a · one brick route leaves — that root's surfaces floor fires", () => {
    const root = treeWithNewRoots();
    const rel = `${BRICK}/lib/core/router.dart`;
    const src = readIn(root, rel);
    const anchor = "          GoRoute(\n            path: '/settings',";
    const open = src.indexOf(anchor);
    assert.ok(open !== -1, 'the /settings route anchor moved in the brick router');
    const close = src.indexOf('          ),', open) + '          ),\n'.length;
    writeIn(root, rel, src.slice(0, open) + src.slice(close));
    const { code, out } = run(root);
    assert.equal(code, 1, out);
    assert.match(out, /COVERAGE LOST — `tooling\/bricks.*` has only 11 responsive surface\(s\).*floor is 12/s);
    // The route left but its width case did not, so the measurement is now
    // pointed at a screen nothing routes to — DEAD COVERAGE, in a report-mode
    // root, FAILING. That is the half of the equality report mode does not relax.
    assert.match(out, /FAIL DEAD COVERAGE — responsive_width_test\.dart measures `SettingsScreen`/);
  });

  test("R11b · one design_system widget file leaves — that root's surfaces floor fires", () => {
    const root = treeWithNewRoots();
    rmSync(join(root, `${DS}/lib/src/widgets/two_pane.dart`));
    const { code, out } = run(root);
    assert.equal(code, 1, out);
    assert.match(out, /COVERAGE LOST — `packages\/design_system` has only 17 responsive surface\(s\).*floor is 19/s);
  });

  test("R11c · a NEW unmeasured surface in EACH new root reaches that root's printed list", () => {
    const root = treeWithNewRoots();
    mkdirSync(join(root, `${BRICK}/lib/features/export`), { recursive: true });
    writeIn(
      root,
      `${BRICK}/lib/features/export/g3_probe_sheet.dart`,
      "import 'package:flutter/material.dart';\n\nFuture<void> showG3ProbeSheet(BuildContext context) async {}\n",
    );
    writeIn(
      root,
      `${DS}/lib/src/widgets/g3_probe.dart`,
      "import 'package:flutter/material.dart';\n\nclass G3ProbeWidget extends StatelessWidget {\n" +
        '  const G3ProbeWidget({super.key});\n' +
        '  @override\n' +
        '  Widget build(BuildContext context) => const SizedBox();\n}\n',
    );
    const { code, out } = run(root);
    // PRINTED, not failed — and NAMED. A root that is derived but whose new
    // surfaces never reach the report is a root this guard cannot see.
    assert.equal(code, 0, out);
    assert.ok(printedUnmeasured(out, BRICK).includes('showG3ProbeSheet'), out);
    assert.ok(printedUnmeasured(out, DS).includes('G3ProbeWidget'), out);
    assert.match(out, /\{\{app_id\}\}: 3 of 13 surface\(s\) measured — 10 PRINTED/);
    assert.match(out, /packages\/design_system: 11 of 20 surface\(s\) measured — 9 PRINTED/);
  });
});
