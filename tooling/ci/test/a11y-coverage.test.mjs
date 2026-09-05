// ─────────────────────────────────────────────────────────────────────────────
// a11y-coverage.test.mjs — assert-a11y-coverage.mjs must be able to FAIL, and
// must be able to say YES.
//
// 🔴 EVERY FIXTURE HERE IS A BYTE COPY OF THE REAL TREE, MUTATED. Not a
// hand-written toy router and not a hand-written toy test file, and that is not
// fastidiousness: `assert-seams-wired.mjs` shipped with its caller check
// matching the function's own DECLARATION, and ALL SIX of its hand-written
// fixtures passed against the broken version. Only breaking the actual repo
// exposed it. A fixture you wrote encodes the same misunderstanding as the
// guard you wrote, so the subjects here are `apps/subly/lib/core/router.dart`,
// `apps/subly/lib/features/**`, `apps/subly/test/a11y_semantics_test.dart`,
// the brick template and `packages/design_system` as they are on disk.
//
// ⚠️ AND EVERY MUTATION ASSERTS ITS OWN ANCHOR WAS FOUND. `edit()` throws when
// the text it is asked to replace is not present, so a mutation that has
// drifted out of the tree FAILS LOUDLY instead of quietly testing nothing —
// which is the shape that lets a suite go on passing over a subject that moved.
//
// ⚠️ THE POSITIVE CONTROLS ARE NOT DECORATION EITHER. `baseline`,
// `M10 · a new sweep counts` and `M12 · the new roots are really in the domain`
// are what stop every negative result below being consistent with a guard that
// can only ever say "unswept": without them, deleting the sweep and deleting
// the whole app would be indistinguishable.
//
// ── THE FIXTURE GAINED TWO MANIFESTS ON 2026-09-05, AND THAT IS THE WIDENING ─
// The guard's domain used to be `const APP = 'apps/subly'` — one hardcoded
// string. It is now DERIVED from `tooling/bricks/app/brick.yaml` plus the root
// `pubspec.yaml` `workspace:` list, so a fixture that copies only subly's
// router and suite derives NO ROOT AT ALL and the guard correctly refuses it.
// `tree()` therefore copies the root manifest and subly's own, and NOTHING
// else — which means the fixture derives exactly one root (design_system is on
// the workspace list but is not present, so it does not clear the
// `flutter_test` + public-widget test) and the mutations below go on measuring
// exactly what they measured before.
//
// ⚠️ AND `tree()` IS DELIBERATELY A PARTIAL TREE. The guard applies its "every
// DECLARED root must have been DERIVED" clause only over a full checkout,
// detected by its own file being present under the root — a sentinel outside
// `apps/`, `packages/` and `tooling/bricks/`, so no mutation OF a subject can
// move it. The PER-ROOT FLOORS still apply here, and they must: M7 and M8 are
// floor mutations over a byte copy of one root, and a floor no mutation can
// reach is a floor nothing has ever exercised. `treeWithNewRoots()` copies the
// sentinel in, because M11b/M11c/M11d are about that clause.
//
// ── RE-MEASURED 2026-08-13, WHEN THE SWEEP WENT FROM 5 OF 19 TO 19 OF 19 ─────
// Every number in this file was re-derived by running the guard against the
// working tree, not by editing the old numbers until they matched:
//   19 reachable surfaces (17 routed screens + 2 modal sheets) — unchanged
//   19 swept (was 5) · 0 unswept (was 14) · ~~60~~ a11y cases (was 24)
//   ~~24 of those 60 cases call a sweep; 36 assert one label and do not~~
//
// ── RE-MEASURED AGAIN THE SAME DAY, WHEN THE TAP-TARGET FAMILY LANDED ────────
// [ADR 048] took the suite 60 → 81 and moved `tap-target` from ×0 to ×19, and
// NINE of this file's fourteen tests went red on pinned numbers that had not
// moved with it. 🔴 AND THREE TESTS CHANGED SUBSTANCE, NOT JUST NUMBERS. A
// second sweep family over the same surfaces silently un-tested M1/M2/M2b and
// half of M5. That is the more expensive half of the repair: the numeric
// failures were LOUD (nine red tests), and those were SILENT and would have
// stayed green.
//
// ── WHAT IS A FAILURE AND WHAT IS A PRINT ────────────────────────────────────
// The guard prints unswept surfaces and exits 0, because reddening CI over work
// nobody has started blocks every unrelated change ([pipeline C-6]). It exits 1
// on COVERAGE LOST, on a REGRESSION against SWEPT_FLOOR, and on DEAD COVERAGE.
// So "a surface whose a11y test is deleted moves from covered to printed" is
// asserted on the ACCOUNTING — the surface leaves the ✅ list and appears in the
// ⬜ list — and the accompanying REGRESSION is asserted separately, because
// coverage that WAS there and is gone is exactly the thing that may not be
// quiet.
//
// Run:  node --test "tooling/ci/test/a11y-coverage.test.mjs"
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
const GUARD = join(CI_DIR, 'assert-a11y-coverage.mjs');

