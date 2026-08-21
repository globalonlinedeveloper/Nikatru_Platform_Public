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
// moved with it. Re-derived the same way — by running the guard, then counting
// the blocks with the guard's own parse:
//   19 reachable surfaces (17 routed screens + 2 modal sheets) — still unchanged
//   19 swept · 0 unswept · 81 a11y cases
//   43 of the 81 call a sweep (naked-controls ×24 + tap-target ×19, and NO case
//      is in two families); 38 assert one label and do not
// 🔴 AND THREE TESTS CHANGED SUBSTANCE, NOT JUST NUMBERS. A second sweep family
// over the same surfaces silently un-tested M1/M2/M2b and half of M5 — see the
// notes on each. That is the more expensive half of this repair: the numeric
// failures were LOUD (nine red tests), and these four were SILENT and would
// have stayed green.
// Two tests changed SUBJECT rather than numbers, because their subject became
// empty, and an assertion that cannot fail inflates coverage instead of
// providing it. Both are re-pointed and renamed below, never deleted:
//   · "an unswept surface PRINTS …" — there are no unswept surfaces left, so
//     the fixture MANUFACTURES one (a new sheet on disk that no case sweeps).
//     The property — owed work prints and does NOT redden CI — is real and has
//     to survive the tree catching up with it.
//   · "M10 · a NEW sweep is counted" — it used to add the missing HomeScreen
//     sweep; home is swept now, so it adds the sweep for that manufactured
//     sheet instead and watches the surface move ⬜ → ✅ across two runs.
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

