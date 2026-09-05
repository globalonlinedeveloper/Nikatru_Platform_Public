#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// assert-deletion-control.mjs — AN APP WITH ACCOUNTS SHIPS A DELETION CONTROL,
// AND THE CONFIRMATION IN FRONT OF IT KEEPS ITS PROPERTIES WHEREVER IT LIVES.
//
// [ADR 027] Both stores require an in-app path to account deletion wherever an
// account can be created at all. It cannot be left to a support email, and it
// cannot be left to the next app.
//
// [ADR 065] moved the confirmation itself into the shared chassis, so the
// properties in front of the control are now asserted where they LIVE as well as
// where they are called from. The server hook that makes any of it real is
// [pipeline C-15]: the brick shipped `requestServerDeletion: null` until then —
// every other limb passing against a flow that can only ever refuse — and limb 5
// below still refuses that shape.
//
// 🔴 THE THREE CITATIONS ABOVE ARE LOAD-BEARING AND MUST STAY IN THE FIRST 60
// LINES. `build-enforcement-index.mjs` reads citations from that window only, so
// a citation pushed past it leaves the machine-readable claim map SILENTLY —
// the guard still says the true thing and the index stops recording that it
// does. Measured on 2026-09-05: this header grew, C-15 slid from line 47 to line
// 89, and the regenerated index dropped it from this row without a word.
//
// ── THE HOLE THIS EXISTS FOR, AND WHY NOTHING ELSE COVERED IT ────────────────
// `assert-stamp-properties.mjs` already enforces `account-deletion-works` — for
// THE BRICK AND EVERY STAMPED APP. Its domain carries `EXEMPT_APPS =
// {'apps/subly'}`, correctly: Subly predates the brick, was never stamped, and
// has no inherited property test to keep. The consequence went unnoticed for
// months — THE ONLY APP IN THE FIELD was the one app no deletion guard reached.
// It shipped with `deleteAccount()` an unconditional throw and no control at
// all, and `sites/nikatru/delete-account.html` had to scope its own sentence
// ("where an app shows a Delete account control") around that absence.
//
// So this guard asks the STORE'S question instead of the chassis's, over a
// domain with NO exemptions: not "did this app keep its inherited property
// test", which only a stamped app can answer, but "can a user of this app
// delete their account from inside it". Subly answers that today; so does the
// brick; so will app #2, whether or not it was stamped.
//
// ── AND THE SECOND HOLE, WHICH [ADR 065] CHASSIS STEP 2 OPENED ──────────────
// Every limb below used to read ONE tree per app root — `lib/features/settings`.
// That was the whole subject while every app hand-rolled its own confirmation.
// Chassis step 2 moved the confirmation itself into
// `packages/design_system/lib/src/widgets/destructive_confirm_dialog.dart`: the
// secret-gated confirm button, the `PopScope` that refuses to close mid-flight,
// and the second "what actually happened" phase all live there now, and
// `packages/` was in NO deletion guard's domain.
//
// MEASURED on 2026-09-05, against main 4ab17a24, before this change:
//   · gut the shared widget's secret gate (`onPressed: ready ? _run : null` →
//     `onPressed: _run`, dropping the `value.text.isNotEmpty` read) — one stray
//     tap then sends an empty password at the re-authentication, on the one
//     screen where a misfire destroys an account — and this guard printed
//     `ok  deletion control — 2 of 2 root(s) offer accounts …` and exited 0.
//   · flip its `PopScope(canPop: !_busy)` to `canPop: true` — a stray Escape or
//     back gesture then looks exactly like a cancelled deletion while the
//     request carries on — and this guard exited 0.
//   · DELETE THE WIDGET FILE OUTRIGHT and this guard exited 0.
// The brick's settings tree still calls `showDialog` itself, so limb 3 stayed
// green over a confirmation that no longer had any of the properties limb 3
// stands for. Coverage of a screen is not coverage of its rules.
//
// It is about to widen, not narrow: chassis step 4 deletes `apps/subly`'s own
// hand-rolled copy (`settings_screen.dart:1591+` today) and points it at the
// same shared widget. An app that keeps a `showDialog` and delegates every
// property to a tree nobody guards is the dead-seam shape this file's own
// limb 1 was written about.
//
// ── WHAT IS CHECKED, AND WHY EACH LIMB CAN FAIL ─────────────────────────────
// A. THE STORE'S QUESTION, ANCHORED TO THE APP ROOTS. For every root whose code
//    HAS ACCOUNTS (derived — see below):
//
//   1. A CALL SITE, not a declaration. `.deleteAccount(` with the leading dot,
//      in comment-stripped source. `assert-seams-wired.mjs` shipped with its
//      caller check matching the function's own DECLARATION, so deleting every
//      real caller still passed and all six of its fixture tests were green.
//      A declaration reads `Future<void> deleteAccount() async`; a call reads
//      `auth.deleteAccount()`.
//   2. IN SETTINGS. Both stores' reviewers look in the app's settings; a call
//      site buried in a service nothing renders is the dead-seam shape again.
//   3. BEHIND THE DELETION'S OWN CONFIRMATION, NOT MERELY BEHIND *A* DIALOG.
//      🔴 A BARE `showDialog` SUBSTRING OVER THE SETTINGS TREE IS NOT THIS
//      CHECK, AND IT USED TO BE. The brick's settings screen opens a
//      reminder-priming dialog at `:434` and an edit-profile dialog at `:530`;
//      either satisfies `settings.includes('showDialog')` on its own, so the
//      deletion confirmation could be deleted entirely and this limb stayed
//      green. So the check now takes each `showDialog(` call's OWN balanced
//      argument list and requires ONE of them to both set
//      `barrierDismissible: false` and name the deletion. MEASURED 2026-09-05:
//      `barrierDismissible` occurs EXACTLY ONCE in each settings tree — brick
//      `:595`, `apps/subly` `:1186` — and both times inside the delete flow's
//      own `showDialog`. Neither of the other two dialogs sets it.
//   4. AND IT MUST RE-AUTHENTICATE. Deletion is irreversible, so a borrowed or
//      unattended device must not be enough to destroy an account.
//   5. AND IT MUST NOT COLLAPSE THE OUTCOMES. `DELETE /v1/account` answers 501
//      (nothing was deleted) and 502 (the rows are gone and the login still
//      works). A `catch (_)` printing one message tells a user whose data is
//      already destroyed that nothing happened — the one failure they cannot
//      discover for themselves. The failure path must reach
//      `accountDeletionOutcomeOf`, which is the chassis's classifier.
//   6. THE SERVER HOOK IS NOT NULLED. `requestServerDeletion: null` makes every
//      limb above pass against a flow that can only ever refuse. That is not
//      hypothetical: it is exactly what the brick shipped until [pipeline C-15].
//
// B. THE CONFIRMATION'S BEHAVIOUR, ASSERTED WHERE IT ACTUALLY LIVES.
//    [CONFIRMATION_PROPERTIES] below is ONE list, applied to ONE tree per root,
//    and which tree that is follows the behaviour rather than the file layout:
//
//      · a root whose settings tree CONSTRUCTS `DestructiveConfirmDialog(`
//        has delegated the behaviour to the chassis, and the chassis subject
//        below carries it. Asserting the properties over that root's own
//        settings tree would be asserting them over a tree that legitimately no
//        longer contains them — a guard that goes red for being right.
//      · a root that still carries its OWN confirmation must satisfy every
//        property in its own settings tree.
//
//    WHICH BRANCH EACH ROOT TOOK IS PRINTED on every run, pass or fail, so
//    chassis step 4 flipping `apps/subly` from one to the other is visible in
//    the log rather than inferred. Today: the brick delegates, `apps/subly`
//    does not.
//
//    🔴 AND THE CHASSIS SUBJECT IS CHECKED UNCONDITIONALLY, not only when some
//    root delegates to it. If it were gated on usage, the one state that
//    matters most — the widget rotting while `apps/subly` still has its own
//    copy, so step 4 migrates onto rotten foundations — would be the state
//    nothing checked. Its absence, its emptiness and its falling below its own
//    line floor are all COVERAGE LOST, never a quiet pass.
//
//    ⚠️ AND NO PROPERTY HERE NAMES A DOMAIN TYPE. `packages/design_system` may
//    not depend on anything called `nikatru_*` (`assert-package-boundaries.mjs
//    :154-158`), which is why that widget takes plain values and callbacks. A
//    check that looked for `AccountDeletionOutcome` in it could only ever pass
//    if that boundary had been broken, so every anchor below is a Flutter or
//    Dart shape (`PopScope`, `onPressed`, `onConfirm`) instead.
//
// ── THE MUTATION TABLE (2026-09-05, full checkout, every row RUN) ───────────
// Reading a guard under-reports what it covers, so nothing below was concluded
// from source. Exit codes were captured on their own line, never printed beside
// a `$(...)` substitution — TRAPS.md, the trap that has bitten four times.
//
//   mutation                                                       before → after
//   baseline, nothing touched                                         0 → 0
//   gut the shared widget's secret gate                               0 → 1
//   shared widget: keep the read, make the button unconditional       0 → 1
//   flip the shared widget's `PopScope(canPop: !_busy)` to `true`     0 → 1
//   collapse the shared widget's result phase to a fixed string       0 → 1
//   delete the shared widget file outright                            0 → 1  COVERAGE LOST
//   stub the shared widget below its line floor                       0 → 1  COVERAGE LOST
//   remove the brick's delete `showDialog`, leave the other two       0 → 1
//   drop `barrierDismissible: false` from the delete `showDialog`     0 → 1
//   flip apps/subly's own `PopScope(canPop: !_busy)` to `true`        0 → 1
//   ungate apps/subly's own confirm button                            0 → 1
//   step 4 WRONG — empty subly's copy, delegate to nothing            0 → 1
//   step 4 RIGHT — empty subly's copy AND delegate to the chassis     0 → 0
//
// The last two rows are the point of the whole design: when chassis step 4
// takes `apps/subly`'s own dialog away, enforcement MOVES WITH THE BEHAVIOUR
// instead of going quiet, and taking it away without delegating is red.
//
// 🔴 TWO OF THOSE ROWS WERE GREEN ON THE FIRST DRAFT OF THIS FILE, AND ONLY
// RUNNING THEM SAID SO. The `PopScope` limb was a negative lookahead that a
// space could backtrack past, and the secret-gate limb's second half was true
// of the CANCEL button. Both defects are recorded beside the code that replaced
// them ([SECRET_GATED_BUTTON], [hasBusyGatedPopScope]) rather than only here.
//
// ── THE DOMAIN, AND THE FILTER THAT IS NOT AN EXCUSE ────────────────────────
// App roots = the brick's app template PLUS every `apps/*` on the root
// `pubspec.yaml` `workspace:` list. A directory listing is refused for the
// reason assert-app-dod.mjs states: the brick lane stamps `apps/probe` and never
// removes it, so a listing differs between this box and CI. NO app is exempt.
//
// "Has accounts" is DERIVED from the app's own code — it programs against
// `AuthRepository` and calls `signInWithEmail(`. An app that genuinely offers no
// account owes no deletion control, and saying so from the tree rather than from
// a list is what stops the filter becoming a waiver somebody adds themselves to.
// Every root's verdict PRINTS, so an app quietly judged account-free is visible.
//
// Usage:  node tooling/ci/assert-deletion-control.mjs [repoRoot]
// Exit 0 = every account-bearing app can be deleted from inside itself, behind a
//          confirmation that still holds its properties wherever it now lives.
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { stripSourceComments } from './text-reductions.mjs';
import { listDir } from './tree-walk.mjs';

