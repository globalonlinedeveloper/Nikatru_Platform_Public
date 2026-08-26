#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// assert-modal-detection.mjs — A FIRST-RUN GATE IS FOUND BY ITS CONTROL, NEVER
// BY WHAT KIND OF WIDGET IT IS.
//
// [pipeline F-10] a guard carries a recorded failing case; [ADR 037 P2.6/P2.6a]
// the consent prompt that changed shape underneath three suites.
//
// ── THE OUTAGE, THREE TIMES, ONE CAUSE ──────────────────────────────────────
// The DPDP analytics-consent prompt comes up over the first live launch and
// covers the app. A suite that does not answer it has every subsequent
// `tester.tap()` swallowed SILENTLY — no exception, no warning — and then fails
// several lines later on whatever the tap was supposed to produce, naming the
// wrong widget. All three times the run page said, byte for byte:
//
//     Found 0 widgets with text "Welcome back"
//
// a login-screen error for a consent-prompt problem.
//
//   🔬 2026-07-27 · `integration_test/app_test.dart`. The prompt was
//      `ConsentGate`, a `showDialog` ROUTE. The suite polled
//      `find.byType(Dialog)`; that worked, and the helper written that day to
//      catch a covering modal asked `find.byType(Dialog)` too.
//   🔬 2026-08-08 · the SAME suite, IDENTICAL symptom, and the 2026-07-27 guard
//      passed through it. #217 (P2.6a) replaced the route with the stamped
//      `_ConsentPrompt` in `app.dart` — `Positioned.fill` + opaque `ColoredBox`
//      inside `MaterialApp.builder`, ABOVE the router's Navigator, where
//      `showDialog` has no Navigator to push onto. Not a route, not a `Dialog`,
//      so `find.byType(Dialog)` matched NOTHING while the prompt sat on screen
//      absorbing taps. #236 corrected THAT file's helpers on 2026-08-09 to key
//      on the decline control, and app_test.dart states the rule it arrived at
//      in its own words: *"SO IT NO LONGER ASKS WHAT THE MODAL IS."*
//   🔬 2026-08-26 · run 32947223120, `integration_test/store_screenshots_test.dart`
//      — the second run that lane has EVER had. #236 was scoped to the file that
//      had failed, so this one kept the stale detector for 18 days, invisible
//      because the lane does not run on push. The line was, verbatim:
//
//          if (await waitFor(
//            tester,
//            find.byType(Dialog),
//            timeout: const Duration(seconds: 8),
//          )) {
//
//      The poll timed out with the prompt plainly on screen, the answering block
//      was SKIPPED, the scrim ate `tap('Skip')`, and the suite failed eleven
//      lines down with the sentence above. It is repeated at CANARY_DEFECT below
//      and re-classified on every single run of this guard.
//
// ⚠️ SO THE DEFECT IS NOT "SOMEBODY FORGOT". Three competent corrections were
// made and the fourth occurrence was still available, because each correction
// was scoped to the file that had failed. That is what a guard is for: the rule
// has to range over every suite it can reach, including the ones written next
// year — and the reach is a real boundary, not a figure of speech. It is every
// .dart file under `test/` and `integration_test/` in every root derived below,
// and that is exactly what "every suite" means in this file. A suite written
// somewhere else is outside this guard, and the DOES NOT CLAIM list says so.
//
// ── WHAT IS ACTUALLY FORBIDDEN, AND WHY IT IS NOT `find.byType` ─────────────
// 🔴 `find.byType(Dialog)` IS NOT WRONG. A naive guard that says so would redden
// honest code and get switched off inside a week — and it would redden, first of
// all, the three CORRECT assertions this repository wrote while fixing this very
// bug (`expect(find.byType(Dialog), findsNothing)` in app_test.dart:384 and
// first_run_destination_test.dart:183, and the sheet-width measurements in
// width_cancel_sheet_test.dart). A guard that fails the fix for the defect it
// guards is not a guard.
//
// 📏 MEASURED FIRST, AND THE MEASUREMENT CHOSE THE RULE. Every `find.byType(` in
// the suite corpus was enumerated and classified before a line of this was
// written. On 2026-08-26, across apps/subly/test, apps/subly/integration_test and
// the brick's test/: 329 sites in 72 files across 2 roots, spanning 58 distinct
// widget types — 155 assertions, 161 inspections, 1 screen-state branch, 12 bare.
// (330/13-bare stood here until 2026-08-26 and was one too many in both: the
// alias limb pushed a SECOND site for a source occurrence the main loop had
// already counted, so app_test.dart:708 was tallied once as `bare` and again as
// `state`. Counted independently against the reduced sources, the corpus holds
// 329 `find.byType(` occurrences. The limb now upgrades the site it already has.)
// The two `Dialog` sites were, without exception, ASSERTIONS that no dialog is
// present; the seventeen `BottomSheet` sites were assertions and geometry
// measurements of a sheet the screen under test genuinely owns. Not one live
// site in the tree was the defect — it had been fixed that morning.
//
// A rule that forbade the TYPE would therefore have flagged nineteen honest
// sites and zero defects, and the first of them would have been the fix.
//
// ⚠️ READ THE PASSING LINE, NOT THIS PARAGRAPH. Every figure above is prose, and
// prose rots — assert-guard-coverage.mjs carries an entry that undercounted its
// own blast radius by a factor of four while claiming in the same sentence to be
// derived. The live counts are printed on every run, and they are the ones that
// are true. A first pass at these numbers, taken with `grep -c` over apps/subly
// ALONE and a narrower matcher, said 273 — short by the whole brick and by every
// second occurrence on a shared line, which is exactly how a number like this
// goes wrong. If you need the count, run the guard.
//
// What the three outages actually share is not a TYPE, it is a SITE. In all
// three the finder was the DETECTOR OF A DISMISSAL — the thing that decides
// whether an overlay is there and therefore whether to answer it — and a widget
// type is the wrong key for that question, because the type is an implementation
// detail of the prompt and the CONTROL is its contract. `find.text('No thanks')`
// survived a route becoming an inline scrim; `find.byType(Dialog)` did not.
//
// So, two limbs:
//
//   LIMB A · DETECTOR. A `find.byType(T)` that is the finder a poll helper or a
//     branch condition decides on — "is this thing there, and if so deal with
//     it" — where T is a gate: one of the framework chassis an app-covering
//     overlay is built from (MODAL_CHASSIS), or a class whose OWN NAME says it
//     is a gate (GATE_SHAPED).
//
//   LIMB B · DISMISSAL. A `find.byType(T)` of the same T that is TAPPED. Tapping
//     a control by its type (`find.byType(FilledButton)`) is ordinary and stays
//     legal; reaching for the chassis is the same brittleness as limb A.
//
// 🔬 LIMB A WAS WRITTEN TYPE-AGNOSTIC FIRST — "any type at a poll or a branch" —
// AND THE TREE REFUTED IT ON THE FIRST RUN. It flagged app_test.dart:708,
// `signOutIfSignedIn`, which does `final Finder shell = find.byType(AppShell); if
// (shell.evaluate().isEmpty) return false;`. That is not modal detection: it asks
// WHICH SCREEN THE APP IS ON, a state question a widget type answers perfectly
// well, and it is one of this suite's better lines (three tests share a browser
// profile, so it refuses to assume the previous test's happy path). Flagging it
// would have been the naive guard the brief for this file warned against — right
// about the shape, wrong about the subject, switched off within a week.
//
// So the SITE narrows the population and the TYPE narrows it again, and both
// narrowings are measured rather than argued: MODAL_CHASSIS alone catches all
// three recorded outages, because all three polled `find.byType(Dialog)` —
// including 2026-07-27, when the prompt was the app's own `ConsentGate`, which
// rendered as one. GATE_SHAPED is the deliberate over-approximation on top, so
// that a future `find.byType(ConsentGate)` — an app-owned class no list of
// framework types could ever name — is covered on the day it is written.
//
// The site classification is derived from the enclosing call, not from a line
// regex: `enclosingCall` walks back over balanced parentheses to the token that
// opened the argument list the finder sits in. `expect(` is an assertion,
// `tester.widget<T>(` is an inspection, `waitFor(` is a poll, `if (` is a branch.
//
// 🔬 AND THE POLL HELPERS ARE DERIVED FROM EACH SUITE, NOT LISTED HERE. A hand
// list of helper names covers what somebody remembered on the day, and the next
// suite names its poller `pumpUntilFound` and is born outside the rule — the
// same shape as the hand-ratcheted floors assert-guard-coverage.mjs deleted. A
// poll helper is instead recognised by its SIGNATURE: it returns `bool` (or
// `Future<bool>`) and it takes a `Finder`. That is what a poller IS.
//
// ── WHAT THIS GUARD DOES NOT CLAIM, STATED RATHER THAN DISCOVERED LATER ─────
//   · It cannot tell you the CONTROL you keyed on is the right one. A suite that
//     polls `find.text('Allow')` when the button says "Accept" passes here and
//     fails on a device. Only the run can answer that.
//   · Banner and toast types (`SnackBar`, `MaterialBanner`) are deliberately
//     OUTSIDE MODAL_CHASSIS. They do not cover the app and cannot swallow a tap
//     aimed at it, so they cannot produce this outage class; including them
//     would buy false positives and no coverage. Named here so the exclusion is
//     a decision on the record and not an oversight.
//   · It is a STATIC reading of a suite. `store_screenshots_test.dart` was wrong
//     for 18 days while every test in the repository was green; that is the gap
//     this closes. It says nothing about whether the suite passes.
//   · IT READS ONLY `test/` AND `integration_test/` UNDER ITS DERIVED ROOTS.
//     A poll helper hoisted to `lib/`, to a `test_util` package, or to any path
//     outside those two directories is invisible: the corpus poller union (see
//     classify) cannot see a signature it never reads, and a suite calling that
//     helper is classified `inspection` and passes. Measured, not assumed —
//     that is the shape limb A was blind to in ALL files before 2026-08-26.
//   · The poller union is a union of NAMES, not an import graph. A file calling
//     something that merely SHARES a poll helper's name is judged as though it
//     called the poller. The type must still be a gate for that to matter.
//   · An indirection this guard cannot follow passes: an assignment with no
//     declaration (`gate = find.byType(Dialog);`), a finder returned from a
//     function, a finder stored on a field and read in another method. What IS
//     followed is a LOCAL DECLARATION bound to `find.byType(T)` — typed,
//     inferred or bool-valued — and used in a branch or a poll.
//   · It is not a claim that a fourth outage is impossible. It is the claim that
//     these two shapes, in these two directories, cannot be written again
//     without somebody reading a failure first. `find.byWidgetPredicate`,
//     `find.byElementType`, a raw `tester.any(…)` and every dynamic detection
//     are all outside it, because none of them is what the three outages did.
//
// 💬 A SHARED HELPER WOULD BE THE BETTER ANSWER AND THIS IS NOT IT. Two suites
// carrying two hand-written copies of "answer the first-run consent prompt" is
// the root cause; this guard polices the symptom. The proposal — one
// `answerFirstRunConsent(tester)` in a shared `integration_test/consent.dart`
// that both suites import — is reported to the main loop by the writer that
// added this file, because a writer that owns only tooling/ci cannot create it.
// When it lands, this guard keeps its value: it is what stops the THIRD suite
// from writing a third copy instead of importing the helper.
//
// 🔴 AND UNTIL 2026-08-26 IT WOULD HAVE GONE BLIND ON THE DAY THAT HELPER
// LANDED, which is the worst possible day for it. `pollers` was derived PER
// FILE, so a suite whose only content was `import 'consent.dart';` plus the
// verbatim outage line classified the finder as an `inspection` and exited 0
// with "0 detector" — measured. The poll signatures are now unioned across every
// file under the scanned suite dirs, so `integration_test/consent.dart` is read
// whether or not it is the file being classified. The limit that remains is
// stated in the list above: a helper hoisted OUTSIDE those directories is still
// invisible, and this guard says so rather than implying otherwise.
//
// Usage:  node tooling/ci/assert-modal-detection.mjs [repoRoot]
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync, existsSync, statSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { listDir } from './tree-walk.mjs';
import { stripSourceComments, stripStringLiterals } from './text-reductions.mjs';

