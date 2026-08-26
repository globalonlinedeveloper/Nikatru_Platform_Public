// ─────────────────────────────────────────────────────────────────────────────
// SC 2.1.1 (KEYBOARD, LEVEL A) — THE REST OF THE ROUTER.
//
// `test/keyboard_traversal_test.dart` sweeps THREE screens and says so in its
// own header: "17 — screens `apps/subly/lib/core/router.dart` actually
// declares … This is the domain THIS FILE sweeps 3 of, and 14 of it are
// unmeasured." `test/a11y/focus_ring_contrast_test.dart` repeats the same
// residual. This file is the 14.
//
// ── 🔴 THE ROUTE SET IS READ OUT OF THE ROUTER. THERE IS NO LIST OF ROUTES ───
// Every screen swept below is reached by walking `routerProvider`'s own
// `GoRouter.configuration.routes` and calling the route's OWN `builder`. No
// path, no screen class and no route count is written down here as a fact —
// a second declaration of what the router already states is this corpus's most
// repeated defect, and it fails the same way every time: the router gains a
// route, the copy does not, and a green suite reports coverage of a set that no
// longer exists.
//
// What IS written down here is four kinds of thing the router does NOT state,
// each of them a table this file must keep true:
//   · [kAlreadySwept]   — which routes the SIBLING file pins, so they are not
//                         measured twice under two sets of numbers.
//   · [kCannotBeSwept]  — routes this rig genuinely cannot measure, each with
//                         its reason.
//   · [kExpected]       — the MEASURED counts, per route.
//   · [kSweptAs]        — the STATE a route is swept in, where the default one
//                         does not build the control the screen exists for.
// All four are keyed by route path, and every key is checked back against the
// router (see `the route tables name only routes that exist`). The load-bearing
// half is the other direction: [kExpected] must cover every screen-bearing
// route that is neither already swept nor excluded, so a NEW route added to the
// router with no entry here FAILS rather than being silently skipped. That
// assertion is the whole reason this file may be read as covering the router.
//
// ── ⚠️ WHAT "CANNOT BE SWEPT" MEANS, AND WHY IT IS ONE ROUTE AND NOT FOUR ────
// [kCannotBeSwept] is not a skip list. Each entry carries a reason AND a case
// that fails when the reason stops being true, so the note cannot outlive its
// subject. `/onboarding` is the only member: it is a horizontal `PageView`
// carousel, so only the CURRENT page is built and a single sweep of it would
// report one page's controls as if they were the screen's. The case
// `the /onboarding exclusion still has its reason` asserts that its horizontal
// Scrollable still has a non-zero `maxScrollExtent` — the day onboarding stops
// paging, that case goes red and this exclusion must be deleted rather than
// inherited.
//
// Nothing here is excluded for needing a live session, and that is worth saying
// because it was the expected answer: the four gate screens (`/verify-email`,
// `/reaccept-terms`, `/reset-password`, `/check-inbox`) are all built straight
// from the router's builder with no session at all. `/check-inbox` needs only
// the address its builder reads out of `state.extra`, and `/sub/:id` only a
// path parameter — both supplied by [kExtra] / [kPathParameters], which are
// route INPUTS, not a route list.
//
// ── 🔴 WHAT THIS SWEEP FOUND, MEASURED 2026-08-26 ────────────────────────────
// 13 routes, 38 interactive controls, 35 reachable by Tab, 3 OUTSIDE THE TAB
// ORBIT. Two screens carry all three, and every one of the three is a duplicate
// hit target rather than a lost function:
//
//   /sign-up        7 of 9  — the two consent SENTENCES.
//   /reaccept-terms 4 of 5  — the one consent sentence.
//   /sub/:id        4 of 4  — nothing off the orbit.
//
// ── 🔴 37 -> 38 LATER THE SAME DAY, AND NO WIDGET MOVED. A SCREEN WAS SWEPT IN
//    THE STATE THE CONTROL IT EXISTS FOR IS ABSENT FROM ───────────────────────
// `/manage-plan` was pinned at `(controls: 2, reachable: 2)` — a full house, so
// nothing was red and nothing could go red. Its cancel row is built under
// `if (isPro)` and this rig resolves no entitlement, so the ROSCA control the
// screen exists for was never built and never graded. [kSweptAs] now drives
// `entitlementsProvider` on that route and the pair is `3 of 3`: the app-bar
// back button, the restore row and the cancel row, each named by its own icon
// in `/manage-plan · a keyboard reaches the cancel-plan row`.
//
// ⚠️ THE ROW TURNED OUT TO BE REACHABLE. Nothing in `lib/` was changed and no
// count on any other route moved; what was false was the SENTENCE the pair
// carried, exactly as it was for the nine below. Mutant F is the proof that the
// difference is measurable rather than argued.
//
// ── 🔴 IT WAS 28 / 9 EARLIER THE SAME DAY. WHAT MOVED, AND WHY ───────────────
// The nine split 6 + 3 (see the section below, written when the split was
// found). THE SIX ARE FIXED. `legal_consent_fields.dart`'s `_LegalLink` and
// `subscription_detail_screen.dart`'s `_iconButton` were rebuilt on
// `packages/design_system`'s `FocusableTap` — the same primitive, and the same
// one-line substitution, that took `/sign-in` from 4-of-8 to 8-of-8 and
// `/settings` from 9-of-27 to 25-of-27 on 2026-08-25, and that the footer
// `_LegalLink` in `features/shared/widgets.dart` took in that increment.
//
//   /sign-up        5 -> 7  — Terms and Privacy joined the orbit.
//   /reaccept-terms 2 -> 4  — the SAME two links: one widget, two routes.
//   /sub/:id        2 -> 4  — "Back" and "More options", the app bar.
//
// ⚠️ NO CONTROL COUNT MOVED ON ANY ROUTE, and that is the shape of an
// inoperable-control fix as opposed to a deletion. 37 controls before, 37
// after: `FocusableTap` wraps each control in a `FocusableActionDetector` and
// keeps the `GestureDetector` with an `onTap` that this rig counts, so what
// changed is which side of the reachable/dead line each one falls on. A fix
// that had moved `controls` too would have been a control removed, and the
// `SC 2.1.1` case says so in its own `reason`.
//
// ⚠️ AND THE THREE DUPLICATES ARE STILL OFF THE ORBIT ON PURPOSE. Making the
// consent sentences focusable would have taken the numbers to 37 / 37 and
// FIXED NOTHING: a Tab stop that activates a `Checkbox` the previous Tab stop
// already reached is a second stop for one function, which costs a keyboard
// user a press and tells a screen-reader user nothing new. The 3 is a pin on
// the duplicates staying duplicates.
//
// 🔴 SO WHAT IS LEFT IS A ZERO, AND IT IS THE HALF WORTH SAYING PLAINLY: across
// the 13 routes this file sweeps there is now NO control whose FUNCTION a
// keyboard cannot reach. That is not a claim about the app — the sibling file's
// three routes and the shell's own nav bar are measured elsewhere and the
// register carries the rest — it is a claim about these thirteen, and the
// numbers above are how it is checked.
//
// ── 🔴 SIX OF THE NINE WERE A DEFECT. THREE WERE NOT, AND THIS FILE SAID
//    THEY WERE. CORRECTED 2026-08-26, BY MEASUREMENT, NOT BY ARGUMENT ─────────
// Being outside the Tab orbit is what the rig can see. "Keyboard-dead" is a
// claim about a FUNCTION, and the two are not the same thing when a screen
// gives one function two hit targets. This file published the difference as if
// it were nothing, and the two most severe things it said were FALSE:
//
//   ❌ "A KEYBOARD-ONLY USER CANNOT TICK THE CONSENT BOX, so they cannot
//      complete registration."  FALSE.
//   ❌ "/reaccept-terms · a user held at this gate has exactly two ways out,
//      agree or sign out, and a keyboard reaches only the second."  FALSE.
//
// The consent control is a Material `Checkbox`, and `ToggleableStateMixin`
// builds it inside a `FocusableActionDetector` — a real `FocusNode` with
// `ActivateIntent` bound. MEASURED: on `/sign-up` the Tab orbit's third stop is
// INSIDE the terms `Checkbox`, a `Space` key event there flips its value to
// true, and the submit `FilledButton` goes from `onPressed == null` to enabled
// in the same frame. A keyboard-only user can register. The fourth stop is the
// marketing box and it ticks the same way. On `/reaccept-terms` the identical
// walk unlocks Accept, so the gate has TWO keyboard exits, not one.
//
// What is actually outside the orbit on those two screens is the consent
// SENTENCE — `legal_consent_fields.dart` wraps the label `Text` in a
// `GestureDetector` under `ExcludeSemantics` as a SECOND hit target for the box
// beside it, and that file's own comment says so ("a second hit target for the
// box, NOT a second control"). The rig counts it, because it counts
// `GestureDetector`s with an `onTap`, and it cannot see that the tap it fires
// is the tap the reachable `Checkbox` already fires. A duplicate target for a
// reachable function is not an SC 2.1.1 failure. Reporting it as one is worse
// than not measuring: somebody "fixes" a working consent box, or stops
// believing the sweep.
//
// 🔴 SO THE HONEST SPLIT OF THE NINE WAS 6 + 3, AND BOTH HALVES ARE ASSERTED:
//   · 6 GENUINELY KEYBOARD-INOPERABLE FUNCTIONS — ✅ FIXED, see the section
//     above. The four `_LegalLink`s (Terms and Privacy, on both consent
//     screens) and the two `/sub/:id` app-bar actions. Every one was the shape
//     the sibling file named — `Semantics(link:/button: true)` over a
//     hand-rolled `GestureDetector`, which tells a screen reader what a control
//     IS and creates no `FocusNode`, so it did nothing whatever for a keyboard.
//     A keyboard user could not open the document they were being asked to
//     agree to, and could not leave the detail screen by any door on it. The
//     fix is the one that had already landed for login and home:
//     `design_system`'s `FocusableTap`.
//   · 3 DUPLICATE HIT TARGETS whose function is reachable — the consent
//     sentences. NOT fixed, because there is nothing to fix. Counted, named as
//     duplicates, and PROVEN redundant by the Space-key cases below rather than
//     argued away. If the box they duplicate ever stops being reachable, those
//     cases go red and these three become a defect for real.
//
// ⚠️ THE COUNTS DID NOT MOVE WHEN THE SPLIT WAS FOUND, AND THAT IS THE POINT OF
// RECORDING IT. 37 / 28 / 9 were correct measurements the whole time; what was
// false was the sentence attached to them. The file was GREEN BECAUSE ITS
// EXPECTATIONS AGREED WITH ITS OWN FALSE BELIEF — the number and the claim
// matched each other and only one of them was checked against the widgets. The
// counts moved LATER THE SAME DAY, when the widgets changed, and the two events
// are kept apart here on purpose: one was a correction to prose, the other is a
// fix to code, and a file that ran them together would look like a number
// edited to suit an argument.
//
// ⚠️ THESE ARE STILL PINS IN BOTH DIRECTIONS, exactly as the sibling file's
// are. Each goes red when a control is ADDED and when one is FIXED, and the
// second half is still the point even now that the six are done: the remaining
// three are pinned AT THREE so that "fixing" a duplicate — adding a redundant
// Tab stop — is as loud as regressing a real one.
//
// ── ⚠️ TWO SCREENS REPORT ZERO CONTROLS, AND THAT IS A MEASUREMENT ───────────
// `/budget` builds no tap-control at all (it is a read-only surface) and
// `/paywall` builds none in the state this rig renders — its offer list comes
// from a billing backend that is not configured under flutter_test, so the
// `FilledButton` at `paywall_screen.dart`'s offer tile is never reached. `0 of
// 0` is therefore the honest reading for both, and it is pinned rather than
// skipped: the first control either screen grows turns this red and has to be
// swept.
//
// ── THE SURFACE, THE SETTLE, AND WHY BOTH ARE UNIFORM ────────────────────────
// [kKeyboardSurface] is imported from the sibling file rather than restated —
// 1079x2400 is a number with a derivation (that file's header carries it) and
// two copies of it would age apart.
//
// 🔴 4 SECONDS OF FAKE TIME ARE ADVANCED ON EVERY ROUTE, NOT ON ONE. `pumpAt`
// advances no timers by design, and `/scan` spends its first 3.36 s (6 x 560 ms)
// showing "Setting up your board" with no control on it — swept cold it reports
// `0 of 0` and hides the button that is the whole point of the screen. The
// settle is applied to EVERY route because a per-screen wait is per-screen
// knowledge, which is the same defect as a per-screen route list. MEASURED
// 2026-08-26: it changes `/scan` from 0 controls to 1 and leaves all twelve
// other routes bit-identical.
//
// ── THE SCOPE, STATED SO IT CANNOT BE READ AS MORE ───────────────────────────
// Each screen is built from its route's builder and hosted BARE, the same way
// the sibling file hosts its three: no `AppShell`, so the five shell branches
// are swept without the bottom navigation bar, and no `GoRouter` above them, so
// no redirect runs. This measures the SCREEN's keyboard operability, which is
// what SC 2.1.1 asks about; it does not measure the shell chrome, and the nav
// bar's own controls are swept by neither file.
//
// ⚠️ THE HELPERS BELOW ARE A SECOND COPY. `_isUnder`, `_label`,
// `_everythingIsLaidOut` and `_followsInReadingOrder` are private to
// `test/keyboard_traversal_test.dart` and cannot be imported. Their home is
// `test/support/`, and moving them there is owed — but it is an edit to a file
// this change does not own, so the duplication is declared here rather than
// smuggled in. Each copy is verbatim; the reasons live in the sibling.
//
// ── 🔴 DIRECTION, PROVEN. SIX MUTANTS, 2026-08-26 ───────────────────────────
// A sweep that cannot fail is not a sweep, so each of this file's three loads
// was driven red on purpose and then restored. Every mutation was made INSIDE
// THIS FILE — no `lib/` file was edited, and none of the checked-in screens was
// touched — and the exit code was captured on its own line, never beside a
// `$(basename …)`:
//
//   A · A CONTROL ON A SWEPT ROUTE MADE UNREACHABLE. The screen for
//     `/verify-email` was wrapped in a `FocusTraversalGroup` whose policy drops
//     the "I have confirmed my email" node from `sortDescendants` — the control
//     stays present, painted and programmatically focusable, and simply leaves
//     the Tab order, which is exactly the user-visible shape of an SC 2.1.1
//     failure. rc=1, ONE case red, naming the screen and the number:
//     "/verify-email: 2 of 3 controls are reachable by Tab, not 3".
//     ⚠️ AND THE MUTANT THAT DID **NOT** WORK IS RECORDED BECAUSE IT LOOKED
//     LIKE A PASS. Setting `canRequestFocus = false` / `skipTraversal = true`
//     on the live `FocusNode` after pumping left the sweep GREEN — `Focus`
//     re-applies its own widget properties on the next build, and the node read
//     back `skip=false, can=true`. A runtime poke at a framework-owned node is
//     not a mutation of the subject; it is a mutation the subject undoes.
//   B · A ROUTE THE ROUTER DECLARES AND NO TABLE MENTIONS. `/calendar`'s
//     [kExpected] entry was deleted. rc=1, `every screen-bearing route is
//     accounted for` red with `Actual: ['/calendar']`. This is the assertion
//     that makes "derived from the router" mean something.
//   C · AN EXCLUSION POINTED AT A ROUTE ITS REASON IS NOT TRUE OF.
//     [kCannotBeSwept]'s key was moved from `/onboarding` to `/budget`. rc=1,
//     TWO cases red: `the /onboarding exclusion still has its reason` (budget
//     has no paging Scrollable) and, on the now-swept `/onboarding`, the
//     completeness precondition — `Expected: <0.0> Actual: <1320.0>` — which is
//     the carousel's culled pages being caught by the rule rather than by the
//     note.
//   D · ADDED 2026-08-26 WITH THE CORRECTION, AND IT IS THE ONE THAT PROVES THE
//     CORRECTION MEASURES SOMETHING THE COUNTS COULD NOT. The `/sign-up` screen
//     was wrapped in a `Shortcuts` binding `Space` to `DoNothingIntent`, so the
//     consent `Checkbox` KEEPS its Tab stop and stops being operable — which is
//     precisely the state the old, false finding described and the new one
//     denies. Every count in the file is bit-identical under it: `5 of 9` green,
//     `dead.length == 4` green, the orbit, the cycle, the Shift-Tab retrace and
//     the reading order all green. rc=1, EXACTLY ONE case red, and it is the new
//     one: `/sign-up · Tab reaches the consent box and Space ticks it`, with
//     "Space on the focused terms Checkbox did not tick it".
//     ⚠️ THAT IS THE POINT. Run against the same mutant, the assertions this
//     file shipped with on 2026-08-26 stay GREEN AT 82 OF 82 while publishing
//     the sentence "a keyboard-only user cannot tick the consent box" — the
//     claim would have been TRUE and nothing would have said so, for the same
//     reason it was FALSE the day before and nothing said so. Strictly
//     stronger, nothing loosened. Mutant A was re-run after the correction and
//     still reddens unchanged: rc=1, one case,
//     "/verify-email: 2 of 3 controls are reachable by Tab, not 3".
//   E · ADDED LATER THE SAME DAY, WITH THE FIX, AND IT IS THE ONE THAT MATTERS
//     FOR IT: A NOW-REACHABLE CONTROL PUT BACK OUTSIDE THE ORBIT. A sweep whose
//     mutant stops reddening once the defect is fixed has been broken BY the
//     fix, so the regression these new numbers exist to prevent was driven for
//     real. `/sign-up` ALONE was wrapped in a `FocusTraversalGroup` whose policy
//     drops the first link-role node from `sortDescendants` — one of the two
//     legal links stays present, painted and programmatically focusable, and
//     simply leaves the Tab order, which is the exact user-visible shape of the
//     defect fixed today. Mutation made INSIDE THIS FILE; no `lib/` file was
//     edited. rc=1.
//     🔴 TWO CASES RED, NOT ONE, AND THAT IS THE DESIGN RATHER THAN NOISE:
//       · `/sign-up · keyboard SC 2.1.1 · 7 of 9 controls are reachable by Tab`
//         — "/sign-up: 6 of 9 controls are reachable by Tab, not 7". The COUNT.
//       · `/sign-up · Tab reaches the consent box and Space ticks it` — the
//         NAMING half, on `dead.length` and on the dropped link owning no stop.
//     Neither is redundant, and mutant A is the proof of that rather than an
//     assertion of it: `/verify-email` carries no named case, so the SAME
//     mutation there reddens EXACTLY ONE. A route that carries both halves
//     reddens both — which is what "a count does not convey WHICH control"
//     means once it is finally exercised. A mutant that reddened only the count
//     would leave `7 of 9` satisfiable by deleting two controls; one that
//     reddened only the naming case would leave the per-route table unpinned.
//     ⚠️ AND THE OTHER TWELVE ROUTES STAYED GREEN, `/reaccept-terms` INCLUDED —
//     whose two links are the SAME widget. The policy is scoped to one route,
//     so the blast radius above is one screen's assertion set and not a
//     suite-wide wobble. 80 of 82 green under the mutant; 82 of 82 restored.
//   F · ADDED WITH [kSweptAs], AND IT IS THE ONE THAT MEASURES WHAT SWEEPING
//     THE PRO STATE BOUGHT: THE CANCEL-PLAN ROW TAKEN OUT OF THE TAB ORDER.
//     `/manage-plan` ALONE was wrapped in a `FocusTraversalGroup` whose policy
//     drops every stop whose subtree paints `Icons.cancel_outlined` — the row
//     stays present, painted and programmatically focusable, and simply leaves
//     the Tab order. Mutation made INSIDE THIS FILE; no `lib/` file was edited.
//     rc=1, TWO cases red, both naming the row rather than a number:
//       · `/manage-plan · keyboard SC 2.1.1 · 3 of 3 controls are reachable by
//         Tab` — "/manage-plan: 2 of 3 controls are reachable by Tab, not 3 …
//         Off the orbit today: [Cancel subscription]".
//       · `/manage-plan · a keyboard reaches the cancel-plan row` — "a control
//         on manage-plan owns no stop on the Tab orbit … Off the orbit today:
//         [Cancel subscription]".
//     73 of 75 green under it; 75 of 75 restored.
//     🔴 AND THE SAME MUTATION RUN AGAINST THE FILE AS IT STOOD THIS MORNING —
//     `(controls: 2, reachable: 2)`, no [kSweptAs] — LEFT IT GREEN AT 73 OF 73,
//     rc=0. It had nothing to remove: the row it takes off the Tab order is not
//     built in the state that file swept. That is the whole finding, and it is
//     the reason a full house is not evidence of anything on its own.
//
// ✅ THE RIG IS CROSS-CHECKED AGAINST THE SIBLING. `/sign-in`, `/home` and
// `/settings` are in [kAlreadySwept] and NOT swept here, but the same rig was
// run over all three while this file was being built and reproduced the
// sibling's published numbers exactly — 8 of 8, 20 of 20, 27 with 2 dead. A
// second rig that disagreed with the first would have made every number below
// unreadable.
// ─────────────────────────────────────────────────────────────────────────────
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:nikatru_core/nikatru_core.dart' as core;
import 'package:subly/core/app_config.dart';
import 'package:subly/core/router.dart';
import 'package:subly/state/money_providers.dart';

