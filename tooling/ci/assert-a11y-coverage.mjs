#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════════════
// EVERY SURFACE A USER CAN REACH, IN EVERY TREE THIS FACTORY SHIPS, EITHER
// CARRIES AN A11Y SWEEP OR IS NAMED, OUT LOUD, ON EVERY RUN, AS ONE THAT DOES
// NOT. AND EVERY A11Y SWEEP POINTS AT A SURFACE A USER CAN REACH.
//
// ── WHY THIS EXISTS ────────────────────────────────────────────────────────
// P5 shipped `apps/subly/test/a11y_semantics_test.dart` and it found two real
// defects while it was being written — the calendar's hand-rolled renewal rows
// (a twin of `RowCard` that never inherited the fix) and the shell's FAB, whose
// `Tooltip` filled the `tooltip` slot and left `isButton` unset. It swept FIVE
// surfaces. The app has NINETEEN, and until this file existed nothing in the
// repository said which fourteen were unswept — or noticed if the five became
// four.
//
// A control a reader cannot identify raises no exception, clips no pixel and
// fails no existing assertion. It is only ever visible to a measurement,
// exactly like a width. So an unswept surface is an unpoliced one, and the
// accounting has to be mechanical.
//
// 🔴 THIS GUARD PRINTS THE GAP; IT DOES NOT FAIL ON IT. As of 2026-08-13 the
// gap in `apps/subly` was empty — the sweep landed all nineteen, so the printed
// list had ZERO entries FOR THAT ROOT. That does not make the printing limb
// decoration: the next surface to land arrives unswept and joins that list by
// existing, which is the ordinary case this guard was written for. A guard that
// reddened CI over work nobody has started would block every unrelated change
// on it — the standing [pipeline C-6] rule, recorded when four fail-closed seams
// shipped with no proven open path. What it DOES fail on is the other three
// things:
//   · COVERAGE LOST — the scan reached no root, no router, no surfaces, no
//     a11y file, no case, or no sweep at all, or a root fell under its own
//     measured floor. An empty set makes every statement below either vacuously
//     true or confidently wrong, and it reports as a pass.
//   · REGRESSION — a surface listed in that root's SWEPT_FLOOR, measured as
//     swept on a stated date, is not swept any more. Work leaving the tree is a
//     legitimate move; it may not be a QUIET one.
//   · DEAD COVERAGE — a sweep whose subject nothing routes to (see below).
// The distinction is the whole design: NEVER DONE prints, WAS DONE AND IS GONE
// fails.
//
// ═══════════════════════════════════════════════════════════════════════════
// 🔴🔴 THE DOMAIN IS DERIVED, AND UNTIL 2026-09-05 IT WAS ONE HARDCODED APP
// ═══════════════════════════════════════════════════════════════════════════
// This file opened with `const APP = 'apps/subly';` from the day it was written
// until 2026-09-05 [backlog G-3]. Two things followed from that line and both
// were measured, not feared:
//
//   · THE BRICK WAS UNCHECKED. `tooling/bricks/app/__brick__/apps/{{app_id}}`
//     is the template every future app is stamped from; it routes TWELVE
//     screens and carries NO `a11y_*_test.dart` at all. An accessibility defect
//     written there is stamped into app #2, app #3 and every app after, and
//     nothing in this repository said a word. That is not hypothetical: backlog
//     item B-4 was a gutter tap beside "Privacy" that TICKED CONSENT in every
//     stamped app, and it was fixed by hand in PR #456 because no guard saw it.
//   · `packages/design_system` WAS UNCHECKED — and this file's own exclusion
//     for `NotFoundScreen` said "the design system owns its semantics", which
//     was a promise nothing kept. [ADR 065] chassis step 2 moved the shared
//     widgets THERE: `nav_shell.dart`, `app_scaffold.dart`, `auth_field.dart`,
//     `destructive_confirm_dialog.dart`, `two_pane.dart` and eleven more. Those
//     nineteen widgets are mounted by every stamped app, so they are the MOST
//     reachable surfaces in the tree, and they were the only ones outside the
//     domain.
//
// 🔴 THE ROOTS ARE DERIVED, NEVER LISTED. A directory listing of `apps/` is
// REFUSED for a stated reason: the brick lane stamps `apps/probe` and does not
// remove it, so a listing differs between a dev box and CI and the domain would
// depend on which machine ran it. The derivation is the same one
// `assert-deletion-control.mjs` and `assert-modal-detection.mjs` use:
//
//   (1) THE BRICK TEMPLATE, anchored on `tooling/bricks/app/brick.yaml` — the
//       tree's OWN declaration that a brick lives here. Anchored rather than
//       opportunistic because the opportunistic form was measured failing:
//       assert-modal-detection.mjs records the brick's app directory renamed
//       away taking that scan from 329 sites to 263 with an "ok" on the end.
//   (2) EVERY `apps/*` ON THE ROOT `pubspec.yaml` `workspace:` LIST, without
//       further condition. An app that ships a screen has a router.
//   (3) EVERY `packages/*` ON THAT LIST whose OWN pubspec declares a
//       `flutter_test` dev-dependency AND which declares at least one public
//       widget class. Both halves are load-bearing and the second is PR #461's
//       disproof, re-measured here on 2026-09-05: `packages/analysis` is
//       lints-only, and `auth_supabase`, `notifications`, `platform_storage`,
//       `purchases` and `telemetry` all declare `flutter_test` and between them
//       declare ZERO public widget classes. Deriving them would make five
//       permanently empty roots, and an empty root is either a permanent red or
//       a floor of zero, which is not a floor. `design_system` is the ONE
//       package that clears both halves, and it clears them by measurement:
//       nineteen public widget classes under `lib/src/widgets/`.
//
// A root that is DERIVED but not DECLARED below is scanned anyway and simply
// has no measured floor yet — new members are covered on arrival. A root that
// is DECLARED and stops being DERIVED FAILS, because a root that is never
// derived is never empty and no emptiness limb can see it go.
//
// 🔴 ONE FLOOR PER ROOT, NEVER A UNION FLOOR. assert-no-tls-pinning.mjs records
// a union floor that stayed satisfied by the brick alone while `apps/` and
// `packages/` went to zero, and assert-workspace-coverage.mjs:130-136 records
// the same shape over an emptied `apps/`. Every floor in REQUIRED_COVERAGE
// below is keyed by root, and WHICH BRANCH WAS TAKEN IS PRINTED ON EVERY RUN.
//
// ── THE DOMAIN RULE, PER KIND OF ROOT ──────────────────────────────────────
// An APP ROOT (the brick, and every `apps/*` member) keeps the rule this file
// has always had, derived from the SAME SOURCE `assert-responsive-coverage.mjs`
// derives it from — the router and the feature tree — and deliberately not one
// word differently:
//
//   (1) ROUTED SCREENS — every widget a `builder:` in `<root>/lib/core/
//       router.dart` returns, INCLUDING the routes inside the
//       StatefulShellRoute branches. A builder target declared IN the router
//       itself (a private `_Wrapper`, e.g. `_GatedInsights`) is resolved ONE
//       LEVEL to the feature screen it builds, because the wrapper is a gate
//       and the pane is what the user is handed.
//   (2) MODAL SHEETS — every `show*Sheet` function declared under
//       `<root>/lib/features/**`. A sheet is a surface a reader has to
//       traverse, and nothing about being modal changes that.
//
// A PACKAGE ROOT HAS NO ROUTER, AND THAT CHANGES THE VOCABULARY RATHER THAN
// WEAKENING IT. In an app, a widget nothing routes to is unreachable — which is
// the whole DEAD COVERAGE limb below. In a package, every PUBLIC widget class
// is reachable by construction: the package exists to be mounted, the barrel
// exports it, and every stamped app inherits it. So the domain of a package
// root is every `class X extends …Widget` declared under `<root>/lib/**` whose
// name does not start with `_`. That is strictly MORE reachable than a routed
// screen, not less, and it is why `NotFoundScreen` can be excluded from
// `apps/subly` on the grounds that "the design system owns its semantics" and
// have that sentence be TRUE for the first time.
//
// 🔴 THERE IS NO SECOND HARDCODED LIST OF SCREENS HERE, AND THAT IS THE POINT.
// A checked-in enumeration of the nineteen would be the copy that silently
// stops matching the first. The only checked-in sets in this file are
// NOT_A_PANE (argued non-panes, per root) and SWEPT_FLOOR (measured sweeps, per
// root), and BOTH are self-checked against the derived domain in both
// directions below — an entry the tree no longer contains fails, and an entry
// the tree contradicts fails.
//
// 🔴 TWO GUARDS, ONE DOMAIN, TWO COPIES OF THE PARSE — SAID OUT LOUD RATHER
// THAN LEFT TO BE DISCOVERED. This repository's rule is to extract a shared
// parse the moment a second consumer appears (`workflow-scan.mjs` was pulled
// out of assert-release-provenance for exactly that reason: four copies of a
// workflow parser drift in the one way that reports clean, which is WHICH LINES
// THEY CAN SEE). The extraction is now OWED TWICE OVER — the root derivation
// above is a third copy of what assert-modal-detection.mjs and
// assert-deletion-control.mjs already carry — and it was NOT taken in the
// change that widened these two guards, for a reason on the record: that change
// was scoped to these two files and their tests, and a new shared module under
// tooling/ci would have been edited by no test in this change. The drift cannot
// be silent in the meantime — each copy carries its own MEASURED per-root floor
// over the SAME tree, so a copy that stops reaching a root falls under its own
// floor and fails by name instead of reporting a smaller domain as fully
// accounted for. The two floors agreeing is the expected reading; a
// DISAGREEMENT is the signal that one parse has drifted.
// ⚠️ EXTRACT `deriveRoots()` INTO ONE MODULE. It has four call sites now.
//
// Everything else a `builder:` returns is an EXCLUSION, and exclusions are
// PRINTED ON EVERY RUN with their reason — never dropped silently. The same two
// shapes the responsive guard argues, restated here because this guard has to
// be readable on its own:
//   · the SHELL WRAPPER (`AppShell`) — chrome, not a pane;
//   · the DIALOG/ERROR surface (`NotFoundScreen`) — declared in
//     packages/design_system, which is now a root of this scan in its own
//     right, so the design system owning its semantics is a fact this guard
//     checks rather than a promise it makes.
// A redirect-only `GoRoute` has no builder and therefore no surface; printed
// too, for the same reason.
//
// 🔴 AN UNKNOWN BUILDER TARGET IS A FAILURE, NOT AN EXCLUSION. NOT_A_PANE is a
// statement about known non-panes, not an allowlist screens can be added to.
//
// ── HOW A SWEEP IS ESTABLISHED, AND WHY A FILE IS NOT ONE ──────────────────
// 🔴 THE HALF THAT DOES THE WORK. A surface is SWEPT when an `a11y_*_test.dart`
// file under that root's `test/` IMPORTS its declaring file (via
// `package:<the root's own pubspec name>/…`) AND SOME `testWidgets` BLOCK IN
// THAT FILE both CONSTRUCTS the symbol AND CALLS AN A11Y SWEEP. All three
// halves are load-bearing:
//   · the IMPORT gives provenance — which file the symbol came from;
//   · the CONSTRUCTION gives evidence the case actually pumps it;
//   · the SWEEP CALL is what distinguishes a measurement from a mention.
//
// ⚠️ THE PACKAGE NAME IS READ OUT OF EACH ROOT'S OWN `pubspec.yaml`, NEVER
// SPELLED HERE. It was `package:subly/` hardcoded until 2026-09-05. The brick's
// name is the literal string `{{app_id.snakeCase()}}` — a mustache placeholder
// that is not a valid Dart identifier and never will be until the brick is
// stamped — and the brick's own suite imports itself by exactly that spelling,
// so quoting the manifest is what makes the template readable at all.
//
// ⚠️ A PACKAGE ROOT'S SUITE IMPORTS THE BARREL, NOT THE FILE. Measured on
// 2026-09-05: fifteen of design_system's seventeen test files import
// `package:nikatru_design_system/nikatru_design_system.dart` and only three
// import a `src/widgets/…` file directly. Provenance would collapse to nothing
// under the app rule, so a barrel import is resolved ONE LEVEL through the
// `export 'src/…';` lines the barrel declares. One level and not a graph: a
// barrel re-exporting a barrel is not a shape this tree has, and a walk nobody
// can check is worse than a bound nobody has hit.
//
// The BLOCK is the unit, NOT the file, and that is the limb this guard exists
// for. Set equality over files would credit `a11y_semantics_test.dart` with
// every screen it so much as names — and RE-MEASURED ON THE TREE OF 2026-08-13
// AFTER THE TAP-TARGET SWEEP LANDED, TWENTY-EIGHT of its 81 cases construct a
// surface while asserting one label on it and never sweeping it (38 of the 81
// sweep nothing; 28 of those 38 pump a domain surface anyway).
// ~~TWENTY-SIX of its 60 cases … (36 of the 60 sweep nothing; 26 of those 36)~~
// — retracted 2026-08-13, same day, same file: that reading was taken before
// the tap-target family added 21 cases.
// ⚠️ AND THE FILE-LEVEL ANSWER HAPPENS TO AGREE TODAY IN SUBLY:
// the same one file that names those surfaces also sweeps all nineteen, so set
// equality over files would currently return the same verdict for the wrong
// reason. That coincidence is not reassurance — it is exactly the state in
// which a weaker check looks correct, and it lasts only until one sweep is
// deleted from a file that still names its subject, which is M1 below.
// "[en] the chart announces the total AND every category" is
// a real assertion and it says nothing whatever about whether that screen
// carries a control a user can activate and cannot identify. That is the
// `width_home_test.dart` defect one domain over: present in both sets, green,
// and measuring neither of the two window classes between a phone and an
// ultra-wide display. A test file is not a measurement.
//
// ── WHAT COUNTS AS A SWEEP, AND WHY THREE FAMILIES ─────────────────────────
// A sweep is a call that ranges over the WHOLE surface and can fail on a
// control added tomorrow, as opposed to an assertion about one label somebody
// already thought of. Three families are recognised, and each is a real
// mechanism rather than an aspiration:
//   · NAKED CONTROLS — `expectNothingNaked(` / `nakedControls(`, the walk this
//     app wrote: every node with a tap action that announces no role or no
//     name. All nineteen subly surfaces have it today. ~~and it is the ONLY
//     family any of them uses~~ — RETRACTED 2026-08-13, hours after it was
//     written, by the tap-target sweep below.
//   · TAP TARGET — flutter_test's own `meetsGuideline(androidTapTargetGuideline)`
//     / `iOSTapTargetGuideline` / `labeledTapTargetGuideline`. LIVE since
//     2026-08-13 ([ADR 048]): 19 cases, covering 17 of the 19 subly surfaces.
//   · CONTRAST — flutter_test's `meetsGuideline(textContrastGuideline)`.
// ⚠️ MEASURED, NOT ASSUMED, AND RE-MEASURED 2026-08-13 AFTER THE TAP-TARGET
// SWEEP LANDED — the reading below is the CURRENT one and the previous two are
// kept because the shape of the change is the lesson:
//   naked-controls ×24 · tap-target ×19 · contrast ×0  (81 cases, 43 sweeping)
// ~~the guideline matchers appear in ZERO source files in this repository — the
// only hits are inside compiled `build/test_cache/*.dill` artefacts, i.e. the
// framework's own bundle~~ — TRUE when this file was written and FALSE the same
// day. `meetsGuideline(androidTapTargetGuideline)` now appears 19× in
// apps/subly/test/a11y_semantics_test.dart, and NOTHING in this guard had to
// change for it to count: the family was recognised in advance and it started
// tallying non-zero on its own. That is the design working, and it is also why
// the tally is PRINTED on every run — "tap targets are checked nowhere" was a
// number a reader saw rather than a claim this header made, so when it stopped
// being true no prose had to be believed. `contrast ×0` is now the only one of
// the three still standing at zero.
//
// 🔴 AND BOTH SETS ARE KEYED BY `<file>#<Symbol>`, NEVER BY THE BARE CLASS
// NAME. Subly has already shipped two different classes called
// `OnboardingScreen` — the routed carousel and an unrouted STAMPED twin that
// `responsive_width_test.dart` spent its life measuring. A name-keyed guard
// finds the twin's name in the covered set and writes the exact bug it exists
// to catch into its own answer. The file is what distinguishes a twin from its
// original, so the file is part of the identity. Since 2026-09-05 the key is
// ROOT-QUALIFIED too, because the brick and subly declare a `SignUpScreen`
// each and they are different files with different sweeps.
//
// ── WHY THE CORPUS IS `a11y_*_test.dart` AND NOT "ANY FILE THAT TAKES A
//    SemanticsHandle" ──────────────────────────────────────────────────────
// ~~Three~~ FOUR other files under apps/subly/test call `ensureSemantics()` —
// chassis_properties, consent_clickwrap_a11y, consent_scrim_layout and
// dark_group_detail — and each
// asserts one targeted fact (an icon's label, a scrim's reading order, a Tamil
// back button). None sweeps a surface. ⚠️ THE "THREE" STOOD IN THIS HEADER
// UNTIL 2026-09-05 AND IT WAS ALREADY FOUR — a fourth file landed and no
// sentence followed it, which is the same prose-drift class this file's
// REQUIRED_COVERAGE block records three instances of. It is a number a reader
// can now see instead of believe: the count is PRINTED per root on every run,
// so the next one to land moves the output rather than needing a comment.
// Counting them would credit a surface
// with a sweep it never received, which is DEAD COVERAGE wearing a friendlier
// face. The cost of the naming rule is real and is stated rather than hidden:
// a11y work written into some other file does not count here. Name the file
// `a11y_<surface>_test.dart` and it does.
//
// ⚠️ THAT COST IS NOW VISIBLE RATHER THAN IMPLIED, AND THE MEASUREMENT IS NOT
// THE ONE THIS PARAGRAPH FIRST CLAIMED. Every root prints, on every run, two
// things about the a11y work that sits OUTSIDE its `a11y_*_test.dart` corpus:
// how many of its other test files call a recognised SWEEP helper, and how many
// take a `SemanticsHandle` without sweeping. Measured 2026-09-05 by grep before
// the sentence was written:
//   · recognised sweep helper outside the corpus — ZERO files in every root.
//     ~~design_system has FOUR~~ — retracted before it shipped: those four call
//     `ensureSemantics()` and nothing else, and `ensureSemantics` is NOT a
//     sweep family. Writing it down without running the grep would have put a
//     false number in a header whose whole subject is false numbers.
//   · `ensureSemantics` without a sweep — FOUR files in design_system
//     (auth_field, brand_lockup, focusable_tap, promo_card), FOUR in subly
//     (chassis_properties, consent_clickwrap_a11y, consent_scrim_layout,
//     dark_group_detail — the header below said THREE and had said it for a
//     file too long), ONE in the brick (chassis_properties).
//     Printed so that a reader of an empty ✅ list is never
//     left to infer a root has done no accessibility work at all — it has done
//     TARGETED work, which is exactly what the paragraph above argues is not a
//     sweep.
// 🔴 THE FIRST OF THOSE TWO LINES HAS NEVER BEEN NON-ZERO. That is the same
// standing of `contrast ×0` on the day this file was written, and it is
// recorded here for the same reason: a limb nothing has ever exercised is a
// limb nobody has read.
//
// ── COMMENTS ARE STRIPPED, AND SO ARE STRING LITERALS ──────────────────────
// Comments via tooling/ci/text-reductions.mjs, the reduction nine guards share.
// The header you are reading names `InsightsScreen`, `expectNothingNaked`,
// `AppShell` and `meetsGuideline`; unstripped, this file's own prose would
// parse as a router and a test suite at once.
//
// ⚠️ STRING LITERALS ARE STRIPPED TOO, BEFORE ANY CONSTRUCTION OR SWEEP MATCH,
// and that is not belt-and-braces. `expectNothingNaked`'s own failure text and
// several `expect` reasons in the real file discuss controls and screens by
// name; one domain over, `width_scan_test.dart` and `width_insights_test.dart`
// carry the word `kWide` inside a reason explaining why they need NO such case,
// and comment-stripping alone would have let a prose explanation of an ABSENT
// case satisfy the check for it — the `r2_buckets` defect, in a file arguing
// the opposite of what it would be credited with. (Imports are matched BEFORE
// that stripping, because an import path IS a string literal.)
//
// ── NEGATIVE TESTS, RUN AGAINST A COPY OF THE REAL TREE ────────────────────
// Recorded here because a guard whose failing path was never exercised is not a
// guard, and because all six fixtures of `assert-seams-wired.mjs` passed
// against a broken version — only mutating the REAL tree exposed it. Every
// mutation below was applied to a byte copy of the live repo, run, and
// restored. tooling/ci/test/a11y-coverage.test.mjs re-applies each one.
//   M1  delete the `expectNothingNaked` call from the CHECK-INBOX sweep
//       → CheckInboxScreen moves out of SWEPT and into the printed list, AND
//         REGRESSION fires by name (SWEPT_FLOOR). exit 1.
//       🔴 RE-POINTED 2026-08-13, AND THE OLD SUBJECT WAS SILENTLY VACUOUS.
//       M1/M2/M2b deleted the INSIGHTS sweep, which stopped unsweeping
//       InsightsScreen the moment the tap-target family landed: insights is
//       swept TWICE (naked-controls + tap-target), so deleting one call leaves
//       the surface swept and the guard is RIGHT to still report it — the
//       mutation no longer tested what its name said. check-inbox is swept by
//       exactly ONE family, and that is not an accident of today's tree: the
//       suite PINS it (`check-inbox hands the tap-target guideline NOTHING —
//       pinned`, a11y_semantics_test.dart:3069), so the day a tap-target sweep
//       becomes possible there the suite says so. The test file also asserts
//       the single-family precondition directly, so this cannot rot in silence
//       a second time.
//   M2  replace that call with a STRING mentioning `expectNothingNaked`
//       → identical to M1: prose does not sweep.
//   M3  delete every `GoRoute` from the router
//       → COVERAGE LOST, the reachable set of that root parsed EMPTY.
//   M4  rename `a11y_semantics_test.dart` out of the `a11y_*` corpus
//       → COVERAGE LOST, subly's declared a11y-file floor of 1 is unmet.
//   M5  rename EVERY sweep helper app-wide inside the test file — both naked
//       helpers AND `meetsGuideline`
//       → COVERAGE LOST, 110 cases parsed and not one sweeps.
//       ⚠️ `meetsGuideline` ADDED 2026-08-13. Renaming only the two naked
//       helpers left tap-target ×19 alive and 17 surfaces still swept, so the
//       mutation could no longer reach the `sweepingBlocks === 0` limb it is
//       named for. A mutation aimed at "not one sweep" has to neuter every
//       family this guard recognises, and it acquires a new one for free every
//       time SWEEP_FAMILIES grows.
//   M6  point a sweep at an unrouted twin screen
//       → DEAD COVERAGE, named.
//   M7  delete one route (`/notifications`) from the router
//       → COVERAGE LOST on subly's `surfaces` floor (18 < 19). ⚠️ TWO MORE
//         LIMBS CO-FIRE, re-measured 2026-08-13: with SWEPT_FLOOR covering the
//         whole domain, the removed route also strands its floor entry (FLOOR
//         OVER NOTHING) and strands its surviving sweep (DEAD COVERAGE). The
//         `surfaces` floor is therefore no longer demonstrable IN ISOLATION
//         for subly — it is still not redundant, because a surface added AFTER
//         the floor was measured sits in neither set and only this floor would
//         see it go. ✅ AND SINCE 2026-09-05 IT *IS* DEMONSTRABLE IN ISOLATION,
//         on another root: the brick has a `surfaces` floor and an EMPTY
//         SWEPT_FLOOR, so deleting one brick route fires the floor and nothing
//         else. See M11.
//   M8  delete four of the 110 cases, keeping every sweep
//       → COVERAGE LOST on subly's `cases` floor (106 < 110): every set above
//         is byte-identical and real assertions left the tree in silence.
//   M9  delete a NOT_A_PANE entry's route (AppShell)
//       → the exclusion self-check fires: judgement over nothing.
//   M10 THE POSITIVE CONTROL — land a reachable surface nothing sweeps (a new
//       `showExportSheet` under lib/features, which enters the domain FROM DISK
//       and so touches neither the router nor SWEPT_FLOOR), then add its sweep,
//       and watch it cross the line in TWO runs against ONE fixture.
//       Without M10, every result above is consistent with a guard that can
//       only ever say "unswept".
//   M11 🔴 THE ROOT MUTATIONS, ADDED 2026-09-05 WITH THE WIDENING. Each of
//       these left the guard GREEN before the widening — that is the defect,
//       and the measurement is the fix:
//       M11a rename the brick's app directory away        → COVERAGE LOST
//       M11b cut `  - packages/design_system` from the root workspace list
//                                                          → COVERAGE LOST
//       M11c cut `flutter_test:` from design_system's own pubspec
//                                                          → COVERAGE LOST
//       M11d cut `  - apps/subly` from the workspace list  → COVERAGE LOST
//       M11e delete one brick route                        → the brick's
//            `surfaces` floor alone, with no other limb firing
//       M11f delete one design_system widget file          → that root's
//            `surfaces` floor
//   M12 THE SECOND POSITIVE CONTROL, and the one that proves the NEW roots are
//       really in the domain rather than merely derived: land a surface in the
//       BRICK and one in DESIGN_SYSTEM and watch each appear, by name, in that
//       root's printed ⬜ list. A root that is derived but whose surfaces never
//       reach the report is a root this guard cannot see.
// ═══════════════════════════════════════════════════════════════════════════
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { listDir } from './tree-walk.mjs';
import { stripSourceComments, stripStringLiterals } from './text-reductions.mjs';
import { CHASSIS_DIR as SHARED_CHASSIS_DIR, delegationOf as resolveChassisDelegation } from './chassis-delegation.mjs';

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