const ROOT = resolve(process.argv[2] ?? join(dirname(fileURLToPath(import.meta.url)), '..', '..'));
const NAME = 'assert-modal-detection';

/** The brick template, which stamps every future app. It is scanned as a root of
 *  its own: a stale detector stamped into app #2 is invisible in app #1's tree,
 *  and the brick has no Dart suite runner of its own, so a static read is the
 *  ONLY reading it ever gets. */
const BRICK = 'tooling/bricks/app/__brick__/apps/{{app_id}}';

/** The brick PACKAGE's manifest — the tree's own declaration that a brick lives
 *  here. It is what turns the line above from an OPPORTUNISTIC `existsSync` into
 *  a derived requirement, and it was added because the opportunistic form was
 *  measured failing in exactly the shape this file's doctrine names: 2026-08-26,
 *  brick present -> 329 sites / 72 files / 2 roots, exit 0; the brick's app
 *  directory renamed and NOTHING else touched -> 263 sites / 65 files / 1 root,
 *  exit 0, "ok". 66 sites and 7 files — a fifth of the corpus — went green by
 *  disappearing, past four COVERAGE LOST limbs that each still had a large
 *  non-empty set to look at. A root that leaves is not a smaller job; it is an
 *  unread one. See the roots block below for the limb this anchors. */