const ROOT = resolve(process.argv[2] ?? process.cwd());
const BRICK = 'tooling/bricks/app/__brick__/apps/{{app_id}}';
/** Where a store reviewer looks, and therefore where the control must be. */
const SETTINGS_DIR = 'lib/features/settings';

/**
 * The shared confirmation — the second subject, and a ROOT OF ITS OWN with its
 * own floor. [ADR 065] chassis step 2.
 *
 * 🔴 ONE FLOOR PER ROOT, NEVER A UNION FLOOR. `assert-workspace-coverage.mjs
 * :130-136` records a union floor that stayed satisfied over an emptied
 * `apps/`, and `assert-no-tls-pinning.mjs:75-93` records the same failure with
 * the measurement that proved it. So this subject is not folded into the app
 * roots' coverage: it is ONE named file, it carries its OWN presence, emptiness
 * and size checks, and none of them can be carried by a neighbouring tree.
 *
 * ⚠️ ONE FILE, NOT THE `widgets/` DIRECTORY, AND THAT IS THE POINT. Ranging
 * the properties below over `packages/design_system/lib/src/widgets` would let
 * an unrelated widget's `PopScope` satisfy a limb about the deletion
 * confirmation — the same "coverage of a screen is not coverage of its rules"
 * failure that a bare `showDialog` substring was.
 *
 * The consequence is deliberate: renaming or retiring this file is COVERAGE
 * LOST until somebody edits this constant. That is the cost of naming a
 * subject, and it is cheaper than the alternative, which is a guard that goes
 * quiet when the thing it guards moves house.
 */