/** The brick template, which stamps every future app. Scanned as a root of its
 *  own: an a11y defect stamped into app #2 is invisible in app #1's tree, and
 *  the brick has no Dart suite runner, so a static read is the ONLY reading it
 *  ever gets. */
const BRICK = 'tooling/bricks/app/__brick__/apps/{{app_id}}';
/** The brick PACKAGE's manifest — the tree's own declaration that a brick lives
 *  here. It is what turns the line above from an OPPORTUNISTIC `existsSync`
 *  into a derived requirement. assert-modal-detection.mjs measured the
 *  opportunistic form failing: the brick's app directory renamed away and
 *  nothing else touched took that scan from 329 sites to 263, exit 0, "ok". */
const BRICK_MANIFEST = 'tooling/bricks/app/brick.yaml';
/** What makes a `packages/` workspace member eligible: its own pubspec
 *  declaring the dependency a widget sweep COMES FROM. */
const SUITE_RUNNER_RE = /^\s+flutter_test:\s*$/m;

/** A PUBLIC widget class. `_FooState extends State<Foo>` is lower-cased out by
 *  the leading `[A-Z]`, which is also what keeps a package's private
 *  implementation widgets out of a domain nothing can mount directly. */
const WIDGET_DECL =
  /\bclass\s+([A-Z][\w$]*)\s+extends\s+(?:[A-Za-z_$][\w$]*\.)?(?:StatelessWidget|StatefulWidget|ConsumerWidget|ConsumerStatefulWidget|HookWidget|HookConsumerWidget)\b/g;