const BRICK_MANIFEST = 'tooling/bricks/app/brick.yaml';

/** Where a suite lives inside a root. BOTH, and that is the whole point of the
 *  file you are reading: #236 corrected `integration_test/app_test.dart` and
 *  left `integration_test/store_screenshots_test.dart` carrying the same line,
 *  so a rule that stops at one directory is the scoped correction again with a
 *  guard's name on it. `test/first_run_destination_test.dart` — the widget test
 *  that reproduces the outage without a device — lives in the other one. */
const SUITE_DIRS = ['test', 'integration_test'];

const problems = [];
const notes = [];

const fail = (lines) => {
  console.error('');
  for (const l of lines) console.error(l);
  console.error('');
  console.error(`${NAME}: FAILED`);
  process.exit(1);
};

/** A scan that reached nothing must say so. This repository's single most
 *  repeated defect is a guard printing ok over an empty set. */
const coverageLost = (lines) => {
  console.error(`✗ COVERAGE LOST — ${lines[0]}`);
  for (const l of lines.slice(1)) console.error(`    ${l}`);
  console.error('');
  console.error(`${NAME}: FAILED`);
  process.exit(1);
};

// ─────────────────────────────────────────────────────────────────────────────
// THE REDUCTION
//
// Comments AND string literals, both blanked, offsets preserved.
//
// 🔴 BOTH, AND NEITHER IS OPTIONAL — each was a measured mis-read on this exact
// corpus. Comments, because the three files that FIXED this bug all quote
// `find.byType(Dialog)` in their headers to explain what went wrong: reading
// prose as a call site would make the fix fail the guard. String literals,
// because first_run_destination_test.dart:188 carries the same text inside an
// `expect` reason — *"Any suite that detects it with find.byType(Dialog) will
// conclude the prompt is absent"* — which is the rule being written down, not a
// site. This is the same class as the `grep '"r2_buckets"'` that matched the
// template comment explaining why there are no r2_buckets, which
// assert-clone-contract.mjs records as the reason it parses instead of greps.
// ─────────────────────────────────────────────────────────────────────────────
const reduce = (src) => stripStringLiterals(stripSourceComments(src, '.dart'));

/** Read the balanced `(...)` argument beginning at `open`. Returns null on an
 *  unbalanced source rather than guessing — an unreadable argument is reported,
 *  never skipped. */
function balancedArg(src, open) {
  let depth = 0;
  for (let i = open; i < src.length; i += 1) {
    if (src[i] === '(') depth += 1;
    else if (src[i] === ')') {
      depth -= 1;
      if (depth === 0) return src.slice(open + 1, i);
    }
  }
  return null;
}

/**
 * The token that opened the argument list `at` sits inside — the SITE.
 *
 * Walks back over balanced parentheses and stops at a statement boundary
 * (`;`, `{`, `}`), so a finder assigned to a local (`final bool shown =
 * find.byType(MaterialBanner).evaluate().isNotEmpty;`) correctly reports NO
 * enclosing call rather than binding to whatever call happened to appear
 * earlier in the method. That case is real — chassis_properties_test.dart:2898 —
 * and it is an assertion, so misreading it as a branch would have been this
 * guard's first false positive.
 *
 * ⚠️ AND `bare` IS NOT THE END OF THE STORY FOR THAT SHAPE. Returning null here
 * is correct — the finder genuinely has no enclosing call — but the SAME two
 * clauses with a gate type and an `if` (`final bool shown =
 * find.byType(Dialog).evaluate().isNotEmpty; if (shown) {…}`) is the outage one
 * indirection away, and until 2026-08-26 it exited 0 as `bare`. It is caught by
 * the alias limb now, via ALIAS_BIND_RE, and attributed to the binding line.
 * chassis_properties_test.dart:2898 itself stays legal and is re-proven so on
 * every run: `MaterialBanner` is deliberately outside MODAL_CHASSIS and `expect`
 * is not a branch, so neither clause of the alias limb reaches it.
 */
function enclosingCall(src, at) {
  let depth = 0;
  for (let i = at - 1; i >= 0; i -= 1) {
    const c = src[i];
    if (c === ')') depth += 1;
    else if (c === '(') {
      if (depth === 0) {
        const before = src.slice(Math.max(0, i - 80), i);
        const m = before.match(/([A-Za-z_$][A-Za-z0-9_$]*)\s*(?:<[^<>()]*>\s*)?$/);
        return m ? m[1] : null;
      }
      depth -= 1;
    } else if (depth === 0 && (c === ';' || c === '{' || c === '}')) {
      return null;
    }
  }
  return null;
}

const lineOf = (src, at) => src.slice(0, at).split('\n').length;

/** Branch keywords — "if it is there, deal with it". The 2026-08-26 defect and
 *  every hand-rolled variant of it land here or on a derived poll helper. */
const BRANCH = new Set(['if', 'while']);

/** Interaction sites — limb B's subject. */
const INTERACT = new Set(['tap', 'tapAt', 'longPress', 'fling', 'drag', 'dragUntilVisible', 'press']);

/**
 * The framework chassis an APP-COVERING overlay is built from.
 *
 * 📏 THIS SET IS WHAT THE THREE OUTAGES MEASURED. Every one of them polled
 * `find.byType(Dialog)` — 2026-07-27 included, when the prompt was the app's own
 * `ConsentGate` rendering as a `showDialog` route. So the set is not a guess at
 * what might go wrong; it is the recorded population, widened only to the sibling
 * chassis the same mistake reaches for.
 */
const MODAL_CHASSIS = new Set([
  'Dialog', 'AlertDialog', 'SimpleDialog', 'CupertinoAlertDialog', 'CupertinoDialog',
  'ModalBarrier', 'BottomSheet', 'DraggableScrollableSheet', 'ModalBottomSheet',
  'Overlay', 'OverlayEntry', 'PopupRoute', 'ModalRoute',
]);