import '../keyboard_traversal_test.dart' show kKeyboardSurface;
import '../support/width_harness.dart';

/// The routes `test/keyboard_traversal_test.dart` already pins, by path.
///
/// Not a scope this file chose — a scope that file states. Sweeping them again
/// here would put two sets of counts on one screen, and the day they disagree
/// neither is evidence. Asserted to be routes that still exist, so a rename in
/// the router cannot leave this file silently skipping a screen nothing pins.
const Set<String> kAlreadySwept = <String>{'/sign-in', '/settings', '/home'};

/// Routes this rig cannot honestly measure, each with its reason.
///
/// 🔴 NOT A SKIP LIST. Every entry has a case that fails when its reason stops
/// being true — see `the /onboarding exclusion still has its reason`. An
/// exclusion whose reason has expired is worse than no exclusion, because it
/// reads as a decision somebody made about today's code.
const Map<String, String> kCannotBeSwept = <String, String>{
  '/onboarding':
      'OnboardingScreen is a horizontal PageView carousel. Only the current '
      'page is built, so a single sweep reports one page of the walkthrough '
      'as if it were the whole screen — and the page it does NOT build is '
      'the last one, which carries the button out of onboarding. Sweeping '
      'it needs a per-page walk driven by the carousel, which is '
      'screen-specific knowledge this file deliberately does not hold.',
};