const CHASSIS = {
  file: 'packages/design_system/lib/src/widgets/destructive_confirm_dialog.dart',
  /**
   * MEASURED 2026-09-05: 152 non-blank comment-stripped lines. The floor sits
   * well under that so ordinary editing never trips it, and well over a stub so
   * emptying the file is COVERAGE LOST rather than three limb failures — the
   * scan being broken and the behaviour being wrong are different reports.
   */
  floor: 90,
  label: 'the shared destructive confirmation every stamped app now renders',
};

/**
 * The floor above is a measurement of THIS repository and means nothing over a
 * synthetic root. It is applied only when ROOT is a full checkout, detected by
 * this guard's OWN file being present under it — a sentinel that sits outside
 * every subject tree (the brick, `apps/*`, `packages/design_system`) and
 * therefore survives any mutation OF a subject, which a sentinel inside one of
 * them would not. Which branch was taken is PRINTED on every run.
 */
const IS_FULL_CHECKOUT = existsSync(join(ROOT, 'tooling', 'ci', 'assert-deletion-control.mjs'));

/**
 * THE CONFIRM BUTTON'S `onPressed` READS THE TYPED SECRET AND CAN RESOLVE TO
 * `null`, IN ONE EXPRESSION — the two halves within sight of each other, in
 * either order, because the two trees that satisfy it today write it both ways:
 *
 *   the shared widget declares the gate first  `final bool ready = !_busy && value.text.isNotEmpty;`
 *                          and uses it after   `onPressed: ready ? _run : null,`
 *   apps/subly writes it inline                `onPressed: (_busy || widget.password.text.isEmpty) ? null : _run,`
 *
 * 🔴 IT IS ONE REGEX AND NOT TWO INDEPENDENT ONES, AND THAT WAS MEASURED. The
 * first draft asked separately for `.text.isEmpty` anywhere and for an
 * `onPressed:` that could be `null` anywhere. The CANCEL button is
 * `onPressed: _busy ? null : …` in both trees, so the second half was true of
 * every version of these files including one with no gate at all — a limb that
 * cannot fail is not a limb.
 */
