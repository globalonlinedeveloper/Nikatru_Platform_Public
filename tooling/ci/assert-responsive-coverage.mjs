#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════════════
// EVERY SURFACE A USER CAN REACH, IN EVERY TREE THIS FACTORY SHIPS, HAS A WIDTH
// MEASUREMENT — AND EVERY WIDTH MEASUREMENT POINTS AT A SURFACE A USER CAN
// REACH.
//
// ── THE DOMAIN RULE, STATED ONCE ───────────────────────────────────────────
// The domain is the RESPONSIVE SURFACES of every DERIVED ROOT, and what counts
// as a surface depends on what kind of root it is.
//
// An APP ROOT (the brick template, and every `apps/*` workspace member) is
// exactly two things:
//
//   (1) ROUTED SCREENS — every widget a `builder:` in `<root>/lib/core/
//       router.dart` returns, INCLUDING the routes inside the
//       StatefulShellRoute branches. A builder target declared IN the router
//       itself (a private `_Wrapper`, e.g. `_GatedInsights`) is resolved ONE
//       LEVEL to the feature screen it builds, because the wrapper is a gate
//       and the pane is what the user looks at.
//   (2) MODAL SHEETS — every `show*Sheet` function declared under
//       `<root>/lib/features/**`. A bottom sheet is a full surface on a 1920 px
//       display and nothing about being modal caps its width.
//
// A PACKAGE ROOT has no router, and that changes the vocabulary rather than
// weakening it: its domain is every PUBLIC widget class declared under
// `<root>/lib/**`. In an app, a widget nothing routes to is unreachable — that
// is the DEAD COVERAGE limb below. In a package, every public widget is
// reachable BY CONSTRUCTION: the package exists to be mounted, the barrel
// exports it, and every stamped app inherits it. `TwoPane` decides the layout
// of more screens than any single Subly pane does.
//
// Everything else a `builder:` returns is an EXCLUSION, and exclusions are
// PRINTED ON EVERY RUN with their reason — never dropped silently. There are
// two shapes of them and both are argued below in NOT_A_PANE_BY_ROOT:
//   · the SHELL WRAPPER (`AppShell`) — chrome, not a pane; its branch routes
//     are each in the domain on their own account;
//   · the DIALOG/ERROR surface (`NotFoundScreen`) — declared in
//     packages/design_system, which since 2026-09-05 is a root of this scan in
//     its own right, so "the design system owns its width" is a fact this
//     guard checks rather than a sentence it prints.
// A redirect-only `GoRoute` has no builder and therefore no pane; it is printed
// too, for the same reason.
//
// 🔴 AN UNKNOWN BUILDER TARGET IS A FAILURE, NOT AN EXCLUSION. The map is a
// statement about known non-panes, not an allowlist screens can be added to.
// Anything a router builds that is neither a feature surface nor one of those
// named non-panes fails the build by name. There is NO app exemption here and
// no way to add one: `assert-stamp-properties.mjs` carries an EXEMPT_APPS list
// and Subly sat in it; this guard deliberately has no equivalent, because the
// app with the most screens is the one that most needs the check.
//
// ═══════════════════════════════════════════════════════════════════════════
// 🔴🔴 THE DOMAIN IS DERIVED, AND UNTIL 2026-09-05 IT WAS ONE HARDCODED APP
// ═══════════════════════════════════════════════════════════════════════════
// This file opened with `const APP = 'apps/subly';` from the day it was written
// until 2026-09-05 [backlog G-3]. The brick template — the tree every future
// app is stamped from — was outside it, and so was `packages/design_system`,
// which [ADR 065] chassis step 2 made the home of `nav_shell.dart`,
// `app_scaffold.dart`, `content_pane.dart`, `two_pane.dart` and fifteen more.
// A width decision is only ever visible to a measurement, so an unmeasured
// chassis widget is an unpoliced one in EVERY app at once.
//
// 🔴 THE ROOTS ARE DERIVED, NEVER LISTED, and a directory listing of `apps/` is
// REFUSED for a stated reason: the brick lane stamps `apps/probe` and does not
// remove it, so a listing differs between a dev box and CI. The derivation is
// the one `assert-deletion-control.mjs` and `assert-modal-detection.mjs`
// already use:
//   (1) the brick template, anchored on `tooling/bricks/app/brick.yaml` — the
//       tree's OWN declaration that a brick lives here, not an opportunistic
//       `existsSync`. assert-modal-detection.mjs measured the opportunistic
//       form failing: the brick's directory renamed away took that scan from
//       329 sites to 263 with an "ok" on the end.
//   (2) every `apps/*` on the root `pubspec.yaml` `workspace:` list.
//   (3) every `packages/*` on that list whose OWN pubspec declares a
//       `flutter_test` dev-dependency AND which declares ≥1 public widget
//       class. PR #461's disproof, re-measured 2026-09-05: `packages/analysis`
//       is lints-only, and auth_supabase / notifications / platform_storage /
//       purchases / telemetry declare `flutter_test` and between them declare
//       ZERO public widget classes. Deriving them would make five permanently
//       empty roots, and an empty root is either a permanent red or a floor of
//       zero, which is not a floor. design_system is the one package that
//       clears both halves, by measurement: nineteen public widget classes.
//
// 🔴 ONE FLOOR PER ROOT, NEVER A UNION FLOOR. assert-no-tls-pinning.mjs records
// a union floor that stayed satisfied by the brick alone while apps/ AND
// packages/ went to zero; assert-workspace-coverage.mjs:130-136 records the
// same over an emptied apps/. Every floor below is keyed by root, and WHICH
// BRANCH WAS TAKEN IS PRINTED ON EVERY RUN.
//
// ═══════════════════════════════════════════════════════════════════════════
// 🔴🔴 THE ONE PLACE THIS WIDENING IS NOT YET FAIL-CLOSED, DATED AND LOUD
// ═══════════════════════════════════════════════════════════════════════════
// Widening the domain found exactly what it was widened to find, and the
// numbers are the reason this section exists rather than a paragraph of
// intent. Measured 2026-09-05, the first run over the new roots:
//   · the BRICK routes twelve screens and measures THREE of them
//     (`responsive_width_test.dart` pumps onboarding, settings and manage-plan).
//     NINE routed screens in the template every future app inherits have no
//     width decision at all.
//   · `packages/design_system` declares nineteen public widgets; ELEVEN are
//     measured by its own per-widget suite and EIGHT are not, among them
//     `AuthField`, `DestructiveConfirmDialog` and `PaywallGate`. Its suite is
//     not named `width_*` at all — see the corpus rule below for why that
//     changes which files are read and what replaces the bound the naming rule
//     was providing.
//
// Those files are OUTSIDE the change that widened this guard, and a guard that
// went red on thirty surfaces the day it landed would be reverted rather than
// fixed — which is the [pipeline C-6] rule this repository already runs on.
// So the UNCOVERED half is, FOR THE TWO ROOTS ADDED ON 2026-09-05 AND ONLY
// THOSE:
//     PRINTED IN FULL, BY NAME, ON EVERY RUN — and NOT failed.
// `apps/subly` is unchanged: an uncovered surface there still fails the build.
//
// 🔴 AND THIS IS NOT A SWITCH THAT SILENCES THE ROOT. Everything else about a
// report-mode root fails exactly as it does for subly:
//   · DEAD COVERAGE — a measurement pointed at a widget nothing declares.
//   · the `surfaces` floor — the domain shrinking.
//   · the `coveredSurfaces` floor — THE BACKSTOP. The three brick screens that
//     ARE measured today cannot stop being measured in silence, and neither can
//     design_system's. A report-mode root can only ever get BETTER from the day
//     it was measured; it cannot quietly get worse.
//   · the `widthTestFiles` floor — the suite leaving.
//   · UNMEASURED WIDTH, wherever the root declares window classes to require.
// ⚠️ TURN `enforce` ON FOR A ROOT THE DAY ITS PRINTED LIST REACHES ZERO. That
// is one field, and the `coveredSurfaces` floor ratcheting up alongside the
// work is what makes the day arrive.
//
// ── WHY BOTH DIRECTIONS ────────────────────────────────────────────────────
// Set equality, not containment, and the second direction is the one this
// repository paid for:
//
//   · a ROUTED SCREEN WITH NO WIDTH TEST fails naming the screen (or, in a
//     report-mode root, PRINTS naming the screen). "The content grew to fill a
//     1920 px display" throws no exception, clips no pixel and fails no
//     existing assertion — it is only ever visible to a measurement, so an
//     unmeasured pane is an unpoliced one.
//   · a WIDTH TEST WHOSE SUBJECT IS NOT ROUTED fails naming the subject, in
//     every root. This is DEAD COVERAGE, and it is not hypothetical:
//     `responsive_width_test.dart` spent its life measuring
//     `features/firstrun/onboarding_screen.dart`, the STAMPED twin of the
//     carousel — an unrouted copy no Subly user could ever reach.
//     `core/router.dart` sends a fresh install to `features/onboarding/`. The
//     screen with the width cap had no user and the screen with the user had no
//     width cap, and the suite was green the entire time. A test that measures
//     a widget nobody can open reports coverage it does not have, and it is
//     worse than no test because it makes the gap invisible.
//
// 🔴 WHICH IS WHY BOTH SETS ARE KEYED BY `<file>#<Symbol>`, NEVER BY THE BARE
// CLASS NAME. Both onboarding screens were called `OnboardingScreen`. A guard
// comparing names would have found the routed `OnboardingScreen` present in the
// covered set and reported clean — it would have written the exact bug it
// exists to catch into its own answer. The file is what distinguishes a twin
// from its original, so the file is part of the identity. Since 2026-09-05 the
// key is root-qualified too: the brick and subly declare a `SignUpScreen` each
// and they are different files with different measurements.
//
// ── HOW A SUBJECT IS ESTABLISHED ───────────────────────────────────────────
// A width test covers `<file>#<Symbol>` when it IMPORTS that file (via
// `package:<the root's own pubspec name>/…`) AND CONSTRUCTS/INVOKES that symbol
// (`Symbol(`). Both halves are required: the import gives provenance (which
// file the symbol came from) and the construction gives evidence (the test
// actually pumps it). An import alone proves nothing — `width_cancel_sheet_
// test.dart` imports `features/shared/widgets.dart` for its row primitives and
// that file is not a surface — and a bare name alone is the twin trap above.
//
// ⚠️ THE PACKAGE NAME IS READ OUT OF EACH ROOT'S OWN `pubspec.yaml`, NEVER
// SPELLED HERE. It was `package:subly/` hardcoded until 2026-09-05. The brick's
// name is the literal string `{{app_id.snakeCase()}}` — a mustache placeholder
// that is not a valid Dart identifier until the brick is stamped — and the
// brick's own suite imports itself by exactly that spelling, so quoting the
// manifest is what makes the template readable at all.
//
// ⚠️ A PACKAGE ROOT'S SUITE IMPORTS THE BARREL, NOT THE FILE. Measured
// 2026-09-05: fifteen of design_system's seventeen test files import
// `package:nikatru_design_system/nikatru_design_system.dart` and only three
// import a `src/widgets/…` file directly. Provenance would collapse to nothing
// under the app rule, so a barrel import is resolved ONE LEVEL through the
// `export 'src/…';` lines the barrel declares. One level and not a graph: a
// barrel re-exporting a barrel is not a shape this tree has, and a walk nobody
// can check is worse than a bound nobody has hit.
//
// ── WHICH TEST FILES ARE THE CORPUS, AND WHY IT DIFFERS BY KIND OF ROOT ────
// An APP root's corpus is `width_*_test.dart` and `responsive_width_test.dart`
// under `<root>/test`. The naming rule exists to bound a large suite: subly's
// `test/` holds 72 files and 17 of them are width tests, and a rule that read
// all 72 would credit a surface with a measurement any file that merely
// constructs it happens to make.
//
// 🔴 THAT RULE RETURNS ZERO OVER A PACKAGE, AND ZERO IS NOT AN ANSWER.
// MEASURED 2026-09-05: NONE of design_system's seventeen test files matches
// `width_*`, and SEVEN of them pump a surface size. A package suite is named
// per widget (`two_pane_test.dart`, `app_scaffold_test.dart`) because that is
// what a package is; applying the app naming rule there would report a chassis
// with real, working width cases as measuring nothing, which is a false
// statement in the direction that makes a reader stop looking. So a PACKAGE
// root's corpus is every `.dart` under `<root>/test`, and the bound that the
// naming rule was providing is replaced by a STRICTER one: in a package root a
// surface is covered only when the file that constructs it ALSO PUMPS AT LEAST
// ONE SURFACE SIZE. Constructing a widget is not measuring it.
//
// ── COMMENTS ARE STRIPPED BEFORE ANY MATCHING ──────────────────────────────
// Via tooling/ci/text-reductions.mjs, the one reduction nine guards share. The
// header you are reading names `OnboardingScreen`, `AppShell`, `showCancelSheet`
// and `features/firstrun/onboarding_screen.dart`; unstripped, this file's own
// prose would be a parse of a router. A guard that greps prose reports the
// opposite of the truth exactly when the code is right.
//
// ── NEGATIVE TESTS, RUN AGAINST A COPY OF THE REAL TREE ────────────────────
// tooling/ci/test/responsive-coverage.test.mjs, created 2026-09-05 with this
// widening — this guard had NO test file of its own before that date, which is
// the reason its header cited a `756-line guard with fifteen recorded failing
// cases` as too risky to touch. Every mutation is applied to a byte copy of the
// live repo:
//   R1  delete a width test's construction → UNCOVERED SURFACE, by name, exit 1
//   R2  delete every `GoRoute` from subly's router → COVERAGE LOST
//   R3  point a width test at an unrouted twin → DEAD COVERAGE, by name
//   R4  delete a route AND its width test together → the `surfaces` floor, the
//       mutation set equality cannot see
//   R5  rename the width harness away → COVERAGE LOST on the window classes
//   R6  delete the `kTablet` case from a width test → UNMEASURED WIDTH
//   R7  rename the brick's app directory away → COVERAGE LOST (the widening's
//       own limb: this was GREEN before 2026-09-05)
//   R8  cut `  - packages/design_system` from the workspace list → COVERAGE
//       LOST
//   R9  cut `flutter_test:` from design_system's pubspec → COVERAGE LOST
//   R10 delete the brick's `responsive_width_test.dart` → the brick's
//       `coveredSurfaces` BACKSTOP floor, which is what stops report mode from
//       being a silence
//   R11 THE POSITIVE CONTROLS — land an unmeasured surface in the brick and in
//       design_system and watch each appear BY NAME in that root's printed
//       list; then measure one and watch it leave.
//   R12 an UNCOVERED surface in `apps/subly` FAILS in the SAME RUN in which the
//       brick's nine only print — report mode is per root, dated and opt-in,
//       never a default a new root falls into.
//
// ⚠️ THE OTHER SIXTEEN CASES, AND WHAT THIS CHANGE OWES THEM.
// `tooling/ci/test/guards.test.mjs` carries a second `assert-responsive-
// coverage` block of sixteen cases over a SYNTHETIC sixteen-screen fixture. All
// sixteen go red against this file until that fixture gains the two manifests
// the derivation now reads (`pubspec.yaml` with a `workspace:` list, and
// `apps/subly/pubspec.yaml` with a `name:`) and six of its assertions are
// re-pointed at the root-qualified wording. MEASURED, NOT PREDICTED: the patch
// was applied to a copy of that file on 2026-09-05 and all sixteen pass. It is
// eight small hunks and it is reported to the owner rather than applied here,
// because guards.test.mjs is outside the files this change owns and two writers
// editing it is the collision this repository partitions by file to avoid.
// ═══════════════════════════════════════════════════════════════════════════
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { listDir } from './tree-walk.mjs';
import { stripSourceComments, stripStringLiterals } from './text-reductions.mjs';