/**
 * A class whose OWN NAME says it is a gate — the over-approximation, stated here
 * rather than relied on quietly.
 *
 * It exists for the one case MODAL_CHASSIS structurally cannot reach: an
 * app-owned gate widget, named in the app and findable by type from a suite,
 * like the `ConsentGate` that was deleted on 2026-08-10. A list of framework
 * types can never contain tomorrow's class name; a claim about what the name
 * MEANS can.
 *
 * ⚠️ IT IS A HEURISTIC AND IT WILL EVENTUALLY BE WRONG. `Screen` and `Shell` are
 * excluded because a screen is a destination rather than an obstacle — that
 * exclusion is what keeps `find.byType(AppShell)` and `find.byType(SettingsScreen)`
 * legal, which the tree required on the first run. When it is wrong the answer is
 * the written exemption below, which costs one line and a sentence; do not
 * quietly delete a word from this pattern, because every word in it is a class of
 * gate somebody would otherwise detect by type.
 *
 * MEASURED 2026-08-26 against the whole suite corpus: it flags nothing that
 * MODAL_CHASSIS did not already flag, so it is coverage bought at zero cost
 * today, purchased for the day an app-owned gate comes back.
 */
const GATE_SHAPED = /(?:Consent|Gate|Prompt|Interstitial|Paywall|Modal|Scrim|Barrier|Overlay)/;
const isGateType = (t) => MODAL_CHASSIS.has(t) || (GATE_SHAPED.test(t) && !/(?:Screen|Shell)$/.test(t));

/** The exemption marker, written in the suite ON or ABOVE the site it excuses.
 *  It lives in the source rather than in a map here for one reason: a waiver in
 *  a distant file outlives the line it describes (assert-no-seam-forks.mjs
 *  records the first stale one this corpus produced), whereas a comment attached
 *  to the line is deleted by the same edit that deletes the line. The reason is
 *  required, measured, and a marker that excuses nothing FAILS below. */
/* ⚠️ THE `\r?` IS LOAD-BEARING AND WAS NOT LIVE ON THE DAY IT WAS ADDED. This
 * pattern has no `m` flag and is applied to lines produced by `split('\n')`, so
 * on a CRLF checkout every line ends in a `\r` that `.` cannot match and that a
 * non-multiline `$` will not skip. MEASURED: without the `\r?`, testing it
 * against `'// modal-detection: allow - <reason>\r'` returns FALSE. Both readers
 * of this pattern would then go silent in the same instant, in OPPOSITE
 * directions — a written marker would stop excusing its site (fails closed, and
 * loudly), and the stale-exemption limb would stop finding stale markers at all
 * (fails OPEN, with no diagnostic anywhere). `.gitattributes` pins
 * `* text=auto eol=lf`, so this was never live; the `\r?` costs two characters
 * and makes the guard's behaviour unconditional instead of contingent on a file
 * nothing in here reads. */
/**
 * A LOCAL BOUND TO A FINDER — the shape limb A and limb B see one indirection
 * away, and the reason this is a DECLARATION pattern rather than a `Finder` one.
 *
 * 📏 IT WAS `(?:final|late final|var)\s+Finder\s+…` AND THAT WAS TWO MEASURED
 * BLIND SPOTS, both re-run 2026-08-26 against a scratch root:
 *   · `final consentGate = find.byType(Dialog); if (consentGate.evaluate()…)`
 *     — type INFERENCE. The old pattern hard-required the literal token
 *     `Finder`, so this classified `bare` and exited 0.
 *   · `final bool shown = find.byType(Dialog).evaluate().isNotEmpty;
 *     if (shown) {…}` — the local is a `bool`, never a `Finder`, and the whole
 *     detection collapses into the initialiser. Also `bare`, also exit 0. That
 *     exact SHAPE already lives at chassis_properties_test.dart:2898 (with
 *     `MaterialBanner` and an `expect`, which is honest and stays honest); the
 *     header discusses that line as a correctness win without noticing that the
 *     same two clauses with a GATE type and an `if` are the invisible defect.
 * So the declared type is now optional and unconstrained, and the capture is
 * anchored on the NAME rather than on the type.
 *
 * ⚠️ WHAT IT STILL DOES NOT SEE, stated here rather than discovered later: an
 * assignment with NO declaration (`gate = find.byType(Dialog);` onto a field or
 * an earlier local), a binding whose initialiser sits further back than this
 * 120-character lookbehind reaches, and any indirection through a function
 * return.
 */
const ALIAS_BIND_RE =
  /(?:^|[;{}()\s])(?:late\s+)?(?:final|var)\s+(?:[A-Za-z_$][A-Za-z0-9_$]*(?:<[^<>]*>)?\??\s+)?([A-Za-z_$][A-Za-z0-9_$]*)\s*=\s*$/;

const EXEMPT_RE = /modal-detection:\s*allow\b[ \t]*[-—:]?[ \t]*(.*)\r?$/;
const MIN_REASON = 30;