const APP = 'apps/subly';
const ROUTER = `${APP}/lib/core/router.dart`;
// 🔴 THE ROUTER IS A SPINE, NOT A FILE (2026-09-04, P1b). `router.dart` is a
// BARREL over `lib/core/router/` — the gate chain, the route table, the shell
// wiring, the navigator key and the `GoRouter` those assemble into — and every
// `GoRoute(`, every `builder:` and every feature import this guard's domain is
// built from lives in that directory. Copying only the barrel gives every
// fixture below a router with NO ROUTES IN IT, which is not a copy of the real
// tree: the reachable set parses empty and the mutations under it assert against
// a subject that is not there. The two files those mutations edit are named
// separately, for the same reason `edit()` throws on a missing anchor — a
// mutation whose target moved must break this suite, not silently apply nothing.
const ROUTER_DIR = `${APP}/lib/core/router`;
const ROUTER_ROUTES = `${ROUTER_DIR}/routes.dart`;
const ROUTER_SHELL = `${ROUTER_DIR}/shell.dart`;
const FEATURES = `${APP}/lib/features`;
const SUITE = `${APP}/test/a11y_semantics_test.dart`;

// 🔴 THE TWO MANIFESTS ARE PART OF THE SUBJECT NOW. Without them the guard
// derives no root and refuses the fixture — see the header.
const WORKSPACE_MANIFEST = 'pubspec.yaml';
const APP_MANIFEST = `${APP}/pubspec.yaml`;

// The things the guard reads for the subly root. Copied whole; copying only
// what is read keeps a fixture from accidentally depending on a part of the
// repo this guard never opens.
const SUBJECT = [WORKSPACE_MANIFEST, APP_MANIFEST, ROUTER, ROUTER_DIR, FEATURES, SUITE];

// The two roots the 2026-09-05 widening added. Copied only by the fixtures that
// measure them, so every mutation above them keeps its one-root reading.
const BRICK = 'tooling/bricks/app/__brick__/apps/{{app_id}}';
const BRICK_MANIFEST = 'tooling/bricks/app/brick.yaml';
const DS = 'packages/design_system';
const NEW_ROOT_SUBJECT = [BRICK, BRICK_MANIFEST, DS];

// MEASURED by running the guard against the working tree of 2026-08-13. Named
// individually rather than counted: a count with no names is the "unmet clause
// that produced no output at all" this repo keeps recording, and it is also
// what would let the insights sweep be deleted and a home sweep added in the
// same change without a word.
const ALL_19_SWEPT = [
  'BudgetScreen',
  'CalendarScreen',
  'CheckInboxScreen',
  'HomeScreen',
  'InsightsScreen',
  'LoginScreen',
  'ManagePlanScreen',
  'NotificationsScreen',
  'OnboardingScreen',
  'PaywallScreen',
  'ReacceptTermsScreen',
  'ResetPasswordScreen',
  'ScanScreen',
  'SettingsScreen',
  'SignUpScreen',
  'SubscriptionDetailScreen',
  'VerifyEmailScreen',
  'showAddSubscriptionSheet',
  'showCancelSheet',
];

let TMP;
let seq = 0;
before(() => {
  TMP = mkdtempSync(join(tmpdir(), 'nikatru-a11y-'));
});
after(() => {
  rmSync(TMP, { recursive: true, force: true });
});

/** A fresh byte copy of the real subject tree. */
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

/** The same, plus the brick and design_system — the roots added 2026-09-05 —
 *  AND the guard's own file, which is the FULL-CHECKOUT SENTINEL.
 *
 *  🔴 THE SENTINEL IS PART OF THE FIXTURE, NOT AN ACCIDENT OF ONE. The guard
 *  applies its "every DECLARED root must have been DERIVED" clause only when
 *  its own file is present under the root it is scanning, because a partial
 *  tree with one root in it is a legitimate thing to scan and this suite builds
 *  several. That sentinel sits OUTSIDE `apps/`, `packages/` and
 *  `tooling/bricks/`, so no mutation of a subject can move it — which is the
 *  whole reason it is the sentinel and a file inside a subject tree is not.
 *  M11b/M11c/M11d each cut ONE root out of the derivation and require the
 *  clause to fire, so their fixture has to be checkout-shaped. Measured:
 *  without this line all three exited 0, which is the guard being right about a
 *  partial tree and the test being wrong about what it had built. */
function treeWithNewRoots() {
  const root = tree(NEW_ROOT_SUBJECT);
  mkdirSync(join(root, 'tooling', 'ci'), { recursive: true });
  cpSync(GUARD, join(root, 'tooling', 'ci', 'assert-a11y-coverage.mjs'));
  return root;
}

const readIn = (root, rel) => readFileSync(join(root, rel), 'utf8');
const writeIn = (root, rel, text) => writeFileSync(join(root, rel), text);

/** Replace `find` with `replace`, and THROW if `find` was not there.
 *
 *  The throw is the point — see the header. A mutation whose anchor has drifted
 *  out of the tree must break this suite, not silently apply zero edits and let
 *  the assertion below pass against an unmutated fixture. */
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

