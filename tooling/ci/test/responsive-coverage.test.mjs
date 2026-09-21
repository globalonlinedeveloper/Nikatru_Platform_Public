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
// In `apps/subscriptiontracker` an uncovered surface FAILS the build — unchanged, and R1 pins
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

const APP = 'apps/subscriptiontracker';
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
// `const APP = 'apps/subscriptiontracker'`; it is now DERIVED from `tooling/bricks/app/
// brick.yaml` plus the root `pubspec.yaml` `workspace:` list, so a fixture with
// no manifests derives NO ROOT and the guard correctly refuses it.
const WORKSPACE_MANIFEST = 'pubspec.yaml';
const APP_MANIFEST = `${APP}/pubspec.yaml`;

// 🔴 THE CHASSIS PACKAGE IS PART OF THE SUBJECT SINCE [ADR 071]. Six of the
// brick's twelve routed screens are ADAPTERS importing
// `package:nikatru_chassis_screens/auth/…`; this guard resolves that import and
// refuses when the target is not on disk, so a fixture that copied the brick
// without it failed as COVERAGE LOST for a reason no case here is about. It is
// also a DERIVED root, and the one root in the tree that ENFORCES.
//
// ⏱ 2026-09-20 · IT IS NOW PART OF THE **BASE** SUBJECT, NOT ONLY OF
// `NEW_ROOT_SUBJECT` ([ADR 086]). `apps/subscriptiontracker` has started down
// the same road the brick took: `features/auth/reaccept_terms_screen.dart` is
// an ADAPTER over `package:nikatru_chassis_screens/auth/…`, so an app fixture
// without the package stopped being a copy of the real tree the moment that
// screen was adopted — measured 2026-09-20, four cases in this file failed as
// `COVERAGE LOST — … that file is not on disk`, which is a reason none of them
// is about. The app fixtures therefore derive TWO roots now, and
// `NEW_ROOT_SUBJECT` adds the remaining two rather than three.
//
// ⚠️ THE WHOLE PACKAGE, NOT JUST ITS `lib`. A root is DERIVED from the
// workspace list AND the member's own `pubspec.yaml`, and this guard refuses a
// delegation whose target root it never derived — so copying `lib` alone trades
// one COVERAGE LOST for another. Measured in both directions before this line
// was written.
const CHASSIS = 'packages/chassis_screens';