/// Path parameters for the one route pattern that takes them.
///
/// A route INPUT, not a route list: the router declares `/sub/:id`, this says
/// which id. `'1'` is Netflix in `data/seed/demo_data.dart` — the same id
/// `width_detail_test.dart` uses, and the one that puts the screen in its
/// POPULATED branch rather than the not-found `Center`, which has nothing to
/// sweep.
const Map<String, Map<String, String>> kPathParameters =
    <String, Map<String, String>>{
      '/sub/:id': <String, String>{'id': '1'},
    };

/// `state.extra` for the one route whose builder reads it.
///
/// `/check-inbox`'s builder is `CheckInboxScreen(email: _pendingAddress(state)!)`
/// and its redirect sends anyone without an address to `/sign-in`. The address
/// is the whole input; nothing about it is asserted.
const Map<String, Object?> kExtra = <String, Object?>{
  '/check-inbox': 'keyboard-sweep@example.test',
};

/// The STATE a route is swept in, where the default state hides a control.
///
/// 🔴 A ROUTE INPUT, LIKE [kExtra] — AND THE ONE THAT DECIDES WHAT IS GRADED.
/// `/manage-plan` builds its cancel row under `if (isPro)`
/// (`manage_plan_screen.dart:179`), so a sweep of the default state — no
/// entitlement resolved, `isPro` false — measures the screen with the ROSCA
/// cancel control ABSENT and reports a full house for the two that remain.
///
/// The entitlement is driven through `entitlementsProvider`, the server's
/// answer that the screen's own `isPro` is computed from, which is the seam
/// `a11y_semantics_test.dart`'s manage-plan group already drives — not a second
/// mechanism invented here. Keyed by path and checked back against the router by
/// `the route tables name only routes that exist`, and the entry's reason is
/// re-checked by `/manage-plan · the cancel row is only there in the Pro state`.
final Map<String, List<Override>> kSweptAs = <String, List<Override>>{
  '/manage-plan': <Override>[
    entitlementsProvider.overrideWith(
      (_) async => const core.Entitlements(
        appId: AppConfig.appId,
        isPro: true,
        items: <core.Entitlement>[],
      ),
    ),
  ],
};

/// (interactive controls found, controls the Tab orbit reaches) per route.
///
/// 🔴 MEASURED 2026-08-26, NOT INTENDED. THREE of these thirty-seven controls
/// sit OUTSIDE the Tab orbit and the numbers say so.
///
/// ⚠️ IT WAS NINE UNTIL THE SAME DAY, AND THE SIX THAT LEFT ARE THE SIX THIS
/// FILE CALLED GENUINELY INOPERABLE. `legal_consent_fields.dart`'s four
/// `_LegalLink`s and `subscription_detail_screen.dart`'s two `_iconButton`s
/// were rebuilt on `design_system`'s `FocusableTap`, so `/sign-up` went 5 -> 7,
/// `/reaccept-terms` 2 -> 4 and `/sub/:id` 2 -> 4. No control count moved on
/// any route: the fix is a substitution INSIDE each control, and `FocusableTap`
/// still builds the `GestureDetector` with an `onTap` that this rig counts.
///
/// ⚠️ `reachable` is exactly that — how many controls the orbit lands on — and
/// it is NOT a count of keyboard-operable FUNCTIONS. The three that remain are
/// ALL duplicate hit targets for a `Checkbox` a keyboard reaches and ticks, and
/// they are deliberately still off the orbit: making them focusable would add a
/// Tab stop that activates something the user has already reached. The header
/// carries the split and the cases below assert both halves; reading these
/// pairs as a defect count is the error this file itself published earlier on
/// 2026-08-26.
/// Each pair goes red in BOTH directions — a control added, and a control
/// fixed — because a number that only moves on regression is a record of
/// today's failure rather than a measurement of it.
///
/// ⚠️ THE KEY SET IS AN ASSERTION, not a convenience. `every screen-bearing
/// route is accounted for` requires this map to cover every route the router
/// declares a builder for, minus [kAlreadySwept] and [kCannotBeSwept]. A route
/// added to the router with no entry here is a FAILURE, which is what stops
/// this file quietly measuring a shrinking share of a growing app.
const Map<String, ({int controls, int reachable})> kExpected =
    <String, ({int controls, int reachable})>{
      '/scan': (controls: 1, reachable: 1),
      // 5 -> 7 on 2026-08-26: the two `_LegalLink`s joined the orbit. The
      // control count did NOT move — `FocusableTap` still builds a
      // `GestureDetector` with an `onTap`, so the rig counts the same nine.
      '/sign-up': (controls: 9, reachable: 7),
      '/check-inbox': (controls: 1, reachable: 1),
      '/verify-email': (controls: 3, reachable: 3),
      // 2 -> 4, and it is the SAME TWO LINKS: this screen renders
      // `LegalConsentFields` too, so one widget fix moved two routes.
      '/reaccept-terms': (controls: 5, reachable: 4),
      '/reset-password': (controls: 1, reachable: 1),
      '/notifications': (controls: 1, reachable: 1),
      // 2 -> 4, i.e. NOTHING on this route is off the orbit any more. `Back`
      // and `More options` are the app bar; `_iconButton` now builds on
      // `FocusableTap`.
      '/sub/:id': (controls: 4, reachable: 4),
      '/paywall': (controls: 0, reachable: 0),
      // 2 -> 3 on 2026-08-26, and NO WIDGET CHANGED. The third control was
      // always built; this file was sweeping the state that does not build it.
      // See [kSweptAs]: the cancel row is `if (isPro)`, so `2 of 2` was a full
      // house for a screen with the ROSCA control absent. The three are the
      // app-bar back button, the restore row and the cancel row, each named by
      // its own icon in `/manage-plan · a keyboard reaches the cancel-plan row`.
      '/manage-plan': (controls: 3, reachable: 3),
      '/calendar': (controls: 7, reachable: 7),
      '/insights': (controls: 3, reachable: 3),
      '/budget': (controls: 0, reachable: 0),
    };