/** The ✅ block — the surfaces the guard says carry a sweep. */
function sweptList(out) {
  return out
    .split('\n')
    .filter((l) => /^ {3}· .+ — .*(naked-controls|tap-target|contrast)/.test(l))
    .map((l) => l.trim().split(' ')[1]);
}

/** The sweep FAMILIES the guard attributes to one surface, from its ✅ line.
 *
 *  Added 2026-08-13. M1/M2/M2b delete ONE sweep call, so they only measure what
 *  their names claim while their subject is swept by exactly ONE family — and
 *  when a second family landed on the old subject nothing said a word. This is
 *  what the precondition test below reads. */
function familiesOf(out, symbol) {
  const prefix = `   · ${symbol} — `;
  const line = out.split('\n').find((l) => l.startsWith(prefix));
  return line === undefined ? null : line.slice(prefix.length).split(' (')[0].split(' + ');
}

/** The ⬜ block — the surfaces the guard prints as owed.
 *
 *  ⚠️ ROOT-SCOPED SINCE 2026-09-05. There is one such block PER ROOT now, and a
 *  scan that stopped at the first would read the brick's twelve and report them
 *  as subly's. `root` defaults to the app because that is what every mutation
 *  below is about. */
function printedUnswept(out, root = APP) {
  const marker = `reachable surface(s) in ${root} carry NO a11y sweep`;
  const start = out.indexOf(marker);
  if (start === -1) return [];
  const rest = out.slice(start).split('\n').slice(1);
  const lines = [];
  for (const l of rest) {
    if (!l.startsWith('   · ')) break;
    lines.push(l.trim().split(' ')[1]);
  }
  return lines;
}

// ── THE MANUFACTURED SURFACE ────────────────────────────────────────────────
// 🔴 WHY A FIXTURE HAS TO INVENT ONE. Two properties of this guard are only
// observable when SOME reachable surface in subly is unswept: that owed work is
// PRINTED, and that a sweep arriving is COUNTED. On 2026-08-13 the tree stopped
// supplying either — 19 of 19 are swept — and the honest move is to
// manufacture the condition, not to drop the tests that measure it.
//
// A MODAL SHEET is used deliberately: a `show…Sheet` under lib/features enters
// the domain FROM DISK, so the fixture adds one file and touches neither the
// router nor SWEPT_FLOOR — no REGRESSION, no FLOOR OVER NOTHING, no other limb
// firing to muddy what is being measured.
const NEW_SHEET_REL = `${FEATURES}/export/export_sheet.dart`;
const NEW_SHEET_SYMBOL = 'showExportSheet';

/** Land a reachable surface that nothing sweeps. Domain 19 → 20. */
function addUnsweptSheet(root) {
  mkdirSync(join(root, `${FEATURES}/export`), { recursive: true });
  writeIn(
    root,
    NEW_SHEET_REL,
    "import 'package:flutter/material.dart';\n" +
      '\n' +
      `Future<void> ${NEW_SHEET_SYMBOL}(BuildContext context) async {}\n`,
  );
}

/** Give that surface a sweep: the import for provenance, and one testWidgets
 *  block that both CONSTRUCTS it and CALLS a sweep. Swept 19 → 20, cases
 *  110 → 111. */
