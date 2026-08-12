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
// guard you wrote, so the subject here is `apps/subly/lib/core/router.dart`,
// `apps/subly/lib/features/**` and `apps/subly/test/a11y_semantics_test.dart`
// as they are on disk.
//
// ⚠️ AND EVERY MUTATION ASSERTS ITS OWN ANCHOR WAS FOUND. `edit()` throws when
// the text it is asked to replace is not present, so a mutation that has
// drifted out of the tree FAILS LOUDLY instead of quietly testing nothing —
// which is the shape that lets a suite go on passing over a subject that moved.
//
// ⚠️ THE POSITIVE CONTROLS ARE NOT DECORATION EITHER. `baseline` and
// `M10 · a new sweep counts` are what stop every negative result below being
// consistent with a guard that can only ever say "unswept": without them,
// deleting the sweep and deleting the whole app would be indistinguishable.
//
// ── WHAT IS A FAILURE AND WHAT IS A PRINT ────────────────────────────────────
// The guard prints the fourteen unswept surfaces and exits 0, because reddening
// CI over work nobody has started blocks every unrelated change ([pipeline
// C-6]). It exits 1 on COVERAGE LOST, on a REGRESSION against SWEPT_FLOOR, and
// on DEAD COVERAGE. So "a surface whose a11y test is deleted moves from covered
// to printed" is asserted on the ACCOUNTING — the surface leaves the ✅ list and
// appears in the ⬜ list — and the accompanying REGRESSION is asserted
// separately, because coverage that WAS there and is gone is exactly the thing
// that may not be quiet.
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
const FEATURES = `${APP}/lib/features`;
const SUITE = `${APP}/test/a11y_semantics_test.dart`;

// The three things the guard reads. Copied whole; nothing else is needed, and
// copying only what is read keeps a fixture from accidentally depending on a
// part of the repo this guard never opens.
const SUBJECT = [ROUTER, FEATURES, SUITE];

let TMP;
let seq = 0;
before(() => {
  TMP = mkdtempSync(join(tmpdir(), 'nikatru-a11y-'));
});
after(() => {
  rmSync(TMP, { recursive: true, force: true });
});