const ROOT = process.argv[2] ?? process.cwd();

const problems = [];
const notes = [];
const ok = (m) => console.log(`ok   ${m}`);
const coverageLost = (m) => problems.push(`COVERAGE LOST — ${m}`);

const read = (rel) => stripSourceComments(readFileSync(join(ROOT, rel), 'utf8'), '.dart');
/** A pubspec is YAML, not Dart: `#` comments out, nothing else touched. */
const readManifest = (rel) => readFileSync(join(ROOT, rel), 'utf8').replace(/^\s*#.*$/gm, '');
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const isDir = (rel) => {
  try {
    return statSync(join(ROOT, rel)).isDirectory();
  } catch {
    return false;
  }
};

// ═══════════════════════════════════════════════════════════════════════════
// (0) THE ROOTS — DERIVED. See the header for why each half is load-bearing.
// ═══════════════════════════════════════════════════════════════════════════
const BRICK = 'tooling/bricks/app/__brick__/apps/{{app_id}}';
const BRICK_MANIFEST = 'tooling/bricks/app/brick.yaml';
const SUITE_RUNNER_RE = /^\s+flutter_test:\s*$/m;

// ── SURFACE VOCABULARY ─────────────────────────────────────────────────────
// Deliberately the SAME vocabulary on both sides, and the same one
// assert-a11y-coverage uses: the routed set and the covered set must agree
// about what counts as a surface, or the equality below compares two different
// questions.
const SCREEN_DECL = /\bclass\s+([A-Za-z_$][\w$]*Screen)\b/g;
const SHEET_DECL = /^[ \t]*(?:Future<[^>]*>|void)\s+(show[A-Z][\w$]*Sheet)\s*\(/gm;
/** A PUBLIC widget class — the vocabulary of a PACKAGE root. `_FooState extends
 *  State<Foo>` is lower-cased out by the leading `[A-Z]`. */
const WIDGET_DECL =
  /\bclass\s+([A-Z][\w$]*)\s+extends\s+(?:[A-Za-z_$][\w$]*\.)?(?:StatelessWidget|StatefulWidget|ConsumerWidget|ConsumerStatefulWidget|HookWidget|HookConsumerWidget)\b/g;

/** Every `.dart` under `rel`, recursively, relative to ROOT. */
function dartFilesUnder(rel) {
  const out = [];
  const walk = (dir) => {
    let entries;
    try {
      entries = listDir(join(ROOT, dir), { withFileTypes: true });
    } catch {
      return; // absent — the caller's own emptiness limb is the report
    }
    for (const e of entries) {
      const child = `${dir}/${e.name}`;
      if (e.isDirectory()) walk(child);
      else if (e.name.endsWith('.dart')) out.push(child);
    }
  };
  walk(rel);
  return out.sort();
}

const packageNameOf = (dir) => {
  try {
    return /^name:[ \t]*(\S+)[ \t]*$/m.exec(readManifest(`${dir}/pubspec.yaml`))?.[1] ?? null;
  } catch {
    return null;
  }
};
const declaresSuiteRunner = (dir) => {
  try {
    return SUITE_RUNNER_RE.test(readManifest(`${dir}/pubspec.yaml`));
  } catch {
    return false;
  }
};
/** ≥1 public widget class under `<dir>/lib`. The PR #461 disproof, applied: a
 *  package with none would be a permanently empty root, and an empty root is
 *  either a permanent red or a floor of zero.
 *
 *  🔴 A FRESH REGEX, NOT `WIDGET_DECL`, AND THE REASON IS A MEASURED DEFECT
 *  THIS GUARD'S OWN FIXTURE CAUGHT ON 2026-09-05. `RegExp.prototype.test` on a
 *  /g/ regex ADVANCES `lastIndex`, and `String.prototype.matchAll` starts from
 *  it — so one `.test()` here silently made `surfacesIn` skip every declaration
 *  before that offset in the NEXT file it read. The full checkout hid it by
 *  luck: `notifications`, `platform_storage`, `purchases` and `telemetry` are
 *  scanned AFTER design_system, they contain no widget, and each failing
 *  `.test()` resets `lastIndex` to 0 on its way out. Against a fixture holding
 *  only the three roots, nothing reset it and the design_system domain read
 *  FIVE surfaces instead of NINETEEN — a fourteen-surface silent loss, in the
 *  direction that reports a smaller domain as fully accounted for.
 *  📌 A SHARED /g/ REGEX IS STATE. Every `matchAll` below resets `lastIndex`
 *  first for the same reason. */
const declaresAWidget = (dir) => {
  const re = new RegExp(WIDGET_DECL.source, 'g');
  return dartFilesUnder(`${dir}/lib`).some((f) => {
    re.lastIndex = 0;
    return re.test(read(f));
  });
};

const roots = []; // { dir, kind, pkg }
const derivation = [];

if (isDir(BRICK)) {
  roots.push({ dir: BRICK, kind: 'app' });
  derivation.push(`${BRICK} (brick template, declared by ${BRICK_MANIFEST})`);
} else if (existsSync(join(ROOT, BRICK_MANIFEST))) {
  coverageLost(
    `${BRICK_MANIFEST} exists, so this tree DECLARES a brick — but ${BRICK} does not, so the template ` +
      'every future app is stamped from contributed NOTHING to this scan. The other root(s) still hold a ' +
      'healthy non-empty domain, so every limb below would find something to look at and print ok over a ' +
      'root that silently left. A width defect stamped into app #2 is invisible in app #1. Re-point BRICK, ' +
      'or delete the brick.',
  );
}

let workspaceRead = false;
try {
  const lines = readManifest('pubspec.yaml').split('\n');
  const at = lines.findIndex((l) => /^workspace:\s*$/.test(l));
  if (at !== -1) {
    workspaceRead = true;
    for (const line of lines.slice(at + 1)) {
      if (/^\S/.test(line)) break;
      const m = line.match(/^\s*-\s*(\S+)\s*$/);
      if (!m) continue;
      const dir = m[1];
      if (dir.startsWith('apps/')) {
        roots.push({ dir, kind: 'app' });
        derivation.push(`${dir} (workspace app member)`);
      } else if (dir.startsWith('packages/') && declaresSuiteRunner(dir) && declaresAWidget(dir)) {
        roots.push({ dir, kind: 'package' });
        derivation.push(`${dir} (workspace package member: declares flutter_test AND a public widget)`);
      }
    }
  }
} catch {
  /* handled by workspaceRead below */
}
if (!workspaceRead) {
  coverageLost(
    'the root pubspec.yaml has no readable `workspace:` block, so the app AND package roots could not be ' +
      'derived. The domain would then be the brick alone — three measured surfaces out of twelve, which ' +
      'is the one shape of this scan that reads healthy while measuring almost nothing.',
  );
}
if (roots.length === 0) {
  coverageLost(
    'NO root was derived: the brick is absent, the workspace lists no `apps/` member, and no ' +
      '`packages/` member both declares a `flutter_test` dev-dependency and declares a public widget ' +
      'class. There is nothing to scan, so a pass here would be a claim about an empty set.',
  );
}
for (const r of roots) {
  r.pkg = packageNameOf(r.dir);
  if (r.pkg === null) {
    coverageLost(
      `\`${r.dir}\` was derived as a root and this parse could not read a \`name:\` out of ` +
        `${r.dir}/pubspec.yaml. The package name is how a test's import is attributed to a file; without ` +
        'it every surface in that root would report as uncovered.',
    );
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// (0b) REQUIRED_COVERAGE — ONE FLOOR PER ROOT, NEVER A UNION FLOOR
//
// 🔴 THIS IS NOT REDUNDANT WITH THE SET EQUALITY BELOW, AND THE MUTATION THAT
// PROVES IT IS: delete a screen from the router AND delete its width test in
// the same change. Both sets shrink by one, they stay EQUAL, and every message
// below still says "the two sets are EQUAL". Coverage left the tree and the
// guard applauded. The floor is the only thing that sees a domain being emptied
// wholesale — the same idiom as check-migrations.mjs's REQUIRED_COVERAGE and
// assert-screen-set.mjs's MIN_PRESENT: a checked-in number that only ever moves
// with a reason written beside it.
//
// A pane genuinely leaving the app is a legitimate move. It may not be a QUIET
// one.
//
// TWO CLAUSES, FIRING IN DIFFERENT SITUATIONS:
//   · A DECLARED ROOT THAT WAS NOT DERIVED fails — but only over a FULL
//     CHECKOUT, detected by this guard's OWN file being present under ROOT, a
//     sentinel outside every subject tree (`apps/`, `packages/`,
//     `tooling/bricks/`) and therefore surviving any mutation OF a subject.
//   · A DERIVED ROOT UNDER ITS OWN FLOOR fails ALWAYS, checkout or fixture. A
//     fixture root is a byte copy of the real root, so the measured floor is
//     valid over it — and gating the floors themselves would make R4 and R10
//     un-testable, which is a floor nothing has ever exercised.
//
// ⚠️ WHICH BRANCH WAS TAKEN IS PRINTED ON EVERY RUN.
//
// ⚠️ A FLOOR IS ONLY A FLOOR ON THE DAY IT IS MEASURED. It has no way to notice
// the tree growing past it, so raising it belongs in the same change that adds
// the surface — the step #280 skipped, which left this file's floor two
// surfaces under its tree for a week.
//
// EVERY NUMBER BELOW WAS PRODUCED BY RUNNING THIS GUARD ON 2026-09-05 AND
// READING ITS OWN PER-ROOT REPORT.
// ═══════════════════════════════════════════════════════════════════════════
const IS_FULL_CHECKOUT = existsSync(join(ROOT, 'tooling', 'ci', 'assert-responsive-coverage.mjs'));

const REQUIRED_COVERAGE = [
  {
    dir: 'apps/subly',
    enforce: true,
    // 19 reachable surfaces (17 routed screens, 2 modal sheets), all measured
    // by 17 width test files at 375/768/1280.
    //
    // 🔴 THE HISTORY OF THIS NUMBER IS KEPT BECAUSE IT IS A HISTORY OF THE
    // FAILURE MODE. It read 15 while the tree held 17 (#280 landed two screens
    // and their test; this file last moved in #275 and did not follow), so
    // those two screens AND their test could have been deleted in one change
    // with the equality printing EQUAL and this number printing nothing at all.
    // It was LOWERED 16 → 15 on 2026-08-10 when `/sign-in` became the canonical
    // auth route and the stamped `SignInScreen` twin was deleted — one surface
    // genuinely left the app, the floor moved with it, once, deliberately. It
    // was re-measured to 18/15 on 2026-08-11 after two changes crossed, and
    // raised to 19/16 in the same change that added `/reset-password` and its
    // width test, which is what "in the same change" means.
    //
    // ⚠️ `surfaces: 19` IS THE SAME NUMBER assert-a11y-coverage.mjs CARRIES for
    // this root and that is a MEASUREMENT, not a copy. Agreement is the
    // expected reading; a DISAGREEMENT is the signal that one of the two parses
    // has drifted. If you change one, RE-MEASURE the other.
    surfaces: 19,
    // 🔴 THIS FLOOR IS ONE UNDER ITS TREE AND IT IS BEING LEFT THERE ON
    // PURPOSE, WHICH IS WORTH MORE WORDS THAN RAISING IT WOULD HAVE BEEN.
    // MEASURED 2026-09-05: `ls apps/subly/test | grep -cE
    // '^(width_.*_test|responsive_width_test)\.dart$'` returns 17, and this
    // guard's own run agrees — so ONE width test file could be deleted today
    // with nothing said, which is precisely the #280 shape recorded above.
    // It was raised to 17 in this change and then put back, because the raise
    // is not free and the cost lands in a file this change does not own:
    // `tooling/ci/test/guards.test.mjs` builds a synthetic 16-width-test
    // fixture for this guard and says so in its own comment ("THIS TRACKS THE
    // FLOOR AND MUST BE MOVED WITH IT"), so 17 turns five of its sixteen cases
    // red for a reason unrelated to what any of them assert. Measured, not
    // predicted: the raise was applied, that block was run, and five cases went
    // red on `only 16 width test file(s) … floor is 17`.
    // 📌 OWED, AND REPORTED TO THE OWNER RATHER THAN LEFT IN A COMMENT: raise
    // this to 17 in the same change that grows that fixture's `N`.
    widthTestFiles: 16, // 15 `width_*_test.dart` + `responsive_width_test.dart`
    coveredSurfaces: 19,
    label: 'the app this guard was written for — every surface measured, and it fails if one stops being',
  },
  {
    dir: BRICK,
    // 🔴 REPORT MODE, 2026-09-05. See the header. Measured on the first run
    // this root was ever in the domain:
    //   12 reachable surfaces (12 routed screens, 0 modal sheets)
    //   1 width test file (`responsive_width_test.dart`)
    //   3 surfaces measured — OnboardingScreen, SettingsScreen, ManagePlanScreen
    //   NINE routed screens with no width decision at all.
    // The nine are PRINTED BY NAME on every run and reported to the owner; they
    // are not fixed here, because they are not files this change owns.
    // ⚠️ FLIP `enforce` TO true THE DAY THE PRINTED LIST REACHES ZERO.
    enforce: false,
    surfaces: 12,
    widthTestFiles: 1,
    coveredSurfaces: 3,
    label:
      'the template every stamped app inherits — 12 routed screens, 3 measured. The nine unmeasured ' +
      'ones are PRINTED, not failed [G-3, 2026-09-05]; the 3 that ARE measured cannot stop being',
  },
  {
    dir: 'packages/design_system',
    // 🔴 REPORT MODE, 2026-09-05. Measured on the first run this root was ever
    // in the domain — the numbers are filled in from the guard's own output,
    // never from ambition.
    //   19 public widget classes under lib/src/widgets/
    //   17 test file(s) in the corpus (the whole suite — see the corpus rule)
    //   11 widgets measured, 8 NOT — AuthField, DestructiveConfirmDialog,
    //      DestructiveOutcomeNotice, ForceUpdateGate, PaywallGate,
    //      PromoObjectionControl, PromoSurface, OfflineNotice.
    //   NO window class is declared anywhere in this root, so the
    //      kPhone/kTablet/kDesktop requirement is NOT APPLIED here and the run
    //      says so on every line it prints. That is the weaker form, and it is
    //      named rather than glossed.
    enforce: false,
    surfaces: 19,
    widthTestFiles: 17,
    coveredSurfaces: 11,
    label:
      'the shared chassis [ADR 065 step 2] — nav_shell, app_scaffold, content_pane, two_pane and fifteen ' +
      'more, whose width decisions every stamped app inherits',
  },
];

// ═══════════════════════════════════════════════════════════════════════════
// (0c) THE ARGUED NON-PANES, PER ROOT
//
// Not an allowlist. Each entry is a claim about WHAT KIND OF THING the symbol
// is, and each is self-checked twice below: an entry the root's router no
// longer builds fails (an exception for something that is not there reports
// judgement over nothing), and an entry that turns out to be a feature surface
// after all fails (it scans as a pane; the exclusion is wrong).
// ═══════════════════════════════════════════════════════════════════════════
const NOT_FOUND_WHY =
  'is the errorBuilder surface and it is DECLARED IN packages/design_system, not in this app. That was a ' +
  'promise nothing kept until 2026-09-05; design_system is now a root of this scan, so the design system ' +
  'owning its width is a fact this guard checks rather than a sentence it prints.';

const NOT_A_PANE_BY_ROOT = new Map([
  [
    'apps/subly',
    new Map([
      [
        'AppShell',
        'is the shell CHROME, not a pane — it hosts the bottom nav and an IndexedStack of the five branch ' +
          'routes, each of which is in this domain on its own account (home, calendar, insights, budget, ' +
          'settings). Measuring the shell would measure the display, since the nav bar is meant to span it.',
      ],
      ['NotFoundScreen', NOT_FOUND_WHY],
    ]),
  ],
  [
    BRICK,
    new Map([
      [
        'AppShell',
        'is the shell CHROME, not a pane — it hosts the nav and the branch routes, each of which is in ' +
          'this domain on its own account. It is DECLARED IN packages/design_system, a root of this scan ' +
          'in its own right since 2026-09-05, so its own width is in the domain THERE rather than nowhere.',
      ],
      ['NotFoundScreen', NOT_FOUND_WHY],
    ]),
  ],
]);

// ── THE ONE ARGUED WIDTH EXEMPTION ─────────────────────────────────────────
// Same shape and same discipline as NOT_A_PANE: a claim about a specific
// surface, printed every run, and self-checked twice below — an entry for a
// surface that is not covered fails, and an entry for a width the test DOES
// pump fails as stale.
const WIDTH_EXEMPT = new Map([
  [
    'apps/subly/lib/features/monetization/paywall_screen.dart#PaywallScreen',
    new Map([
      [
        'kDesktop',
        'is capped at `AppBreakpoints.pane` (480), not at `kMaxBodyWidth` — so the cap has ALREADY engaged ' +
          'at 768 and the file asserts the flat 480 there and again at 1920. 1280 is not a boundary for a ' +
          '480 cap the way it is for a 1280 one; a case there would assert the same constant, bound the ' +
          'same way, between two surfaces that already bracket it.',
      ],
    ]),
  ],
]);

const APP_WIDTH_TEST = /^(?:width_.*_test|responsive_width_test)\.dart$/;
const REQUIRED_WIDTHS = ['kPhone', 'kTablet', 'kDesktop'];

// ── SHARED PARSE HELPERS ───────────────────────────────────────────────────

const surfaceCache = new Map();
/** The surfaces a file DECLARES, as bare symbol names. */
function surfacesIn(rel, kind) {
  const cacheKey = `${kind}:${rel}`;
  if (surfaceCache.has(cacheKey)) return surfaceCache.get(cacheKey);
  let out = [];
  if (existsSync(join(ROOT, rel))) {
    const code = read(rel);
    // 🔴 `lastIndex` RESET BEFORE EVERY `matchAll`. See declaresAWidget: a /g/
    // regex carries state between calls and `matchAll` honours it, which cost
    // this guard fourteen of nineteen design_system surfaces in silence before
    // its own fixture caught it.
    WIDGET_DECL.lastIndex = 0;
    SCREEN_DECL.lastIndex = 0;
    SHEET_DECL.lastIndex = 0;
    out =
      kind === 'package'
        ? [...code.matchAll(WIDGET_DECL)].map((m) => m[1])
        : [
            ...[...code.matchAll(SCREEN_DECL)].map((m) => m[1]),
            ...[...code.matchAll(SHEET_DECL)].map((m) => m[1]),
          ];
  }
  surfaceCache.set(cacheKey, out);
  return out;
}

/** The inner text of the balanced run opening at `open`, quotes respected.
 *
 *  Used for BOTH an argument list and a class body, and the bound matters in
 *  each: an unbounded `slice(start)` for a class body would let the wrapper
 *  resolution below read symbols from every line AFTER the class, which happens
 *  to be correct today only because `_GatedInsights` is the last declaration in
 *  the file. A parse that is right by file order is a parse waiting to be wrong. */
function sliceBalanced(text, open, openCh, closeCh) {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    const c = text[i];
    if (c === "'" || c === '"') {
      // Skip the literal. Dart escapes with a backslash; an unterminated quote
      // means we mis-read the opener, so bail rather than run to end of file.
      let j = i + 1;
      while (j < text.length && text[j] !== c && text[j] !== '\n') {
        if (text[j] === '\\') j++;
        j++;
      }
      if (j >= text.length || text[j] === '\n') return null;
      i = j;
      continue;
    }
    if (c === openCh) depth++;
    else if (c === closeCh) {
      depth--;
      if (depth === 0) return text.slice(open + 1, i);
    }
  }
  return null;
}
const sliceCall = (text, open) => sliceBalanced(text, open, '(', ')');

// ── THE ROUTER IS A SPINE, NOT A FILE (2026-09-04, P1b) ────────────────────
// `<root>/lib/core/router.dart` may be a BARREL over `<root>/lib/core/router/`.
// Read as one file after that split this guard ranges over a router with NO
// ROUTES IN IT, which is indistinguishable from a router that LOST them. The
// domain widens to the barrel PLUS `router/*.dart`, in that order, and to
// nothing else. A tree whose router is still one file has no sibling directory
// and is read exactly as it was before — the brick is such a tree; subly is not.
//
// Concatenated rather than scanned per file on purpose: `_GatedInsights` is
// declared in one file and routed from another.
function routerSpine(routerRel) {
  const dir = routerRel.slice(0, -'.dart'.length);
  let entries = [];
  try {
    entries = listDir(join(ROOT, dir));
  } catch {
    entries = []; // no sibling directory: an unsplit router
  }
  const files = [
    routerRel,
    ...entries
      .filter((e) => e.endsWith('.dart'))
      .sort()
      .map((e) => `${dir}/${e}`),
  ];
  return { files, src: files.map(read).join('\n') };
}

/** The files a `package:<pkg>/<path>` import resolves to, INCLUDING one level
 *  of barrel expansion — see the header. */
function resolveImport(R, path) {
  const rel = `${R.dir}/lib/${path}`;
  if (!existsSync(join(ROOT, rel))) return [];
  if (surfacesIn(rel, R.kind).length > 0) return [rel];
  const out = [];
  for (const m of read(rel).matchAll(/export\s+'([^':]+\.dart)'/g)) {
    const target = `${R.dir}/lib/${m[1]}`;
    if (existsSync(join(ROOT, target))) out.push(target);
  }
  return out.length ? out : [rel];
}

// ════════════════════════════════════════════════════════════════════════════
// DELEGATION — A WIDTH DECISION FOLLOWS THE SCREEN INTO THE CHASSIS
// (ADR 067 decision 2, the same resolver assert-a11y-coverage.mjs carries)
//
// [ADR 066] step 4 leaves an ADAPTER behind at each moved screen: same path,
// same route, same `SettingsScreen` name, and NO LayoutBuilder, no ConstrainedBox
// and no max-width — those went into `package:nikatru_chassis_screens` with the
// body. The width test went with them too, into the chassis package's own suite.
//
// 🔴 READ WITHOUT THIS RESOLVER, THAT MOVE IS INDISTINGUISHABLE FROM DELETING
// THE WIDTH TEST. This root's covered set drops by one, `coveredSurfaces` falls
// under its floor and the set-equality limb reports the screen as UNCOVERED —
// all three correctly describing a tree where the measurement is right there,
// green, in a file this scan judges under a different root. The honest answer is
// not to lower the floor: it is to follow the import.
//
// ⚠️ THE ADAPTER STAYS IN THE ROUTED SET, exactly as in the a11y guard. The
// domain WIDENS: a surface is measured when its own root measures it OR when
// the chassis root measures the file it delegates to. Nothing here moves a
// surface OUT of a domain.
//
// ⚠️ ONE LEVEL, ONE IMPORT, AND EVERY REFUSAL IS COVERAGE LOST. Two chassis
// imports in one adapter is ambiguous and refused; a target not on disk, a
// target that declares no widget, and a chassis that is not a DERIVED ROOT of
// this scan are all reported rather than passed over — each of them means the
// width decision is now measured NOWHERE.
// ════════════════════════════════════════════════════════════════════════════
const CHASSIS_PKG = 'nikatru_chassis_screens';
const CHASSIS_DIR = 'packages/chassis_screens';
const CHASSIS_IMPORT = new RegExp(`import\\s+'package:${escapeRe(CHASSIS_PKG)}/([^']+\\.dart)'`, 'g');

/** Where `rel` delegates to, resolved one level. `null` = does not delegate;
 *  `{ lost }` = it does and the target could not be resolved, which the caller
 *  must report as COVERAGE LOST; `{ files }` = the package file(s) that now own
 *  this surface's width decision. The three answers are kept apart on purpose:
 *  collapsing `null` and `{ lost }` is how a resolver that stopped reaching its
 *  target starts reporting "nothing to do". */
function delegationOf(rel) {
  if (!existsSync(join(ROOT, rel))) return null;
  CHASSIS_IMPORT.lastIndex = 0;
  const paths = [...new Set([...read(rel).matchAll(CHASSIS_IMPORT)].map((m) => m[1]))];
  if (paths.length === 0) return null;
  if (paths.length > 1) {
    return {
      lost:
        `\`${rel}\` imports ${paths.length} different \`package:${CHASSIS_PKG}\` paths ` +
        `(${paths.join(', ')}), so the file that now owns this surface's width decision cannot be ` +
        'identified. This guard keys coverage by FILE and will not guess between two of them.',
    };
  }
  const target = `${CHASSIS_DIR}/lib/${paths[0]}`;
  if (!existsSync(join(ROOT, target))) {
    return {
      lost:
        `\`${rel}\` delegates to \`package:${CHASSIS_PKG}/${paths[0]}\`, which resolves to \`${target}\` — ` +
        'and that file is not on disk. The screen has been emptied into a package that does not carry it, ' +
        'so no width is asserted for it anywhere.',
    };
  }
  if (surfacesIn(target, 'package').length > 0) return { files: [target] };
  const out = [];
  for (const m of read(target).matchAll(/export\s+'([^':]+\.dart)'/g)) {
    const t = `${CHASSIS_DIR}/lib/${m[1]}`;
    if (existsSync(join(ROOT, t)) && surfacesIn(t, 'package').length > 0) out.push(t);
  }
  if (out.length === 0) {
    return {
      lost:
        `\`${rel}\` delegates to \`${target}\`, which declares no public widget and re-exports none that ` +
        'does. One level of barrel expansion is all this resolver does, and it found nothing to measure.',
    };
  }
  return { files: out };
}

// ═══════════════════════════════════════════════════════════════════════════
// ONE ROOT, ANALYSED. Everything below used to be top-level code over
// `const APP = 'apps/subly'`; it is the same accounting, once per derived root.
// ═══════════════════════════════════════════════════════════════════════════
function analyseRoot(R) {
  const routerRel = `${R.dir}/lib/core/router.dart`;
  const featuresRel = `${R.dir}/lib/features`;
  const testRel = `${R.dir}/test`;
  const harnessRel = `${testRel}/support/width_harness.dart`;
  const rootProblems = [];
  const problem = (m) => rootProblems.push(m);
  const rootCoverageLost = (m) => rootProblems.push(`COVERAGE LOST — ${m}`);
  const NOT_A_PANE = NOT_A_PANE_BY_ROOT.get(R.dir) ?? new Map();

  const routed = new Map(); // "<file>#<Symbol>" → { file, symbol, via, kind }
  const excluded = [];
  const routerTargets = new Set();
  let goRoutes = 0;
  let redirectOnly = 0;
  let spineFiles = [];

  // ═══════════════════════════════════════════════════════════════════════
  // (A) THE ROUTED SET
  // ═══════════════════════════════════════════════════════════════════════
  if (R.kind === 'app') {
    if (!existsSync(join(ROOT, routerRel))) {
      rootCoverageLost(
        `${routerRel} does not exist, so the routed-screen half of this check ranged over NOTHING for ` +
          'this root and would have reported every width test in it as dead coverage. The router is the ' +
          'domain; without it there is no question.',
      );
    } else {
      const spine = routerSpine(routerRel);
      spineFiles = spine.files;
      const router = spine.src;

      const importedFeature = new Map(); // Symbol → [file, …]
      for (const m of router.matchAll(/import\s+'(?:\.\.\/)+(features\/[^']+\.dart)'/g)) {
        const rel = `${R.dir}/lib/${m[1]}`;
        for (const symbol of surfacesIn(rel, R.kind)) {
          if (!importedFeature.has(symbol)) importedFeature.set(symbol, []);
          importedFeature.get(symbol).push(rel);
        }
      }
      for (const [symbol, files] of importedFeature) {
        if (files.length > 1) {
          problem(
            `AMBIGUOUS SURFACE — ${routerRel} imports ${files.length} feature files that each declare ` +
              `\`${symbol}\` (${files.join(', ')}), so a \`${symbol}(\` in the router cannot be attributed ` +
              'to one of them. That is the twin shape this guard keys by file to catch; resolve the ' +
              'collision rather than guessing.',
          );
        }
      }

      // ── Every GoRoute is accounted for: a builder target, or a redirect ──
      // Walked route by route rather than by a bare `builder:` regex, so a
      // route this parse cannot classify FAILS instead of vanishing. A screen
      // dropped by a parser looks exactly like a screen that was never there.
      const unparsed = [];
      for (const m of router.matchAll(/\bGoRoute\s*\(/g)) {
        goRoutes++;
        const open = m.index + m[0].length - 1;
        const inner = sliceCall(router, open);
        if (inner === null) {
          unparsed.push(`a GoRoute( at offset ${m.index} whose argument list this parse could not close`);
          continue;
        }
        if (/\bbuilder\s*:/.test(inner)) continue;
        if (/\bredirect\s*:/.test(inner)) {
          redirectOnly++;
          const path = /\bpath\s*:\s*'([^']*)'/.exec(inner)?.[1] ?? '(unnamed)';
          excluded.push({
            what: `GoRoute ${path}`,
            why: 'is REDIRECT-ONLY — it declares no builder, so it renders nothing and there is no pane to measure.',
          });
          continue;
        }
        unparsed.push(`a GoRoute( at offset ${m.index} with neither a builder: nor a redirect:`);
      }
      if (unparsed.length) {
        rootCoverageLost(
          `${unparsed.length} route(s) in ${routerRel} could not be classified: ${unparsed.join('; ')}. ` +
            'An unclassified route is a screen this guard cannot see, and an invisible screen reads exactly ' +
            'like a covered one.',
        );
      }

      const BUILDER =
        /\b(errorBuilder|builder)\s*:\s*\([^)]*\)\s*=>\s*(?:const\s+)?([A-Za-z_$][\w$]*)\s*\(/g;
      const builderKeys = [...router.matchAll(/\b(?:errorBuilder|builder)\s*:/g)].length;
      const matches = [...router.matchAll(BUILDER)];
      if (matches.length !== builderKeys) {
        rootCoverageLost(
          `${routerRel} has ${builderKeys} builder key(s) and this parse resolved ${matches.length} of ` +
            'them. The unresolved ones build SOMETHING and this guard does not know what — a builder with ' +
            'a block body or a non-constructor expression slips past the arrow form. Widen the parse; do ' +
            'not let a screen be invisible.',
        );
      }

      for (const [, , target] of matches) {
        routerTargets.add(target);
        let symbol = target;
        let via = null;
        if (target.startsWith('_')) {
          const decl = new RegExp(`\\bclass\\s+${target}\\b`).exec(router);
          const brace = decl ? router.indexOf('{', decl.index) : -1;
          const body = brace === -1 ? '' : (sliceBalanced(router, brace, '{', '}') ?? '');
          const inner = [...body.matchAll(/\b(?:const\s+)?([A-Za-z_$][\w$]*)\s*\(/g)]
            .map((x) => x[1])
            .find((name) => importedFeature.has(name));
          if (!inner) {
            problem(
              `\`${target}\` is a route builder declared inside ${routerRel} and it resolves to NO feature ` +
                'surface. A wrapper that wraps nothing measurable is a route whose pane nothing can be ' +
                'pointed at; name the screen it builds or stop routing to it.',
            );
            continue;
          }
          symbol = inner;
          via = target;
        }

        const files = importedFeature.get(symbol);
        if (!files) {
          const why = NOT_A_PANE.get(symbol);
          if (why) {
            excluded.push({ what: symbol, why });
          } else {
            problem(
              `\`${symbol}\` is built by a route in ${routerRel} but is neither a screen declared under ` +
                `${featuresRel} nor one of the ${NOT_A_PANE.size} argued non-panes for this root. This ` +
                'guard will not guess: a builder target it cannot classify is a surface that would ' +
                'silently leave the domain. Either it is a pane (give it a width test) or it is not (say ' +
                'why, in NOT_A_PANE_BY_ROOT).',
            );
          }
          continue;
        }
        routed.set(`${files[0]}#${symbol}`, { file: files[0], symbol, via, kind: 'routed screen' });
      }
    }
  }

  // ── MODAL SHEETS — the other half of an app root's domain ────────────────
  // ── or, for a PACKAGE root, the whole of it: every public widget under lib.
  const declaringFiles =
    R.kind === 'package' ? dartFilesUnder(`${R.dir}/lib`) : dartFilesUnder(featuresRel);
  if (declaringFiles.length === 0) {
    rootCoverageLost(
      `no .dart file was found under ${R.kind === 'package' ? `${R.dir}/lib` : featuresRel}, so the ` +
        `${R.kind === 'package' ? 'whole domain of this package root' : 'modal-sheet half of the domain'} ` +
        'is empty and a measurement pointed there would read as dead coverage. The scan is pointed at the ' +
        'wrong tree.',
    );
  }
  for (const rel of declaringFiles) {
    for (const symbol of surfacesIn(rel, R.kind)) {
      if (R.kind === 'app' && !symbol.startsWith('show')) continue;
      routed.set(`${rel}#${symbol}`, {
        file: rel,
        symbol,
        via: null,
        kind: R.kind === 'package' ? 'shared widget' : 'modal sheet',
      });
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  // (B) WHICH WINDOWS THE MEASUREMENT PUMPS — the harness's own vocabulary
  //
  // 🔴 SET EQUALITY ONLY ASKS WHETHER A FILE EXISTS, AND A FILE IS NOT A
  // MEASUREMENT. `width_home_test.dart` shipped with three cases — 375, 1500,
  // 1920 — and NO 768 and NO 1280, the only surface in the app measured at
  // neither. Both sets contained `home_screen.dart#HomeScreen`, the equality
  // printed EQUAL, and the two window classes between a phone and an ultra-wide
  // display went unmeasured inside a green tree.
  //
  // 🔴 THE NUMBERS ARE READ OUT OF THE TREE, NEVER RESTATED HERE. If this file
  // carried its own 375/768/1280 and the harness moved `kTablet` to 800, the
  // requirement would go on being satisfied by a constant nothing pumps.
  //
  // ⚠️ AND THE DECLARATION IS NOT ALWAYS IN A HARNESS. subly declares its
  // window classes in `test/support/width_harness.dart`; the BRICK declares the
  // same four constants at the top of `responsive_width_test.dart` itself, and
  // design_system declares none at all and writes raw `Size(375, 812)`. So the
  // search is: the harness file if it exists, else the root's own width corpus.
  // A root that yields NO window class has the required-width check SKIPPED,
  // and the skip is PRINTED — a check that is silently not applied is
  // indistinguishable from one that passed.
  // ═══════════════════════════════════════════════════════════════════════
  let testFiles = [];
  let corpusRule;
  try {
    if (R.kind === 'package') {
      testFiles = dartFilesUnder(testRel).map((f) => f.slice(testRel.length + 1));
      corpusRule = `every .dart under ${testRel} (a package suite is named per widget, not \`width_*\`)`;
    } else {
      testFiles = listDir(join(ROOT, testRel)).filter((f) => APP_WIDTH_TEST.test(f)).sort();
      corpusRule = `\`width_*_test.dart\` / \`responsive_width_test.dart\` under ${testRel}`;
    }
  } catch {
    corpusRule = `(no ${testRel} directory)`;
  }

  const windowClasses = new Map();
  let windowSource = null;
  const harvest = (rel) => {
    for (const m of read(rel).matchAll(
      /\bconst\s+Size\s+(k[A-Za-z0-9_$]*)\s*=\s*(?:const\s+)?Size\(\s*(\d+(?:\.\d+)?)\s*,/g,
    )) {
      windowClasses.set(m[1], Number(m[2]));
    }
  };
  if (existsSync(join(ROOT, harnessRel))) {
    harvest(harnessRel);
    windowSource = harnessRel;
  }
  if (windowClasses.size === 0) {
    for (const name of testFiles) harvest(`${testRel}/${name}`);
    if (windowClasses.size > 0) windowSource = `${testRel}/* (declared inline, no support harness)`;
  }

  // ═══════════════════════════════════════════════════════════════════════
  // (C) THE COVERED SET
  // ═══════════════════════════════════════════════════════════════════════
  const pumpedCache = new Map();
  /** The surface widths a test file actually pumps.
   *
   *  A size reaches a case one of two ways — a window constant in an argument
   *  position (`pumpAt(tester, kTablet, …)`, `setSurface(tester, kPhone)`, and
   *  this app's own `_openSheetAt(tester, kDesktop)`), or a `Size(w, h)` written
   *  inline (`home`'s 1500). Both are counted; the argument-position bound is
   *  what keeps a constant merely NAMED from counting as one pumped.
   *
   *  ⚠️ STRING LITERALS ARE STRIPPED AS WELL AS COMMENTS, and that is not
   *  belt-and-braces: `width_scan_test.dart` and `width_insights_test.dart` both
   *  carry the word `kWide` inside an `expect` REASON explaining why the screen
   *  needs no such case. Comment-stripping alone leaves those, so a prose
   *  explanation of an ABSENT case would have satisfied the check for it — the
   *  `r2_buckets` defect verbatim, in a file arguing the opposite of what it was
   *  credited with. */
  function widthsPumpedBy(name) {
    if (pumpedCache.has(name)) return pumpedCache.get(name);
    const code = stripStringLiterals(read(`${testRel}/${name}`));
    const out = new Set();
    for (const [windowClass, width] of windowClasses) {
      if (new RegExp(`[(,]\\s*${windowClass}\\s*[,)]`).test(code)) out.add(width);
    }
    // `\bSize\(` and not `Size\(`: `tester.getSize(...)` is not a size literal.
    for (const m of code.matchAll(/\bSize\(\s*(\d+(?:\.\d+)?)\s*,/g)) out.add(Number(m[1]));
    pumpedCache.set(name, out);
    return out;
  }

  const covered = new Map(); // "<file>#<Symbol>" → [test file, …]
  const IMPORT_RE = new RegExp(`import\\s+'package:${escapeRe(R.pkg ?? ' ')}/([^']+\\.dart)'`, 'g');
  for (const name of testFiles) {
    const rel = `${testRel}/${name}`;
    const code = read(rel);

    const declaredHere = new Map(); // Symbol → [declaring file, …]
    IMPORT_RE.lastIndex = 0;
    for (const m of code.matchAll(IMPORT_RE)) {
      for (const declRel of resolveImport(R, m[1])) {
        for (const symbol of surfacesIn(declRel, R.kind)) {
          if (!declaredHere.has(symbol)) declaredHere.set(symbol, []);
          if (!declaredHere.get(symbol).includes(declRel)) declaredHere.get(symbol).push(declRel);
        }
      }
    }

    // 🔴 THE PACKAGE BOUND. An app root's corpus is already bounded by the
    // width naming rule; a package root's is the whole suite, so CONSTRUCTING a
    // widget in `auth_field_test.dart` must not by itself count as measuring
    // its width. A package-root file contributes coverage only if it pumps at
    // least one surface size. See the header.
    if (R.kind === 'package' && widthsPumpedBy(name).size === 0) continue;

    for (const [symbol, files] of declaredHere) {
      // Construction/invocation, not a bare mention: `find.byType(HomeScreen)`
      // names a widget without pumping one, and a name in an argument list is
      // not a measurement.
      if (!new RegExp(`\\b${symbol}\\s*\\(`).test(code)) continue;
      if (files.length > 1) {
        problem(
          `AMBIGUOUS SUBJECT — ${rel} imports ${files.length} files that each declare \`${symbol}\` ` +
            `(${files.join(', ')}), so this guard cannot tell WHICH of them the test pumps. Keying by file ` +
            'is exactly what catches an unrouted twin, and a collision inside one test defeats it.',
        );
        continue;
      }
      const key = `${files[0]}#${symbol}`;
      if (!covered.has(key)) covered.set(key, []);
      covered.get(key).push(name);
    }
  }

  // ══════════════════════════════════════════════════════════════════════
  // WHICH ROUTED SURFACES DELEGATE INTO THE CHASSIS — see the resolver above.
  // Asked over the routed set, not over the disk: the question is only ever
  // about a surface a user can open. The chassis root does not ask it of
  // itself — a widget importing its own package is not a delegation.
  // ══════════════════════════════════════════════════════════════════════
  const delegatesTo = new Map(); // routed key → [package file, …]
  if (R.dir !== CHASSIS_DIR) {
    for (const [key, entry] of routed) {
      const d = delegationOf(entry.file);
      if (d === null) continue;
      if (d.lost) {
        rootProblems.push(`COVERAGE LOST — ${d.lost}`);
        continue;
      }
      delegatesTo.set(key, d.files);
    }
  }

  return {
    R,
    routed,
    covered,
    delegatesTo,
    excluded,
    routerTargets,
    declaringFiles,
    testFiles,
    corpusRule,
    windowClasses,
    windowSource,
    widthsPumpedBy,
    goRoutes,
    redirectOnly,
    spineFiles,
    routerRel,
    featuresRel,
    testRel,
    harnessRel,
    problems: rootProblems,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// EVERY ROOT, THEN THE ACCOUNTING OVER EACH
// ═══════════════════════════════════════════════════════════════════════════
const analyses = problems.length === 0 ? roots.map(analyseRoot) : [];

ok(
  `${roots.length} root(s) DERIVED, never listed — ${derivation.join(' · ')}` +
    (IS_FULL_CHECKOUT
      ? ` (FULL CHECKOUT: all ${REQUIRED_COVERAGE.length} declared root(s) are required to be among them)`
      : ' (PARTIAL TREE: the declared-root-must-exist clause is SKIPPED; every derived root still ' +
        'carries its own floor)'),
);

const byDir = new Map(analyses.map((a) => [a.R.dir, a]));
const totals = { routed: 0, covered: 0, delegated: 0, uncovered: 0, files: 0, excluded: 0 };

/** The chassis measurements that discharge a delegating surface's obligation.
 *  `null` = does not delegate; `{ lost }` = it does and the chassis is not in
 *  the domain, so nothing measures it; `{ via }` = the package file(s) whose
 *  width tests cover it (empty when the chassis carries the widget but no test).
 *
 *  🔴 KEYED BY FILE, NOT BY SYMBOL. The adapter is still `SettingsScreen`;
 *  the widget it delegates to is called whatever the chassis calls it, and
 *  requiring the two names to match would make every delegation read as
 *  uncovered for a reason that has nothing to do with width. */
function delegatedCoverage(a, key) {
  const targets = a.delegatesTo.get(key);
  if (!targets) return null;
  const owner = byDir.get(CHASSIS_DIR);
  if (!owner) {
    return {
      lost:
        `\`${key.split('#')[1]}\` (${key.split('#')[0]}) delegates its surface to ${targets.join(', ')}, and ` +
        `\`${CHASSIS_DIR}\` is NOT among the ${analyses.length} root(s) this scan derived. The screen's width ` +
        'decision is therefore measured by nothing at all: it left this root by moving house and never ' +
        'arrived anywhere this guard looks. Put the chassis package on the workspace list with a ' +
        '`flutter_test` dev-dependency and a public widget, or stop delegating to it.',
    };
  }
  const via = targets.filter((f) => [...owner.covered.keys()].some((k) => k.startsWith(`${f}#`)));
  return { via };
}

/** Measured in its own root, or measured where it now lives. */
const isCovered = (a, key) => a.covered.has(key) || (delegatedCoverage(a, key)?.via?.length ?? 0) > 0;

for (const a of analyses) {
  const { R } = a;
  const label = R.dir;
  const floor = REQUIRED_COVERAGE.find((r) => r.dir === R.dir) ?? null;
  // 🔴 A ROOT WITH NO DECLARED ENTRY IS ENFORCED. Report mode is a DECISION
  // taken per root with a date beside it, never the default a new root falls
  // into — a default that silences is a default nobody notices.
  const enforce = floor ? floor.enforce : true;
  const NOT_A_PANE = NOT_A_PANE_BY_ROOT.get(R.dir) ?? new Map();

  if (a.goRoutes > 0) {
    ok(
      `${label}: ${a.goRoutes} GoRoute(s) parsed — ${a.goRoutes - a.redirectOnly} with a builder, ` +
        `${a.redirectOnly} redirect-only (router spine: ${a.spineFiles.length} file(s) — ` +
        `${a.spineFiles.join(', ')})`,
    );
  }

  // ═══════════════════════════════════════════════════════════════════════
  // (D) EMPTY PARSE ⇒ COVERAGE LOST
  //     Either set empty makes the equality below TRIVIALLY TRUE in one
  //     direction and catastrophically wrong in the other, and it reports as a
  //     pass. The marker string is what assert-guard-coverage.mjs looks for.
  // ═══════════════════════════════════════════════════════════════════════
  if (a.routed.size === 0) {
    a.problems.push(
      `COVERAGE LOST — the ROUTED set of \`${label}\` parsed EMPTY. Nothing was found to require a width ` +
        'test, so every existing width test in that root would be reported as dead coverage and a router ' +
        'full of screens would be reported as fully covered. The parse has stopped reaching the tree.',
    );
  }
  // 🔴 `parsedCleanly` MEANS "THE PARSE REACHED THE TREE", NOT "NOTHING HAS
  // GONE WRONG YET", AND THE DIFFERENCE IS A MEASURED DEFECT. The
  // `coveredSurfaces` floor lived HERE for one draft on 2026-09-05, and
  // tripping it suppressed the whole set-equality section below — so deleting
  // one width case reported `18 measured, floor is 19` and NEVER NAMED THE
  // SURFACE. A failure message that withholds the name is read at the exact
  // moment somebody is deciding what broke. The floor now lives in section (G),
  // with the other floors, and only a genuinely EMPTY routed set gates the
  // accounting.
  const parsedCleanly = a.problems.length === 0;

  // ═══════════════════════════════════════════════════════════════════════
  // (E) SET EQUALITY, BOTH DIRECTIONS
  // ═══════════════════════════════════════════════════════════════════════
  const uncovered = parsedCleanly
    ? [...a.routed.keys()].filter((k) => !isCovered(a, k)).sort()
    : [];
  // Measured WHERE THEY NOW LIVE — counted apart from this root's own tests so
  // no line ever implies this suite did work the chassis's suite did.
  const delegated = parsedCleanly
    ? [...a.routed.keys()].filter((k) => !a.covered.has(k) && isCovered(a, k)).sort()
    : [];
  a.uncovered = uncovered;
  a.delegated = delegated;

  // A DELEGATION WITH NOWHERE TO LAND. The refusal that makes the widening
  // safe: `isCovered` is allowed to answer "measured, in the chassis", and if
  // the chassis is not in the domain that answer is not available at all.
  for (const key of [...a.delegatesTo.keys()].sort()) {
    const d = delegatedCoverage(a, key);
    if (d?.lost) a.problems.push(`COVERAGE LOST — ${d.lost}`);
  }

  if (parsedCleanly) {
    for (const key of uncovered) {
      const { file, symbol, via, kind } = a.routed.get(key);
      const finding =
        `UNCOVERED SURFACE — \`${symbol}\` (${kind}, ${file}${via ? `, routed via ${via}` : ''}) is ` +
        'reachable and NO width test measures it. "The content grew to fill a 1920 px display" raises no ' +
        'exception and clips no pixel; a surface with no measurement is a surface with no width decision. ' +
        `Add a case under ${a.testRel} that pumps it at every window class.`;
      if (enforce) a.problems.push(finding);
    }

    const dead = [...a.covered.keys()].filter((k) => !a.routed.has(k)).sort();
    for (const key of dead) {
      const [file, symbol] = key.split('#');
      a.problems.push(
        `DEAD COVERAGE — ${a.covered.get(key).join(', ')} measures \`${symbol}\` from \`${file}\`, and ` +
          'NOTHING ROUTES TO IT. The measurement is green and it is measuring a widget no user can open. ' +
          'This is the unrouted-twin defect verbatim: the screen with the width cap had no user and the ' +
          'screen with the user had no width cap. Re-point the test at the routed surface, or route to ' +
          'this one.',
      );
    }

    if (uncovered.length === 0 && dead.length === 0) {
      ok(`${label}: ${a.routed.size} surface(s) reachable, ${a.covered.size} measured — the two sets are EQUAL`);
    } else if (!enforce) {
      ok(
        `${label}: ${a.covered.size} of ${a.routed.size} surface(s) measured — ${uncovered.length} PRINTED ` +
          'and not failed [report mode, G-3 2026-09-05], and the measured ones are held by a floor of ' +
          `${floor ? floor.coveredSurfaces : 0}`,
      );
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  // (F) WHICH WINDOWS THE MEASUREMENT ACTUALLY PUMPS
  //
  // The required widths are the harness's own named window classes — [kPhone],
  // [kTablet], [kDesktop]. Not [kWide]: 1920 is the case that can go red for a
  // `kMaxBodyWidth` screen and is meaningless for one capped at `pane`, so
  // requiring it would force an assertion that cannot fail onto half the
  // domain. The three required ones are the CLASSES a layout branches on, and a
  // surface unmeasured in one of them has no width decision there whatever its
  // file count says.
  // ═══════════════════════════════════════════════════════════════════════
  const missingClasses = REQUIRED_WIDTHS.filter((w) => !a.windowClasses.has(w));
  if (a.windowClasses.size === 0) {
    // 🔴 PRINTED, AND FATAL ONLY WHERE IT WAS EARNED. For subly the harness is
    // the vocabulary and losing it is COVERAGE LOST (R5). For a root that has
    // never declared window classes — design_system writes raw `Size(375, 812)`
    // — the requirement cannot be applied at all, and saying so out loud is the
    // only honest move. A check silently not applied is indistinguishable from
    // one that passed.
    const line =
      `\`${label}\` declares NO \`const Size k… = Size(w, h)\` window class, in ${a.harnessRel} or ` +
      `anywhere in its width corpus, so the ${REQUIRED_WIDTHS.join('/')} requirement was NOT APPLIED to ` +
      'any of its surfaces. Coverage there means "some case pumps this widget at some size", which is ' +
      'weaker than what every other root gets.';
    if (floor && floor.widthTestFiles > 0 && a.testFiles.length > 0 && floor.enforce) {
      a.problems.push(`COVERAGE LOST — ${line} The harness moved, or its window classes are now spelled some other way.`);
    } else {
      notes.push(`⚠️ ${line} → declare kPhone/kTablet/kDesktop in ${a.harnessRel} and this root joins the strong form.`);
    }
  } else if (missingClasses.length) {
    a.problems.push(
      `\`${missingClasses.join('`, `')}\` ${missingClasses.length === 1 ? 'is' : 'are'} required of every ` +
        `responsive surface and \`${label}\` declares ${missingClasses.length === 1 ? 'it' : 'them'} ` +
        `nowhere (window classes read from ${a.windowSource}: ` +
        `${[...a.windowClasses.keys()].join(', ')}). A requirement naming a constant that does not exist ` +
        'ranges over nothing and reports clean.',
    );
  }

  if (parsedCleanly && a.windowClasses.size > 0) {
    for (const key of WIDTH_EXEMPT.keys()) {
      if (!key.startsWith(`${label}/`)) continue;
      if (!a.covered.has(key)) {
        a.problems.push(
          `\`${key}\` is exempted from a required width but it is not in the covered set at all. An ` +
            'exemption for a surface nothing measures reports judgement over nothing — it moved, or it is gone.',
        );
      }
    }

    for (const key of [...a.covered.keys()].sort()) {
      const [file, symbol] = key.split('#');
      const pumped = new Set();
      for (const name of a.covered.get(key)) for (const w of a.widthsPumpedBy(name)) pumped.add(w);
      const exempt = WIDTH_EXEMPT.get(key) ?? new Map();

      for (const windowClass of REQUIRED_WIDTHS) {
        const width = a.windowClasses.get(windowClass);
        if (width === undefined) continue; // already reported above
        if (pumped.has(width)) continue;
        if (exempt.has(windowClass)) continue;
        const finding =
          `UNMEASURED WIDTH — \`${symbol}\` (${file}) is measured by ${a.covered.get(key).join(', ')}, ` +
          `and not one case pumps ${windowClass} (${width}). The widths it does pump are ` +
          `${[...pumped].sort((x, y) => x - y).join(', ') || '(none this parse could read)'}. A width ` +
          'test file is not a width measurement: the set equality above sees the file and cannot see ' +
          'which windows it opens. Add the case, or argue the omission in WIDTH_EXEMPT.';
        if (enforce) a.problems.push(finding);
        else notes.push(`   ⬜ ${finding}`);
      }

      for (const [windowClass, why] of exempt) {
        if (!a.windowClasses.has(windowClass)) continue;
        if (pumped.has(a.windowClasses.get(windowClass))) {
          a.problems.push(
            `STALE EXEMPTION — \`${symbol}\` (${file}) is exempted from ${windowClass} on the grounds that ` +
              `it ${why} — but ${a.covered.get(key).join(', ')} now pumps it. The case exists; delete the ` +
              'exemption so the width is required of it like every other surface.',
          );
        }
      }
    }

    if (a.problems.length === 0 && enforce) {
      ok(
        `${label}: every measured surface is pumped at ` +
          `${REQUIRED_WIDTHS.map((w) => `${w} (${a.windowClasses.get(w)})`).join(', ')}` +
          `${[...WIDTH_EXEMPT.keys()].some((k) => k.startsWith(`${label}/`)) ? ' — argued exemption(s) printed below' : ''}` +
          ` (window classes read from ${a.windowSource})`,
      );
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  // (G) THE PER-ROOT FLOORS — what set equality cannot see. See (0b).
  // ═══════════════════════════════════════════════════════════════════════
  if (floor) {
    // 🔴 THE BACKSTOP. `covered.size === 0 ⇒ COVERAGE LOST` was right for the
    // one root this guard could see and is wrong the moment a root with little
    // coverage joins: it would redden CI over work nobody has started. A floor
    // keeps the strength where it was earned — subly's is 19, so ANY loss there
    // fires — and a report-mode root's floor is its measured coverage, which is
    // what stops "printed, not failed" from meaning "not checked".
    // 🔴 THE FLOOR COUNTS DELEGATED COVERAGE, AND IT HAS TO. A screen moving
    // into the chassis takes its width test with it; counting only this root's
    // own tests would make [ADR 066] step 4 fail this floor on every unit,
    // which trains the next reader to lower it — and a floor that is lowered
    // to make a move land is a floor that has stopped holding anything.
    const measured = a.covered.size + (a.delegated?.length ?? 0);
    if (measured < floor.coveredSurfaces) {
      a.problems.push(
        `COVERAGE LOST — \`${label}\` has ${measured} measured surface(s) and its measured floor is ` +
          `${floor.coveredSurfaces} (${floor.label}). Coverage that WAS there is gone. That may be a ` +
          'legitimate move; it may not be a QUIET one. Restore it, or lower the floor in the same change ' +
          'with the reason beside it.',
      );
    }
    if (a.routed.size > 0 && a.routed.size < floor.surfaces) {
      a.problems.push(
        `COVERAGE LOST — \`${label}\` has only ${a.routed.size} responsive surface(s) in the domain, and ` +
          `its checked-in floor is ${floor.surfaces} (${floor.label}). Set equality cannot see this: a ` +
          'screen and its width test deleted together keep the two sets equal while the domain shrinks. ' +
          'Lower the floor deliberately in the same change that removes the surface, with the reason beside it.',
      );
    }
    if (a.testFiles.length < floor.widthTestFiles) {
      a.problems.push(
        `COVERAGE LOST — \`${label}\` yielded only ${a.testFiles.length} width test file(s) — the corpus ` +
          `is ${a.corpusRule} — and the checked-in floor is ${floor.widthTestFiles}. The files did not ` +
          'become correct; the scan stopped reaching them.',
      );
    }
  } else {
    notes.push(
      `⬜ ${label} is DERIVED but has no measured floor in REQUIRED_COVERAGE. It is scanned in full and ` +
        'ENFORCED (an uncovered surface there fails), but it cannot yet fail on a domain that SHRINKS. ' +
        'Measure it and declare it.',
    );
  }

  // ── THE EXCLUSION SELF-CHECKS ────────────────────────────────────────────
  for (const [symbol, why] of NOT_A_PANE) {
    if (!a.routerTargets.has(symbol)) {
      a.problems.push(
        `\`${symbol}\` is excluded in NOT_A_PANE for \`${label}\` but no route in ${a.routerRel} builds ` +
          'it. Either it moved and the entry did not follow, or it is retired and the entry should have ' +
          'gone with it — an exception for something that is not there reports judgement over nothing.',
      );
    }
    const declaredAsSurface = a.declaringFiles.find((f) => surfacesIn(f, R.kind).includes(symbol));
    if (declaredAsSurface) {
      a.problems.push(
        `\`${symbol}\` is excluded in NOT_A_PANE for \`${label}\` but \`${declaredAsSurface}\` declares it ` +
          'as a surface of that same root. It is a pane after all; remove the exclusion and measure it.',
      );
    }
  }

  totals.routed += a.routed.size;
  totals.covered += a.covered.size;
  totals.delegated += delegated.length;
  totals.uncovered += uncovered.length;
  totals.files += a.testFiles.length;
  totals.excluded += a.excluded.length;
  for (const p of a.problems) problems.push(p);

  // ── THE REPORT, PRINTED EVERY RUN ────────────────────────────────────────
  // Counted is not enough. The failure this repo keeps recording is an unmet
  // clause that produced NO OUTPUT AT ALL.
  notes.push(`── ${label} (${R.kind} root, package \`${R.pkg}\`) ─────────────────────────`);
  notes.push(
    `   corpus: ${a.corpusRule} — ${a.testFiles.length} file(s); window classes: ` +
      `${a.windowClasses.size ? `${[...a.windowClasses.entries()].map(([k, v]) => `${k}=${v}`).join(', ')} (from ${a.windowSource})` : 'NONE DECLARED — the required-width check was SKIPPED for this root'}`,
  );
  if (uncovered.length && !enforce) {
    notes.push(
      `⬜ ${uncovered.length} of ${a.routed.size} reachable surface(s) in ${label} have NO width ` +
        'measurement. PRINTED, NOT FAILED — report mode, [G-3] 2026-09-05, because this root entered the ' +
        'domain that day and the files that would fix it are not files that change owned. It is owed, and ' +
        `the ${a.covered.size} that ARE measured are held by a floor so this list cannot grow in silence —`,
    );
    for (const key of uncovered) {
      const { file, symbol, via, kind } = a.routed.get(key);
      notes.push(`   · ${symbol} (${kind}, ${file}${via ? `, via ${via}` : ''})`);
    }
    notes.push(
      `   → add a case under ${a.testRel} that pumps the surface at every window class, raise this root's ` +
        '`coveredSurfaces` floor in the same change, and flip `enforce` to true when the list reaches zero.',
    );
  }
  for (const [key, widths] of WIDTH_EXEMPT) {
    if (!key.startsWith(`${label}/`)) continue;
    for (const [windowClass, why] of widths) {
      notes.push(`⬜ ${key.split('#')[1]} is NOT required at ${windowClass} — it ${why}`);
    }
  }
  if (a.excluded.length) {
    notes.push(
      `⬜ ${a.excluded.length} builder target(s) in ${label} DELIBERATELY OUTSIDE the domain, printed not hidden:`,
    );
    for (const e of a.excluded.sort((x, y) => x.what.localeCompare(y.what))) {
      notes.push(`   · ${e.what} — ${e.why}`);
    }
  }
}

// ── THE DECLARED ROOTS THAT NEVER ARRIVED ──────────────────────────────────
// The limbs above catch a derived root that went empty or fell under its floor.
// This one catches the step BEFORE it: a root that stopped being DERIVED.
// Cutting one line from the workspace list took assert-modal-detection from 349
// sites to 80 with an "ok" on the end, and nothing else could see it, because a
// root that is never derived is never empty.
if (IS_FULL_CHECKOUT && analyses.length > 0) {
  const lost = REQUIRED_COVERAGE.filter((r) => !byDir.has(r.dir));
  if (lost.length) {
    coverageLost(
      `${lost.length} of the ${REQUIRED_COVERAGE.length} DECLARED root(s) were not among the ` +
        `${roots.length} this run derived:\n` +
        lost.map((r) => `    · \`${r.dir}\` — ${r.label}`).join('\n') +
        `\n    The scan still read ${totals.routed} surface(s) from the root(s) that remain, so every ` +
        'count above would print healthy and the "ok" line would be literally true of a collapsed tree. ' +
        'Each root carries its OWN floor deliberately: a single floor over the union is satisfied by ' +
        'whichever root happens to be biggest, which is how assert-no-tls-pinning.mjs once passed over a ' +
        'deleted apps/ AND packages/ (its header, and assert-workspace-coverage.mjs:130-136 for the same ' +
        'shape again). Restore the root, or — if it really has left the tree for good — delete its entry ' +
        'in REQUIRED_COVERAGE in the same commit, so the domain shrinks on purpose.',
    );
  }
}

if (notes.length) console.log(`\n${notes.join('\n')}`);

if (problems.length) {
  console.error('');
  for (const p of problems) console.error(`FAIL ${p}`);
  console.error('\nassert-responsive-coverage: FAILED');
  process.exit(1);
}

console.log(
  `\nassert-responsive-coverage: ok — ${roots.length} derived root(s) ` +
    `(${roots.map((r) => r.dir).join(', ')}); ${totals.routed} reachable surface(s), ${totals.covered} ` +
    `measured by ${totals.files} test file(s); ${totals.delegated} measured where they delegate to; ` +
    `${totals.uncovered} PRINTED as unmeasured in report-mode ` +
    `root(s); ${totals.excluded} exclusion(s) printed`,
);