const SECRET_GATED_BUTTON = new RegExp(
  '\\.text\\.is(?:Not)?Empty\\b[\\s\\S]{0,400}?onPressed:[^,\\n]{0,200}\\bnull\\b' +
    '|onPressed:[^;\\n]{0,200}\\.text\\.is(?:Not)?Empty\\b[^;\\n]{0,200}\\bnull\\b',
);

/**
 * A `PopScope` whose `canPop` is NOT the literal `true`.
 *
 * 🔴 A NEGATIVE LOOKAHEAD IS NOT ENOUGH HERE, AND THAT WAS MEASURED TOO.
 * `/PopScope\(\s*canPop:\s*(?!true\b)/` looks right and matches
 * `PopScope(canPop: true, …)`: `\s*` backtracks to zero characters, the
 * lookahead is then applied at the SPACE before `true`, and a space is not
 * `true`. Flipping the shared widget's `canPop: !_busy` to `canPop: true` left
 * this guard exiting 0. So the value is CAPTURED and compared instead — a
 * comparison cannot backtrack.
 */
const POP_SCOPE_VALUE = /PopScope\(\s*canPop:\s*([^,)]+)/g;
const hasBusyGatedPopScope = (src) => {
  POP_SCOPE_VALUE.lastIndex = 0;
  let m;
  while ((m = POP_SCOPE_VALUE.exec(src)) !== null) {
    if (m[1].trim() !== 'true') return true;
  }
  return false;
};

/**
 * WHAT A CONFIRMATION IN FRONT OF AN IRREVERSIBLE ACTION HAS TO DO. One list,
 * asserted over whichever tree OWNS the confirmation for a given root — see
 * section B of the header. Each entry carries the sentence that has to be true
 * for it to be a real finding, because a message that only says "missing"
 * teaches the reader nothing about why the build is red.
 *
 * Every anchor is a shape a bug cannot rename away: `PopScope`/`canPop`,
 * `onPressed`, `onConfirm` and `.text.isEmpty` are Flutter and Dart spellings,
 * not local identifiers. `onConfirm` in particular is already pinned across
 * this repo by `assert-stamp-properties.mjs:1042`, which anchors the literal
 * closure `onConfirm: () => _deleteAccount(` — verified at that line, not
 * quoted from the comment in the widget that cites it.
 *
 * ⚠️ AND NOT ONE OF THEM NAMES A DOMAIN TYPE, because the tree that has to
 * satisfy them may be `packages/design_system`, which
 * `assert-package-boundaries.mjs:154-158` forbids from depending on anything
 * called `nikatru_*`. A limb looking for `AccountDeletionOutcome` in there
 * could only ever pass if that boundary had been broken.
 */