const SUBJECT = [WORKSPACE_MANIFEST, APP_MANIFEST, ROUTER, ROUTER_DIR, FEATURES, TESTS, CHASSIS];

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
  test('the REAL repository — 4 derived roots, subscriptiontracker EQUAL, exit 0', () => {
    const { code, out } = run(REPO);
    assert.equal(code, 0, out);
    // 🔴 THE ROOT LINE IS PINNED BECAUSE THE ROOT LINE IS THE FIX. The domain
    // being one hardcoded app is the defect this change exists to remove, and
    // nothing else in the output would say it had come back: `19 surface(s)
    // reachable … EQUAL` prints just as happily over a tree with two unchecked
    // roots in it.
    // FOUR since [ADR 071] added packages/chassis_screens — the one root here
    // that ENFORCES rather than reports.
    assert.match(out, /4 root\(s\) DERIVED, never listed/);
    assert.match(out, /apps\/subscriptiontracker \(workspace app member\)/);
    assert.match(
      out,
      /packages\/design_system \(workspace package member: declares flutter_test AND a public widget\)/,
    );
    assert.match(out, /\{\{app_id\}\} \(brick template, declared by tooling\/bricks\/app\/brick\.yaml\)/);
    assert.match(out, /FULL CHECKOUT: all 4 declared root\(s\) are required to be among them/);
    // 17 since 2026-09-07 ([ADR 067] phase 2, unit app-shell): NikatruApp,
    // ConsentScrim, ConsentPromptCard, OfflineBannerHost and AppLifecycleFlush
    // arrived with test/app_shell_view_test.dart, which pumps all five at all
    // three window classes. The number is read off the guard's own per-root
    // line, and it is PINNED here for the same reason the root line is: the root
    // staying at reachable == measured is the property, and "17 reachable, 12
    // measured" would print as a cheerful report-mode line if it ever slipped.
    assert.match(out, /packages\/chassis_screens: 18 surface\(s\) reachable, 18 measured — the two sets are EQUAL/);

    assert.match(out, /apps\/subscriptiontracker: 19 surface\(s\) reachable, 19 measured — the two sets are EQUAL/);
    assert.match(
      out,
      /apps\/subscriptiontracker: every measured surface is pumped at kPhone \(375\), kTablet \(768\), kDesktop \(1280\)/,
    );
    // The two report-mode roots, and the shape of what they report.
    assert.match(out, /\{\{app_id\}\}: 3 of 12 surface\(s\) measured — 2 PRINTED and not failed/);
    assert.match(out, /packages\/design_system: 12 of 20 surface\(s\) measured — 8 PRINTED and not failed/);
  });

  test('the copied subject tree reproduces the subscriptiontracker reading exactly — and derives TWO roots', () => {
    // ⏱ 2026-09-20 · TWO, NOT ONE, AND THE APP READING IS BYTE-FOR-BYTE WHAT IT
    // WAS ([ADR 086]). `apps/subscriptiontracker` adopted `ReacceptTermsView`,
    // so its adapter delegates into `packages/chassis_screens`; this guard
    // resolves that import and refuses when the target is not on disk, so the
    // fixture carries the package and therefore derives it as a second root.
    //
    // 🔴 THE PER-ROOT LINE IS THE CLAIM, NOT THE AGGREGATE. `19 reachable, 19
    // measured — EQUAL` is what this case has always been about, and it did not
    // move: the app still pumps `ReacceptTermsScreen` at all three widths from
    // its own `width_legal_gates_test.dart`, which is why the aggregate reports
    // `0 measured where they delegate to` rather than one. Asserting only the
    // 37-surface total would let the app's own equality break under cover of a
    // second root arriving, which is the exact silent-stop shape this file is
    // built against.
    const { code, out } = run(tree());
    assert.equal(code, 0, out);
    assert.match(
      out,
      /2 root\(s\) DERIVED, never listed — packages\/chassis_screens \(workspace package member: declares flutter_test AND a public widget\) · apps\/subscriptiontracker \(workspace app member\)/,
    );
    assert.match(out, /PARTIAL TREE: the declared-root-must-exist clause is SKIPPED/);
    assert.match(out, /apps\/subscriptiontracker: 19 surface\(s\) reachable, 19 measured — the two sets are EQUAL/);
    assert.match(out, /packages\/chassis_screens: 18 surface\(s\) reachable, 18 measured — the two sets are EQUAL/);
    // ⏱ 2026-09-22 · 36 → 37 TEST FILES, SURFACES UNCHANGED. The app gained
    // `width_shell_fab_test.dart`, which pumps the five shell branches at all
    // three widths to prove the FAB clears each list's last row. It measures
    // surfaces that were already measured, so both per-root equalities above
    // are untouched and only the file count moves — re-derived from the
    // guard's own output, as the 36 was.
    assert.match(
      out,
      /37 reachable surface\(s\), 37 measured by 37 test file\(s\); 0 measured where they delegate to/,
    );
    assert.equal(fails(out).length, 0, out);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// THE TWO DIRECTIONS OF THE EQUALITY, IN THE ENFORCED ROOT
// ─────────────────────────────────────────────────────────────────────────────
describe('set equality, both directions, in apps/subscriptiontracker', () => {
  test('R1 · a routed screen whose width test stops constructing it — UNCOVERED SURFACE', () => {
    const root = tree();
    // The import stays, so provenance survives and the ONLY thing that changed
    // is whether any case pumps the screen. That is the axis under test.
    edit(root, RESET_PW, 'const ResetPasswordScreen()', 'const SizedBox()', { count: 4 });
    const { code, out } = run(root);
    assert.equal(code, 1, out);
    assert.match(out, /FAIL UNCOVERED SURFACE — `ResetPasswordScreen`/);
    // ⚠️ THE COVERED FLOOR CO-FIRES, AND IT IS PINNED RATHER THAN LEFT
    // UNSTATED. subscriptiontracker's `coveredSurfaces` floor is its WHOLE domain, so any
    // surface losing its measurement trips both limbs. The measured reading is
    // the record; a third finding appearing here means something else moved.
    //
    // 🔴 AND THE ORDER OF THOSE TWO WAS A REAL DEFECT FOR ONE DRAFT. The
    // covered floor originally ran BEFORE the parse gate, so tripping it
    // suppressed the whole equality section and the run reported "18 measured,
    // floor is 19" and NEVER NAMED THE SURFACE. This assertion is what pins
    // the fix: the specific finding must survive the general one.
    assert.match(out, /FAIL COVERAGE LOST — `apps\/subscriptiontracker` has 18 measured surface\(s\).*floor is 19/s);
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
      "import 'package:subscriptiontracker/features/onboarding/onboarding_screen.dart';",
      "import 'package:subscriptiontracker/features/firstrun/onboarding_screen.dart';",
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
    // brick declares its four inline), and subscriptiontracker's width tests DO declare local
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
    assert.match(out, /COVERAGE LOST — the ROUTED set of `apps\/subscriptiontracker` parsed EMPTY/);
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
    assert.equal(code, 2, out);
    assert.match(out, /COVERAGE LOST — `apps\/subscriptiontracker` has only 18 responsive surface\(s\).*floor is 19/s);
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
    assert.match(out, /FAIL `AppShell` is excluded in NOT_A_PANE for `apps\/subscriptiontracker` but no route in .* builds it/);
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
    assert.equal(code, 2, out);
    assert.match(out, /COVERAGE LOST — tooling\/bricks\/app\/brick\.yaml exists, so this tree DECLARES a brick/);
  });

  test('R8 · a package root cut from the workspace list — COVERAGE LOST', () => {
    const root = treeWithNewRoots();
    edit(root, WORKSPACE_MANIFEST, '\n  - packages/design_system', '');
    const { code, out } = run(root);
    assert.equal(code, 2, out);
    assert.match(out, /DECLARED root\(s\) were not among the 3 this run derived/);
    assert.match(out, /`packages\/design_system`/);
    // The reason the limb exists, asserted: nothing else could see it, because
    // the scan still read the other roots in full.
    assert.match(out, /every count above would print healthy/);
  });

  test('R9 · a package root that stops declaring flutter_test — COVERAGE LOST', () => {
    const root = treeWithNewRoots();
    edit(root, `${DS}/pubspec.yaml`, '\n  flutter_test:', '');
    const { code, out } = run(root);
    assert.equal(code, 2, out);
    assert.match(out, /DECLARED root\(s\) were not among the 3 this run derived/);
    assert.match(out, /`packages\/design_system`/);
  });

  test('R9b · the APP cut from the workspace list — COVERAGE LOST', () => {
    const root = treeWithNewRoots();
    edit(root, WORKSPACE_MANIFEST, '\n  - apps/subscriptiontracker', '');
    const { code, out } = run(root);
    assert.equal(code, 2, out);
    assert.match(out, /DECLARED root\(s\) were not among the 3 this run derived/);
    assert.match(out, /`apps\/subscriptiontracker`/);
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
    assert.equal(code, 2, out);
    // 🔴 THE BACKSTOP THAT FIRES HERE IS THE CORPUS FLOOR, AND SAYING SO IS THE
    // POINT. Until [ADR 067] phase 2 the brick's own suite measured six surfaces
    // that no longer live in the brick, so deleting it dropped `measured` from 9
    // to 6 and the `coveredSurfaces` backstop fired. Now the brick's own suite
    // measures three, deleting it leaves ZERO, and the `coveredSurfaces` check
    // deliberately does not fire on a zero — a root that measures NOTHING is the
    // corpus floor's subject, not the ratchet's, and reporting it as a ratchet
    // failure would send the fix to the wrong file.
    //
    // The `coveredSurfaces` backstop is NOT left unproven: R-D2 below deletes the
    // width suite of ONE chassis widget the brick delegates to, which is the
    // mutation that lowers `measured` without emptying the corpus, and it asserts
    // the 9-below-10 sentence this case used to carry.
    assert.match(out, /COVERAGE LOST — `tooling\/bricks.*` yielded only 0 width test file\(s\)/s);
    assert.match(out, /and the checked-in floor is 1/s);
  });

  test('R10b · one design_system width case is deleted — the same backstop fires there', () => {
    const root = treeWithNewRoots();
    rmSync(join(root, `${DS}/test/two_pane_test.dart`));
    const { code, out } = run(root);
    assert.equal(code, 2, out);
    assert.match(
      out,
      /COVERAGE LOST — `packages\/design_system` has 10 measured surface\(s\) and its measured floor is 12/s,
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
    assert.equal(code, 2, out);
    assert.match(out, /COVERAGE LOST — `packages\/design_system` has only 18 responsive surface\(s\).*floor is 20/s);
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
    assert.match(out, /\{\{app_id\}\}: 3 of 13 surface\(s\) measured — 3 PRINTED/);
    assert.match(out, /packages\/design_system: 12 of 21 surface\(s\) measured — 9 PRINTED/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// DELEGATION — A WIDTH TEST FOLLOWS ITS SCREEN INTO THE CHASSIS (ADR 067 dec. 2)
//
// [ADR 066] step 4 empties a brick screen into `package:nikatru_chassis_screens`
// and leaves an ADAPTER at the same path. The LayoutBuilder, the ConstrainedBox
// and the max-width go into the package with the body — AND SO DOES THE WIDTH
// TEST, into the package's own suite.
//
// Read without the resolver, that move is indistinguishable from DELETING the
// width test: the brick's covered set drops by one and `coveredSurfaces` falls
// under its floor of 3, which is a COVERAGE LOST finding about a tree where the
// measurement is right there, green, one import away.
//
// THE BRICK IS THE ROOT USED, NOT `apps/subscriptiontracker`, AND THAT IS DELIBERATE. subscriptiontracker
// measures all 19 of its surfaces, so a delegation there changes no number and
// the tests below would pass against a resolver that does nothing at all. The
// brick measures exactly 3 of 12 with a floor at 3 — zero slack — so moving one
// of the three is the smallest change this suite can read, and the floor is
// what reads it.
//
// GREEN CONTROL FIRST, EVERY TIME. R-D1 is the whole point: without it, R-D2's
// red is equally consistent with a resolver that refuses every delegation.
// ─────────────────────────────────────────────────────────────────────────────
const FIXTURES = join(CI_DIR, 'test', 'fixtures', 'chassis-delegation');
const CHASSIS_DIR = 'packages/chassis_screens';
const tpl = (name, subs) => {
  let text = readFileSync(join(FIXTURES, name), 'utf8');
  for (const [k, v] of Object.entries(subs)) text = text.split(k).join(v);
  return text;
};

/** The brick's SettingsScreen moved into the chassis: an adapter at the brick
 *  path, the widget in the package, and the brick's own four `SettingsScreen`
 *  width cases gone — because they went with it.
 *
 *  `chassisWidthTest: false` is the MUTATION: the screen moved and its width
 *  test did not arrive. The brick is then genuinely measuring 2 surfaces
 *  against a floor of 3, and that must fail. */
function treeWithChassis({ chassisWidthTest = true, inWorkspace = true, widgetOnDisk = true } = {}) {
  const root = treeWithNewRoots();
  mkdirSync(join(root, CHASSIS_DIR, 'lib'), { recursive: true });
  mkdirSync(join(root, CHASSIS_DIR, 'test'), { recursive: true });
  writeFileSync(
    join(root, CHASSIS_DIR, 'pubspec.yaml'),
    'name: nikatru_chassis_screens\npublish_to: none\n\ndependencies:\n  flutter:\n    sdk: flutter\n\ndev_dependencies:\n  flutter_test:\n    sdk: flutter\n',
  );
  if (widgetOnDisk) {
    writeFileSync(
      join(root, CHASSIS_DIR, 'lib', 'settings_body.dart'),
      tpl('chassis_widget.dart.tpl', { __CLASS__: 'SettingsBody' }),
    );
  }
  if (chassisWidthTest) {
    writeFileSync(
      join(root, CHASSIS_DIR, 'test', 'width_settings_body_test.dart'),
      [
        "import 'package:flutter/material.dart';",
        "import 'package:flutter_test/flutter_test.dart';",
        "import 'package:nikatru_chassis_screens/settings_body.dart';",
        '',
        'const Size kPhone = Size(375, 812);',
        'const Size kTablet = Size(768, 1024);',
        'const Size kDesktop = Size(1280, 900);',
        '',
        'void main() {',
        "  testWidgets('SettingsBody at every window class', (tester) async {",
        '    for (final size in <Size>[kPhone, kTablet, kDesktop]) {',
        '      await tester.binding.setSurfaceSize(size);',
        '      await tester.pumpWidget(const MaterialApp(home: SettingsBody()));',
        '    }',
        '  });',
        '}',
        '',
      ].join('\n'),
    );
  }

  writeFileSync(
    join(root, BRICK, 'lib/features/settings/settings_screen.dart'),
    tpl('adapter_screen.dart.tpl', {
      __IMPORT__: 'package:nikatru_chassis_screens/settings_body.dart',
      __CLASS__: 'SettingsScreen',
      __BODY__: 'SettingsBody',
    }),
  );

  // The width cases went with the body. `edit()` throws if the anchor is not
  // there, so this mutation cannot silently apply nothing.
  edit(root, `${BRICK}/test/responsive_width_test.dart`, 'const SettingsScreen()', 'const Placeholder()', {
    count: 4,
  });

  // ⚠️ THE WORKSPACE LINE IS ALREADY THERE, SO THE MUTATION IS THE REMOVAL —
  // see the same note in a11y-coverage.test.mjs. Adding a second line derived
  // `packages/chassis_screens` twice once [ADR 071] put it in the real manifest.
  if (!inWorkspace) {
    edit(root, WORKSPACE_MANIFEST, `\n  - ${CHASSIS_DIR}`, '');
  }
  return root;
}

describe('a screen that DELEGATES into the chassis is measured where it now lives', () => {
  // GREEN CONTROL.
  test('R-D1 · the width test moves with the screen and the floor still holds', () => {
    const { code, out } = run(treeWithChassis());
    assert.equal(code, 0, out);
    assert.match(out, /4 derived root\(s\)/);
    assert.match(out, /8 measured where they delegate to/);
  });

  // THE MUTATION — the screen moved and NO width test arrived with it.
  test('R-D2 · the chassis widget has no width test: the brick floor fires', () => {
    const { code, out } = run(treeWithChassis({ chassisWidthTest: false }));
    assert.equal(code, 1, out);
    assert.match(out, /COVERAGE LOST — .*\{\{app_id\}\}` has 9 measured surface\(s\) and its measured floor is 10/);
  });

  // Same mutation seen from the other side: the delegation resolves to nothing.
  test('R-D3 · COVERAGE LOST when the delegation resolves to nothing on disk', () => {
    const { code, out } = run(treeWithChassis({ widgetOnDisk: false }));
    assert.equal(code, 2, out);
    assert.match(out, /COVERAGE LOST — .*settings_screen\.dart` delegates to/);
    assert.match(out, /that file is not on disk/);
  });

  // The refusal that makes the widening safe: followed out of the domain, the
  // width decision would be measured by nothing and the run would still be green.
  test('R-D4 · COVERAGE LOST when the chassis is not a DERIVED ROOT of the scan', () => {
    const { code, out } = run(treeWithChassis({ inWorkspace: false }));
    assert.equal(code, 2, out);
    assert.match(out, /is NOT among the \d+ root\(s\) this scan derived/);
    assert.match(out, /never arrived anywhere this guard looks/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// R14 · THE `packages/chassis_screens` FLOORS, PINNED BY NUMBER
//
// 🔴 THE DEFECT THIS CLOSES, AND IT IS THIS SUITE'S OWN. [ADR 067] phase 2, unit
// app-shell, raised this root's floors at `assert-responsive-coverage.mjs:568-570`
// — `surfaces` 7 → 17, `widthTestFiles` 8 → 13, `coveredSurfaces` 12 → 17 — and
// added NOT ONE case here. The diff to this file was a single pinned report line
// and nothing else, and `coverage-manifest.json` recorded this suite unchanged.
//
// A report pin catches a surface leaving ONLY while the suite runs against the
// REAL checkout; the FLOOR is what fires on a fixture too. That sentence is the
// a11y twin's M11g comment verbatim, and the same repair pass that wrote it
// there stopped one guard short of writing it here. For one review cycle any of
// this root's seventeen surfaces, or any of its thirteen width test files, could
// have left with nothing but a hand-maintained report line to notice.
//
// So these three cases pin the NUMBERS, not the prose. They are the twin of
// `a11y-coverage.test.mjs`'s M11g / M11g-control, and of R10/R10b/R11a/R11b for
// the two report-mode roots — the half this ENFORCED root has never had.
//
// ⚠️ MEASURED, NOT PREDICTED: both mutations exit **1**, not 2. This guard has a
// single `process.exit(1)` (`assert-responsive-coverage.mjs:1529`) and expresses
// COVERAGE LOST as a message prefix rather than a distinct code, exactly as
// R10/R10b/R11a/R11b already record. That is a property of the guard, not of
// this floor raise, and it is written down here rather than asserted away.
// ─────────────────────────────────────────────────────────────────────────────
describe('the chassis_screens floors are floors, not report lines', () => {
  // GREEN CONTROL, FIRST. Without this half, R14a and R14b are equally
  // consistent with a fixture that fails for some unrelated reason — which is
  // exactly how a floor that never held reads as a floor that fires.
  test('R14-control · GREEN CONTROL — the same fixture, unmutated, is 18/18 and passes', () => {
    const { code, out } = run(treeWithNewRoots());
    assert.equal(code, 0, out);
    assert.match(out, /packages\/chassis_screens: 18 surface\(s\) reachable, 18 measured/);
  });

  // ── R14a · A SURFACE LEAVES ────────────────────────────────────────────────
  // It removes ONE surface, not the file — `lib/shell/app_shell.dart` declares
  // five, so deleting it would drop 17→12 and prove nothing about where the
  // boundary actually sits. A leading underscore is how a surface really leaves
  // a package: the class still compiles, it has simply stopped being public.
  test("R14a · one chassis shell widget goes private — that root's surfaces floor fires", () => {
    const root = treeWithNewRoots();
    const rel = `${CHASSIS}/lib/shell/app_shell.dart`;
    const src = readIn(root, rel);
    // ⚠️ LAND-CHECK BEFORE THE MUTATION IS TRUSTED (trap flutter-10): a
    // `String.replace(<string>, …)` takes only the FIRST occurrence, so a
    // second declaration of this name would leave the surface in place and this
    // case would pass for the wrong reason.
    assert.equal(
      (src.match(/class ConsentPromptCard\b/g) ?? []).length,
      1,
      'ConsentPromptCard is no longer declared exactly once in the chassis shell',
    );
    writeIn(root, rel, src.replace('class ConsentPromptCard', 'class _ConsentPromptCard'));

    const { code, out } = run(root);
    assert.equal(code, 2, out);
    // The DOMAIN floor — the one set equality cannot see, because the surface
    // and its measurement left together and the two sets stayed equal.
    assert.match(
      out,
      /COVERAGE LOST — `packages\/chassis_screens` has only 17 responsive surface\(s\).*floor is 18/s,
    );
    // AND the ratchet on what was measured, which fires in the same run. Both
    // numbers moved 7 → 17 in the landing and both are load-bearing.
    assert.match(
      out,
      /COVERAGE LOST — `packages\/chassis_screens` has 17 measured surface\(s\) and its measured floor is 18/s,
    );
  });

  // ── R14b · A WIDTH TEST FILE LEAVES ────────────────────────────────────────
  // `widthTestFiles` is the third floor the landing raised (8 → 13) and the one
  // neither of the other two can stand in for: it is the CORPUS check, and it
  // fires when the scan stops reaching the files rather than when a surface goes.
  //
  // 🔴 RE-POINTED 13 → 17 ON 2026-09-07 ([ADR 067] post-audit, unit
  // chassis-screens-a11y), AND THIS CASE IS WHAT CAUGHT THE SLACK. That unit
  // added four files under `packages/chassis_screens/test` (three a11y suites
  // and their harness), which is the CORPUS this floor counts — so with the
  // floor still at 13, deleting a width suite left 16 and cleared it, and this
  // case failed in CI naming exactly that. The floor was raised in the same
  // change, from the guard's own `corpus: … — 17 file(s)` line, rather than
  // this assertion being loosened: a mutation that stops firing is a floor that
  // has gone slack, never a test that needs relaxing.
  test("R14b · one chassis width test file is deleted — that root's corpus floor fires", () => {
    const root = treeWithNewRoots();
    const rel = `${CHASSIS}/test/check_inbox_view_test.dart`;
    assert.ok(existsSync(join(root, rel)), `the chassis corpus no longer has ${rel}`);
    rmSync(join(root, rel));

    const { code, out } = run(root);
    assert.equal(code, 1, out);
    assert.match(
      out,
      /COVERAGE LOST — `packages\/chassis_screens` yielded only 18 width test file\(s\).*checked-in floor is 19/s,
    );
    // This root ENFORCES, so the surface the deleted file measured is a FAIL and
    // not a print — the half R12 pins for apps/subscriptiontracker, here for the new root.
    //
    // 🔴 THE MESSAGE MOVED FROM `UNCOVERED SURFACE` TO `UNMEASURED WIDTH` ON
    // 2026-09-07, AND THE MOVE IS STRICTER RATHER THAN WEAKER. The a11y suites
    // landed by unit chassis-screens-a11y pump every chassis surface at kPhone
    // and kDesktop — deliberately NOT at kTablet, because they are a11y sweeps
    // and this root's THREE-window requirement belongs to the width suites. So
    // with `check_inbox_view_test.dart` deleted the surface is still SEEN by
    // the corpus, and the guard says the sharper thing: it is measured by
    // `a11y_auth_test.dart` and *not one case pumps kTablet*. Had the a11y
    // suites pumped all three, this deletion would have left the surface
    // reading fully measured and only the corpus floor would have fired — which
    // is the weaker outcome and the reason those suites stay at two windows.
    assert.match(
      out,
      /FAIL UNMEASURED WIDTH — `CheckInboxView`.*not one case pumps kTablet/,
    );
  });
});