/** A fresh byte copy of the real subject tree. */
function tree() {
  const root = join(TMP, `r${seq++}`);
  for (const rel of SUBJECT) {
    const src = join(REPO, rel);
    assert.ok(existsSync(src), `the real tree no longer has ${rel} — this suite's subject moved`);
    const dest = join(root, rel);
    mkdirSync(dirname(dest), { recursive: true });
    cpSync(src, dest, { recursive: true });
  }
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

/** The ⬜ block — the surfaces the guard prints as owed. */
function printedUnswept(out) {
  const start = out.indexOf('carry NO a11y sweep');
  if (start === -1) return [];
  const rest = out.slice(start).split('\n').slice(1);
  const lines = [];
  for (const l of rest) {
    if (!l.startsWith('   · ')) break;
    lines.push(l.trim().split(' ')[1]);
  }
  return lines;
}

// ─────────────────────────────────────────────────────────────────────────────
// POSITIVE CONTROLS
// ─────────────────────────────────────────────────────────────────────────────
describe('the guard says YES on the tree as it is', () => {
  test('the REAL repository — 19 reachable, 5 swept, 14 printed, exit 0', () => {
    const { code, out } = run(REPO);
    assert.equal(code, 0, out);
    assert.match(out, /19 reachable surface\(s\) \(17 routed screens, 2 modal sheets\)/);
    assert.match(out, /5 swept by 1 a11y test file\(s\) across 24 case\(s\)/);
    assert.match(out, /14 unswept and PRINTED/);
  });

  test('the copied subject tree reproduces the real reading exactly', () => {
    const { code, out } = run(tree());
    assert.equal(code, 0, out);
    assert.match(out, /19 reachable surface\(s\)/);
    assert.match(out, /5 swept by 1 a11y test file\(s\) across 24 case\(s\)/);
    assert.deepEqual(sweptList(out).sort(), [
      'BudgetScreen',
      'CalendarScreen',
      'InsightsScreen',
      'ScanScreen',
      'SubscriptionDetailScreen',
    ]);
    assert.equal(printedUnswept(out).length, 14);
  });

  test('the fourteen unswept surfaces PRINT and do not fail the build', () => {
    const { code, out } = run(tree());
    assert.equal(code, 0, out);
    // Named individually, not merely counted: a count with no names is the
    // "unmet clause that produced no output at all" this repo keeps recording.
    for (const symbol of [
      'HomeScreen',
      'LoginScreen',
      'SignUpScreen',
      'OnboardingScreen',
      'SettingsScreen',
      'PaywallScreen',
      'showAddSubscriptionSheet',
      'showCancelSheet',
    ]) {
      assert.ok(printedUnswept(out).includes(symbol), `${symbol} is not in the printed list:\n${out}`);
    }
    assert.doesNotMatch(out, /FAIL /);
  });

  test('M10 · a NEW sweep is counted — without this, every failure below is vacuous', () => {
    const root = tree();
    edit(
      root,
      SUITE,
      "import 'package:subly/features/insights/insights_screen.dart';",
      "import 'package:subly/features/home/home_screen.dart';\n" +
        "import 'package:subly/features/insights/insights_screen.dart';",
    );
    edit(
      root,
      SUITE,
      "        expectNothingNaked(tester, 'the shell (landed on /home)', floor: 7);\n" +
        '      });\n' +
        '    });\n' +
        '  });\n' +
        '}',
      "        expectNothingNaked(tester, 'the shell (landed on /home)', floor: 7);\n" +
        '      });\n' +
        '    });\n' +
        '  });\n' +
        '\n' +
        "  group('home · the sweep this suite did not have', () {\n" +
        "    testWidgets('nothing on home is naked', (WidgetTester tester) async {\n" +
        '      await semantically(tester, () async {\n' +
        '        await pumpScreen(tester, const HomeScreen());\n' +
        "        expectNothingNaked(tester, 'home');\n" +
        '      });\n' +
        '    });\n' +
        '  });\n' +
        '}',
    );
    const { code, out } = run(root);
    assert.equal(code, 0, out);
    assert.ok(sweptList(out).includes('HomeScreen'), `HomeScreen was not counted as swept:\n${out}`);
    assert.equal(printedUnswept(out).length, 13);
    assert.match(out, /6 swept by 1 a11y test file\(s\) across 25 case\(s\)/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// A SWEEP THAT LEAVES — covered ⇒ printed, and it is NOT quiet
// ─────────────────────────────────────────────────────────────────────────────
describe('a surface whose a11y sweep is deleted moves from covered to printed', () => {
  const DELETED = "        expectNothingNaked(tester, 'insights');\n";

  test('M1 · the sweep call is deleted', () => {
    const root = tree();
    edit(root, SUITE, DELETED, '');
    const { code, out } = run(root);

    // THE ACCOUNTING MOVED — this is the requirement.
    assert.ok(!sweptList(out).includes('InsightsScreen'), `still reported swept:\n${out}`);
    assert.ok(printedUnswept(out).includes('InsightsScreen'), `not printed as owed:\n${out}`);
    assert.equal(printedUnswept(out).length, 15);

    // AND IT IS NOT QUIET. Coverage that WAS there and is gone is a regression,
    // not an unstarted task, and SWEPT_FLOOR is what tells the two apart.
    assert.equal(code, 1, out);
    assert.match(out, /FAIL REGRESSION — `InsightsScreen`/);

    // The remaining four are untouched: one loss is reported as one loss.
    assert.deepEqual(sweptList(out).sort(), [
      'BudgetScreen',
      'CalendarScreen',
      'ScanScreen',
      'SubscriptionDetailScreen',
    ]);
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
    assert.ok(!sweptList(out).includes('InsightsScreen'), `prose was counted as a sweep:\n${out}`);
    assert.ok(printedUnswept(out).includes('InsightsScreen'), out);
    assert.match(out, /FAIL REGRESSION — `InsightsScreen`/);
  });

  // 🔴 M2 AND M2b DIFFER ON PURPOSE, AND THE DIFFERENCE WAS MEASURED. Both
  // leave the CONSTRUCTION in place, so the only thing that changed is whether
  // the sweep call survives as executable code — which is exactly the axis
  // under test. M2 hides it in a STRING (the literal-stripping limb); M2b hides
  // it in a COMMENT (the comment-stripping limb). An earlier draft of M2b also
  // deleted the construction, and it therefore passed for the WRONG REASON:
  // with the guard meta-mutated to skip stripStringLiterals it still went
  // green, because an unconstructed surface is unattributable however the
  // sweep is spelled. A test that passes for a reason other than the one it
  // names is not testing that reason.
  test('M2b · the sweep call is commented out, and the comment still names it', () => {
    const root = tree();
    edit(
      root,
      SUITE,
      DELETED,
      '        // expectNothingNaked(tester) — InsightsScreen is swept elsewhere.\n',
    );
    const { code, out } = run(root);
    assert.equal(code, 1, out);
    assert.ok(
      !sweptList(out).includes('InsightsScreen'),
      `a commented-out call was counted as coverage:\n${out}`,
    );
    assert.ok(printedUnswept(out).includes('InsightsScreen'), out);
    assert.match(out, /FAIL REGRESSION — `InsightsScreen`/);
    // It is still NAMED by the two locale cases, and the guard says so rather
    // than implying the screen is untouched by the suite.
    assert.match(out, /InsightsScreen .*NAMES it but never sweeps it/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// COVERAGE LOST — the scan reached nothing, and said so
// ─────────────────────────────────────────────────────────────────────────────
describe('an empty scan is COVERAGE LOST, never a pass', () => {
  test('M3 · an EMPTY surface list — no routes and no sheets', () => {
    const root = tree();
    writeIn(root, ROUTER, 'const int routerStub = 0;\n');
    for (const sheet of ['add/add_subscription_sheet.dart', 'cancel/cancel_sheet.dart']) {
      writeIn(root, `${FEATURES}/${sheet}`, 'const int stub = 0;\n');
    }
    const { code, out } = run(root);
    assert.equal(code, 1, out);
    assert.match(out, /COVERAGE LOST — the REACHABLE set parsed EMPTY/);
  });

  test('M4 · the a11y corpus is renamed out of the scan', () => {
    const root = tree();
    renameSync(join(root, SUITE), join(root, `${APP}/test/semantics_of_a11y_test.dart`));
    const { code, out } = run(root);
    assert.equal(code, 1, out);
    assert.match(out, /COVERAGE LOST — no file under .* matched `a11y_\*_test\.dart`/);
  });

  test('M5 · both sweep helpers are renamed — 24 cases, not one sweep', () => {
    const root = tree();
    const src = readIn(root, SUITE)
      .replaceAll('expectNothingNaked', 'expectNothingBare')
      .replaceAll('nakedControls', 'bareControls');
    assert.ok(!src.includes('expectNothingNaked') && !src.includes('nakedControls'));
    writeIn(root, SUITE, src);
    const { code, out } = run(root);
    assert.equal(code, 1, out);
    assert.match(out, /COVERAGE LOST — 24 a11y case\(s\) were parsed .* and NOT ONE of them calls a sweep/s);
  });

  test('M7 · a route leaves the app — the surfaces floor is the only thing that sees it', () => {
    const root = tree();
    edit(
      root,
      ROUTER,
      '      GoRoute(\n' +
        "        path: '/notifications',\n" +
        '        parentNavigatorKey: rootNavigatorKey,\n' +
        '        builder: (_, __) => const NotificationsScreen(),\n' +
        '      ),\n',
      '',
    );
    const { code, out } = run(root);
    assert.equal(code, 1, out);
    assert.match(out, /COVERAGE LOST — only 18 reachable surface\(s\) .* the checked-in floor is 19/s);
    // Proof the floor is doing the work and not some other limb: the printed
    // list got SHORTER, which on its own reads exactly like progress.
    assert.equal(printedUnswept(out).length, 13);
  });

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
    assert.match(out, /COVERAGE LOST — only 20 a11y case\(s\) .* the checked-in floor is 24/s);
    // Every set above is byte-identical — which is the point of the floor.
    assert.deepEqual(sweptList(out).sort(), [
      'BudgetScreen',
      'CalendarScreen',
      'InsightsScreen',
      'ScanScreen',
      'SubscriptionDetailScreen',
    ]);
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
    edit(
      root,
      SUITE,
      "import 'package:subly/features/insights/insights_screen.dart';",
      "import 'package:subly/features/firstrun/onboarding_screen.dart';\n" +
        "import 'package:subly/features/insights/insights_screen.dart';",
    );
    edit(
      root,
      SUITE,
      "        expectNothingNaked(tester, 'insights');\n",
      "        expectNothingNaked(tester, 'insights');\n" +
        '        await pumpScreen(tester, const OnboardingScreen());\n' +
        "        expectNothingNaked(tester, 'the twin');\n",
    );
    const { code, out } = run(root);
    assert.equal(code, 1, out);
    assert.match(out, /FAIL DEAD COVERAGE — .* sweeps `OnboardingScreen` from `.*firstrun\/onboarding_screen\.dart`/);
  });

  test('M9 · a NOT_A_PANE entry no route builds is judgement over nothing', () => {
    const root = tree();
    edit(root, ROUTER, 'AppShell(navigationShell: navShell)', 'AppShellChrome(navigationShell: navShell)');
    const { code, out } = run(root);
    assert.equal(code, 1, out);
    assert.match(out, /FAIL `AppShell` is excluded in NOT_A_PANE but no route in .* builds it/);
  });
});