/** A surface in an APP root. Unchanged since this file was written. */
const SCREEN_DECL = /\bclass\s+([A-Za-z_$][\w$]*Screen)\b/g;
const SHEET_DECL = /^[ \t]*(?:Future<[^>]*>|void)\s+(show[A-Z][\w$]*Sheet)\s*\(/gm;

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

const roots = []; // { dir, kind: 'app' | 'package', pkg }
const derivation = [];

if (isDir(BRICK)) {
  roots.push({ dir: BRICK, kind: 'app' });
  derivation.push(`${BRICK} (brick template, declared by ${BRICK_MANIFEST})`);
} else if (existsSync(join(ROOT, BRICK_MANIFEST))) {
  coverageLost(
    `${BRICK_MANIFEST} exists, so this tree DECLARES a brick — but ${BRICK} does not, so the template ` +
      'every future app is stamped from contributed NOTHING to this scan. The other root(s) still hold ' +
      'a healthy non-empty domain, so every limb below would find something to look at and print ok over ' +
      'a root that silently left. The brick has no Dart suite runner of its own: a static read is the ' +
      'ONLY reading it ever gets, and an a11y defect stamped into app #2 is invisible in app #1. ' +
      'Re-point BRICK, or delete the brick.',
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
      } else if (dir.startsWith('packages/')) {
        const runner = declaresSuiteRunner(dir);
        const widget = runner && declaresAWidget(dir);
        if (runner && widget) {
          roots.push({ dir, kind: 'package' });
          derivation.push(`${dir} (workspace package member: declares flutter_test AND a public widget)`);
        }
      }
    }
  }
} catch {
  /* handled by workspaceRead below */
}
if (!workspaceRead) {
  coverageLost(
    'the root pubspec.yaml has no readable `workspace:` block, so the app AND package roots could not be ' +
      'derived. The domain would then be the brick alone — and the brick carries no a11y suite at all, ' +
      'which is the one shape of this scan that finds nothing to sweep and still prints ok.',
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
        'it every surface in that root would print as unswept — confident statements derived from having ' +
        'read nothing.',
    );
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// (0b) REQUIRED_COVERAGE — ONE FLOOR PER ROOT, NEVER A UNION FLOOR
//
// 🔴 assert-no-tls-pinning.mjs:94-175 records a union floor that stayed
// satisfied by the brick alone while apps/ AND packages/ went to zero;
// assert-workspace-coverage.mjs:130-136 records the same shape over an emptied
// apps/. A root that is never DERIVED is never EMPTY, so the derivation above
// cannot see a root leave on its own — that is what this table is for.
//
// TWO CLAUSES, AND THEY FIRE IN DIFFERENT SITUATIONS:
//   · A DECLARED ROOT THAT WAS NOT DERIVED fails — but only over a FULL
//     CHECKOUT, detected by this guard's OWN file being present under ROOT. The
//     sentinel sits outside every subject tree (`apps/`, `packages/`,
//     `tooling/bricks/`) and therefore survives any mutation OF a subject,
//     which a sentinel inside one of them would not. Partial trees are real and
//     legitimate: this guard's own suite builds one root at a time.
//   · A DERIVED ROOT UNDER ITS OWN FLOOR fails ALWAYS, checkout or fixture.
//     ⚠️ THE ASYMMETRY IS DELIBERATE AND IT IS NOT THE ONE assert-modal-
//     detection.mjs TOOK. Gating the floors themselves on IS_FULL_CHECKOUT
//     would make M7, M8, M11e and M11f un-testable — every one of them mutates
//     a byte copy of one root — and a floor no mutation can reach is a floor
//     nothing has ever exercised. A fixture root IS a byte copy of the real
//     root, so the measured floor is valid over it.
//
// ⚠️ WHICH BRANCH WAS TAKEN IS PRINTED ON EVERY RUN. A floor skipped in silence
// is indistinguishable from a floor that passed.
//
// ⚠️ A FLOOR IS ONLY A FLOOR ON THE DAY IT IS MEASURED. It has no way to notice
// the tree growing past it, so ADDING to it belongs in the same change that
// adds the surface — the step #280 skipped one domain over, which left
// assert-responsive-coverage's floor two surfaces under its tree for a week.
//
// EVERY NUMBER BELOW WAS PRODUCED BY RUNNING THIS GUARD ON 2026-09-05 AND
// READING ITS OWN PER-ROOT REPORT. None was incremented, inherited or guessed.
// ═══════════════════════════════════════════════════════════════════════════
const IS_FULL_CHECKOUT = existsSync(join(ROOT, 'tooling', 'ci', 'assert-a11y-coverage.mjs'));

const REQUIRED_COVERAGE = [
  {
    dir: 'apps/subly',
    // 19 reachable surfaces — 17 routed screens + 2 modal sheets.
    // 110 testWidgets cases in 1 file (a11y_semantics_test.dart), of which the
    //    sweeping families are naked-controls ×24 · tap-target ×19 · contrast ×24
    // ~~81 cases~~ — the reading after the tap-target increment.
    // ~~60 cases … 24 sweeping … 36 non-sweeping~~ — the reading before that.
    //
    // 🔴 THIS FLOOR WENT BLIND THREE TIMES IN ONE DAY AND THE RECORD STAYS.
    // The 2026-08-13 sweep moved SWEPT_FLOOR 5 → 19 and left `cases` at 24
    // while the suite grew 24 → 60 (**36 cases deletable in silence**); the
    // tap-target increment took it 60 → 81 and left `cases` at 60 (**21
    // deletable**); the contrast increment took it 81 → 109 and left `cases` at
    // 81 (**28 deletable**). Each time the floor could not fire AT ALL without
    // a sweep also being deleted, which the sets already catch. A floor that
    // can only fire when something else fires first is not a floor.
    // 📌 A guard extended in one dimension must be re-measured in EVERY
    // dimension it carries. Raising the membership set is not raising the
    // count. What caught the third occurrence was this guard's OWN test suite
    // (M8), which pins the floor's number in its regex — and that suite runs
    // ONLY under `node --test`, so a session that gates locally sees nothing.
    //
    // ⚠️ `surfaces: 19` IS THE SAME NUMBER assert-responsive-coverage.mjs
    // CARRIES for this root and that is a MEASUREMENT, not a copy. The two
    // guards range over the same domain by design, so agreement is the expected
    // reading and a DISAGREEMENT is the signal that one parse has drifted. If
    // you change one, RE-MEASURE the other rather than mirroring the edit.
    surfaces: 19,
    a11yFiles: 1,
    cases: 110,
    label: 'the app P5 wrote this guard for — 19 surfaces, all nineteen swept',
  },
  {
    dir: BRICK,
    // MEASURED 2026-09-05, the first day this root was ever in the domain:
    //   12 reachable surfaces — 12 routed screens, 0 modal sheets
    //   0 `a11y_*_test.dart` files, 0 cases, 0 swept.
    //
    // 🔴 `a11yFiles: 0` AND `cases: 0` ARE NOT A SHRUG, THEY ARE THE FINDING.
    // The brick is the template every future app inherits and it has never had
    // an accessibility sweep. That gap is PRINTED in full on every run — twelve
    // named surfaces — and it is reported to the owner rather than silenced.
    // A floor of zero cannot fall, so it says nothing; the `surfaces` floor is
    // what holds this root, and it is a real one: it is what fires when the
    // brick's router loses a route or the template stops being derived.
    // ⚠️ RAISE `a11yFiles` TO 1 AND `cases` TO WHATEVER THE FIRST BRICK SWEEP
    // MEASURES, IN THE SAME CHANGE THAT LANDS IT.
    surfaces: 12,
    a11yFiles: 0,
    cases: 0,
    label: 'the template every stamped app inherits — 12 routed screens, ZERO a11y sweeps',
  },
  {
    dir: 'packages/design_system',
    // MEASURED 2026-09-05, the first day this root was ever in the domain:
    //   19 public widget classes under lib/src/widgets/
    //   0 `a11y_*_test.dart` files, 0 cases, 0 swept — though FOUR of its
    //   seventeen test files do call a recognised sweep helper from outside the
    //   corpus, which is printed rather than left to be inferred.
    //
    // This is the root [ADR 065] chassis step 2 moved the shared widgets into,
    // and it is the root whose absence made `NotFoundScreen`'s exclusion from
    // apps/subly a promise nothing kept.
    surfaces: 19,
    a11yFiles: 0,
    cases: 0,
    label:
      'the shared chassis [ADR 065 step 2] — nav_shell, app_scaffold, auth_field, ' +
      'destructive_confirm_dialog, two_pane and fourteen more, mounted by every stamped app',
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
//
// Keyed by root since 2026-09-05: the brick and subly each route an `AppShell`
// and an errorBuilder `NotFoundScreen`, and one map over both would let an
// exclusion argued for one tree silence the other.
// ═══════════════════════════════════════════════════════════════════════════
const SHELL_WHY =
  'is the shell CHROME, not a pane — it hosts the bottom nav and an IndexedStack of the branch routes, ' +
  'each of which is in this domain on its own account. It is DECLARED IN packages/design_system, which ' +
  'is a root of this scan in its own right since 2026-09-05, so its own semantics are in the domain ' +
  'THERE rather than nowhere.';
const NOT_FOUND_WHY =
  'is the errorBuilder surface and it is DECLARED IN packages/design_system, not in this app. That was a ' +
  'promise nothing kept until 2026-09-05; design_system is now a root of this scan, so the design ' +
  'system owning its semantics is a fact this guard checks rather than a sentence it prints.';

const NOT_A_PANE_BY_ROOT = new Map([
  [
    'apps/subly',
    new Map([
      [
        'AppShell',
        'is the shell CHROME, not a pane — it hosts the bottom nav and an IndexedStack of the five branch ' +
          'routes, each of which is in this domain on its own account. Its OWN semantics are not unmeasured: ' +
          'the `shell ·` group pumps the REAL router and sweeps what it lands on — once per family since ' +
          '2026-08-13 — which is why the tally below reports sweeping case(s) that attribute to no surface ' +
          'rather than pretending there are none.',
      ],
      ['NotFoundScreen', NOT_FOUND_WHY],
    ]),
  ],
  [
    BRICK,
    new Map([
      ['AppShell', SHELL_WHY],
      ['NotFoundScreen', NOT_FOUND_WHY],
    ]),
  ],
]);

// ═══════════════════════════════════════════════════════════════════════════
// (0d) SWEPT_FLOOR — what WAS swept, by name, per root
//
// 🔴 A COUNT WOULD NOT DO, AND THE MUTATION THAT PROVES IT IS: delete one
// surface's sweep and add another's in the same change. A `sweptSurfaces: 19`
// number stays satisfied, the printed list is still empty, and the surface that
// lost its coverage lost it in silence. The floor is therefore a SET, and it
// names what it loses — which is what M1 measures: deleting the check-inbox
// sweep reports `REGRESSION — CheckInboxScreen` BY NAME, not a count that moved.
//
// It is NOT an allowlist and nothing can be added to it to silence anything —
// it is a measurement of work already done, and it is self-checked: an entry
// the domain no longer contains FAILS, because a floor over a surface that is
// not there is judgement over nothing.
//
// MEASURED 2026-08-13 for apps/subly by running this guard against the working
// tree: these NINETEEN keys were reported swept, each by a `nothing on … is
// naked` case in apps/subly/test/a11y_semantics_test.dart. That is the WHOLE
// domain of that root.
//
// 🔴 THE OTHER TWO ROOTS HAVE AN EMPTY FLOOR, AND THAT IS A MEASUREMENT TOO —
// on 2026-09-05 neither the brick nor design_system carried a single a11y
// sweep. An empty set here is not a waiver: every one of their surfaces is in
// the printed ⬜ list on every run, and the first sweep to land in either root
// belongs in this map in the same change.
//
// ⚠️ AN EMPTY FLOOR ALSO BUYS SOMETHING M7 LOST. With subly's floor covering
// its whole domain, no mutation there can fire the `surfaces` floor ALONE. The
// brick's floor is empty, so deleting one brick route fires its `surfaces`
// floor and nothing else — M11e — and the floor's independence is demonstrable
// again for the first time since 2026-08-13.
// ═══════════════════════════════════════════════════════════════════════════
const SWEPT_FLOOR_BY_ROOT = new Map([
  [
    'apps/subly',
    new Set(
      [
        'features/insights/insights_screen.dart#InsightsScreen',
        'features/budget/budget_screen.dart#BudgetScreen',
        'features/scan/scan_screen.dart#ScanScreen',
        'features/calendar/calendar_screen.dart#CalendarScreen',
        'features/detail/subscription_detail_screen.dart#SubscriptionDetailScreen',
        'features/auth/check_inbox_screen.dart#CheckInboxScreen',
        'features/auth/verify_email_screen.dart#VerifyEmailScreen',
        'features/auth/reaccept_terms_screen.dart#ReacceptTermsScreen',
        'features/auth/login_screen.dart#LoginScreen',
        'features/auth/sign_up_screen.dart#SignUpScreen',
        'features/auth/reset_password_screen.dart#ResetPasswordScreen',
        'features/home/home_screen.dart#HomeScreen',
        'features/settings/settings_screen.dart#SettingsScreen',
        'features/notifications/notifications_screen.dart#NotificationsScreen',
        'features/monetization/paywall_screen.dart#PaywallScreen',
        'features/monetization/manage_plan_screen.dart#ManagePlanScreen',
        'features/onboarding/onboarding_screen.dart#OnboardingScreen',
        'features/add/add_subscription_sheet.dart#showAddSubscriptionSheet',
        'features/cancel/cancel_sheet.dart#showCancelSheet',
      ].map((k) => `apps/subly/lib/${k}`),
    ),
  ],
  [BRICK, new Set()],
  ['packages/design_system', new Set()],
]);

// ── WHAT MAKES A CASE A SWEEP RATHER THAN A LABEL ASSERTION ────────────────
// See the header. Each family is matched on the literal-stripped BODY of one
// `testWidgets` block.
const SWEEP_FAMILIES = [
  {
    kind: 'naked-controls',
    re: /\b(?:expectNothingNaked|nakedControls)\s*\(/,
    what: 'every node with a tap action that announces no role or no name',
  },
  {
    kind: 'tap-target',
    re: /\bmeetsGuideline\s*\(\s*(?:android|iOS|labeled)TapTargetGuideline\b/,
    what: "flutter_test's own minimum tap-target sweep",
  },
  {
    kind: 'contrast',
    re: /\bmeetsGuideline\s*\(\s*textContrastGuideline\b/,
    what: "flutter_test's own text-contrast sweep",
  },
];
const A11Y_TEST = /^a11y_.*_test\.dart$/;
/** Not a sweep, and printed BECAUSE it is not one — see the header. A file that
 *  takes a SemanticsHandle is doing accessibility work of some kind; a file
 *  that takes one and asserts a single label is the exact shape this guard
 *  refuses to count, so it is named rather than left invisible. */
const SEMANTICS_HANDLE_RE = /\bensureSemantics\s*\(/;

// ── SHARED PARSE HELPERS ───────────────────────────────────────────────────

const surfaceCache = new Map();
/** The surfaces a file DECLARES, as bare symbol names.
 *
 *  APP roots keep the `…Screen` / `show…Sheet` vocabulary, deliberately the
 *  same one assert-responsive-coverage uses. PACKAGE roots use PUBLIC WIDGET
 *  CLASSES, because a package has no router and everything it exports is
 *  mounted by every app that depends on it — see the header. */
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
 *  Used for a route's argument list, a router-local class body and a
 *  `testWidgets(` argument list. Returning null rather than guessing is the
 *  point: a block this parse cannot close is REPORTED, never skipped, because a
 *  block dropped by a parser looks exactly like a block that was never there —
 *  and here it would look like it in the direction that reports LESS work than
 *  was done, quietly moving a swept surface onto the printed list. */
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
// `<root>/lib/core/router.dart` may be a BARREL over `<root>/lib/core/router/`
// — the ordered gate chain, the route table, the shell wiring, the navigator
// key and the `GoRouter` those assemble into. Every `GoRoute`, every `builder:`
// and every `import '../../features/…'` this guard's domain is built from lives
// in that directory when the split has happened.
//
// 🔴 READ AS ONE FILE AFTER THAT SPLIT THIS GUARD RANGES OVER A ROUTER WITH NO
// ROUTES IN IT, which is indistinguishable from a router that LOST them: the
// reachable set empties, every sweep is reported as dead coverage, and the
// argued non-panes fail as "no route builds it". The domain widens to the
// barrel PLUS `router/*.dart`, in that order, and to nothing else — same
// vocabulary, same regexes, same refusals. A tree whose router is still one
// file has no sibling directory and is read exactly as it was before. The brick
// is such a tree today; subly is not.
//
// Concatenated rather than scanned per file on purpose: `_GatedInsights` is
// declared in one file and routed from another, and the wrapper resolution
// below has to see both to resolve it to a feature surface.
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
 *  of barrel expansion. See the header: fifteen of design_system's seventeen
 *  test files import the barrel and only three import a widget file directly,
 *  so without this the provenance half collapses and every widget prints as
 *  unswept for a reason that has nothing to do with the package. */
function resolveImport(R, path) {
  const rel = `${R.dir}/lib/${path}`;
  if (!existsSync(join(ROOT, rel))) return [];
  const declared = surfacesIn(rel, R.kind);
  if (declared.length > 0) return [rel];
  const out = [];
  for (const m of read(rel).matchAll(/export\s+'([^':]+\.dart)'/g)) {
    const target = `${R.dir}/lib/${m[1]}`;
    if (existsSync(join(ROOT, target))) out.push(target);
  }
  return out.length ? out : [rel];
}

// ═══════════════════════════════════════════════════════════════════════════
// (0e) DELEGATION — WHEN A SCREEN MOVES INTO THE CHASSIS, ITS ACCESSIBILITY
//      MOVES WITH IT, AND THIS GUARD FOLLOWS IT THERE (ADR 067 decision 2)
//
// [ADR 065] moves the generic chassis into `packages/`; [ADR 066] scopes step 4
// to the screens whose CALL SITE measurably shrinks. What is left behind at
// each moved screen is an ADAPTER: a file at the same path, still routed, still
// named `SettingsScreen`, that owns a controller and hands plain values to a
// widget under `package:nikatru_chassis_screens`.
//
// 🔴 READ WITHOUT THIS RESOLVER, THAT ADAPTER IS A SURFACE WITH NO SEMANTICS.
// Every `Semantics(`, every label and every tap target left this file the day
// the screen moved, so the surface prints as owed FOREVER while the work that
// would discharge it sits one import away, in a file this scan judges under a
// different root. That is the `NotFoundScreen` failure this guard's own header
// records verbatim — "DECLARED IN packages/design_system … a promise nothing
// kept" — and the fix there was the same one: put the declaring file in the
// domain and follow the import to it.
//
// ⚠️ THE ADAPTER IS NOT REMOVED FROM THE ROUTED SET. It is still reachable, it
// is still counted, it still appears in the report. The domain WIDENS: the
// surface is swept when its own root sweeps it OR when the chassis root sweeps
// the file it delegates to. A resolver that moved surfaces OUT of the routed
// set would be shrinking a domain, which is the one direction every floor in
// this file exists to refuse.
//
// ⚠️ ONE LEVEL, LIKE THE BARREL RULE ABOVE, AND NOT A GRAPH. A single
// `package:nikatru_chassis_screens/…` import per adapter; if that path is a
// barrel it is expanded one level through its `export '…';` lines and no
// further. Two different chassis imports in one adapter is AMBIGUOUS and
// refused rather than guessed: this guard keys coverage by FILE, and a
// delegation it cannot attribute to one file defeats that exactly the way an
// unrouted twin does.
//
// ⚠️ AND EVERY REFUSAL IS COVERAGE LOST, NEVER SILENCE. A delegation that
// resolves to nothing on disk, and a delegation whose target is not inside any
// DERIVED ROOT of this scan, both mean the same thing: the accessibility of
// that screen is now judged NOWHERE, by a guard that would otherwise print ok.
// ═══════════════════════════════════════════════════════════════════════════
// 🔴 THE RULE IS NOT WRITTEN OUT AGAIN HERE. It lives in
// ./chassis-delegation.mjs — one import, one level, the target must be on
// disk, AND THE ADAPTER MUST ACTUALLY USE SOMETHING THE TARGET DECLARES.
// It shipped as eleven near-copies on 2026-09-05 and a review measured seven
// distinct implementations of the same paragraph with nothing in the tree
// comparing them; the module is that finding repaired. What stays HERE is the
// one thing that is this guard's own: a target with no PUBLIC WIDGET is no
// use to a scan whose unit of coverage is a widget, so the shared answer is
// narrowed by `surfacesIn` before it is accepted.
const CHASSIS_DIR = SHARED_CHASSIS_DIR;

/** Where `rel` delegates to, resolved one level, NARROWED to the files that
 *  declare a public widget.
 *
 *  Three answers, deliberately distinct — `null` (this file does not delegate),
 *  `{ lost }` (it does and the target could not be resolved, which the caller
 *  must report as COVERAGE LOST) and `{ files }` (the package file(s) that now
 *  own this surface's properties). Collapsing `null` and `{ lost }` is how a
 *  resolver that stopped reaching its target starts reporting "nothing to do". */
function delegationOf(rel) {
  const d = resolveChassisDelegation(ROOT, rel, { describe: (r) => `\`${r}\`` });
  if (d === null || d.lost) return d;
  const withWidgets = d.files.filter((f) => surfacesIn(f, 'package').length > 0);
  if (withWidgets.length === 0) {
    return {
      lost:
        `\`${rel}\` delegates to \`${d.files[0]}\`, which declares no public widget and re-exports none ` +
        'that does. One level of barrel expansion is all this resolver does, and it found nothing to ' +
        'judge — so the surface has no owner and nothing would ever fail over it.',
    };
  }
  return { files: withWidgets };
}

// ═══════════════════════════════════════════════════════════════════════════
// ONE ROOT, ANALYSED. Everything below (A)–(G) used to be top-level code over
// `const APP = 'apps/subly'`; it is the same accounting, once per derived root.
// ═══════════════════════════════════════════════════════════════════════════
function analyseRoot(R) {
  const routerRel = `${R.dir}/lib/core/router.dart`;
  const featuresRel = `${R.dir}/lib/features`;
  const testRel = `${R.dir}/test`;
  const notFound = []; // this root's problems
  const rootProblem = (m) => notFound.push(m);
  const rootCoverageLost = (m) => notFound.push(`COVERAGE LOST — ${m}`);
  const NOT_A_PANE = NOT_A_PANE_BY_ROOT.get(R.dir) ?? new Map();

  const reachable = new Map(); // "<file>#<Symbol>" → { file, symbol, via, kind }
  const excluded = []; // { what, why }
  const routerTargets = new Set();
  let goRoutes = 0;
  let redirectOnly = 0;
  let spineFiles = [];

  // ═══════════════════════════════════════════════════════════════════════
  // (A) THE REACHABLE SET
  // ═══════════════════════════════════════════════════════════════════════
  if (R.kind === 'app') {
    if (!existsSync(join(ROOT, routerRel))) {
      rootCoverageLost(
        `${routerRel} does not exist, so the reachable-surface half of this check ranged over NOTHING for ` +
          'this root and would have reported every a11y sweep in it as dead coverage. The router is the ' +
          'domain; without it there is no question to ask.',
      );
    } else {
      const spine = routerSpine(routerRel);
      spineFiles = spine.files;
      const router = spine.src;

      // Which feature file each symbol the router imports comes from. Relative
      // imports, because that is how a router spells them (`../features/…`).
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
          rootProblem(
            `AMBIGUOUS SURFACE — ${routerRel} imports ${files.length} feature files that each declare ` +
              `\`${symbol}\` (${files.join(', ')}), so a \`${symbol}(\` in the router cannot be attributed ` +
              'to one of them. That is the twin shape this guard keys by file to catch; resolve the ' +
              'collision rather than guessing.',
          );
        }
      }

      // ── Every GoRoute is accounted for: a builder target, or a redirect ──
      // Walked route by route rather than by a bare `builder:` regex, so a
      // route this parse cannot classify FAILS instead of vanishing.
      const unparsed = [];
      for (const m of router.matchAll(/\bGoRoute\s*\(/g)) {
        goRoutes++;
        const open = m.index + m[0].length - 1;
        const inner = sliceCall(router, open);
        if (inner === null) {
          unparsed.push(`a GoRoute( at offset ${m.index} whose argument list this parse could not close`);
          continue;
        }
        if (/\bbuilder\s*:/.test(inner)) continue; // handled by the builder pass below
        if (/\bredirect\s*:/.test(inner)) {
          redirectOnly++;
          const path = /\bpath\s*:\s*'([^']*)'/.exec(inner)?.[1] ?? '(unnamed)';
          excluded.push({
            what: `GoRoute ${path}`,
            why: 'is REDIRECT-ONLY — it declares no builder, so it renders nothing and there is no surface for a reader to traverse.',
          });
          continue;
        }
        unparsed.push(`a GoRoute( at offset ${m.index} with neither a builder: nor a redirect:`);
      }
      if (unparsed.length) {
        rootCoverageLost(
          `${unparsed.length} route(s) in ${routerRel} could not be classified: ${unparsed.join('; ')}. ` +
            'An unclassified route is a screen this guard cannot see, and an invisible screen reads exactly ' +
            'like a swept one.',
        );
      }

      // Builder targets. `errorBuilder` is captured too so the 404 surface is
      // EXCLUDED WITH A REASON rather than never noticed.
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

        // A router-local private wrapper (`_GatedInsights`) is a gate, not a
        // pane. Resolve ONE level to the feature surface it builds.
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
            rootProblem(
              `\`${target}\` is a route builder declared inside ${routerRel} and it resolves to NO feature ` +
                'surface. A wrapper that wraps nothing is a route whose surface nothing can be pointed at; ' +
                'name the screen it builds or stop routing to it.',
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
            rootProblem(
              `\`${symbol}\` is built by a route in ${routerRel} but is neither a screen declared under ` +
                `${featuresRel} nor one of the ${NOT_A_PANE.size} argued non-panes for this root. This ` +
                'guard will not guess: a builder target it cannot classify is a surface that would ' +
                'silently leave the domain. Either it is a surface (sweep it, or let it print as unswept) ' +
                'or it is not (say why, in NOT_A_PANE_BY_ROOT).',
            );
          }
          continue;
        }
        reachable.set(`${files[0]}#${symbol}`, {
          file: files[0],
          symbol,
          via,
          kind: 'routed screen',
        });
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
        'is empty and a sweep pointed there would read as dead coverage. The scan is pointed at the wrong tree.',
    );
  }
  for (const rel of declaringFiles) {
    for (const symbol of surfacesIn(rel, R.kind)) {
      if (R.kind === 'app' && !symbol.startsWith('show')) continue; // screens enter via the router, not the disk
      reachable.set(`${rel}#${symbol}`, {
        file: rel,
        symbol,
        via: null,
        kind: R.kind === 'package' ? 'shared widget' : 'modal sheet',
      });
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  // (A2) WHICH REACHABLE SURFACES DELEGATE INTO THE CHASSIS — see (0e)
  //
  // Computed over the reachable set, not over the disk, because the question is
  // only ever asked about a surface a user can open. The chassis root does not
  // ask it of itself: a widget importing its own package is not a delegation.
  // ═══════════════════════════════════════════════════════════════════════
  const delegatesTo = new Map(); // reachable key → [package file, …]
  if (R.dir !== CHASSIS_DIR) {
    for (const [key, entry] of reachable) {
      const d = delegationOf(entry.file);
      if (d === null) continue;
      if (d.lost) {
        rootCoverageLost(d.lost);
        continue;
      }
      delegatesTo.set(key, d.files);
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  // (B) THE SWEPT SET — per testWidgets BLOCK, not per file
  // ═══════════════════════════════════════════════════════════════════════
  let a11yFiles = [];
  let otherSweepFiles = [];
  let semanticsOnlyFiles = [];
  try {
    const all = listDir(join(ROOT, testRel));
    a11yFiles = all.filter((f) => A11Y_TEST.test(f)).sort();
    // The naming rule's cost, MEASURED rather than implied — see the header.
    for (const f of all.filter((x) => x.endsWith('.dart') && !A11Y_TEST.test(x)).sort()) {
      const src = stripStringLiterals(read(`${testRel}/${f}`));
      if (SWEEP_FAMILIES.some((fam) => fam.re.test(src))) otherSweepFiles.push(f);
      else if (SEMANTICS_HANDLE_RE.test(src)) semanticsOnlyFiles.push(f);
    }
  } catch {
    /* absent — the floors below are the report */
  }

  const swept = new Map(); // "<file>#<Symbol>" → { files:Set, kinds:Set }
  const namedOnly = new Map(); // "<file>#<Symbol>" → Set of test files naming it in a NON-sweeping case
  const kindTally = new Map(SWEEP_FAMILIES.map((f) => [f.kind, 0]));
  let a11yCases = 0;
  let sweepingBlocks = 0;
  let unattributedSweeps = 0;

  const IMPORT_RE = new RegExp(`import\\s+'package:${escapeRe(R.pkg ?? ' ')}/([^']+\\.dart)'`, 'g');

  for (const name of a11yFiles) {
    const rel = `${testRel}/${name}`;
    const code = read(rel);

    // Imports FIRST, on comment-stripped text ONLY: an import path IS a string
    // literal, so stripping literals before this would erase the provenance
    // half and every surface would fall to the printed list with nothing to say
    // why.
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
    for (const [symbol, files] of declaredHere) {
      if (files.length > 1) {
        rootProblem(
          `AMBIGUOUS SUBJECT — ${rel} imports ${files.length} files that each declare \`${symbol}\` ` +
            `(${files.join(', ')}), so this guard cannot tell WHICH of them a case pumps. Keying by file is ` +
            'exactly what catches an unrouted twin, and a collision inside one file defeats it.',
        );
      }
    }

    const blocks = [...code.matchAll(/\btestWidgets\s*\(/g)];
    a11yCases += blocks.length;
    const unclosed = [];
    for (const m of blocks) {
      const open = m.index + m[0].length - 1;
      const inner = sliceCall(code, open);
      if (inner === null) {
        unclosed.push(`a testWidgets( at offset ${m.index}`);
        continue;
      }
      // Literals out for the construction and sweep match. A case's own prose
      // must not be able to claim a sweep it does not perform.
      const body = stripStringLiterals(inner);
      const kinds = SWEEP_FAMILIES.filter((f) => f.re.test(body)).map((f) => f.kind);
      if (kinds.length) sweepingBlocks++;
      for (const kind of kinds) kindTally.set(kind, kindTally.get(kind) + 1);

      let attributed = 0;
      for (const [symbol, files] of declaredHere) {
        if (files.length !== 1) continue; // already reported as AMBIGUOUS
        // Construction/invocation, not a bare mention: `find.byType(HomeScreen)`
        // names a widget without pumping one.
        if (!new RegExp(`\\b${symbol}\\s*\\(`).test(body)) continue;
        const key = `${files[0]}#${symbol}`;
        if (!kinds.length) {
          if (!namedOnly.has(key)) namedOnly.set(key, new Set());
          namedOnly.get(key).add(name);
          continue;
        }
        attributed++;
        if (!swept.has(key)) swept.set(key, { files: new Set(), kinds: new Set() });
        swept.get(key).files.add(name);
        for (const kind of kinds) swept.get(key).kinds.add(kind);
      }
      if (kinds.length && attributed === 0) unattributedSweeps++;
    }
    if (unclosed.length) {
      rootCoverageLost(
        `${unclosed.length} testWidgets block(s) in ${rel} could not be closed by this parse ` +
          `(${unclosed.join('; ')}). A block this guard cannot read is a sweep it cannot see, and an ` +
          'invisible sweep reads exactly like an absent one — in the direction that reports LESS work than ' +
          'was done, silently moving a swept surface onto the printed list.',
      );
    }
  }

  return {
    R,
    reachable,
    delegatesTo,
    excluded,
    routerTargets,
    declaringFiles,
    swept,
    namedOnly,
    kindTally,
    a11yFiles,
    otherSweepFiles,
    semanticsOnlyFiles,
    a11yCases,
    sweepingBlocks,
    unattributedSweeps,
    goRoutes,
    redirectOnly,
    spineFiles,
    routerRel,
    featuresRel,
    testRel,
    problems: notFound,
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
const totals = { reachable: 0, swept: 0, delegated: 0, unswept: 0, cases: 0, files: 0, excluded: 0 };

/** The chassis sweeps that discharge a delegating surface's obligation — see
 *  (0e). Three answers again: `null` (this surface does not delegate),
 *  `{ lost }` (it does, and the chassis is not in the domain, so nothing judges
 *  it) and `{ via }` (the package file(s) whose sweeps cover it).
 *
 *  🔴 KEYED BY FILE, NOT BY SYMBOL, AND THAT IS THE POINT. The adapter is still
 *  called `SettingsScreen`; the widget it delegates to is called whatever the
 *  chassis calls it. Requiring the names to match would make every delegation
 *  read as unswept for a reason that has nothing to do with accessibility — the
 *  same failure the barrel rule above was written to stop. */
function delegatedSweep(a, key) {
  const targets = a.delegatesTo.get(key);
  if (!targets) return null;
  const owner = byDir.get(CHASSIS_DIR);
  if (!owner) {
    return {
      lost:
        `\`${key.split('#')[1]}\` (${key.split('#')[0]}) delegates its surface to ${targets.join(', ')}, and ` +
        `\`${CHASSIS_DIR}\` is NOT among the ${analyses.length} root(s) this scan derived. The screen's ` +
        'accessibility is therefore asserted by nothing at all: it left this root by moving house and it ' +
        'never arrived anywhere this guard looks. Put the chassis package on the workspace list with a ' +
        '`flutter_test` dev-dependency and a public widget, or stop delegating to it.',
    };
  }
  const via = targets.filter((f) => [...owner.swept.keys()].some((k) => k.startsWith(`${f}#`)));
  return via.length ? { via } : { via: [] };
}

/** Swept in its own root, or swept where it now lives. */
const isSwept = (a, key) => a.swept.has(key) || (delegatedSweep(a, key)?.via?.length ?? 0) > 0;

for (const a of analyses) {
  const { R } = a;
  const label = R.dir;
  const floor = REQUIRED_COVERAGE.find((r) => r.dir === R.dir) ?? null;
  const SWEPT_FLOOR = SWEPT_FLOOR_BY_ROOT.get(R.dir) ?? new Set();
  const NOT_A_PANE = NOT_A_PANE_BY_ROOT.get(R.dir) ?? new Map();

  if (a.goRoutes > 0) {
    ok(
      `${label}: ${a.goRoutes} GoRoute(s) parsed — ${a.goRoutes - a.redirectOnly} with a builder, ` +
        `${a.redirectOnly} redirect-only (router spine: ${a.spineFiles.length} file(s) — ` +
        `${a.spineFiles.join(', ')})`,
    );
  }

  // ═══════════════════════════════════════════════════════════════════════
  // (C) EMPTY PARSE ⇒ COVERAGE LOST
  //     Every statement below reads these two sets. Either one empty makes the
  //     accounting vacuous in one direction and catastrophically wrong in the
  //     other, and it reports as a pass. The marker string is what
  //     assert-guard-coverage.mjs looks for.
  // ═══════════════════════════════════════════════════════════════════════
  if (a.reachable.size === 0) {
    a.problems.push(
      `COVERAGE LOST — the REACHABLE set of \`${label}\` parsed EMPTY. Nothing was found to require a ` +
        'sweep, so every existing a11y case in that root would be reported as dead coverage and a router ' +
        'full of screens would be reported as fully accounted for. The parse has stopped reaching the tree.',
    );
  }
  // 🔴 THE a11y-FILE LIMB IS A FLOOR, NOT AN EXISTENCE CHECK, AND THAT CHANGED
  // ON 2026-09-05. It used to be `a11yFiles.length === 0 ⇒ COVERAGE LOST`,
  // which was right for the one root this guard could see and is WRONG the
  // moment a root with no suite at all joins the domain: the brick and
  // design_system have never had one, and reddening CI over work nobody has
  // started is the [pipeline C-6] rule this guard's whole design obeys. The
  // floor keeps the strength where it was earned — subly's floor is 1, so
  // renaming its suite out of the corpus still fires (M4) — and a root at zero
  // prints its entire domain as owed instead.
  if (floor && a.a11yFiles.length < floor.a11yFiles) {
    a.problems.push(
      `COVERAGE LOST — \`${label}\` yielded ${a.a11yFiles.length} file(s) matching \`a11y_*_test.dart\` ` +
        `under ${a.testRel} and its measured floor is ${floor.a11yFiles}. The swept set is smaller than ` +
        'the day it was measured for a reason that has nothing to do with the app: the suite moved, or it ' +
        'was renamed out of this scan, and every surface it swept would print as unswept — confident ' +
        'statements derived from having read nothing.',
    );
  }
  if (a.a11yFiles.length > 0 && a.a11yCases === 0) {
    a.problems.push(
      `COVERAGE LOST — ${a.a11yFiles.length} a11y test file(s) were read under \`${label}\` and NOT ONE ` +
        "`testWidgets(` block was parsed out of them. The block is this guard's unit of evidence; with " +
        'none, the swept set is empty for a reason that has nothing to do with the app.',
    );
  }
  if (a.a11yCases > 0 && a.sweepingBlocks === 0) {
    a.problems.push(
      `COVERAGE LOST — ${a.a11yCases} a11y case(s) were parsed across ${a.a11yFiles.length} file(s) under ` +
        `\`${label}\` and NOT ONE of them calls a sweep ` +
        `(${SWEEP_FAMILIES.map((f) => f.kind).join(', ')}). Either the sweep was deleted, or it was ` +
        'renamed and this parse did not follow — and a renamed sweep reports as EVERY surface being ' +
        'unswept, which is a confident statement about the wrong thing.',
    );
  }

  // Both sets are now built. Everything below reads them rather than the tree,
  // so one parse failure above must not be reported as nineteen findings here.
  const parsedCleanly = a.problems.length === 0;

  // ═══════════════════════════════════════════════════════════════════════
  // (D) DEAD COVERAGE — a sweep whose subject nothing reaches
  //
  // The direction this repository paid for. `responsive_width_test.dart` spent
  // its life measuring `features/firstrun/onboarding_screen.dart`, the STAMPED
  // twin of the carousel — an unrouted copy no Subly user could ever open. The
  // screen with the coverage had no user and the screen with the user had no
  // coverage, and the suite was green the entire time. A sweep that audits a
  // widget nobody can open reports coverage it does not have, and it is worse
  // than no sweep because it makes the gap invisible.
  // ═══════════════════════════════════════════════════════════════════════
  if (parsedCleanly) {
    for (const key of [...a.swept.keys()].filter((k) => !a.reachable.has(k)).sort()) {
      const [file, symbol] = key.split('#');
      a.problems.push(
        `DEAD COVERAGE — ${[...a.swept.get(key).files].join(', ')} sweeps \`${symbol}\` from \`${file}\`, ` +
          'and NOTHING REACHES IT. The sweep is green and it is auditing a widget no user can open. This ' +
          'is the unrouted-twin defect verbatim — Subly has already shipped two classes called ' +
          '`OnboardingScreen`, and the one with the coverage had no user. Re-point the case at the ' +
          'reachable surface, or route to this one.',
      );
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  // (D2) A DELEGATION WITH NOWHERE TO LAND — see (0e)
  //
  // The refusal that makes the widening safe. Every clause below reads
  // `isSwept`, which is allowed to answer "swept, in the chassis"; if the
  // chassis is not in the domain that answer is not available and the surface
  // would print as owed while the work sits in a file nothing here opens.
  // ═══════════════════════════════════════════════════════════════════════
  for (const key of [...a.delegatesTo.keys()].sort()) {
    const d = delegatedSweep(a, key);
    if (d?.lost) a.problems.push(`COVERAGE LOST — ${d.lost}`);
  }

  // ═══════════════════════════════════════════════════════════════════════
  // (E) SWEPT_FLOOR — what WAS swept, by name. See (0d).
  // ═══════════════════════════════════════════════════════════════════════
  if (parsedCleanly) {
    for (const key of [...SWEPT_FLOOR].sort()) {
      if (!a.reachable.has(key)) {
        a.problems.push(
          `FLOOR OVER NOTHING — \`${key}\` is recorded in SWEPT_FLOOR as a surface \`${label}\` sweeps, ` +
            'and nothing in that root reaches it any more. Either it moved and the floor did not follow, ' +
            'or it is retired and the entry should have gone with it. An entry for something that is not ' +
            'there reports judgement over nothing, and it makes the floor below it unfalsifiable.',
        );
        continue;
      }
      if (!isSwept(a, key)) {
        const [file, symbol] = key.split('#');
        const alsoNamed = a.namedOnly.get(key);
        a.problems.push(
          `REGRESSION — \`${symbol}\` (${file}) was swept when this floor was measured (2026-08-13, all ` +
            `${SWEPT_FLOOR.size} surfaces of ${label}) and NO a11y case sweeps it now. ` +
            (alsoNamed
              ? `${[...alsoNamed].join(', ')} still NAMES it, and naming is not sweeping: a case that ` +
                'asserts one label says nothing about whether the screen carries a tap action with no role ' +
                'or no name. '
              : '') +
            'Work leaving the tree is a legitimate move and it may not be a quiet one — restore the sweep, ' +
            'or remove this entry in the same change with the reason written beside it.',
        );
      }
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  // (F) THE PER-ROOT FLOORS — what membership cannot see
  //
  // 🔴 NEITHER IS REDUNDANT WITH ANYTHING ABOVE, AND EACH HAS THE MUTATION
  // THAT PROVES IT:
  //   surfaces  delete a route. The reachable set shrinks, a surface that is
  //             gone is not unswept but ABSENT, and the printed list gets
  //             SHORTER, which reads like progress. This floor is what sees a
  //             domain being emptied wholesale. On subly it no longer fires
  //             ALONE (M7); on the brick, whose SWEPT_FLOOR is empty, it does
  //             (M11e).
  //   cases     delete a case that is not the only sweep of its surface. Every
  //             set above is byte-identical and a real assertion left the tree
  //             in silence. P5 shipped 24; the 2026-08-13 naked-controls sweep
  //             took the suite to 60, the tap-target family the same day to 81
  //             and the contrast family to 110. A smaller number is coverage
  //             leaving, not tidying.
  // ═══════════════════════════════════════════════════════════════════════
  if (floor) {
    if (a.reachable.size > 0 && a.reachable.size < floor.surfaces) {
      a.problems.push(
        `COVERAGE LOST — \`${label}\` has only ${a.reachable.size} reachable surface(s) in the domain, and ` +
          `its checked-in floor is ${floor.surfaces} (${floor.label}). Nothing else here can see this: a ` +
          'surface that is GONE is not unswept, it is absent, and the printed list below merely gets ' +
          'shorter — which reads like progress. Lower the floor deliberately in the same change that ' +
          'removes the surface, with the reason beside it.',
      );
    }
    if (a.a11yCases > 0 && a.a11yCases < floor.cases) {
      a.problems.push(
        `COVERAGE LOST — only ${a.a11yCases} a11y case(s) were found across ${a.a11yFiles.length} file(s) ` +
          `under \`${label}\`, and the checked-in floor is ${floor.cases}. Cases can be deleted without ` +
          'changing either set above — the screen stays swept by one surviving case while every label, ' +
          'locale and falsifier assertion around it goes. A smaller number is coverage leaving the tree, ' +
          'not a tidy-up.',
      );
    }
  } else {
    notes.push(
      `⬜ ${label} is DERIVED but has no measured floor in REQUIRED_COVERAGE. It is scanned in full and ` +
        'its whole domain is reported below; it simply cannot yet fail on a domain that SHRINKS. Measure ' +
        'it and declare it.',
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
          'as a surface of that same root. It is a surface after all; remove the exclusion and let it be ' +
          'swept or printed like every other one.',
      );
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  // (G) THE REPORT — swept, unswept, excluded. ALL OF IT PRINTED, EVERY RUN.
  //
  // Counted is not enough. The failure this repository keeps recording is an
  // unmet clause that produced NO OUTPUT AT ALL, so every unswept surface is
  // read aloud on a GREEN run and stays uncomfortable to read. There is no
  // deferral list to add a screen to and no reason field to fill in: the list
  // is DERIVED from the domain minus the sweeps, so it cannot drift from
  // either, and a surface added tomorrow joins it by existing rather than by
  // somebody remembering.
  // ═══════════════════════════════════════════════════════════════════════
  const unswept = [...a.reachable.keys()].filter((k) => !isSwept(a, k)).sort();
  // Swept WHERE THEY NOW LIVE — counted apart from the root's own sweeps so the
  // report never implies this root's suite did work the chassis's suite did.
  const delegated = [...a.reachable.keys()].filter((k) => !a.swept.has(k) && isSwept(a, k)).sort();
  a.unswept = unswept;
  a.delegated = delegated;
  totals.reachable += a.reachable.size;
  totals.swept += a.swept.size;
  totals.delegated += delegated.length;
  totals.unswept += unswept.length;
  totals.cases += a.a11yCases;
  totals.files += a.a11yFiles.length;
  totals.excluded += a.excluded.length;

  if (a.problems.length === 0) {
    ok(
      `${label}: ${a.swept.size} of ${a.reachable.size} reachable surface(s) carry an a11y sweep, from ` +
        `${a.a11yFiles.length} a11y test file(s) across ${a.a11yCases} case(s)` +
        (delegated.length
          ? `; ${delegated.length} more are swept in \`${CHASSIS_DIR}\`, which they delegate to`
          : ''),
    );
  }
  for (const p of a.problems) problems.push(p);

  notes.push(`── ${label} (${R.kind} root, package \`${R.pkg}\`) ─────────────────────────`);
  if (a.swept.size) {
    notes.push(
      `✅ ${a.swept.size} surface(s) SWEPT — the sweep is what can fail on a control added tomorrow:`,
    );
    for (const key of [...a.swept.keys()].sort()) {
      const { files, kinds } = a.swept.get(key);
      notes.push(
        `   · ${key.split('#')[1]} — ${[...kinds].sort().join(' + ')} (${[...files].sort().join(', ')})`,
      );
    }
  }
  notes.push(
    `   sweep families used: ${SWEEP_FAMILIES.map((f) => `${f.kind} ×${a.kindTally.get(f.kind)}`).join(', ')}` +
      `${a.unattributedSweeps ? `; ${a.unattributedSweeps} sweeping case(s) construct no domain surface directly (the \`shell ·\` group pumps the REAL router, once per family)` : ''}`,
  );
  // The naming rule's cost, PRINTED rather than left to be inferred, and both
  // halves printed every run including at zero. See the header: a reader must
  // not conclude from an empty ✅ list that a root has done no accessibility
  // work at all, and must not conclude from a non-empty one that everything
  // a11y-shaped in the tree has been counted.
  notes.push(
    `   outside the \`a11y_*_test.dart\` corpus: ${a.otherSweepFiles.length} file(s) call a recognised ` +
      `sweep helper and are NOT counted` +
      (a.otherSweepFiles.length ? ` (${a.otherSweepFiles.join(', ')}) — rename one to ` +
        '`a11y_<surface>_test.dart` and its sweeps count' : '') +
      `; ${a.semanticsOnlyFiles.length} take a SemanticsHandle without sweeping` +
      (a.semanticsOnlyFiles.length
        ? ` (${a.semanticsOnlyFiles.join(', ')}) — targeted assertions, which this guard deliberately ` +
          'does not count as coverage of a surface'
        : ''),
  );

  if (unswept.length) {
    notes.push(
      `⬜ ${unswept.length} of ${a.reachable.size} reachable surface(s) in ${label} carry NO a11y sweep. ` +
        'Printed, not failed: this is work nobody has started, and reddening CI over it would block every ' +
        'unrelated change. It is still owed —',
    );
    for (const key of unswept) {
      const { file, symbol, via, kind } = a.reachable.get(key);
      const alsoNamed = a.namedOnly.get(key);
      notes.push(
        `   · ${symbol} (${kind}, ${file}${via ? `, via ${via}` : ''})` +
          (alsoNamed
            ? ` — ${[...alsoNamed].sort().join(', ')} NAMES it but never sweeps it; a case asserting one ` +
              'label says nothing about a tap action with no role or no name'
            : ''),
      );
    }
    notes.push(
      `   → add a case to ${a.testRel}/a11y_*_test.dart that pumps the surface and calls ` +
        '`expectNothingNaked(tester, …)`, and add its key to SWEPT_FLOOR_BY_ROOT in the same change.',
    );
  }

  if (a.delegatesTo.size) {
    notes.push(
      `⬜ ${a.delegatesTo.size} reachable surface(s) in ${label} DELEGATE into \`${CHASSIS_DIR}\` and are ` +
        'judged there — printed every run, because a property judged somewhere else is exactly the shape ' +
        'that reads as judged nowhere:',
    );
    for (const key of [...a.delegatesTo.keys()].sort()) {
      const d = delegatedSweep(a, key);
      notes.push(
        `   · ${key.split('#')[1]} (${key.split('#')[0]}) → ${a.delegatesTo.get(key).join(', ')}` +
          (d?.via?.length ? ' — SWEPT there' : ' — not swept there either; it stays on the owed list above'),
      );
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
//
// Reported TOGETHER, never first-only: a tree can lose two roots for two
// different reasons and naming one sends the reader to fix half of it.
if (IS_FULL_CHECKOUT && analyses.length > 0) {
  const lost = REQUIRED_COVERAGE.filter((r) => !byDir.has(r.dir));
  if (lost.length) {
    coverageLost(
      `${lost.length} of the ${REQUIRED_COVERAGE.length} DECLARED root(s) were not among the ` +
        `${roots.length} this run derived:\n` +
        lost.map((r) => `    · \`${r.dir}\` — ${r.label}`).join('\n') +
        `\n    The scan still read ${totals.reachable} surface(s) from the root(s) that remain, so every ` +
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
  console.error('\nassert-a11y-coverage: FAILED');
  process.exit(1);
}

console.log(
  `\nassert-a11y-coverage: ok — ${roots.length} derived root(s) (${roots.map((r) => r.dir).join(', ')}); ` +
    `${totals.reachable} reachable surface(s); ${totals.swept} swept by ${totals.files} a11y test file(s) ` +
    `across ${totals.cases} case(s); ${totals.delegated} swept where they delegate to; ` +
    `${totals.unswept} unswept and PRINTED; ` +
    `${totals.excluded} exclusion(s) printed`,
);