// ─────────────────────────────────────────────────────────────────────────────
// THE SUBJECT SET
// ─────────────────────────────────────────────────────────────────────────────
const roots = [];
if (existsSync(join(ROOT, BRICK))) roots.push(BRICK);
else if (existsSync(join(ROOT, BRICK_MANIFEST))) {
  coverageLost([
    `${BRICK_MANIFEST} exists, so this tree DECLARES a brick — but ${BRICK} does not, so the brick`,
    'contributed no suite to this scan. The other root(s) still hold thousands of lines, so every limb',
    'below finds a healthy non-empty corpus and prints ok over a root that silently left.',
    'The brick has no Dart suite runner of its own: a static read is the ONLY reading it ever gets, and',
    'a stale detector stamped into app #2 is invisible in app #1. Re-point BRICK, or delete the brick.',
  ]);
}
let workspaceRead = false;
try {
  const lines = readFileSync(join(ROOT, 'pubspec.yaml'), 'utf8').replace(/^\s*#.*$/gm, '').split('\n');
  const at = lines.findIndex((l) => /^workspace:\s*$/.test(l));
  if (at !== -1) {
    workspaceRead = true;
    for (const line of lines.slice(at + 1)) {
      if (/^\S/.test(line)) break;
      const m = line.match(/^\s*-\s*(\S+)\s*$/);
      if (m && m[1].startsWith('apps/')) roots.push(m[1]);
    }
  }
} catch {
  /* handled by workspaceRead below */
}
if (!workspaceRead) {
  coverageLost([
    'the root pubspec.yaml has no readable `workspace:` block, so the app roots could not be derived.',
    'The domain would then be the brick alone — and the brick has no integration suite at all, which is',
    'the one shape of this scan that would find nothing and still print ok.',
  ]);
}
if (!roots.length) {
  coverageLost([
    'no app root was derived: the brick is absent and the workspace lists no `apps/` member.',
    'There is nothing to scan, so a pass here would be a claim about an empty set.',
  ]);
}

/** Every .dart under a suite dir, recursively. */
function suiteFiles(rootRel) {
  const out = [];
  const walk = (absDir, relDir) => {
    for (const entry of listDir(absDir, { withFileTypes: true })) {
      const abs = join(absDir, entry.name);
      const rel = `${relDir}/${entry.name}`;
      if (entry.isDirectory()) walk(abs, rel);
      else if (entry.name.endsWith('.dart')) out.push(rel);
    }
  };
  for (const d of SUITE_DIRS) {
    const abs = join(ROOT, rootRel, d);
    if (existsSync(abs) && statSync(abs).isDirectory()) walk(abs, `${rootRel}/${d}`);
  }
  return out;
}

const perRoot = roots.map((rootRel) => [rootRel, suiteFiles(rootRel)]);
const files = perRoot.flatMap(([, f]) => f).sort();
if (!files.length) {
  coverageLost([
    `${roots.length} root(s) were derived and NOT ONE carries a .dart file under ${SUITE_DIRS.join('/ or ')}/.`,
    'Either the suites moved, or this walk lost its grip on the tree. Both read as "no violations" and',
    'the second one is the failure this whole corpus keeps paying for.',
  ]);
}
/* 🔴 AND PER ROOT, NOT ONLY IN TOTAL. The check above is satisfied by ONE root
 * carrying files while another carries none — the same "a root left and the
 * total still looked healthy" failure the BRICK_MANIFEST limb catches one step
 * earlier, in the shape where the directory is still present and empty rather
 * than renamed away. */
const emptyRoots = perRoot.filter(([, f]) => !f.length).map(([r]) => r);
if (emptyRoots.length) {
  coverageLost([
    `${emptyRoots.length} of ${roots.length} derived root(s) carry NO .dart file under ${SUITE_DIRS.join('/ or ')}/:`,
    ...emptyRoots,
    `The other root(s) still yielded ${files.length} file(s), so every count below would read healthy`,
    'while the root(s) named above went entirely unscanned.',
  ]);
}

// ─────────────────────────────────────────────────────────────────────────────
// THE CLASSIFIER
// ─────────────────────────────────────────────────────────────────────────────
/**
 * Every `find.byType(...)` in one suite, classified by SITE.
 *
 * Returns `{ sites, pollers, unreadable }`. A site is
 * `{ line, type, call, verdict }` where verdict is one of
 * `detector` / `dismissal` (both defects) or `assertion` / `inspection` /
 * `state` / `bare` (all fine).
 *
 * `state` is the verdict that keeps this guard usable: a poll or a branch on a
 * type that is NOT a gate — `if (find.byType(AppShell)…)` — asking which screen
 * the app is on. It is counted and printed separately from `inspection` so that
 * the line between "detected a gate by type" and "asked where I am" stays
 * visible in the passing output instead of being asserted in this comment.
 */
function declaredPollers(src) {
  const out = new Set();
  for (const m of src.matchAll(/\b(?:Future\s*<\s*bool\s*>|bool)\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*\(/g)) {
    const args = balancedArg(src, m.index + m[0].length - 1);
    if (args !== null && /\bFinder\b/.test(args)) out.add(m[1]);
  }
  return out;
}

function classify(source, importedPollers = new Set()) {
  const src = reduce(source);

  // ── the poll helpers this suite declares, derived from their signatures ──
  // Returns a bool (now or later) and takes a Finder. That is what a poller is,
  // so a suite that names its own `pumpUntilFound` is covered on the day it is
  // written rather than on the day somebody remembers to extend a list here.
  const pollers = declaredPollers(src);
  /* 🔴 …AND THE ONES IT IMPORTS, which is the difference between this guard
   * working and this guard going blind on the day its own recommendation lands.
   * `pollers` above is derived PER FILE. MEASURED 2026-08-26: a suite containing
   * only `import 'consent.dart';` and the verbatim 2026-08-26 outage line —
   * `if (await waitFor(tester, find.byType(Dialog), …))` — classified as
   * `inspection`, "0 detector", EXIT 0. The header calls one shared
   * `answerFirstRunConsent(tester)` in `integration_test/consent.dart` "the
   * better answer"; the moment two suites import it, `waitFor` is declared in
   * NEITHER of them and limb A stops seeing the exact shape of all three
   * outages. `importedPollers` is the union of every poll signature declared
   * anywhere under the scanned suite dirs, so a helper hoisted into a shared
   * file stays visible to every file that calls it.
   *
   * ⚠️ THE LIMIT, AND IT IS A REAL ONE: the union ranges over the SUITE DIRS
   * only. A poll helper hoisted out to `lib/`, to a `test_util` package, or to
   * any path outside `test/` and `integration_test/` is invisible to this scan,
   * and a suite calling it reads `inspection` again. It is also a NAME union and
   * not an import graph — a file that calls something merely SHARING a poller's
   * name is judged as though it called the poller. Both are deliberate: the type
   * still has to be a gate for either to matter, and measured over the corpus
   * the union changes no verdict (0 detector, 0 dismissal, before and after). */
  const knownPollers = importedPollers.size ? new Set([...pollers, ...importedPollers]) : pollers;

  const sites = [];
  const unreadable = [];
  /** Locals bound to a byType finder — `final Finder x = find.byType(T);`, and
   *  since 2026-08-26 the inferred and bool-valued forms too (see
   *  ALIAS_BIND_RE). The 2026-08-26 defect passed the finder inline, but the
   *  CORRECTED code in both suites binds a local first (`final Finder
   *  consentDecline = …`), so the next person to reintroduce the defect will
   *  very likely reintroduce it in that shape — the shape the fix taught them.
   *
   *  The map holds the SITE OBJECT already pushed below, not a copy of its
   *  fields, because the alias limb UPGRADES that site in place. It used to push
   *  a SECOND site for the same source occurrence, which double-counted it:
   *  measured 2026-08-26, the passing line printed 330 over a corpus holding 329
   *  `find.byType(` occurrences, the extra one being app_test.dart:708's
   *  `final Finder shell = find.byType(AppShell)` counted once as `bare` and
   *  again as `state`. A count in an operator-facing line that is off by the
   *  number of aliases is the exact failure this whole file is about. */
  const aliases = new Map();

  for (const m of src.matchAll(/\bfind\s*\.\s*byType\s*\(/g)) {
    const open = m.index + m[0].length - 1;
    const arg = balancedArg(src, open);
    if (arg === null) {
      unreadable.push(lineOf(src, m.index));
      continue;
    }
    const type = arg.trim().replace(/<[\s\S]*$/, '').trim();
    const call = enclosingCall(src, m.index);
    let verdict;
    if (call !== null && (BRANCH.has(call) || knownPollers.has(call))) {
      verdict = isGateType(type) ? 'detector' : 'state';
    } else if (call !== null && INTERACT.has(call)) verdict = isGateType(type) ? 'dismissal' : 'inspection';
    else if (call === 'expect' || call === 'expectLater') verdict = 'assertion';
    else if (call === null) verdict = 'bare';
    else verdict = 'inspection';
    const site = { line: lineOf(src, m.index), type, call, verdict };
    sites.push(site);

    if (verdict === 'bare') {
      const before = src.slice(Math.max(0, m.index - 120), m.index);
      const a = before.match(ALIAS_BIND_RE);
      if (a && !aliases.has(a[1])) aliases.set(a[1], site);
    }
  }

  // ── the alias limb ────────────────────────────────────────────────────────
  // A local bound to a byType finder and then handed to a poll or a branch is
  // the same defect one indirection away, and it is attributed to the BINDING
  // line, because that is the line the fix has to change.
  for (const [name, site] of aliases) {
    for (const u of src.matchAll(new RegExp(`\\b${name}\\b`, 'g'))) {
      const call = enclosingCall(src, u.index);
      if (call !== null && (BRANCH.has(call) || knownPollers.has(call))) {
        site.verdict = isGateType(site.type) ? 'detector' : 'state';
        site.call = call;
        site.viaAlias = name;
        break;
      }
    }
  }

  // `pollers`, not `knownPollers`: this is what THIS file declares, which is what
  // the canary below asserts the signature derivation still recognises.
  return { sites, pollers: [...pollers], unreadable };
}

// ─────────────────────────────────────────────────────────────────────────────
// 🔴 THE RECORDED FAILING CASE, RE-RUN ON EVERY INVOCATION.
//
// [pipeline F-10] asks every guard to carry one. This corpus has learned twice
// over that a guard nobody has seen fail is not yet a guard — and a classifier
// is exactly the kind of thing that stops classifying silently, because "found
// no defects" and "stopped being able to see defects" print identically.
//
// CANARY_DEFECT is the 2026-08-26 line, verbatim from
// integration_test/store_screenshots_test.dart as it stood at a6a0646, with the
// suite's own `waitFor` declaration above it so the poll-helper DERIVATION is
// exercised too and not merely the branch keywords.
//
// CANARY_HONEST is the CORRECTION that shipped the same day, in the shapes the
// fixed tree actually uses: the `expect(find.byType(Dialog), findsNothing)`
// assertion, the control-keyed poll, a `BottomSheet` geometry read, a tap on a
// control by its type — and, last, `signOutIfSignedIn`'s screen-state branch on
// `find.byType(AppShell)`, WHICH THE FIRST VERSION OF THIS GUARD FLAGGED. That
// line is in here so the refutation the tree produced on the first run cannot be
// un-learned by a later widening of limb A: re-broaden the detector limb to any
// type and this canary goes red immediately, in the guard's own file, rather
// than in somebody's pull request three weeks from now.
//
// If either canary stops behaving, this guard is dead and says so before it
// reads a single suite file.
// ─────────────────────────────────────────────────────────────────────────────
const CANARY_DEFECT = `
  Future<bool> waitFor(WidgetTester tester, Finder f, {Duration timeout = d}) async {
    return false;
  }
  testWidgets('x', (WidgetTester tester) async {
    if (await waitFor(
      tester,
      find.byType(Dialog),
      timeout: const Duration(seconds: 8),
    )) {
      await tester.tap(find.text('No thanks'));
    }
  });
`;
const CANARY_HONEST = `
  Future<bool> waitFor(WidgetTester tester, Finder f, {Duration timeout = d}) async {
    return false;
  }
  testWidgets('x', (WidgetTester tester) async {
    expect(find.byType(Dialog), findsNothing, reason: 'find.byType(Dialog) here is the assertion');
    final Finder consentDecline = find.text('No thanks');
    if (await waitFor(tester, consentDecline, timeout: const Duration(seconds: 8))) {
      await tester.tap(consentDecline.first);
    }
    expect(tester.getSize(find.byType(BottomSheet)).width, 600.0);
    await tester.tap(find.byType(FilledButton));
    final Finder shell = find.byType(AppShell);
    if (shell.evaluate().isEmpty) return false;
  });
`;
{
  const defect = classify(CANARY_DEFECT);
  const flagged = defect.sites.filter((s) => s.verdict === 'detector' || s.verdict === 'dismissal');
  if (flagged.length !== 1 || flagged[0].type !== 'Dialog' || flagged[0].call !== 'waitFor') {
    coverageLost([
      'THE RECORDED FAILING CASE IS NO LONGER DETECTED. The 2026-08-26 line — a poll on',
      `\`find.byType(Dialog)\` — classified as ${
        flagged.length ? flagged.map((f) => `${f.verdict} via ${f.call}`).join(', ') : 'NOTHING AT ALL'
      }.`,
      'Every green this guard has printed since the change that did this is vacuous. Fix the classifier;',
      'do not adjust the canary to match it.',
    ]);
  }
  if (!defect.pollers.includes('waitFor')) {
    coverageLost([
      'the poll-helper derivation no longer recognises `Future<bool> waitFor(WidgetTester, Finder, …)`.',
      'Limb A would then see branch keywords only, and the exact shape of all three outages — a finder',
      'handed to a suite-local poller — would pass unread.',
    ]);
  }
  const honest = classify(CANARY_HONEST);
  const wrongly = honest.sites.filter((s) => s.verdict === 'detector' || s.verdict === 'dismissal');
  if (wrongly.length) {
    coverageLost([
      `the classifier now flags ${wrongly.length} site(s) in the CORRECTION that shipped on 2026-08-26:`,
      ...wrongly.map((s) => `${s.type} at canary line ${s.line} — ${s.verdict} via ${s.call}`),
      'A guard that reddens the fix for the defect it guards is a guard people switch off. Narrow the',
      'site classification rather than widening the exemption route.',
    ]);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 🔴 THE THREE SHAPES THAT USED TO PASS, RE-RUN ON EVERY INVOCATION TOO.
//
// Each of these classified as a NON-DEFECT and exited 0 before 2026-08-26, over
// a tree that was otherwise the real corpus. They are canaries and not tests for
// the same reason CANARY_DEFECT is: the coverage they represent is invisible in
// a passing run, so it has to be re-proven in front of the reader every time
// rather than in a suite somebody may not have run.
//
// ⚠️ NOTE WHAT CANARY_IMPORTED ASSERTS IN BOTH DIRECTIONS. It is flagged WITH the
// corpus poller union and NOT flagged without it, so the union is proven to be
// the thing doing the work — a canary that only ever asserts the red half can be
// satisfied by a classifier that flags everything.
// ─────────────────────────────────────────────────────────────────────────────
const CANARY_INDIRECT = `
  testWidgets('x', (WidgetTester tester) async {
    final bool shown = find.byType(Dialog).evaluate().isNotEmpty;
    if (shown) {
      await tester.tap(find.text('No thanks'));
    }
    final consentGate = find.byType(AlertDialog);
    if (consentGate.evaluate().isNotEmpty) {
      await tester.pump();
    }
    final bool bannerUp = find.byType(MaterialBanner).evaluate().isNotEmpty;
    expect(bannerUp, true);
  });
`;
const CANARY_IMPORTED = `
  testWidgets('x', (WidgetTester tester) async {
    if (await settleUntilSeen(tester, find.byType(Dialog))) {
      await tester.tap(find.text('No thanks'));
    }
  });
`;
{
  const indirect = classify(CANARY_INDIRECT);
  const flagged = indirect.sites.filter((s) => s.verdict === 'detector' || s.verdict === 'dismissal');
  const want = ['Dialog', 'AlertDialog'];
  if (flagged.length !== want.length || flagged.some((f, i) => f.type !== want[i] || f.call !== 'if')) {
    coverageLost([
      'THE INDIRECT SHAPES ARE NO LONGER DETECTED. A gate finder bound to a local — `final bool shown =',
      '…isNotEmpty` and `final consentGate = find.byType(…)` — and then branched on, classified as',
      `${flagged.length ? flagged.map((f) => `${f.type} ${f.verdict} via ${f.call}`).join(', ') : 'NOTHING AT ALL'}.`,
      'Both exited 0 as `bare` before 2026-08-26; ALIAS_BIND_RE is what closed them. Fix the classifier.',
    ]);
  }
  if (indirect.sites.length !== 3) {
    coverageLost([
      `the alias limb is counting again: 3 \`find.byType(\` occurrences in CANARY_INDIRECT produced ${indirect.sites.length} site(s).`,
      'It must UPGRADE the site the main loop already pushed, never add a second one — a printed count',
      'inflated by the number of aliases is this file\u2019s own subject matter.',
    ]);
  }
  const banner = indirect.sites.filter((s) => s.type === 'MaterialBanner');
  if (banner.length !== 1 || banner[0].verdict === 'detector') {
    coverageLost([
      'the honest twin of the shape above is now flagged: `final bool shown =',
      'find.byType(MaterialBanner)…isNotEmpty; expect(shown, …)` is chassis_properties_test.dart:2898,',
      `and it classified as ${banner.length ? banner[0].verdict : 'NOTHING AT ALL'}. A banner does not cover the app and an`,
      '`expect` is not a branch. Narrow the alias limb rather than exempting the tree.',
    ]);
  }

  const alone = classify(CANARY_IMPORTED);
  if (alone.sites.some((s) => s.verdict === 'detector')) {
    coverageLost([
      'CANARY_IMPORTED is flagged with NO poller union supplied, so the union below proves nothing.',
      '`settleUntilSeen` is declared nowhere in that source; if it reads as a poller anyway, the',
      'signature derivation has stopped deriving and is matching on shape or on name.',
    ]);
  }
  const united = classify(CANARY_IMPORTED, new Set(['settleUntilSeen']));
  const seen = united.sites.filter((s) => s.verdict === 'detector');
  if (seen.length !== 1 || seen[0].type !== 'Dialog' || seen[0].call !== 'settleUntilSeen') {
    coverageLost([
      'THE IMPORTED POLL HELPER IS INVISIBLE AGAIN. A suite that imports its poller rather than',
      'declaring it — the shape the shared `answerFirstRunConsent` helper creates on the day it lands —',
      `classified as ${seen.length ? seen.map((f) => `${f.verdict} via ${f.call}`).join(', ') : 'NOTHING AT ALL'}.`,
      'Measured before the union: `inspection`, "0 detector", exit 0, over the verbatim outage line.',
    ]);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// THE SCAN
// ─────────────────────────────────────────────────────────────────────────────
const tally = { detector: 0, dismissal: 0, assertion: 0, inspection: 0, state: 0, bare: 0 };
const types = new Set();
let occurrences = 0;
let pollerFiles = 0;
const exemptions = [];
const staleExemptions = [];

/* ── PASS ONE: EVERY POLL HELPER THE CORPUS DECLARES, ANYWHERE ──────────────
 * Read before a single verdict is taken, because a suite that IMPORTS its
 * poller declares nothing itself and limb A would read the outage line as an
 * ordinary inspection. See the `importedPollers` note in classify() for the
 * measurement and for the limit this union does NOT close. */
const sources = new Map(files.map((rel) => [rel, readFileSync(join(ROOT, rel), 'utf8')]));
const corpusPollers = new Set();
for (const raw of sources.values()) for (const p of declaredPollers(reduce(raw))) corpusPollers.add(p);

// ── PASS TWO: the verdicts ──────────────────────────────────────────────────
for (const rel of files) {
  const raw = sources.get(rel);
  const rawLines = raw.split('\n');
  const { sites, pollers, unreadable } = classify(raw, corpusPollers);
  if (pollers.length) pollerFiles += 1;
  if (unreadable.length) {
    coverageLost([
      `${rel} carries ${unreadable.length} \`find.byType(\` whose argument this scan could not read to a`,
      `closing parenthesis (line(s) ${unreadable.join(', ')}).`,
      'An unreadable site is skipped by construction, which is how a scan quietly stops covering a file.',
    ]);
  }
  occurrences += sites.length;
  for (const s of sites) {
    tally[s.verdict] += 1;
    types.add(s.type);
  }

  // The exemption route. A marker is read from the RAW source — the reduction
  // blanks comments, and the reason is prose — on the site's own line or the
  // line above it.
  const markerAt = (line) => {
    for (const n of [line, line - 1]) {
      const text = rawLines[n - 1];
      if (text === undefined) continue;
      const m = text.match(EXEMPT_RE);
      if (m) return { line: n, reason: m[1].trim() };
    }
    return null;
  };

  const flagged = sites.filter((s) => s.verdict === 'detector' || s.verdict === 'dismissal');
  /** Markers that landed on a flagged site — whether or not the REASON passed.
   *  Kept apart from acceptance on purpose: a marker rejected for a thin reason
   *  is a bad exemption, not a stale one, and reporting it as both told the
   *  reader to delete the line when the fix is to finish the sentence. */
  const matchedLines = new Set();
  for (const s of flagged) {
    const mark = markerAt(s.line);
    if (mark) matchedLines.add(mark.line);
    if (!mark) {
      problems.push(
        `${rel}:${s.line} — \`find.byType(${s.type})\` is the ${
          s.verdict === 'detector' ? 'DETECTOR of a' : 'target of a'
        } \`${s.call}\`${s.viaAlias ? ` (via the local \`${s.viaAlias}\`)` : ''}. ${
          s.verdict === 'detector'
            ? 'A first-run gate must be found by a CONTROL that survives it being restyled or re-parented — ' +
              "find.text('No thanks'), a Key, an icon — never by what kind of widget it is."
            : 'Dismiss an overlay through the control that dismisses it, not through its chassis type.'
        }`,
      );
      continue;
    }
    if (mark.reason.length < MIN_REASON) {
      problems.push(
        `${rel}:${mark.line} — the modal-detection exemption gives ${mark.reason.length} character(s) of reason ` +
          `("${mark.reason}"), and ${MIN_REASON} is the floor. An exemption is a claim somebody has to be able to ` +
          'read and disagree with; a marker with nothing after it is a switch, not a reason.',
      );
      continue;
    }
    exemptions.push(`${rel}:${s.line} ${s.type} via ${s.call} — ${mark.reason}`);
  }

  // 🔴 A WAIVER THAT MATCHES NOTHING IS AN EXEMPTION OVER NOTHING, and it is a
  // live re-entry permit: leave it behind and the next `find.byType` written on
  // that line is waived on sight without a single person deciding to.
  // assert-no-seam-forks.mjs learned this from the first stale entry this corpus
  // produced. Cheap to enforce here because the marker sits on the line.
  for (let i = 0; i < rawLines.length; i += 1) {
    if (!EXEMPT_RE.test(rawLines[i])) continue;
    if (!matchedLines.has(i + 1)) {
      staleExemptions.push(
        `${rel}:${i + 1} — a modal-detection exemption that excuses nothing: no site on this line or the ` +
          'next is flagged by this guard. Delete it.',
      );
    }
  }
}

// ── COVERAGE SELF-CHECKS ────────────────────────────────────────────────────
// Every one of these is a way this scan can read the whole tree and see nothing,
// which prints identically to a clean tree.
if (!occurrences) {
  coverageLost([
    `${files.length} suite file(s) were read and NOT ONE \`find.byType(\` was found in any of them.`,
    'Measured 2026-08-26 over both roots: the corpus carried 329. Either every suite stopped using it',
    'on the same day, or the matcher — or the comment/literal reduction it runs on — has stopped',
    'matching. (283 stood here and matched nothing on record: not the 329 this scan counts, not the 273',
    'a first grep over apps/subly alone produced, not the 330 the double-counting alias limb printed',
    'before 2026-08-26. A number in an operator-facing line is checked or it is deleted.)',
  ]);
}
if (!tally.assertion && !tally.inspection) {
  coverageLost([
    `${occurrences} \`find.byType(\` site(s) were found and the classifier called NOT ONE of them an`,
    'assertion or an inspection. Those are the overwhelming majority of every honest suite, so a run',
    'without them means `enclosingCall` has stopped resolving sites and every verdict below is noise.',
  ]);
}

// ─────────────────────────────────────────────────────────────────────────────
// THE VERDICT
// ─────────────────────────────────────────────────────────────────────────────
if (staleExemptions.length) problems.push(...staleExemptions);

for (const n of notes) console.log(n);
console.log(
  `note ${occurrences} \`find.byType(\` site(s) across ${files.length} suite file(s) in ${roots.length} root(s), ` +
    `${types.size} distinct widget type(s): ${tally.assertion} assertion, ${tally.inspection} inspection, ` +
    `${tally.state} screen-state, ${tally.bare} bare, ${tally.detector} detector, ${tally.dismissal} dismissal. ` +
    `${pollerFiles} file(s) declare a poll helper this scan derived from its signature.`,
);
if (exemptions.length) {
  console.log(`note ${exemptions.length} site(s) carry a written modal-detection exemption:`);
  for (const e of exemptions) console.log(`       ${e}`);
}

if (problems.length) {
  const lines = [`✗ ${problems.length} suite site(s) detect a modal by WIDGET TYPE where a CONTROL is required:`];
  for (const p of problems) lines.push(`    ${p}`);
  lines.push('');
  lines.push('  The DPDP consent prompt broke a suite on 2026-07-27, 2026-08-08 and 2026-08-26 — three times,');
  lines.push('  byte-identical symptom (`Found 0 widgets with text "Welcome back"`), three times because a');
  lines.push('  suite asked WHAT THE MODAL IS. It was a `showDialog` route, then an inline `Positioned.fill`');
  lines.push('  scrim in `MaterialApp.builder`; the answer control — "No thanks" — was the same throughout.');
  lines.push('');
  lines.push('  Key on the control: `find.text(…)`, `find.byKey(…)`, `find.byIcon(…)`. See the corrected');
  lines.push('  helpers in apps/subly/integration_test/app_test.dart (`answerConsentIfPrompted`) and the');
  lines.push('  device-free reproduction in apps/subly/test/first_run_destination_test.dart.');
  lines.push('');
  lines.push('  ONLY the sites listed above can be exempted, and they are the only ones this guard ever');
  lines.push('  flags: a gate type DETECTED at a poll or a branch, or TAPPED. An assertion');
  lines.push('  (`expect(find.byType(Dialog), findsNothing)`) and an inspection (`tester.widget<T>(…)`,');
  lines.push('  `getSize(…)`) are already legal and need NO marker — writing one over an assertion is a');
  lines.push('  waiver that excuses nothing, and the stale-exemption limb FAILS THE BUILD on it.');
  lines.push('  (Measured 2026-08-26: the advice that stood here named "a suite ASSERTING a dialog" as the');
  lines.push('  example to exempt. Following it literally, over the assertion in');
  lines.push('  first_run_destination_test.dart:183, turned a green tree RED on the stale-exemption limb.');
  lines.push('  The one example the advice named was the one case the advice was wrong for.)');
  lines.push('');
  lines.push('  For a flagged site that is genuinely right, write `// modal-detection: allow — <reason>`');
  lines.push(`  on it or the line above, with at least ${MIN_REASON} characters saying why.`);
  fail(lines);
}

console.log(
  `\nok   modal detection — ${occurrences} \`find.byType(\` site(s) in ${files.length} suite file(s) and none of ` +
    'them is the detector of a first-run gate or the target of a dismissal tap',
);
console.log(`${NAME}: ok`);