const CONFIRMATION_PROPERTIES = [
  {
    id: 'secret-gate',
    what: 'the destructive button is INERT until the secret is typed',
    all: [SECRET_GATED_BUTTON],
    why:
      'Measured in the brick at `settings_screen.dart:776` on 2026-09-04, before the widget moved: the ' +
      'confirm button was live with nothing typed, so one stray tap sent an empty password at the ' +
      're-authentication — a call that can only fail, on the one screen where a misfire destroys an ' +
      'account. The button must read the typed secret and be able to resolve to `null`.',
  },
  {
    id: 'no-dismiss-in-flight',
    what: 'NOTHING may dismiss it while the request is in flight',
    test: hasBusyGatedPopScope,
    why:
      'A stray Escape, a back gesture or a swipe looks exactly like a cancelled deletion to the person ' +
      'doing it, while the request carries on. `barrierDismissible: false` covers the barrier and nothing ' +
      'else; a `PopScope` whose `canPop` is gated on the busy state covers the routes a barrier flag ' +
      'cannot reach. A `PopScope(canPop: true)` alone — the result phase, correctly — is not this.',
  },
  {
    id: 'honest-result',
    what: 'the result phase says WHAT ACTUALLY HAPPENED, in the outcome\'s own words',
    all: [/=\s*await\s+widget\.onConfirm\(\)/, /Text\(\s*[\w.]+\.\w*[Mm]essage\b/],
    why:
      'The confirm callback\'s answer must be CAPTURED and RENDERED. A dialog that discards it and prints ' +
      'one fixed sentence tells a user whose data is already gone (502) the same thing it tells a user ' +
      'whose request was refused before it touched anything (501) — the one failure they cannot detect ' +
      'for themselves, and the defect the whole two-phase design exists for.',
  },
];

/** A root's settings tree has handed the behaviour to the chassis. */
const DELEGATES = /\bDestructiveConfirmDialog\s*\(/;

const problems = [];
const notes = [];

/** Structural failure — the scan itself is broken, so nothing below it means
 *  anything. Exits immediately rather than joining the problem list. */
const coverageLost = (lines) => {
  console.error(`✗ COVERAGE LOST — ${lines[0]}`);
  for (const l of lines.slice(1)) console.error(`  ${l}`);
  process.exit(1);
};

/** Every .dart file under `dir`, comment-stripped and concatenated. */
// ─────────────────────────────────────────────────────────────────────────────
// DELEGATION — THE DELETION CONTROL FOLLOWS THE SCREEN INTO THE CHASSIS PACKAGE
// (ADR 067 decision 2; the same resolver assert-a11y-coverage.mjs carries)
//
// [ADR 066] step 4 empties a brick screen into `package:nikatru_chassis_screens`
// and leaves an ADAPTER at the same path: same file, same route, same class
// name, and none of the body. The `.deleteAccount(` call site, the confirmation dialog and the re-authentication all move with the body, out of `lib/features/settings/` and into the package — and read at the adapter alone this guard reports that a shipping app has NO in-app deletion control, which is a store rejection claim about a tree that is perfectly compliant.
//
// So the scan below reads the adapter AND the chassis file it delegates to.
// This only ever ADDS text: a call site that was found is still found, and one
// that is genuinely absent is still absent. Nothing is removed from any domain
// and no floor is lowered.
//
// ONE LEVEL, ONE IMPORT, EVERY REFUSAL LOUD. Two different chassis imports in
// one adapter is ambiguous and refused; a target that is not on disk is
// COVERAGE LOST. A delegation this resolver cannot follow must never read as
// "no delegation" — that is the silent-pass shape.
// ─────────────────────────────────────────────────────────────────────────────
const CHASSIS_PKG = 'nikatru_chassis_screens';
const CHASSIS_DIR = 'packages/chassis_screens';
const CHASSIS_IMPORT = new RegExp(`import\\s+'package:${CHASSIS_PKG}/([^']+\\.dart)'`, 'g');

/** The chassis file(s) an absolute path delegates to, resolved ONE level, as
 *  paths relative to the REPOSITORY root.
 *  `null` = no delegation · `{ lost }` = a delegation that could not be followed
 *  · `{ files }`. `null` and `{ lost }` stay different answers on purpose. */
function delegationOf(absFile, repoRoot) {
  if (!existsSync(absFile)) return null;
  CHASSIS_IMPORT.lastIndex = 0;
  const src = readFileSync(absFile, 'utf8');
  const paths = [...new Set([...src.matchAll(CHASSIS_IMPORT)].map((m) => m[1]))];
  if (paths.length === 0) return null;
  if (paths.length > 1) {
    return {
      lost: `imports ${paths.length} different \`package:${CHASSIS_PKG}\` paths (${paths.join(', ')}), so the file that now carries the behaviour cannot be identified`,
    };
  }
  const target = `${CHASSIS_DIR}/lib/${paths[0]}`;
  if (!existsSync(join(repoRoot, target))) {
    return { lost: `delegates to \`package:${CHASSIS_PKG}/${paths[0]}\`, which resolves to \`${target}\` and that file is not on disk` };
  }
  const out = [target];
  for (const m of readFileSync(join(repoRoot, target), 'utf8').matchAll(/export\s+'([^':]+\.dart)'/g)) {
    const t = `${CHASSIS_DIR}/lib/${m[1]}`;
    if (existsSync(join(repoRoot, t))) out.push(t);
  }
  return { files: out };
}

/** Every chassis file the .dart tree under `absDir` delegates to.
 *  `{ files, lost }` — `lost` is a list of refusals the caller must report. */
function chassisDelegationsUnder(absDir, repoRoot) {
  const files = [];
  const lost = [];
  const walk = (d) => {
    if (!existsSync(d)) return;
    for (const e of listDir(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith('.dart')) {
        const dg = delegationOf(p, repoRoot);
        if (dg && dg.lost) {
          lost.push(`${p} — ${dg.lost}`);
        } else {
          for (const f of (dg && dg.files) || []) if (!files.includes(f)) files.push(f);
        }
      }
    }
  };
  walk(absDir);
  return { files, lost };
}

const readDartTree = (dir) => {
  const out = [];
  const walk = (d) => {
    if (!existsSync(d)) return;
    for (const e of listDir(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith('.dart')) {
        out.push(stripSourceComments(readFileSync(p, 'utf8'), '.dart'));
      }
    }
  };
  walk(dir);
  return out.join('\n');
};

/**
 * The OWN argument list of every `showDialog(` call in `src`, balanced.
 *
 * 🔴 THE WINDOW IS THE WHOLE POINT. `src.includes('showDialog')` is true of a
 * settings screen whose only dialogs are a reminder prompt and an edit-profile
 * sheet, which is how the deletion confirmation could be deleted outright with
 * this guard still green. Reading one call's arguments — and only that call's —
 * is what lets limb 3 ask about THE DELETION'S dialog rather than about the
 * screen's dialogs.
 *
 * Quotes are skipped so a parenthesis inside a string literal cannot unbalance
 * the scan. If the scan ever does run away, the window it returns is wrong and
 * the limb goes RED, which is the direction a broken scan should fail in.
 */
const showDialogArgs = (src) => {
  const out = [];
  const re = /\bshowDialog\s*(?:<[^>]*>)?\s*\(/g;
  let m;
  while ((m = re.exec(src)) !== null) {
    const from = m.index + m[0].length;
    let depth = 1;
    let quote = null;
    let i = from;
    for (; i < src.length && depth > 0; i++) {
      const c = src[i];
      if (quote !== null) {
        if (c === '\\') i++;
        else if (c === quote) quote = null;
        continue;
      }
      if (c === "'" || c === '"') quote = c;
      else if (c === '(' || c === '[' || c === '{') depth++;
      else if (c === ')' || c === ']' || c === '}') depth--;
    }
    out.push(src.slice(from, i - 1));
  }
  return out;
};

/** Which of [CONFIRMATION_PROPERTIES] `src` does NOT satisfy. */
const missingProperties = (src) =>
  CONFIRMATION_PROPERTIES.filter((p) =>
    p.test ? !p.test(src) : !p.all.every((re) => re.test(src)),
  );

// ── the app roots ───────────────────────────────────────────────────────────
const roots = [];
if (existsSync(join(ROOT, BRICK))) roots.push(BRICK);
let workspaceRead = false;
try {
  const lines = readFileSync(join(ROOT, 'pubspec.yaml'), 'utf8')
    .replace(/^\s*#.*$/gm, '')
    .split('\n');
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
    'the root pubspec.yaml has no readable `workspace:` block.',
    'The set of apps this guard ranges over would then be the brick alone — and the brick was never the',
    'problem. The app that shipped with no deletion control is the one that lives under apps/.',
  ]);
}
// The brick plus at least one real app. Below that the domain has collapsed to
// the template, which is the exact blind spot that let the only shipping app go
// unchecked — and an empty-domain scan prints ok, this repo's most repeated
// failure.
if (roots.length < 2) {
  coverageLost([
    `only ${roots.length} root(s) resolved (${roots.join(', ') || 'none'}).`,
    'Expected the brick app template AND at least one apps/* workspace member. A guard over the template',
    'alone re-creates the hole it was written to close.',
  ]);
}

// ── the chassis root, and its own floor ─────────────────────────────────────
// Read BEFORE the app roots, because the app-root branch below reports which
// roots lean on it and that sentence is only worth printing once this subject
// is known to be real.
const chassisPath = join(ROOT, CHASSIS.file);
if (!existsSync(chassisPath)) {
  coverageLost([
    `${CHASSIS.file} is not a file under ${ROOT} — ${CHASSIS.label}.`,
    'Chassis step 2 moved the secret gate, the in-flight dismissal lock and the "what actually happened"',
    'phase out of every app settings screen and into that one widget. With the file gone this guard would',
    'range over app trees that legitimately no longer contain any of it, and print ok over a confirmation',
    'nothing checked. If the widget was renamed or retired, this guard\'s CHASSIS constant is the edit.',
  ]);
}
const chassisSrc = stripSourceComments(readFileSync(chassisPath, 'utf8'), '.dart');
const chassisLines = chassisSrc.split('\n').filter((l) => l.trim().length > 0).length;
if (chassisLines === 0) {
  coverageLost([
    `${CHASSIS.file} contains no source at all once comments are stripped.`,
    'Every property below is a predicate over that text, and a predicate over an empty string answers the',
    'same way for a widget that was never written and one whose behaviour was deleted.',
  ]);
}
if (IS_FULL_CHECKOUT && chassisLines < CHASSIS.floor) {
  coverageLost([
    `${CHASSIS.file} yielded only ${chassisLines} non-blank source line(s), below its floor of ${CHASSIS.floor}.`,
    `${CHASSIS.label} was 152 lines when this floor was measured (2026-09-05). A file this far below it is a`,
    'stub, and a stub failing three property limbs reads as three behavioural regressions when the truth is',
    'that the subject is gone. One floor for this root alone: it can never be carried by a neighbouring tree.',
  ]);
}
const chassisMissing = missingProperties(chassisSrc);
for (const p of chassisMissing) {
  problems.push(
    `${CHASSIS.file}: the shared confirmation no longer guarantees that ${p.what}. ${p.why} ` +
      '[ADR 065] moved this behaviour here out of every app settings screen, so it is asserted here — ' +
      'gutting it used to leave every limb of this guard green.',
  );
}

// ── the app roots ───────────────────────────────────────────────────────────
let withAccounts = 0;
const branches = [];

for (const root of roots) {
  const lib = join(ROOT, root, 'lib');
  const src = readDartTree(lib);
  if (src.trim().length === 0) {
    coverageLost([
      `no Dart source was read under ${root}/lib.`,
      'Every limb below reads that tree, and a predicate over an empty string answers "no accounts here"',
      'for reasons that have nothing to do with the app. A scan over nothing prints ok.',
    ]);
  }

  // DERIVED, never declared: the app programs against the auth seam AND has a
  // way in. Both limbs, because a file that merely mentions the type could be a
  // leftover import, while `signInWithEmail(` is the door an account comes
  // through.
  const hasAuthSeam = /\bAuthRepository\b/.test(src);
  const hasSignIn = src.includes('signInWithEmail(');
  if (!hasAuthSeam || !hasSignIn) {
    notes.push(
      `⬜ ${root} — no account surface (AuthRepository: ${hasAuthSeam}, signInWithEmail: ${hasSignIn}); ` +
        'no deletion control is owed. Derived from the app\'s own code, not from a list.',
    );
    continue;
  }
  withAccounts++;

  const settingsAbs = join(ROOT, root, SETTINGS_DIR);
  const delegated = chassisDelegationsUnder(settingsAbs, ROOT);
  for (const why of delegated.lost) {
    coverageLost([
      `${root}: a settings file could not have its chassis delegation followed — ${why}.`,
      'Every limb below reads the settings tree PLUS whatever it delegates to; a delegation this scan',
      'cannot follow is a deletion control it cannot see, and an unseen control reads exactly like an',
      'absent one — in a guard whose failure mode is a store rejection.',
    ]);
  }
  let settings = readDartTree(settingsAbs);
  if (delegated.files.length) {
    settings += `\n${delegated.files
      .map((f) => stripSourceComments(readFileSync(join(ROOT, f), 'utf8'), '.dart'))
      .join('\n')}`;
    notes.push(
      `⬜ ${root}: the settings scan also read ${delegated.files.length} chassis file(s) it delegates ` +
        `to — ${delegated.files.join(', ')}`,
    );
  }
  if (settings.trim().length === 0) {
    problems.push(
      `${root} offers accounts and has NO ${SETTINGS_DIR}/. Both stores' reviewers look for the deletion ` +
        'control in settings, so an app with accounts and no settings screen has nowhere to put one.',
    );
    branches.push(`${root}=no settings tree`);
    continue;
  }

  // 1 + 2 — a CALL SITE, and it is in settings.
  if (!settings.includes('.deleteAccount(')) {
    problems.push(
      `${root}: no \`.deleteAccount(\` CALL SITE in ${SETTINGS_DIR}/. Both stores require an in-app ` +
        'deletion path wherever an account can be created. (The leading dot is the check: a declaration ' +
        'reads `Future<void> deleteAccount() async` and would match a screen that calls nothing.)',
    );
  }

  // 3 — the DELETION's own confirmation, not merely a dialog somewhere on the
  // screen. See the header: the brick's settings tree opens two other dialogs.
  const dialogs = showDialogArgs(settings);
  if (dialogs.length === 0) {
    problems.push(
      `${root}: the deletion control in ${SETTINGS_DIR}/ opens no dialog. An irreversible action one tap ` +
        'away is the misfire a confirmation step exists to stop.',
    );
  } else if (
    !dialogs.some((a) => /barrierDismissible:\s*false/.test(a) && /deleteaccount/i.test(a))
  ) {
    problems.push(
      `${root}: ${dialogs.length} \`showDialog\` call(s) in ${SETTINGS_DIR}/ and NOT ONE of them is the ` +
        'deletion\'s own undismissable confirmation — no single call both sets `barrierDismissible: false` ' +
        'and names the deletion in its own argument list. A settings screen opens several dialogs (the ' +
        'brick primes reminders at :434 and edits the profile at :530); any of them satisfies a bare ' +
        '`showDialog` substring, which is how this limb could stay green over a deletion with no ' +
        'confirmation at all. Tapping the barrier must not close the one dialog that destroys an account.',
    );
  }
  if (!settings.includes('signInWithEmail(')) {
    problems.push(
      `${root}: the deletion flow in ${SETTINGS_DIR}/ does not RE-AUTHENTICATE. Deletion is irreversible, ` +
        'so a borrowed or unattended device must not be enough to destroy an account.',
    );
  }

  // 4 — the outcomes must not collapse.
  if (!settings.includes('accountDeletionOutcomeOf(')) {
    problems.push(
      `${root}: the deletion failure path in ${SETTINGS_DIR}/ never reaches ` +
        '`accountDeletionOutcomeOf`, so every refusal shares one message. DELETE /v1/account answers 501 ' +
        '(nothing was deleted) and 502 (the data is gone and the login still works) — telling a user ' +
        'whose data is already destroyed that nothing happened is the one failure they cannot detect.',
    );
  }

  // 5 — and the server hook is not nulled out from under all of it.
  if (/requestServerDeletion:\s*null/.test(src)) {
    problems.push(
      `${root}: \`requestServerDeletion: null\` is wired. Every limb above then passes against a flow ` +
        'that can only ever refuse — the user is signed out and never deleted, which is what the brick ' +
        'shipped until [pipeline C-15].',
    );
  }

  // 6 — the confirmation's BEHAVIOUR has a home, and the branch is printed.
  if (DELEGATES.test(settings)) {
    branches.push(`${root}=delegates to the shared confirmation`);
  } else {
    branches.push(`${root}=carries its own confirmation`);
    for (const p of missingProperties(settings)) {
      problems.push(
        `${root}: its OWN confirmation in ${SETTINGS_DIR}/ does not guarantee that ${p.what}. ${p.why} ` +
          'This root does not construct `DestructiveConfirmDialog(`, so the property is owed HERE. ' +
          `Delegating to \`${CHASSIS.file}\` discharges it — that widget is checked separately, and ` +
          'that is how [ADR 065] chassis step 4 is meant to land.',
      );
    }
  }
}

// The account-bearing set cannot be empty either. If every root were judged
// account-free, all five limbs above would be skipped and this guard would
// print a clean pass over nothing at all.
if (withAccounts === 0) {
  coverageLost([
    `not one of the ${roots.length} root(s) was judged to offer accounts.`,
    'Every assertion in this guard is gated on that judgement, so a pass here would mean the scan stopped',
    'recognising an account surface — not that no app has one.',
  ]);
}

if (problems.length) {
  console.error(`✗ assert-deletion-control — ${problems.length} problem(s):`);
  for (const p of problems) console.error(`    ${p}`);
  console.error('');
  console.error('  [ADR 027] An app that lets a person create an account must let them delete it from');
  console.error('  inside the app, and must tell them what actually happened when they try.');
  console.error('  [ADR 065] The confirmation in front of it is chassis now, so a red limb above may need');
  console.error(`  fixing in ${CHASSIS.file} rather than in the app —`);
  console.error('  each message names the tree it read. Branch taken per root: ' + (branches.join(', ') || 'none'));
  process.exit(1);
}

for (const n of notes) console.log(n);
// 🔴 THE PASSING LINE PRINTS THE SPLIT, NOT A TOTAL. It used to name the roots
// and nothing else, which stayed literally true while the confirmation's every
// property had left those trees for `packages/design_system` and gone unchecked.
// A line that names the branch each root took, and the chassis subject's own
// size against its own floor, cannot be true of a collapsed subject.
console.log(
  `ok  deletion control — ${withAccounts} of ${roots.length} root(s) offer accounts and every one of them ` +
    `ships a confirmed, honestly-reported in-app deletion path [${branches.join(', ')}]; the shared ` +
    `confirmation ${CHASSIS.file} holds all ${CONFIRMATION_PROPERTIES.length} propert(ies) ` +
    `(${chassisLines} line(s)${IS_FULL_CHECKOUT ? `/floor ${CHASSIS.floor}` : ''})` +
    (IS_FULL_CHECKOUT
      ? ''
      : '. NOTE: this root is not a checkout of this repository, so the chassis line floor was NOT applied ' +
        '— only its presence and non-emptiness were checked.'),
);