// ── THE MANUFACTURED SURFACE ────────────────────────────────────────────────
// 🔴 WHY A FIXTURE HAS TO INVENT ONE NOW. Two properties of this guard are only
// observable when SOME reachable surface is unswept: that owed work is PRINTED,
// and that a sweep arriving is COUNTED. On 2026-08-13 the tree stopped
// supplying either — 19 of 19 are swept — and the honest move is to
// manufacture the condition, not to drop the tests that measure it. A surface
// that lands tomorrow with no sweep is the ordinary case this guard was written
// for; the fixture just makes tomorrow happen now.
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
 *  109 → 110. */
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
  test('the REAL repository — 19 reachable, 19 swept, 0 printed, exit 0', () => {
    const { code, out } = run(REPO);
    assert.equal(code, 0, out);
    assert.match(out, /19 reachable surface\(s\) \(17 routed screens, 2 modal sheets\)/);
    assert.match(out, /19 swept by 1 a11y test file\(s\) across 110 case\(s\)/);
    assert.match(out, /0 unswept and PRINTED/);
    // The per-family tally, pinned. It read `tap-target ×0` from the day this
    // guard was written until 2026-08-13, and a family that has never been
    // non-zero is a limb nothing has exercised — so the number that proves it
    // started is worth holding.
    //
    // ✅ `contrast` STARTED TOO, later the same day: ×0 → ×23. It is pinned here
    // for the same reason tap-target is — and it earned the pin immediately, by
    // failing on its first real run and catching five genuine defects (a 1.01:1
    // page title in dark mode among them). **Both families have now gone from
    // ×0 to non-zero, so this line no longer records a limb that has never
    // fired.** If either returns to ×0, that is a sweep helper renamed out of
    // the parse, not progress.
    assert.match(out, /sweep families used: naked-controls ×24, tap-target ×19, contrast ×24/);
  });

  test('the copied subject tree reproduces the real reading exactly', () => {
    const { code, out } = run(tree());
    assert.equal(code, 0, out);
    assert.match(out, /19 reachable surface\(s\)/);
    assert.match(out, /19 swept by 1 a11y test file\(s\) across 110 case\(s\)/);
    assert.deepEqual(sweptList(out).sort(), ALL_19_SWEPT);
    assert.equal(printedUnswept(out).length, 0);
  });

  // ⚠️ RE-POINTED 2026-08-13, NOT DELETED. This test used to read "the fourteen
  // unswept surfaces PRINT and do not fail the build" and it had fourteen real
  // subjects. It now has none — and the property it measures (owed a11y work is
  // READ ALOUD on a GREEN run rather than reddening CI, the standing [pipeline
  // C-6] rule) did not stop being a property just because the tree caught up.
  // Deleting it would delete the only proof that a future unswept surface is
  // printed rather than build-failing, which is precisely the behaviour a
  // reader of this guard is entitled to rely on. So the fixture supplies the
  // subject the tree no longer does.
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
    assert.match(out, /⬜ 1 of 20 reachable surface\(s\) carry NO a11y sweep/);
    assert.match(out, /→ add a case to .* that pumps the surface and calls/);

    // AND NOT FAILED. This is the half that would be lost if the test went.
    assert.equal(code, 0, out);
    assert.doesNotMatch(out, /FAIL /);
    assert.match(out, /20 reachable surface\(s\) \(17 routed screens, 3 modal sheets\)/);
    assert.match(out, /19 swept by 1 a11y test file\(s\) across 110 case\(s\)/);
    assert.match(out, /1 unswept and PRINTED/);
  });

  // ⚠️ RE-POINTED for the same reason: its old subject was the MISSING HomeScreen
  // sweep, and home is swept now. Adding a sweep for an already-swept surface
  // would change no number, which is a positive control that cannot fail — the
  // exact defect class this suite exists to catch. It now moves the
  // manufactured sheet across the line, in two runs against ONE fixture, so the
  // move itself is the evidence rather than two unrelated readings.
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
// A SWEEP THAT LEAVES — covered ⇒ printed, and it is NOT quiet
// ─────────────────────────────────────────────────────────────────────────────
// 🔴 RE-POINTED FROM INSIGHTS TO CHECK-INBOX, 2026-08-13, AND THE OLD SUBJECT
// HAD STOPPED TESTING ANYTHING — SILENTLY, WITH ALL THREE TESTS STILL GREEN
// WOULD HAVE BEEN THE OUTCOME HAD THE NUMBERS NOT MOVED TOO.
//
// These three delete ONE sweep call and require the surface to leave the ✅
// list. `InsightsScreen` is swept by TWO families now (naked-controls AND
// tap-target), so deleting `expectNothingNaked(tester, 'insights')` leaves it
// swept — and the guard is CORRECT to keep reporting it. The mutation stopped
// matching its own name: "the sweep call is deleted" would have been measuring
// nothing but the guard's ability to survive an irrelevant edit.
//
// TWO REPAIRS WERE AVAILABLE AND THE CHOICE IS RECORDED RATHER THAN IMPLIED:
//   (a) make each mutation delete BOTH of the subject's sweeps;
//   (b) re-point at a surface carrying exactly ONE.
// (b) is taken, for all three. The axis under test is whether a sweep CALL is
// what the guard counts — M2 hides it in a string, M2b in a comment — and each
// needs the smallest edit that isolates that axis. Under (a) every one of the
// three would need a second anchor in a distant group of the suite, doubling
// what can drift while measuring the same one thing; and M2/M2b would have to
// prose-ify a `meetsGuideline` call as well, which tests the literal- and
// comment-stripping limbs twice over rather than once.
//
// ⚠️ AND (b) HAS A FAILURE MODE, WHICH IS THE ONE THAT JUST HAPPENED: the
// subject's single-family status is a fact about today's tree, and nothing
// noticed when it changed. So it is no longer left to be noticed. The
// PRECONDITION test below asserts it, and the suite ARGUES it too —
// `CheckInboxScreen` is single-family because
// `androidTapTargetGuideline` inspects zero nodes on that screen, pinned by
// `check-inbox hands the tap-target guideline NOTHING — pinned`
// (a11y_semantics_test.dart:3069). The day that stops being true, that case
// goes red and so does the precondition, in the same run.
describe('a surface whose a11y sweep is deleted moves from covered to printed', () => {
  // The subject, named once. Swept by exactly ONE family — see the precondition.
  const SUBJECT = 'CheckInboxScreen';
  const DELETED = "        expectNothingNaked(tester, 'check-inbox');\n";

  test('PRECONDITION · the subject is swept by exactly ONE family', () => {
    const { code, out } = run(tree());
    assert.equal(code, 0, out);
    assert.deepEqual(
      familiesOf(out, SUBJECT),
      ['naked-controls'],
      `${SUBJECT} is no longer swept by exactly one family, so deleting its ONE sweep call no longer ` +
        'unsweeps it and M1/M2/M2b below are vacuous — they would pass while measuring nothing. This is ' +
        'not hypothetical: it is exactly what a second family did to the previous subject (InsightsScreen) ' +
        'on 2026-08-13, in silence. Either re-point M1/M2/M2b at a single-family surface, or make each of ' +
        `them delete EVERY sweep of ${SUBJECT}.\n${out}`,
    );
  });

  test('M1 · the sweep call is deleted', () => {
    const root = tree();
    edit(root, SUITE, DELETED, '');
    const { code, out } = run(root);

    // THE ACCOUNTING MOVED — this is the requirement.
    assert.ok(!sweptList(out).includes(SUBJECT), `still reported swept:\n${out}`);
    assert.ok(printedUnswept(out).includes(SUBJECT), `not printed as owed:\n${out}`);
    assert.deepEqual(printedUnswept(out), [SUBJECT]);

    // AND IT IS NOT QUIET. Coverage that WAS there and is gone is a regression,
    // not an unstarted task, and SWEPT_FLOOR is what tells the two apart.
    assert.equal(code, 1, out);
    assert.match(out, new RegExp(`FAIL REGRESSION — \`${SUBJECT}\``));

    // The remaining eighteen are untouched: one loss is reported as one loss.
    assert.deepEqual(
      sweptList(out).sort(),
      ALL_19_SWEPT.filter((s) => s !== SUBJECT),
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
    assert.ok(!sweptList(out).includes(SUBJECT), `prose was counted as a sweep:\n${out}`);
    assert.ok(printedUnswept(out).includes(SUBJECT), out);
    assert.match(out, new RegExp(`FAIL REGRESSION — \`${SUBJECT}\``));
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
      `        // expectNothingNaked(tester) — ${SUBJECT} is swept elsewhere.\n`,
    );
    const { code, out } = run(root);
    assert.equal(code, 1, out);
    assert.ok(
      !sweptList(out).includes(SUBJECT),
      `a commented-out call was counted as coverage:\n${out}`,
    );
    assert.ok(printedUnswept(out).includes(SUBJECT), out);
    assert.match(out, new RegExp(`FAIL REGRESSION — \`${SUBJECT}\``));
    // It is still NAMED — by the two label cases in its own group AND by the
    // pinned `hands the tap-target guideline NOTHING` case, all three of which
    // construct it without sweeping it — and the guard says so rather than
    // implying the screen is untouched by the suite.
    assert.match(out, new RegExp(`${SUBJECT} .*NAMES it but never sweeps it`));
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

  // 🔴 `meetsGuideline` ADDED TO THE RENAME 2026-08-13, AND WITHOUT IT THIS
  // TEST HAD STOPPED REACHING ITS OWN LIMB. Renaming only the two naked
  // helpers used to silence every sweep in the suite; once the tap-target
  // family landed it left `tap-target ×19` running and SEVENTEEN surfaces still
  // swept, so `sweepingBlocks === 0` could not fire and the guard instead
  // reported two REGRESSIONs (budget and check-inbox, the two surfaces the
  // tap-target family does not reach). The test went red on its regex and that
  // is the only reason this was seen — had the message not carried a number,
  // it would have passed while measuring a different failure entirely.
  // 📌 A mutation named "not one sweep" must neuter EVERY family the guard
  // recognises, and it inherits a new one each time SWEEP_FAMILIES grows.
  // `contrast` needs no rename today only because it shares `meetsGuideline`.
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
  // held five of nineteen and NotificationsScreen was not one of them. It holds
  // all nineteen now, so removing ANY route also strands a floor entry and
  // strands its sweep: three findings fire, not one. The assertion on the
  // surfaces floor is unchanged and just as tight — 18 against a floor of 19 —
  // and the two co-firing findings are PINNED here rather than left unstated,
  // because the measured reading is the record.
  //
  // 🔴 WHAT WAS LOST AND IS NOT RECOVERABLE FROM THIS FILE: with SWEPT_FLOOR
  // covering the whole domain, no mutation can make the surfaces floor fire
  // ALONE, so its independence is no longer demonstrable here. It is not
  // redundant — a surface added AFTER the floor was measured is in neither set
  // and only this floor would see it go — but that case cannot be built without
  // editing REQUIRED_COVERAGE, which lives in the guard.
  //
  // ⚠️ THE MUTATION THAT WOULD DEMONSTRATE IT, so the next person need not
  // re-derive it: when a 20th surface lands and `surfaces` is re-measured to 20
  // BEFORE that surface is swept, delete its route — its key is in neither
  // `swept` nor SWEPT_FLOOR, so 19 < 20 fires the surfaces floor with no other
  // limb able to see it, and this test can go back to asserting exactly that.
  test('M7 · a route leaves the app — the surfaces floor fires by number, SWEPT_FLOOR by name', () => {
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
    // The two limbs that now co-fire, asserted rather than assumed: the sweep
    // is still in the suite and now audits a screen no user can open, and the
    // floor entry is judgement over a surface that is not there.
    assert.match(out, /FAIL DEAD COVERAGE — .* sweeps `NotificationsScreen`/);
    assert.match(out, /FAIL FLOOR OVER NOTHING — .*notifications_screen\.dart#NotificationsScreen`/);
    // Proof the domain really shrank rather than the report merely changing
    // wording: the guard's ✅ list still holds 19 keys while only 18 are
    // reachable, which is the mismatch DEAD COVERAGE is reading.
    assert.equal(sweptList(out).length, 19);
    assert.equal(printedUnswept(out).length, 0);
  });

  // ⚠️ BACK IN ITS FOUR-CASE FORM 2026-08-13, and the detour is worth recording
  // because it is a property of FLOORS, not of this test. The a11y sweep took
  // the suite from 24 cases to 60 and raised SWEPT_FLOOR from 5 keys to 19, but
  // `REQUIRED_COVERAGE.cases` stayed at 24 for one change — and a floor 36
  // below its tree is not a floor: THIRTY-SIX cases could have left in silence,
  // this four-case deletion among them. While that lasted, the only mutation
  // that could reach the floor deleted 37 cases and needed a re-implementation
  // of the guard's own `testWidgets` parse inside this file to pick them. The
  // floor has since been re-measured to 60, so four is enough again, the
  // fixture parse is deleted, and the mutation is once more the small silent
  // erosion the limb exists to catch.
  //
  // 🔴 AND IT HAPPENED AGAIN THE SAME DAY, WHICH IS WHY THE PARAGRAPH ABOVE
  // STAYS. The tap-target increment took the suite 60 → 81 and again left
  // `cases` behind, this time at 60 — TWENTY-ONE cases deletable in silence.
  // This test was one of the nine that went red, and only because it pins the
  // floor's own number in its regex: `only 56 … floor is 60` could not match a
  // guard that no longer trips at 77. Pinning the FLOOR here, not just the
  // measured count, is what turns someone else's missed re-measurement into a
  // red test instead of a quieter guard. Re-measured to 81; four is still
  // enough, because the floor sits exactly on the tree again.
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
    // it is also what catches a mutation that disabled the WRONG block: if one
    // of the four titles above ever drifts onto a sweeping case, its surface
    // leaves this list instead of the deletion reading as a tidy-up.
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
    // the suite ALREADY HAS starts attributing to a file no route imports — which
    // is DEAD COVERAGE, by name. REPLACE the routed import; do NOT add alongside
    // it. Until 2026-08-13 the suite did not import
    // `features/onboarding/onboarding_screen.dart` at all, so ADDING the twin's
    // import left exactly one `OnboardingScreen` in scope and this fired. The
    // sweep of all 19 surfaces added that import, and two files declaring one
    // symbol is AMBIGUOUS SUBJECT (:518) — which fires FIRST and, because an
    // ambiguous symbol is never resolved into `swept`, section (D) at :613 can no
    // longer compute DEAD COVERAGE at all. The fixture would have gone on passing
    // against a DIFFERENT check while reporting that it proved this one.
    //
    // ⚠️ A SECOND EDIT STOOD HERE UNTIL 2026-08-13 AND IT WAS DEAD. It pumped
    // `const OnboardingScreen()` and swept "the twin" beside the insights sweep.
    // Inverting it ALONE left this test green — once the import is swapped the
    // suite's own onboarding case already points at the twin, so it changed no
    // outcome. An edit that contributes nothing is the "assertion that cannot
    // fail" shape wearing a mutation's clothes, and it left a reader believing
    // two things were being mutated. Deleted rather than annotated; re-proved
    // after deletion by inverting the swap below, which turns this test RED.
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
    edit(root, ROUTER, 'AppShell(navigationShell: navShell)', 'AppShellChrome(navigationShell: navShell)');
    const { code, out } = run(root);
    assert.equal(code, 1, out);
    assert.match(out, /FAIL `AppShell` is excluded in NOT_A_PANE but no route in .* builds it/);
  });
});