function sweepTheNewSheet(root) {
  edit(
    root,
    SUITE,
    "import 'package:subly/features/detail/subscription_detail_screen.dart';",
    "import 'package:subly/features/detail/subscription_detail_screen.dart';\n" +
      `import 'package:subly/features/export/export_sheet.dart';`,
  );
  edit(
    root,
    SUITE,
    "        sweep('the cancel sheet (step 1)', 1);\n" + '      });\n' + '    });\n' + '  });\n',
    "        sweep('the cancel sheet (step 1)', 1);\n" +
      '      });\n' +
      '    });\n' +
      '  });\n' +
      '\n' +
      "  group('export · the sweep this suite did not have', () {\n" +
      "    testWidgets('nothing on the export sheet is naked', (WidgetTester tester) async {\n" +
      '      await semantically(tester, () async {\n' +
      `        await ${NEW_SHEET_SYMBOL}(tester.element(find.byType(Scaffold)));\n` +
      "        expectNothingNaked(tester, 'export');\n" +
      '      });\n' +
      '    });\n' +
      '  });\n',
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// POSITIVE CONTROLS
// ─────────────────────────────────────────────────────────────────────────────
describe('the guard says YES on the tree as it is', () => {
  test('the REAL repository — 3 derived roots, 50 surfaces, 19 swept, exit 0', () => {
    const { code, out } = run(REPO);
    assert.equal(code, 0, out);
    // 🔴 THE ROOT LINE IS PINNED BECAUSE THE ROOT LINE IS THE FIX. Until
    // 2026-09-05 this guard read one hardcoded app; the number of DERIVED roots
    // going back to one is the regression this whole change exists to prevent,
    // and nothing else in the output would say so — 19 of 19 swept would still
    // print, in a tree with two unchecked roots in it.
    assert.match(out, /3 root\(s\) DERIVED, never listed/);
    assert.match(out, /apps\/subly \(workspace app member\)/);
    assert.match(
      out,
      /packages\/design_system \(workspace package member: declares flutter_test AND a public widget\)/,
    );
    assert.match(out, /\{\{app_id\}\} \(brick template, declared by tooling\/bricks\/app\/brick\.yaml\)/);
    assert.match(out, /FULL CHECKOUT: all 3 declared root\(s\) are required to be among them/);

    assert.match(out, /apps\/subly: 19 of 19 reachable surface\(s\) carry an a11y sweep/);
    assert.match(out, /50 reachable surface\(s\); 19 swept by 1 a11y test file\(s\) across 110 case\(s\)/);
    assert.match(out, /31 unswept and PRINTED/);
    // The per-family tally for subly, pinned. It read `tap-target ×0` from the
    // day this guard was written until 2026-08-13, and a family that has never
    // been non-zero is a limb nothing has exercised — so the number that proves
    // it started is worth holding. `contrast` started the same day: ×0 → ×24.
    assert.match(out, /sweep families used: naked-controls ×24, tap-target ×19, contrast ×24/);
  });

  test('the copied subject tree reproduces the subly reading exactly — and derives ONE root', () => {
    const { code, out } = run(tree());
    assert.equal(code, 0, out);
    assert.match(out, /1 root\(s\) DERIVED, never listed — apps\/subly \(workspace app member\)/);
    assert.match(out, /PARTIAL TREE: the declared-root-must-exist clause is SKIPPED/);
    assert.match(out, /19 reachable surface\(s\); 19 swept by 1 a11y test file\(s\) across 110 case\(s\)/);
    assert.deepEqual(sweptList(out).sort(), ALL_19_SWEPT);
    assert.equal(printedUnswept(out).length, 0);
  });

  // ⚠️ RE-POINTED 2026-08-13, NOT DELETED. This test used to read "the fourteen
  // unswept surfaces PRINT and do not fail the build" and it had fourteen real
  // subjects. It now has none — and the property it measures (owed a11y work is
  // READ ALOUD on a GREEN run rather than reddening CI, the standing [pipeline
  // C-6] rule) did not stop being a property just because the tree caught up.
  test('an unswept surface PRINTS and does not fail the build — a NEW sheet nobody has swept', () => {
    const root = tree();
    addUnsweptSheet(root);
    const { code, out } = run(root);

    // PRINTED, and named — not merely counted.
    assert.ok(
      printedUnswept(out).includes(NEW_SHEET_SYMBOL),
      `${NEW_SHEET_SYMBOL} is not in the printed list:\n${out}`,
    );
    assert.deepEqual(printedUnswept(out), [NEW_SHEET_SYMBOL]);
    assert.match(out, /⬜ 1 of 20 reachable surface\(s\) in apps\/subly carry NO a11y sweep/);
    assert.match(out, /→ add a case to .* that pumps the surface and calls/);

    // AND NOT FAILED. This is the half that would be lost if the test went.
    assert.equal(code, 0, out);
    assert.doesNotMatch(out, /FAIL /);
    assert.match(out, /20 reachable surface\(s\); 19 swept by 1 a11y test file\(s\) across 110 case\(s\)/);
    assert.match(out, /1 unswept and PRINTED/);
  });

  // ⚠️ RE-POINTED for the same reason: its old subject was the MISSING HomeScreen
  // sweep, and home is swept now. Adding a sweep for an already-swept surface
  // would change no number, which is a positive control that cannot fail — the
  // exact defect class this suite exists to catch.
  test('M10 · a NEW sweep is counted — without this, every failure below is vacuous', () => {
    const root = tree();
    addUnsweptSheet(root);

    const before = run(root);
    assert.equal(before.code, 0, before.out);
    assert.ok(
      !sweptList(before.out).includes(NEW_SHEET_SYMBOL),
      `the new sheet was counted as swept before any sweep was written:\n${before.out}`,
    );
    assert.deepEqual(printedUnswept(before.out), [NEW_SHEET_SYMBOL]);

    sweepTheNewSheet(root);

    const { code, out } = run(root);
    assert.equal(code, 0, out);
    assert.ok(
      sweptList(out).includes(NEW_SHEET_SYMBOL),
      `${NEW_SHEET_SYMBOL} was not counted as swept:\n${out}`,
    );
    assert.deepEqual(sweptList(out).sort(), [...ALL_19_SWEPT, NEW_SHEET_SYMBOL].sort());
    assert.equal(printedUnswept(out).length, 0);
    assert.match(out, /20 swept by 1 a11y test file\(s\) across 111 case\(s\)/);
    assert.match(out, /0 unswept and PRINTED/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 🔴 THE WIDENING ITSELF — every test in this block was GREEN against the
// version of the guard this change replaces, WITH THE MUTATION APPLIED. That is
// not a manner of speaking: `tooling/ci/assert-a11y-coverage.mjs` was copied out
// of git at a9b04696, renamed into tooling/ci so its relative imports resolved,
// and run against each mutated tree on 2026-09-05. It exited 0 on all six. The
// domain was one hardcoded string and none of these touched it.
// ─────────────────────────────────────────────────────────────────────────────
describe('the domain is DERIVED, and a root that stops being derived FAILS', () => {
  test('the three roots are all scanned, and each one is NAMED in the report', () => {
    const { code, out } = run(treeWithNewRoots());
    assert.equal(code, 0, out);
    assert.match(out, /3 root\(s\) DERIVED/);
    assert.match(out, /FULL CHECKOUT: all 3 declared root\(s\) are required to be among them/);
    // Each root gets its own accounting line. A root that is derived but whose
    // surfaces never reach the report is a root this guard cannot see.
    assert.match(out, /apps\/subly: 19 of 19 reachable surface\(s\) carry an a11y sweep/);
    assert.match(out, /\{\{app_id\}\}: 0 of 12 reachable surface\(s\) carry an a11y sweep/);
    assert.match(out, /packages\/design_system: 0 of 19 reachable surface\(s\) carry an a11y sweep/);
    // And the gap in each is PRINTED, by name, not merely counted.
    assert.ok(printedUnswept(out, BRICK).includes('HomeScreen'), out);
    assert.ok(printedUnswept(out, DS).includes('NavShell'), out);
    assert.ok(printedUnswept(out, DS).includes('DestructiveConfirmDialog'), out);
    assert.ok(printedUnswept(out, DS).includes('TwoPane'), out);
  });

  test('M11a · the brick DECLARES itself and its app directory is gone — COVERAGE LOST', () => {
    const root = treeWithNewRoots();
    renameSync(join(root, BRICK), join(root, 'tooling/bricks/app/__brick__/apps/renamed_away'));
    const { code, out } = run(root);
    assert.equal(code, 1, out);
    assert.match(out, /COVERAGE LOST — tooling\/bricks\/app\/brick\.yaml exists, so this tree DECLARES a brick/);
  });

  test('M11b · a package root cut from the workspace list — COVERAGE LOST', () => {
    const root = treeWithNewRoots();
    edit(root, WORKSPACE_MANIFEST, '\n  - packages/design_system', '');
    const { code, out } = run(root);
    assert.equal(code, 1, out);
    assert.match(out, /DECLARED root\(s\) were not among the 2 this run derived/);
    assert.match(out, /`packages\/design_system`/);
    // 🔴 THE REASON THIS LIMB EXISTS, ASSERTED. Nothing else can see it: the
    // scan still read the other roots in full, so every count printed healthy.
    assert.match(out, /every count above would print healthy/);
  });

  test('M11c · a package root that stops declaring flutter_test — COVERAGE LOST', () => {
    const root = treeWithNewRoots();
    edit(root, `${DS}/pubspec.yaml`, '\n  flutter_test:', '');
    const { code, out } = run(root);
    assert.equal(code, 1, out);
    assert.match(out, /DECLARED root\(s\) were not among the 2 this run derived/);
    assert.match(out, /`packages\/design_system`/);
  });

  test('M11d · the APP cut from the workspace list — COVERAGE LOST', () => {
    const root = treeWithNewRoots();
    edit(root, WORKSPACE_MANIFEST, '\n  - apps/subly', '');
    const { code, out } = run(root);
    assert.equal(code, 1, out);
    assert.match(out, /DECLARED root\(s\) were not among the 2 this run derived/);
    assert.match(out, /`apps\/subly`/);
  });

  test('M11e · one brick route leaves — the brick surfaces floor fires, and ALONE', () => {
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
    assert.match(
      out,
      /COVERAGE LOST — `tooling\/bricks\/app\/__brick__\/apps\/\{\{app_id\}\}` has only 11 reachable surface\(s\).*floor is 12/s,
    );
    // 🔴 AND ALONE, WHICH IS THE PROPERTY M7 LOST. Since SWEPT_FLOOR covers the
    // whole of subly, removing a subly route also strands a floor entry and a
    // sweep — three findings, so the surfaces floor is not demonstrable there in
    // isolation. The brick's SWEPT_FLOOR is empty, so here it is: exactly one.
    assert.equal(
      out.split('\n').filter((l) => l.startsWith('FAIL ')).length,
      1,
      `the surfaces floor did not fire alone:\n${out}`,
    );
  });

  test("M11f · one design_system widget file leaves — that root's surfaces floor fires", () => {
    const root = treeWithNewRoots();
    rmSync(join(root, `${DS}/lib/src/widgets/two_pane.dart`));
    const { code, out } = run(root);
    assert.equal(code, 1, out);
    assert.match(out, /COVERAGE LOST — `packages\/design_system` has only 17 reachable surface\(s\).*floor is 19/s);
  });

  test("M12 · a NEW surface in EACH new root reaches that root's printed list", () => {
    const root = treeWithNewRoots();
    // The brick: a modal sheet, which enters the domain FROM DISK and so touches
    // neither the router nor any floor.
    mkdirSync(join(root, `${BRICK}/lib/features/export`), { recursive: true });
    writeIn(
      root,
      `${BRICK}/lib/features/export/g3_probe_sheet.dart`,
      "import 'package:flutter/material.dart';\n\nFuture<void> showG3ProbeSheet(BuildContext context) async {}\n",
    );
    // design_system: a public widget, which is that root's whole vocabulary.
    writeIn(
      root,
      `${DS}/lib/src/widgets/g3_probe.dart`,
      "import 'package:flutter/material.dart';\n\nclass G3ProbeWidget extends StatelessWidget {\n" +
        '  const G3ProbeWidget({super.key});\n' +
        '  @override\n' +
        '  Widget build(BuildContext context) => const SizedBox();\n}\n',
    );
    const { code, out } = run(root);
    // PRINTED, not failed — the [pipeline C-6] rule, in the new roots too.
    assert.equal(code, 0, out);
    assert.ok(printedUnswept(out, BRICK).includes('showG3ProbeSheet'), out);
    assert.ok(printedUnswept(out, DS).includes('G3ProbeWidget'), out);
    assert.match(out, /13 of 13 reachable surface\(s\) in tooling\/bricks/);
    assert.match(out, /20 of 20 reachable surface\(s\) in packages\/design_system/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// A SWEEP THAT LEAVES — covered ⇒ printed, and it is NOT quiet
// ─────────────────────────────────────────────────────────────────────────────
// 🔴 RE-POINTED FROM INSIGHTS TO CHECK-INBOX, 2026-08-13, AND THE OLD SUBJECT
// HAD STOPPED TESTING ANYTHING — SILENTLY. These three delete ONE sweep call
// and require the surface to leave the ✅ list. `InsightsScreen` is swept by TWO
// families now, so deleting `expectNothingNaked(tester, 'insights')` leaves it
// swept — and the guard is CORRECT to keep reporting it.
//
// ⚠️ AND THE REPAIR HAS A FAILURE MODE, WHICH IS THE ONE THAT HAPPENED: the
// subject's single-family status is a fact about today's tree, and nothing
// noticed when it changed. So it is no longer left to be noticed. The
// PRECONDITION test below asserts it.
describe('a surface whose a11y sweep is deleted moves from covered to printed', () => {
  // The subject, named once. Swept by exactly ONE family — see the precondition.
  const SUBJECT_SCREEN = 'CheckInboxScreen';
  const DELETED = "        expectNothingNaked(tester, 'check-inbox');\n";

  test('PRECONDITION · the subject is swept by exactly ONE family', () => {
    const { code, out } = run(tree());
    assert.equal(code, 0, out);
    assert.deepEqual(
      familiesOf(out, SUBJECT_SCREEN),
      ['naked-controls'],
      `${SUBJECT_SCREEN} is no longer swept by exactly one family, so deleting its ONE sweep call no longer ` +
        'unsweeps it and M1/M2/M2b below are vacuous — they would pass while measuring nothing. This is ' +
        'not hypothetical: it is exactly what a second family did to the previous subject (InsightsScreen) ' +
        'on 2026-08-13, in silence. Either re-point M1/M2/M2b at a single-family surface, or make each of ' +
        `them delete EVERY sweep of ${SUBJECT_SCREEN}.\n${out}`,
    );
  });

  test('M1 · the sweep call is deleted', () => {
    const root = tree();
    edit(root, SUITE, DELETED, '');
    const { code, out } = run(root);

    // THE ACCOUNTING MOVED — this is the requirement.
    assert.ok(!sweptList(out).includes(SUBJECT_SCREEN), `still reported swept:\n${out}`);
    assert.ok(printedUnswept(out).includes(SUBJECT_SCREEN), `not printed as owed:\n${out}`);
    assert.deepEqual(printedUnswept(out), [SUBJECT_SCREEN]);

    // AND IT IS NOT QUIET. Coverage that WAS there and is gone is a regression,
    // not an unstarted task, and SWEPT_FLOOR is what tells the two apart.
    assert.equal(code, 1, out);
    assert.match(out, new RegExp(`FAIL REGRESSION — \`${SUBJECT_SCREEN}\``));

    // The remaining eighteen are untouched: one loss is reported as one loss.
    assert.deepEqual(
      sweptList(out).sort(),
      ALL_19_SWEPT.filter((s) => s !== SUBJECT_SCREEN),
    );
  });

  test('M2 · the sweep call is replaced by PROSE that names it', () => {
    const root = tree();
    edit(
      root,
      SUITE,
      DELETED,
      "        expect(1, 1, reason: 'expectNothingNaked(tester) used to run here');\n",
    );
    const { code, out } = run(root);
    assert.equal(code, 1, out);
    assert.ok(!sweptList(out).includes(SUBJECT_SCREEN), `prose was counted as a sweep:\n${out}`);
    assert.ok(printedUnswept(out).includes(SUBJECT_SCREEN), out);
    assert.match(out, new RegExp(`FAIL REGRESSION — \`${SUBJECT_SCREEN}\``));
  });

  // 🔴 M2 AND M2b DIFFER ON PURPOSE, AND THE DIFFERENCE WAS MEASURED. Both
  // leave the CONSTRUCTION in place, so the only thing that changed is whether
  // the sweep call survives as executable code — which is exactly the axis
  // under test. M2 hides it in a STRING (the literal-stripping limb); M2b hides
  // it in a COMMENT (the comment-stripping limb). An earlier draft of M2b also
  // deleted the construction, and it therefore passed for the WRONG REASON.
  test('M2b · the sweep call is commented out, and the comment still names it', () => {
    const root = tree();
    edit(
      root,
      SUITE,
      DELETED,
      `        // expectNothingNaked(tester) — ${SUBJECT_SCREEN} is swept elsewhere.\n`,
    );
    const { code, out } = run(root);
    assert.equal(code, 1, out);
    assert.ok(
      !sweptList(out).includes(SUBJECT_SCREEN),
      `a commented-out call was counted as coverage:\n${out}`,
    );
    assert.ok(printedUnswept(out).includes(SUBJECT_SCREEN), out);
    assert.match(out, new RegExp(`FAIL REGRESSION — \`${SUBJECT_SCREEN}\``));
    // It is still NAMED — by the two label cases in its own group AND by the
    // pinned `hands the tap-target guideline NOTHING` case, all three of which
    // construct it without sweeping it — and the guard says so rather than
    // implying the screen is untouched by the suite.
    assert.match(out, new RegExp(`${SUBJECT_SCREEN} .*NAMES it but never sweeps it`));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// COVERAGE LOST — the scan reached nothing, and said so
// ─────────────────────────────────────────────────────────────────────────────
describe('an empty scan is COVERAGE LOST, never a pass', () => {
  test('M3 · an EMPTY surface list — no routes and no sheets', () => {
    const root = tree();
    // THE BARREL AND THE SPINE. Stubbing only the barrel leaves `router/*.dart`
    // in the fixture, and the guard reads the spine — so every route would still
    // be there and this mutation would assert nothing.
    writeIn(root, ROUTER, 'const int routerStub = 0;\n');
    for (const f of readdirSync(join(root, ROUTER_DIR))) {
      if (f.endsWith('.dart')) {
        writeIn(root, `${ROUTER_DIR}/${f}`, 'const int routerStub = 0;\n');
      }
    }
    for (const sheet of ['add/add_subscription_sheet.dart', 'cancel/cancel_sheet.dart']) {
      writeIn(root, `${FEATURES}/${sheet}`, 'const int stub = 0;\n');
    }
    const { code, out } = run(root);
    assert.equal(code, 1, out);
    assert.match(out, /COVERAGE LOST — the REACHABLE set of `apps\/subly` parsed EMPTY/);
  });

  // 🔴 THIS LIMB CHANGED SHAPE ON 2026-09-05 AND KEPT ITS STRENGTH. It used to
  // be "no a11y file at all ⇒ COVERAGE LOST", which is right for one root and
  // wrong the moment a root that has never had one joins the domain — the brick
  // and design_system would have reddened CI on arrival. It is now a per-root
  // FLOOR, and subly's floor is 1, so renaming its suite out of the corpus
  // still fires exactly as before.
  test('M4 · the a11y corpus is renamed out of the scan — the per-root floor of 1 fires', () => {
    const root = tree();
    renameSync(join(root, SUITE), join(root, `${APP}/test/semantics_of_a11y_test.dart`));
    const { code, out } = run(root);
    assert.equal(code, 1, out);
    assert.match(out, /COVERAGE LOST — `apps\/subly` yielded 0 file\(s\) matching `a11y_\*_test\.dart`.*floor is 1/s);
  });

  // 🔴 `meetsGuideline` ADDED TO THE RENAME 2026-08-13, AND WITHOUT IT THIS
  // TEST HAD STOPPED REACHING ITS OWN LIMB. Renaming only the two naked
  // helpers left `tap-target ×19` running and SEVENTEEN surfaces still swept.
  // 📌 A mutation named "not one sweep" must neuter EVERY family the guard
  // recognises, and it inherits a new one each time SWEEP_FAMILIES grows.
  test('M5 · every sweep helper is renamed — 110 cases, not one sweep', () => {
    const root = tree();
    const src = readIn(root, SUITE)
      .replaceAll('expectNothingNaked', 'expectNothingBare')
      .replaceAll('nakedControls', 'bareControls')
      .replaceAll('meetsGuideline', 'satisfiesGuideline');
    assert.ok(
      !src.includes('expectNothingNaked') &&
        !src.includes('nakedControls') &&
        !/\bmeetsGuideline\b/.test(src),
      'a sweep helper survived the rename, so this mutation would leave a family running',
    );
    writeIn(root, SUITE, src);
    const { code, out } = run(root);
    assert.equal(code, 1, out);
    assert.match(out, /COVERAGE LOST — 110 a11y case\(s\) were parsed .* and NOT ONE of them calls a sweep/s);
    // Proof the mutation reached the limb it names rather than a neighbouring
    // one: with NO family running, nothing is attributed at all.
    assert.equal(sweptList(out).length, 0);
    assert.match(out, /sweep families used: naked-controls ×0, tap-target ×0, contrast ×0/);
  });

  // ⚠️ RENAMED 2026-08-13, AND THE OLD NAME WAS THE LIE. It read "the surfaces
  // floor is the only thing that sees it", which was TRUE while SWEPT_FLOOR
  // held five of nineteen. It holds all nineteen now, so removing ANY subly
  // route also strands a floor entry and strands its sweep: three findings.
  // ✅ The floor's INDEPENDENCE is demonstrable again as of 2026-09-05, on
  // another root — see M11e, where the brick's empty SWEPT_FLOOR lets exactly
  // one finding fire.
  test('M7 · a route leaves the app — the surfaces floor fires by number, SWEPT_FLOOR by name', () => {
    const root = tree();
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
    const { code, out } = run(root);
    assert.equal(code, 1, out);
    assert.match(out, /COVERAGE LOST — `apps\/subly` has only 18 reachable surface\(s\).*floor is 19/s);
    // The two limbs that now co-fire, asserted rather than assumed.
    assert.match(out, /FAIL DEAD COVERAGE — .* sweeps `NotificationsScreen`/);
    assert.match(out, /FAIL FLOOR OVER NOTHING — .*notifications_screen\.dart#NotificationsScreen`/);
    // Proof the domain really shrank rather than the report merely changing
    // wording: the guard's ✅ list still holds 19 keys while only 18 are
    // reachable, which is the mismatch DEAD COVERAGE is reading.
    assert.equal(sweptList(out).length, 19);
    assert.equal(printedUnswept(out).length, 0);
  });

  // ⚠️ THE `cases` FLOOR WENT BLIND THREE TIMES IN ONE DAY and this test is the
  // only limb that catches it: it pins the FLOOR's own number in its regex, not
  // just the measured count, so somebody else's missed re-measurement is a red
  // test rather than a quieter guard.
  test('M8 · four cases are deleted while every sweep survives', () => {
    const root = tree();
    for (const title of [
      "testWidgets('GlyphTile with no label is DECORATIVE",
      "testWidgets('GlyphTile with a label announces the label",
      "testWidgets('a tappable RowCard is a BUTTON",
      "testWidgets('an INERT RowCard is not announced as a button",
    ]) {
      edit(root, SUITE, title, `x${title}`);
    }
    const { code, out } = run(root);
    assert.equal(code, 1, out);
    assert.match(out, /COVERAGE LOST — only 106 a11y case\(s\) .* the checked-in floor is 110/s);
    // Every set above is byte-identical — which is the point of the floor, and
    // it is also what catches a mutation that disabled the WRONG block.
    assert.deepEqual(sweptList(out).sort(), ALL_19_SWEPT);
    assert.doesNotMatch(out, /REGRESSION/);
    assert.doesNotMatch(out, /DEAD COVERAGE/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// THE OTHER DIRECTION, AND THE EXCLUSIONS' OWN SELF-CHECK
// ─────────────────────────────────────────────────────────────────────────────
describe('a sweep must point at something a user can reach', () => {
  test('M6 · DEAD COVERAGE — the unrouted twin defect, verbatim', () => {
    const root = tree();
    // The STAMPED twin: a second class called OnboardingScreen, in a file no
    // route imports. This is the shape `responsive_width_test.dart` shipped.
    mkdirSync(join(root, `${FEATURES}/firstrun`), { recursive: true });
    writeIn(
      root,
      `${FEATURES}/firstrun/onboarding_screen.dart`,
      'class OnboardingScreen extends StatelessWidget {\n' +
        '  const OnboardingScreen({super.key});\n' +
        '}\n',
    );
    // 🔴 THE IMPORT SWAP IS THE WHOLE MUTATION, AND IT MUST BE A SWAP. Re-point
    // the suite's `OnboardingScreen` import at the twin and the onboarding sweep
    // the suite ALREADY HAS starts attributing to a file no route imports —
    // which is DEAD COVERAGE, by name. REPLACE the routed import; do NOT add
    // alongside it, or AMBIGUOUS SUBJECT fires first and section (D) can no
    // longer compute DEAD COVERAGE at all.
    edit(
      root,
      SUITE,
      "import 'package:subly/features/onboarding/onboarding_screen.dart';",
      "import 'package:subly/features/firstrun/onboarding_screen.dart';",
    );
    const { code, out } = run(root);
    assert.equal(code, 1, out);
    assert.match(out, /FAIL DEAD COVERAGE — .* sweeps `OnboardingScreen` from `.*firstrun\/onboarding_screen\.dart`/);
  });

  test('M9 · a NOT_A_PANE entry no route builds is judgement over nothing', () => {
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