/// Every [GoRoute] in the tree, including the ones nested under a shell.
///
/// `StatefulShellRoute` keeps its children on `branches`, NOT on `routes` — a
/// walk that only follows `RouteBase.routes` finds fourteen of Subly's nineteen
/// routes and misses all five shell branches, which are the app's whole
/// signed-in surface. That is the reason this is a function and not a
/// `configuration.routes.whereType<GoRoute>()`.
List<GoRoute> _everyGoRoute(List<RouteBase> routes) {
  final List<GoRoute> out = <GoRoute>[];
  for (final RouteBase r in routes) {
    if (r is GoRoute) {
      out.add(r);
      out.addAll(_everyGoRoute(r.routes));
    } else if (r is StatefulShellRoute) {
      for (final StatefulShellBranch b in r.branches) {
        out.addAll(_everyGoRoute(b.routes));
      }
    } else {
      out.addAll(_everyGoRoute(r.routes));
    }
  }
  return out;
}

/// True when [child] is [ancestor] or sits anywhere beneath it.
///
/// Verbatim from `test/keyboard_traversal_test.dart`; see that file's header for
/// why both directions of containment are needed and why it walks upwards.
bool _isUnder(Element? child, Element? ancestor) {
  if (child == null || ancestor == null) return false;
  if (identical(child, ancestor)) return true;
  bool found = false;
  child.visitAncestorElements((Element a) {
    if (identical(a, ancestor)) {
      found = true;
      return false;
    }
    return true;
  });
  return found;
}

/// What a failure calls a control. Verbatim from the sibling file.
///
/// ⚠️ LOCALISED STRINGS ON PURPOSE, and no assertion in this file compares one —
/// only counts and element identity are asserted, so an .arb edit cannot turn
/// this file red.
String _label(Element e) {
  String? semantic;
  e.visitAncestorElements((Element a) {
    final Widget w = a.widget;
    if (w is Semantics && w.properties.label != null) {
      semantic = w.properties.label;
      return false;
    }
    return true;
  });
  if (semantic != null) return semantic!;
  String? painted;
  void down(Element c) {
    if (painted != null) return;
    final Widget w = c.widget;
    if (w is Text && w.data != null) {
      painted = w.data;
      return;
    }
    c.visitChildren(down);
  }

  e.visitChildren(down);
  return painted ?? e.widget.runtimeType.toString();
}

/// True when the nearest ancestor of [e] that DECLARES a link role declares it
/// true.
///
/// ⚠️ THE ROLE, NOT THE LABEL — which is why this is not `_label` with a
/// different return type. `_label` skips past any `Semantics` whose label is
/// null, and `FocusableTap` deliberately leaves `label` null for a control whose
/// own painted text is its name, so a label-hunting walk sails straight past the
/// very annotation that says "this is a link". Roles are compared here and
/// labels never are: `properties.link` is a bool the widget code sets, not a
/// translated string an .arb edit could move.
///
/// 🔴 "DECLARES", NOT "NEAREST". MEASURED 2026-08-26: a walk that stopped at the
/// first `Semantics` ancestor found NOTHING, because `Focus` contributes a
/// `Semantics` of its own between the control and its annotation — the ancestor
/// chain under a `FocusableTap` reads `DecoratedBox, Semantics, Focus, …,
/// Semantics, FocusableTap`, and the FIRST of those two says nothing about a
/// role. `link == null` is exactly the difference between "this annotation is
/// silent on the question" and "this annotation answers it", so the walk skips
/// the silent ones and stops at the first that answers.
bool _declaresLink(Element e) {
  bool? declared;
  e.visitAncestorElements((Element a) {
    final Widget w = a.widget;
    if (w is Semantics && w.properties.link != null) {
      declared = w.properties.link;
      return false;
    }
    return true;
  });
  return declared ?? false;
}

/// One route's measurement.
class _Sweep {
  _Sweep(this.orbit, this.controls, this.dead);

  final List<FocusNode> orbit;
  final List<Element> controls;
  final List<Element> dead;

  List<String> get deadLabels => dead.map(_label).toList();
}

/// Builds [route]'s screen from the ROUTE'S OWN BUILDER and presses Tab through
/// it.
///
/// 🔴 THE BUILDER, NOT A SCREEN CLASS. `route.builder!(context, state)` is the
/// exact expression `GoRouter` evaluates when a user navigates here, so this rig
/// cannot drift from what the app shows: re-point `/budget` at a different
/// widget and this sweeps the new one without an edit. Naming
/// `const BudgetScreen()` here instead would be the hardcoded-route-list defect
/// wearing a different hat — a second declaration of what the router says.
///
/// The `Builder` is what gives the route builder a context beneath
/// `MaterialApp`'s `Localizations` and beneath the `ProviderScope`
/// `pumpAt` installs — `_GatedInsights` and every `AppLocalizations.of` call in
/// the tree need both.
Future<_Sweep> _sweepRoute(
  WidgetTester tester,
  GoRouter router,
  GoRoute route, {
  List<Override>? overrides,
}) async {
  final GoRouterState state = GoRouterState(
    router.configuration,
    uri: Uri.parse(route.path),
    matchedLocation: route.path,
    fullPath: route.path,
    pathParameters: kPathParameters[route.path] ?? const <String, String>{},
    extra: kExtra[route.path],
    pageKey: ValueKey<String>(route.path),
  );
  await pumpAt(
    tester,
    kKeyboardSurface,
    Builder(builder: (BuildContext c) => route.builder!(c, state)),
    overrides: overrides ?? kSweptAs[route.path] ?? const <Override>[],
  );
  // See the header: a uniform, bounded advance of fake time, applied to every
  // route rather than to the one that needs it. Bounded on purpose —
  // `pumpAndSettle` spins forever on a screen whose timer never quiesces, and
  // `pumpAt`'s own doc names that as the reason it advances none.
  for (int i = 0; i < 40; i++) {
    await tester.pump(const Duration(milliseconds: 100));
  }

  tester.binding.focusManager.primaryFocus?.unfocus();
  await tester.pump();

  final List<FocusNode> orbit = <FocusNode>[];
  for (int i = 0; i < 200; i++) {
    await tester.sendKeyEvent(LogicalKeyboardKey.tab);
    await tester.pump();
    final FocusNode? pf = tester.binding.focusManager.primaryFocus;
    if (pf == null || orbit.any((FocusNode n) => identical(n, pf))) break;
    orbit.add(pf);
  }

  final List<Element> candidates = <Element>[
    for (final Element e in find.byType(GestureDetector).evaluate())
      if ((e.widget as GestureDetector).onTap != null) e,
    for (final Element e in find.byType(InkWell).evaluate())
      if ((e.widget as InkWell).onTap != null) e,
    ...find.byType(EditableText).evaluate(),
  ];
  final List<Element> controls = candidates
      .where(
        (Element e) =>
            !candidates.any((Element o) => !identical(o, e) && _isUnder(e, o)),
      )
      .toList();

  final List<Element> dead = controls
      .where(
        (Element e) => !orbit.any(
          (FocusNode n) =>
              _isUnder(e, n.context as Element?) ||
              _isUnder(n.context as Element?, e),
        ),
      )
      .toList();

  return _Sweep(orbit, controls, dead);
}

/// The completeness precondition every count in this file rests on. Verbatim
/// from the sibling file: a culled control is neither reachable nor
/// unreachable — it does not exist — so a scrolling screen under-reports and
/// never says so.
void _everythingIsLaidOut(WidgetTester tester, String screen) {
  for (final Element e in find.byType(Scrollable).evaluate()) {
    final ScrollableState s = (e as StatefulElement).state as ScrollableState;
    expect(
      s.position.maxScrollExtent,
      0.0,
      reason:
          '$screen scrolls at ${kKeyboardSurface.width}x'
          '${kKeyboardSurface.height}, so its off-screen controls were culled '
          'and every count for it is about the viewport rather than about the '
          'screen. Raise the surface height until this passes, or — if the '
          'surface cannot fix it, as for a paged carousel — give the route a '
          'kCannotBeSwept entry with its reason. Do NOT relax this assertion',
    );
  }
}

/// Reading order for a pair of focus rects, with no invented tolerance.
/// Verbatim from the sibling file.
bool _followsInReadingOrder(Rect a, Rect b) {
  final bool sameRow = b.top < a.bottom && a.top < b.bottom;
  return sameRow ? b.left >= a.left : b.top >= a.top;
}

void main() {
  // The router is real and is read once. `TestWidgetsFlutterBinding` first:
  // resolving `authRepositoryProvider` initialises a `WidgetsFlutterBinding`,
  // and flutter_test cannot install its own binding afterwards — the file fails
  // to LOAD, with an assertion about `_debugInitializedType` that says nothing
  // about routers. Measured 2026-08-26.
  TestWidgetsFlutterBinding.ensureInitialized();
  final ProviderContainer container = ProviderContainer();
  tearDownAll(container.dispose);
  final GoRouter router = container.read(routerProvider);

  final List<GoRoute> declared = _everyGoRoute(router.configuration.routes);
  final List<GoRoute> screenBearing = declared
      .where((GoRoute r) => r.builder != null)
      .toList();
  final Set<String> declaredPaths = declared.map((GoRoute r) => r.path).toSet();
  final Set<String> screenPaths = screenBearing
      .map((GoRoute r) => r.path)
      .toSet();

  group('the router is the only declaration of the route set', () {
    test('19 routes, 17 of them build a screen, 2 are redirect-only', () {
      expect(
        declared.length,
        19,
        reason:
            'the router declares ${declared.length} GoRoutes, not 19. That is '
            'not a failure by itself — an app may gain a route — but this '
            "file's coverage claim is about a set of that size, and the new "
            'route needs a kExpected entry before any number here can be read. '
            'Declared: ${declaredPaths.toList()..sort()}',
      );
      expect(
        screenBearing.length,
        17,
        reason:
            '${screenBearing.length} routes build a screen, not 17. Screen '
            'paths: ${screenPaths.toList()..sort()}',
      );
      for (final GoRoute r in declared) {
        if (r.builder != null) continue;
        expect(
          r.redirect,
          isNotNull,
          reason:
              '"${r.path}" builds no screen and has no redirect either, so it '
              'resolves to nothing. A route that is neither swept nor '
              'redirected is not a scope decision, it is a dead route',
        );
      }
    });

    // 🔴 THE ONE WAY A ROUTE CAN LEAVE THIS SWEEP WITHOUT SAYING SO. A route
    // written with `pageBuilder:` instead of `builder:` has a null `builder`,
    // so it silently drops out of `screenBearing` and out of every count and
    // coverage assertion below — the sweep would keep passing while quietly
    // measuring a smaller set. Subly uses none today; this is the case that
    // notices the first one.
    test('no route builds through pageBuilder, which this rig cannot call', () {
      final List<String> paged = declared
          .where((GoRoute r) => r.pageBuilder != null)
          .map((GoRoute r) => r.path)
          .toList();
      expect(
        paged,
        isEmpty,
        reason:
            'these routes build through `pageBuilder`: $paged. This file '
            'reaches a screen through `route.builder`, so a pageBuilder route '
            'has a null builder and vanishes from the sweep AND from the '
            'coverage assertion, with nothing going red. Teach _sweepRoute to '
            'call pageBuilder, or give each one a kCannotBeSwept entry',
      );
    });

    test('the route tables name only routes that exist', () {
      for (final String p in <String>[
        ...kAlreadySwept,
        ...kCannotBeSwept.keys,
        ...kExpected.keys,
        ...kPathParameters.keys,
        ...kExtra.keys,
        ...kSweptAs.keys,
      ]) {
        expect(
          screenPaths,
          contains(p),
          reason:
              '"$p" is named by a table in this file and is NOT a '
              'screen-bearing route in the router. Either it was renamed — in '
              'which case the entry is stale and points at nothing — or it was '
              'deleted, in which case an exclusion or a pin has outlived its '
              'subject. Screen-bearing routes: ${screenPaths.toList()..sort()}',
        );
      }
    });

    // 🔴 THE ASSERTION THIS WHOLE FILE RESTS ON. Everything above checks that
    // the tables point at real routes; this checks the other direction — that
    // every real route is pointed at. Without it a route added to the router
    // is simply not swept, and a green run here would mean nothing more than
    // "the routes I happened to list still pass".
    test('every screen-bearing route is accounted for', () {
      final Set<String> accounted = <String>{
        ...kAlreadySwept,
        ...kCannotBeSwept.keys,
        ...kExpected.keys,
      };
      expect(
        screenPaths.difference(accounted).toList()..sort(),
        isEmpty,
        reason:
            'these routes build a screen and no table in this file mentions '
            'them, so NOTHING measures whether a keyboard can operate them. '
            'Add a kExpected entry with the measured counts, or — if the '
            'screen genuinely cannot be swept — a kCannotBeSwept entry with '
            'the reason and a case that fails when the reason expires',
      );
      expect(
        kAlreadySwept.intersection(kExpected.keys.toSet()),
        isEmpty,
        reason:
            'these routes are pinned in BOTH files. Two sets of counts on one '
            'screen disagree eventually, and on that day neither is evidence',
      );
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // THE EXCLUSION, AND THE CASE THAT KILLS IT WHEN ITS REASON EXPIRES.
  // ───────────────────────────────────────────────────────────────────────────
  testWidgets('the /onboarding exclusion still has its reason', (
    WidgetTester tester,
  ) async {
    expect(
      kCannotBeSwept,
      hasLength(1),
      reason:
          'this case evidences ONE exclusion, and it takes the path from '
          'kCannotBeSwept rather than naming it, so it cannot end up '
          're-checking a reason that belongs to a different route. A second '
          'entry needs its own case that fails when ITS reason expires — an '
          'exclusion nothing re-checks is a note about code that may no longer '
          'exist. Excluded: ${kCannotBeSwept.keys.toList()}',
    );
    final String path = kCannotBeSwept.keys.single;
    final GoRoute route = screenBearing.firstWhere(
      (GoRoute r) => r.path == path,
    );
    await pumpAt(
      tester,
      kKeyboardSurface,
      Builder(
        builder: (BuildContext c) => route.builder!(
          c,
          GoRouterState(
            router.configuration,
            uri: Uri.parse(path),
            matchedLocation: path,
            fullPath: path,
            pathParameters: const <String, String>{},
            pageKey: ValueKey<String>(path),
          ),
        ),
      ),
    );
    final Iterable<ScrollableState> paging = find
        .byType(Scrollable)
        .evaluate()
        .map((Element e) => (e as StatefulElement).state as ScrollableState)
        .where(
          (ScrollableState s) =>
              s.position.axisDirection == AxisDirection.right ||
              s.position.axisDirection == AxisDirection.left,
        )
        .where((ScrollableState s) => s.position.maxScrollExtent > 0);
    expect(
      paging,
      isNotEmpty,
      reason:
          'kCannotBeSwept excludes $path because it is a horizontal carousel '
          'whose off-screen pages are never built. It no longer has a '
          'horizontal Scrollable with pages beyond the first — the reason has '
          'expired. DELETE the exclusion and sweep the route; do not leave a '
          'note describing code that changed underneath it',
    );
  });

  // ───────────────────────────────────────────────────────────────────────────
  // THE SWEEP. One group per route, generated from the router — see the header.
  // ───────────────────────────────────────────────────────────────────────────
  for (final GoRoute route in screenBearing) {
    final String path = route.path;
    if (kAlreadySwept.contains(path) || kCannotBeSwept.containsKey(path)) {
      continue;
    }
    // A route with no kExpected entry is caught by `every screen-bearing route
    // is accounted for` above; here it would only throw a null error with no
    // sentence attached, so it is skipped and left to the case that explains it.
    final ({int controls, int reachable})? want = kExpected[path];
    if (want == null) continue;

    group('$path · keyboard', () {
      testWidgets('the sweep sees the whole screen', (
        WidgetTester tester,
      ) async {
        await _sweepRoute(tester, router, route);
        _everythingIsLaidOut(tester, path);
      });

      testWidgets('SC 2.1.1 · ${want.reachable} of ${want.controls} '
          'controls are reachable by Tab', (WidgetTester tester) async {
        final _Sweep s = await _sweepRoute(tester, router, route);
        _everythingIsLaidOut(tester, path);
        expect(
          s.controls.length,
          want.controls,
          reason:
              'the interactive-control inventory for $path moved to '
              '${s.controls.length}. That is not a failure by itself — a screen '
              'may gain or lose a control — but the reachable/dead split is '
              'meaningless until this number is reconciled',
        );
        expect(
          s.controls.length - s.dead.length,
          want.reachable,
          reason:
              '$path: ${s.controls.length - s.dead.length} of '
              '${s.controls.length} controls are reachable by Tab, not '
              '${want.reachable}. If this went UP a control JOINED the Tab '
              'orbit — update the number here, and the SC 2.1.1 row in '
              'tooling/dod-register.json which quotes this sweep. ⚠️ Say which '
              'control and whether its FUNCTION was previously unreachable: a '
              'duplicate hit target joining the orbit changes this number and '
              'fixes no defect, and mistaking the two is how this file came to '
              'publish a false Level A failure on 2026-08-26. '
              'Off the orbit today: ${s.deadLabels}',
        );
      });

      testWidgets('Tab closes a cycle back onto the first element', (
        WidgetTester tester,
      ) async {
        final _Sweep s = await _sweepRoute(tester, router, route);
        expect(
          s.orbit,
          isNotEmpty,
          reason:
              'pressing Tab on $path focused nothing at all — the screen is '
              'entirely keyboard-inoperable, which is SC 2.1.1 failed outright '
              'rather than partially',
        );
        s.orbit.first.requestFocus();
        await tester.pump();
        for (int i = 0; i < s.orbit.length; i++) {
          await tester.sendKeyEvent(LogicalKeyboardKey.tab);
          await tester.pump();
        }
        expect(
          identical(tester.binding.focusManager.primaryFocus, s.orbit.first),
          isTrue,
          reason:
              '${s.orbit.length} Tab presses from the first element of $path '
              'did not come back to it. Focus entered a sub-cycle it cannot '
              'leave — a keyboard trap (SC 2.1.2), reached from the very first '
              'Tab press',
        );
      });

      testWidgets('Shift-Tab retraces the same cycle backwards', (
        WidgetTester tester,
      ) async {
        final _Sweep s = await _sweepRoute(tester, router, route);
        s.orbit.first.requestFocus();
        await tester.pump();
        // ⚠️ `shiftLeft`, NOT `shift` — the synonym key leaves
        // `HardwareKeyboard.isShiftPressed` false and every press below reads
        // as a plain forward Tab. The sibling file measured that in 2026-08-21.
        for (int i = 0; i <= s.orbit.length; i++) {
          await tester.sendKeyDownEvent(LogicalKeyboardKey.shiftLeft);
          await tester.sendKeyEvent(LogicalKeyboardKey.tab);
          await tester.sendKeyUpEvent(LogicalKeyboardKey.shiftLeft);
          await tester.pump();
          final FocusNode want =
              s.orbit[s.orbit.length - 1 - (i % s.orbit.length)];
          expect(
            identical(tester.binding.focusManager.primaryFocus, want),
            isTrue,
            reason:
                'Shift-Tab #${i + 1} on $path left focus somewhere other than '
                'the forward orbit reversed. A control reachable going one way '
                'and not the other is a one-way trap: the user gets in and '
                'cannot back out',
          );
        }
      });

      testWidgets('focus order follows visual order', (
        WidgetTester tester,
      ) async {
        final _Sweep s = await _sweepRoute(tester, router, route);
        for (int i = 0; i + 1 < s.orbit.length; i++) {
          final Rect a = s.orbit[i].rect;
          final Rect b = s.orbit[i + 1].rect;
          expect(
            _followsInReadingOrder(a, b),
            isTrue,
            reason:
                'on $path, Tab goes from '
                '${_label(s.orbit[i].context! as Element)} at ${a.topLeft} to '
                '${_label(s.orbit[i + 1].context! as Element)} at ${b.topLeft} '
                '— backwards up the page, or leftwards along a row. SC 2.4.3 '
                'asks focus order to preserve meaning, and the meaning of a '
                'form is the order it is read in',
          );
        }
      });
    });
  }

  // ───────────────────────────────────────────────────────────────────────────
  // 🔴 THE THREE SCREENS THAT CARRIED ALL NINE OFF-ORBIT CONTROLS, NAMED — AND
  // THE TWO WHERE OFF-ORBIT NEVER MEANT INOPERABLE.
  //
  // The counts above go red if a dead control is fixed, but a count does not
  // convey WHICH control — `/sign-up` at `7 of 9` would also be satisfied by
  // deleting two controls, and deleting the consent checkbox is not a fix. So
  // each of the three screens gets a case that names what a keyboard reaches on
  // it and what it does not, in the terms the screen itself uses.
  //
  // ⚠️ THE GROUP KEEPS ITS NAME THOUGH SIX OF THE NINE ARE FIXED, because two
  // of the three cases still name something a keyboard does not reach and the
  // third now asserts the opposite of what it used to. A `/sub/:id` that
  // asserts nothing is dead is doing MORE work than the one that asserted two
  // were: it has to name the pair and put them on the orbit, not merely count
  // an absence — an empty dead set is also what deleting both buttons looks
  // like.
  //
  // 🔴 AND ON THE TWO CONSENT SCREENS THE CASE ALSO PRESSES SPACE. A count of
  // off-orbit `GestureDetector`s cannot tell a keyboard-dead control from a
  // duplicate hit target for a reachable one, and this file spent its first day
  // publishing the second as the first (see the header). The correction is not
  // a softer sentence — it is a POSITIVE assertion, driven by a real key event,
  // that the function those duplicates duplicate is keyboard-operable end to
  // end: Tab lands inside the `Checkbox`, `Space` ticks it, and the gated
  // button unlocks. The day that stops being true these cases go red and the
  // original claim becomes correct, which is the only honest way to hold a
  // "this is NOT a defect" finding.
  //
  // ⚠️ IDENTITY AND COUNTS, NEVER LABELS. `_label` appears only inside
  // `reason:` strings, so an .arb edit cannot turn any of these red.
  // ───────────────────────────────────────────────────────────────────────────
  group('SC 2.1.1 · the controls a keyboard cannot reach', () {
    GoRoute routeAt(String path) =>
        screenBearing.firstWhere((GoRoute r) => r.path == path);

    /// The Tab stops that belong to [control] — in EITHER direction of
    /// containment.
    ///
    /// 🔴 BOTH DIRECTIONS, WHICH IS THE SAME RULE `_sweepRoute` USES TO DECIDE
    /// WHAT IS DEAD, and it has to be: the two shapes put the focus node on
    /// opposite sides of the control. A `Checkbox` is not itself a focus node —
    /// `ToggleableStateMixin` builds one inside a `FocusableActionDetector`, so
    /// the orbit stop sits BENEATH the `Checkbox` element. A `FocusableTap` is
    /// the other way round: the node is in the `FocusableActionDetector` it
    /// WRAPS the control in, so the stop sits ABOVE the `GestureDetector` this
    /// file counts as the control.
    ///
    /// ⚠️ THIS WAS ONE-DIRECTIONAL AND CALLED `stopsInside` UNTIL 2026-08-26,
    /// WHEN THE SECOND SHAPE ARRIVED. Measured: the detail app bar reported
    /// `0 stops` for two controls the sweep had just measured as reachable —
    /// the helper and `_sweepRoute` disagreeing about the same node, which is
    /// the disagreement that makes two numbers on one screen worthless. It is
    /// renamed rather than patched so no call site keeps reading it as "under".
    /// Identity, never a label.
    List<FocusNode> stopsFor(_Sweep s, Element control) => s.orbit
        .where(
          (FocusNode n) =>
              _isUnder(n.context as Element?, control) ||
              _isUnder(control, n.context as Element?),
        )
        .toList();

    /// Whether the single gated `FilledButton` on the current screen is live.
    ///
    /// Read off `onPressed`, not off a painted colour: `onPressed == null` is
    /// exactly what makes the clickwrap blocking, and it is also why the button
    /// is absent from the control inventory at rest — a null `onTap` never
    /// reaches `_sweepRoute`'s candidate list.
    bool gatedButtonIsLive() =>
        (find.byType(FilledButton).evaluate().single.widget as FilledButton)
            .onPressed !=
        null;

    testWidgets('/sign-up · Tab reaches the consent box and Space ticks it', (
      WidgetTester tester,
    ) async {
      final _Sweep s = await _sweepRoute(tester, router, routeAt('/sign-up'));
      // 🔴 THIS FILE PUBLISHED THE OPPOSITE UNTIL 2026-08-26 — "a keyboard-only
      // user cannot tick the consent box, so they cannot complete
      // registration" — and it was FALSE. The four off-orbit controls are the
      // two inline legal links and the two consent SENTENCES, which
      // `legal_consent_fields.dart` builds as second hit targets for the boxes
      // beside them and says so in its own comment. The boxes are Material
      // `Checkbox`es and they traverse. Everything below measures that instead
      // of asserting it.
      final List<Element> boxes = find.byType(Checkbox).evaluate().toList();
      expect(
        boxes,
        hasLength(2),
        reason:
            'sign-up is expected to carry exactly two Material Checkboxes — the '
            'blocking terms clickwrap and the optional marketing opt-in. It '
            'carries ${boxes.length}, so the consent shape moved and every '
            'sentence in this case is about a screen that no longer exists',
      );
      for (final Element b in boxes) {
        expect(
          stopsFor(s, b),
          hasLength(1),
          reason:
              'a consent Checkbox on sign-up owns no stop on the Tab orbit. '
              'THAT is the SC 2.1.1 failure this file once claimed and had to '
              'retract — if it is true now it is true for real, and the '
              'off-orbit consent SENTENCE beside it stops being a harmless '
              'duplicate and becomes the only remaining way to tick the box. '
              'Off-orbit today: ${s.deadLabels}',
        );
      }
      expect(
        gatedButtonIsLive(),
        isFalse,
        reason:
            'the sign-up submit button is live before anything has been '
            'ticked, so the clickwrap is not blocking and the keyboard '
            'question below is moot for the wrong reason',
      );
      // The terms box is identified by CONSEQUENCE, not by label or by
      // position: it is the box whose ticking unlocks the submit button. If the
      // two rows were ever reordered, the first Checkbox would be the marketing
      // opt-in, submit would stay disabled, and this goes red.
      stopsFor(s, boxes.first).single.requestFocus();
      await tester.pump();
      await tester.sendKeyEvent(LogicalKeyboardKey.space);
      await tester.pump();
      expect(
        (find.byType(Checkbox).evaluate().first.widget as Checkbox).value,
        isTrue,
        reason:
            'Space on the focused terms Checkbox did not tick it. A control '
            'that Tab reaches and no key operates is SC 2.1.1 failed just the '
            'same — reachability is the half this rig measures by counting, '
            'and this is the half it has to press a key for',
      );
      expect(
        gatedButtonIsLive(),
        isTrue,
        reason:
            'Tab-then-Space on the consent box did NOT unlock sign-up. A '
            'keyboard-only user cannot register, which is a Level A failure on '
            'the app\'s registration path and the single most severe thing this '
            'sweep can find. Rebuild the consent row on design_system\'s '
            'FocusableTap, as login was on 2026-08-25',
      );
      // 🔴 4 -> 2 ON 2026-08-26, AND THE TWO THAT LEFT ARE THE TWO THAT WERE A
      // DEFECT. `legal_consent_fields.dart`'s `_LegalLink` was rebuilt on
      // `FocusableTap`, so Terms and Privacy now own Tab stops and a keyboard
      // user can open the documents they are being asked to agree to. What is
      // still off the orbit is the pair the same file builds as SECOND HIT
      // TARGETS for the boxes beside them, and pinning that at 2 rather than
      // deleting the assertion is deliberate: it goes red if somebody
      // "completes" the fix by making the sentences focusable, which would add
      // a Tab stop that ticks a box the previous Tab stop already reached.
      expect(
        s.dead.length,
        2,
        reason:
            'sign-up controls outside the Tab orbit: ${s.deadLabels}. TWO are '
            'expected and they are the two consent SENTENCES — duplicate hit '
            'targets for the boxes the assertions above prove a keyboard '
            'operates, costing no function. They are NOT the consent boxes and '
            'they are NOT the two inline legal links, which joined the orbit '
            'on 2026-08-26 when _LegalLink moved onto design_system\'s '
            'FocusableTap. If this went UP, say WHICH control left the orbit '
            'and whether its function went with it; if it went DOWN to 0 or 1, '
            'a consent sentence became separately focusable and that is a '
            'redundant Tab stop, not a fix',
      );
      expect(
        s.controls.length - s.dead.length,
        7,
        reason:
            'sign-up reachable: the two text fields, the two consent boxes, the '
            '"Already have an account?" button and — since 2026-08-26 — the '
            'Terms and Privacy links. NOT the submit button: it is disabled at '
            'rest, so it is not a control this rig counts at all. Reaching '
            '${s.controls.length - s.dead.length} instead means the split '
            'moved and the sentence above is stale',
      );
      // 🔴 AND THE LINKS ARE NAMED, NOT JUST COUNTED. `7 of 9` is equally
      // satisfied by two links that traverse and by two links that were
      // deleted, and a consent screen with no route to the documents is worse
      // than one whose route is keyboard-dead. So: the screen carries exactly
      // two link-role controls, and each owns exactly one Tab stop.
      final List<Element> links = s.controls
          .where(
            (Element e) => _declaresLink(e),
          )
          .toList();
      expect(
        links,
        hasLength(2),
        reason:
            'sign-up is expected to carry exactly two link-role controls — the '
            'Terms document and the Privacy document, which AppConfig points at '
            'the live nikatru.com pages. It carries ${links.length}. Either a '
            'document link was removed from the clickwrap, or one stopped '
            'announcing as a link, and in both cases the counts above are '
            'about a screen that no longer exists',
      );
      for (final Element l in links) {
        expect(
          stopsFor(s, l),
          hasLength(1),
          reason:
              'a legal document link on sign-up owns no stop on the Tab orbit, '
              'so a keyboard user is being asked to agree to a document they '
              'cannot open. That is SC 2.1.1 at Level A on the clickwrap '
              'itself, and it is exactly the state this screen was in until '
              '2026-08-26. Rebuild _LegalLink on design_system\'s FocusableTap '
              '- do NOT hand-roll a Focus widget at the call site. Off-orbit '
              'today: ${s.deadLabels}',
        );
      }
    });

    testWidgets('/reaccept-terms · a keyboard can agree, not only sign out', (
      WidgetTester tester,
    ) async {
      final _Sweep s = await _sweepRoute(
        tester,
        router,
        routeAt('/reaccept-terms'),
      );
      // 🔴 RETRACTED 2026-08-26. This case asserted that "a user held at this
      // gate has exactly two ways out — agree, or sign out — and Tab reaches
      // only the second". Measured false: the orbit's two stops are the consent
      // Checkbox and the sign-out button, and Space on the first unlocks
      // Accept. Both doors open from the keyboard.
      final Element box = find.byType(Checkbox).evaluate().single;
      final List<FocusNode> boxStops = stopsFor(s, box);
      expect(
        boxStops,
        hasLength(1),
        reason:
            'the gate\'s consent Checkbox owns no stop on the Tab orbit, so the '
            'only door left to a keyboard is sign-out. That is the finding this '
            'file wrongly published on 2026-08-26 and had to withdraw; if it '
            'is true now it is true for real. Off-orbit today: ${s.deadLabels}',
      );
      expect(
        s.orbit.where((FocusNode n) => !_isUnder(n.context as Element?, box)),
        isNotEmpty,
        reason:
            'the gate keeps a keyboard-reachable consent box and NOTHING else, '
            'so a user who declines cannot sign out. Declining has to stay '
            'possible — that is the whole reason the sign-out button is on this '
            'screen',
      );
      expect(
        gatedButtonIsLive(),
        isFalse,
        reason:
            'the re-acceptance Accept button is live before the box is ticked, '
            'so the tick is decorative and this screen is a notice rather than '
            'a clickwrap',
      );
      boxStops.single.requestFocus();
      await tester.pump();
      await tester.sendKeyEvent(LogicalKeyboardKey.space);
      await tester.pump();
      expect(
        gatedButtonIsLive(),
        isTrue,
        reason:
            'Tab-then-Space on the gate\'s consent box did NOT unlock Accept, '
            'so a keyboard-only user held at this interstitial can only leave '
            'by signing out of an account they are still paying for. Level A, '
            'on a screen the router puts in front of EVERY signed-in user when '
            'kTermsVersion moves',
      );
      // 🔴 3 -> 1 ON 2026-08-26, FROM A FIX MADE IN NEITHER OF THIS SCREEN'S
      // OWN FILES. This gate renders the same `LegalConsentFields` as
      // `/sign-up`, so rebuilding `_LegalLink` on `FocusableTap` moved two
      // routes at once — which is the argument for the shared primitive stated
      // as a measurement rather than as a preference. The one that remains is
      // the consent sentence, a duplicate hit target, pinned so that making it
      // focusable is as red as losing a link.
      expect(
        s.dead.length,
        1,
        reason:
            'reaccept-terms controls outside the Tab orbit: ${s.deadLabels}. '
            'ONE is expected: the consent SENTENCE, a duplicate hit target for '
            'the box the assertions above prove a keyboard ticks. The two '
            'inline legal links used to be here too and were genuinely '
            'keyboard-dead; they joined the orbit on 2026-08-26. If this is '
            'back at 3, a user held at this gate is again being asked to agree '
            'to two documents a keyboard cannot open',
      );
      // The same naming assertion `/sign-up` carries, for the same reason: a
      // count of 1 is equally satisfied by two links that traverse and by two
      // links that were removed from the gate altogether.
      final List<Element> links = s.controls
          .where(
            (Element e) => _declaresLink(e),
          )
          .toList();
      expect(
        links,
        hasLength(2),
        reason:
            'the re-acceptance gate is expected to carry exactly two link-role '
            'controls — the two documents it is re-taking consent to. It '
            'carries ${links.length}, so the screen is asking for agreement to '
            'a set of documents it does not link',
      );
      for (final Element l in links) {
        expect(
          stopsFor(s, l),
          hasLength(1),
          reason:
              'a legal document link on the re-acceptance gate owns no stop on '
              'the Tab orbit. This screen is the one the router puts in front '
              'of EVERY signed-in user when kTermsVersion moves, and it cannot '
              'be left except by agreeing or signing out — so a keyboard user '
              'is made to choose between agreeing to a document they cannot '
              'open and losing access to an account they are paying for. '
              'Off-orbit today: ${s.deadLabels}',
        );
      }
    });

    // 🔴 THIS CASE WAS `a keyboard cannot reach the app-bar actions` UNTIL
    // 2026-08-26 AND NOW ASSERTS THE OPPOSITE, BECAUSE THE WIDGET CHANGED.
    // `subscription_detail_screen.dart`'s `_iconButton` was
    // `Semantics(button: true)` over a bare `GestureDetector` — a role for a
    // screen reader and no `FocusNode` for anybody — so "Back" and "More
    // options" were both off the orbit and this screen was one a keyboard user
    // could read in full and leave by no door on. It is built on
    // `design_system`'s `FocusableTap` now, exactly as home's identical pair
    // was on 2026-08-25.
    //
    // ⚠️ AND THE CASE GOT LONGER RATHER THAN SHORTER, WHICH IS THE WHOLE POINT.
    // `dead.isEmpty` on its own is WEAKER than the `dead.length == 2` it
    // replaces: deleting both buttons satisfies it. So the pair is now
    // identified by the screen's own published key, required to exist, required
    // to own one Tab stop each, and required to be the FIRST two stops — the
    // mirror of the positional assertion this case used to make about the dead
    // set, and the one that says "the app bar is the top of the keyboard path"
    // rather than merely "nothing is missing".
    testWidgets('/sub/:id · a keyboard reaches the app-bar actions first', (
      WidgetTester tester,
    ) async {
      final _Sweep s = await _sweepRoute(tester, router, routeAt('/sub/:id'));
      expect(
        s.dead,
        isEmpty,
        reason:
            'detail keyboard-dead controls: ${s.deadLabels}. NONE is expected '
            'since 2026-08-26 — every control this rig counts on the detail '
            'screen is on the Tab orbit. Anything here is a control whose '
            'function a keyboard cannot reach, on a screen whose only exits are '
            'in the app bar',
      );
      // The hero is identified by the key the SCREEN publishes, not by a label
      // and not by a widget class: `detail-hero-gradient` is checked in, and if
      // it is renamed this goes red with a sentence rather than silently
      // measuring nothing.
      final Finder heroFinder = find.byKey(const Key('detail-hero-gradient'));
      expect(
        heroFinder,
        findsOneWidget,
        reason:
            'the detail screen no longer publishes a `detail-hero-gradient` '
            'key, so this case cannot tell the app bar from the body and every '
            'sentence below is about a screen it can no longer find',
      );
      final Element hero = heroFinder.evaluate().single;
      final List<Element> heroControls = s.controls
          .where((Element e) => _isUnder(e, hero))
          .toList();
      expect(
        heroControls,
        hasLength(2),
        reason:
            'the detail hero is expected to carry exactly two controls — '
            '"Back" and "More options". It carries ${heroControls.length}. If '
            'it carries none, the exits were DELETED rather than fixed, which '
            'the empty dead set above would happily report as success',
      );
      final List<FocusNode> heroStops = <FocusNode>[
        for (final Element e in heroControls) ...stopsFor(s, e),
      ];
      expect(
        heroStops,
        hasLength(2),
        reason:
            'the detail app bar owns ${heroStops.length} stops on the Tab '
            'orbit, not one each. THAT is the SC 2.1.1 failure this case was '
            'written to report and reported until 2026-08-26: a keyboard user '
            'can read the whole screen and leave by no door on it. Rebuild '
            '_iconButton on design_system\'s FocusableTap — do NOT hand-roll a '
            'Focus widget at the call site',
      );
      // 🔴 THE POSITIONAL HALF, WHICH THE COUNTS CANNOT SAY. The app bar is the
      // top of the screen, so it must be the top of the keyboard path too: two
      // exits that traverse LAST are reachable and still make a keyboard user
      // walk the whole body to leave. SC 2.4.3 asks focus order to preserve
      // meaning, and the meaning of an app bar is that it comes first.
      expect(
        <bool>[
          identical(s.orbit[0], heroStops[0]),
          identical(s.orbit[1], heroStops[1]),
        ],
        everyElement(isTrue),
        reason:
            'the detail screen\'s first two Tab stops are not "Back" then '
            '"More options". The app bar is the first thing on the screen and '
            'the only way off it, so it has to be the first thing the keyboard '
            'reaches; a Tab order that puts the exits after the body is '
            'reachable-but-buried. Orbit: '
            '${s.orbit.map((FocusNode n) => _label(n.context! as Element)).toList()}',
      );
      final double lowestHero = heroStops
          .map((FocusNode n) => n.rect.bottom)
          .reduce((double a, double b) => a > b ? a : b);
      final double highestBody = s.orbit
          .where((FocusNode n) => !heroStops.any((FocusNode h) => identical(h, n)))
          .map((FocusNode n) => n.rect.top)
          .reduce((double a, double b) => a < b ? a : b);
      expect(
        lowestHero,
        lessThanOrEqualTo(highestBody),
        reason:
            'the two app-bar stops no longer sit above every other stop on the '
            'detail screen, so "first two" above is an ordering that no longer '
            'matches the page. Either the hero moved or a body control was '
            'lifted into it',
      );
    });

    // ─────────────────────────────────────────────────────────────────────────
    // 🔴 THIS SCREEN WAS SWEPT IN THE STATE THE CONTROL IT EXISTS FOR IS ABSENT
    // FROM, AND `(controls: 2, reachable: 2)` PINNED IT THERE. `2 of 2` is a
    // full house, so nothing was red and nothing could go red: the cancel row is
    // built under `if (isPro)` and the default sweep resolves no entitlement.
    // [kSweptAs] now drives the entitlement, so the row is built and graded.
    //
    // ⚠️ NO WIDGET CHANGED AND THE ROW WAS ALREADY REACHABLE — what was false
    // was the sentence attached to the number, the same shape this file's header
    // records for 2026-08-26. So the three are NAMED here rather than counted:
    // `3 of 3` is equally satisfied by three controls that traverse and by a
    // screen whose cancel row was deleted again.
    //
    // ⚠️ ICONS, NOT LABELS. Each of the three is identified by the `IconData`
    // `manage_plan_screen.dart` checks in, which is a const in the screen's own
    // source — an .arb edit cannot move any assertion below.
    // ─────────────────────────────────────────────────────────────────────────

    /// The one control on the pumped screen that contains [icon].
    Element controlWith(_Sweep s, IconData icon) {
      final Finder painted = find.byIcon(icon);
      expect(
        painted,
        findsOneWidget,
        reason:
            'manage-plan paints no $icon, so the control it identifies is not '
            'on the screen at all. A count of three would still be satisfied by '
            'some other control taking its place',
      );
      final List<Element> owning = s.controls
          .where((Element c) => _isUnder(painted.evaluate().single, c))
          .toList();
      expect(
        owning,
        hasLength(1),
        reason:
            'manage-plan paints $icon but ${owning.length} of the controls this '
            'rig counts contain it, so the icon no longer names one control',
      );
      return owning.single;
    }

    testWidgets('/manage-plan · a keyboard reaches the cancel-plan row', (
      WidgetTester tester,
    ) async {
      final _Sweep s = await _sweepRoute(
        tester,
        router,
        routeAt('/manage-plan'),
      );
      final List<Element> named = <Element>[
        // The only way off this screen — the route sits above the shell, so
        // there is no bottom nav bar under it and nothing to pop.
        controlWith(s, Icons.arrow_back),
        controlWith(s, Icons.refresh),
        // 🔴 THE ROSCA CONTROL, AND THE REASON THIS SCREEN EXISTS.
        controlWith(s, Icons.cancel_outlined),
      ];
      expect(
        named.map(identityHashCode).toSet(),
        hasLength(3),
        reason:
            'two of back / restore / cancel resolved to the SAME control, so '
            'one of the three rows is not the row this case thinks it is',
      );
      expect(
        s.controls.length,
        3,
        reason:
            'manage-plan carries ${s.controls.length} controls this rig counts '
            'and only three of them are named above, so a control is being '
            'graded by the pair in kExpected and by nothing else',
      );
      for (final Element c in named) {
        expect(
          stopsFor(s, c),
          hasLength(1),
          reason:
              'a control on manage-plan owns no stop on the Tab orbit. If it is '
              'the cancel row, a keyboard user cannot cancel a subscription '
              'they can buy — ROSCA asks that cancelling be no harder than '
              'subscribing, and unreachable is harder. Off the orbit today: '
              '${s.deadLabels}',
        );
      }
      expect(
        s.dead,
        isEmpty,
        reason:
            'manage-plan controls outside the Tab orbit: ${s.deadLabels}. NONE '
            'is expected: this screen has three controls and a keyboard reaches '
            'all three',
      );
    });

    // The case that kills [kSweptAs]'s one entry when its reason expires — the
    // same rule `the /onboarding exclusion still has its reason` applies to
    // kCannotBeSwept. An entry that drives a state nothing depends on any more
    // reads as a decision somebody made about today's code.
    testWidgets('/manage-plan · the cancel row is only there in the Pro state', (
      WidgetTester tester,
    ) async {
      final _Sweep free = await _sweepRoute(
        tester,
        router,
        routeAt('/manage-plan'),
        overrides: const <Override>[],
      );
      expect(
        find.byIcon(Icons.cancel_outlined),
        findsNothing,
        reason:
            'manage-plan builds its cancel row with no entitlement resolved, so '
            'kSweptAs no longer buys anything on this route — DELETE the entry '
            'rather than leave a state override describing code that changed '
            'underneath it',
      );
      expect(
        free.controls,
        hasLength(2),
        reason:
            'the default state of manage-plan carries ${free.controls.length} '
            'controls, not the two the Pro sweep is one more than. The '
            'difference between the two states is what kSweptAs exists for, and '
            'it is no longer exactly the cancel row',
      );
    });
  });
}

