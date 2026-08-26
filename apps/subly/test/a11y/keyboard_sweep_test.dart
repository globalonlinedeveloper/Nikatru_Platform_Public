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
// What IS written down here is three kinds of thing the router does NOT state,
// each of them a table this file must keep true:
//   · [kAlreadySwept]   — which routes the SIBLING file pins, so they are not
//                         measured twice under two sets of numbers.
//   · [kCannotBeSwept]  — routes this rig genuinely cannot measure, each with
//                         its reason.
//   · [kExpected]       — the MEASURED counts, per route.
// All three are keyed by route path, and every key is checked back against the
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
// 13 routes, 37 interactive controls, 28 reachable by Tab, 9 OUTSIDE THE TAB
// ORBIT. Three screens carry all nine:
//
//   /sign-up        5 of 9  — the two inline legal links (Terms, Privacy) and
//                             the two consent SENTENCES.
//   /reaccept-terms 2 of 5  — the same two links and the one consent sentence.
//   /sub/:id        2 of 4  — "Back" and "More options", the app-bar actions.
//                             The same pair home carried until 2026-08-25.
//
// ── 🔴 AND SIX OF THOSE NINE ARE A DEFECT. THREE ARE NOT, AND THIS FILE SAID
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
// 🔴 SO THE HONEST SPLIT OF THE NINE IS 6 + 3, AND BOTH HALVES ARE ASSERTED:
//   · 6 GENUINELY KEYBOARD-INOPERABLE FUNCTIONS. The four `_LegalLink`s (Terms
//     and Privacy, on both consent screens) and the two `/sub/:id` app-bar
//     actions. Every one is the shape the sibling file named —
//     `Semantics(link:/button: true)` over a hand-rolled `GestureDetector`,
//     which tells a screen reader what a control IS and creates no `FocusNode`,
//     so it does nothing whatever for a keyboard. A keyboard user cannot open
//     the document they are being asked to agree to, and cannot leave the
//     detail screen by any door on it. The fix is the one that already landed
//     for login and home: `design_system`'s `FocusableTap`.
//   · 3 DUPLICATE HIT TARGETS whose function is reachable — the consent
//     sentences. Counted, named as duplicates, and PROVEN redundant by the
//     Space-key cases below rather than argued away. If the box they duplicate
//     ever stops being reachable, those cases go red and these three become a
//     defect for real.
//
// ⚠️ THE COUNTS DID NOT MOVE, AND THAT IS THE POINT OF RECORDING THIS. 37 / 28
// / 9 were correct measurements the whole time; what was false was the sentence
// attached to them. The file was GREEN BECAUSE ITS EXPECTATIONS AGREED WITH ITS
// OWN FALSE BELIEF — the number and the claim matched each other and only one
// of them was checked against the widgets.
//
// ⚠️ THESE ARE PINS ON A FAILING STATE, exactly as the sibling file's are. Each
// goes red when a control is ADDED and when one is FIXED, and the second is the
// point: a sweep that only fires on regression records today's failure as the
// standard.
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
// ── 🔴 DIRECTION, PROVEN. THREE MUTANTS, 2026-08-26 ─────────────────────────
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
import 'package:subly/core/router.dart';

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

/// (interactive controls found, controls the Tab orbit reaches) per route.
///
/// 🔴 MEASURED 2026-08-26, NOT INTENDED. Nine of these thirty-seven controls
/// sit OUTSIDE the Tab orbit and the numbers say so. ⚠️ `reachable` is exactly
/// that — how many controls the orbit lands on — and it is NOT a count of
/// keyboard-operable FUNCTIONS: six of the nine are genuinely inoperable and
/// three are duplicate hit targets for a `Checkbox` a keyboard reaches and
/// ticks. The header carries the split and the cases below assert both halves;
/// reading these pairs as a defect count is the error this file itself
/// published until 2026-08-26.
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
      '/sign-up': (controls: 9, reachable: 5),
      '/check-inbox': (controls: 1, reachable: 1),
      '/verify-email': (controls: 3, reachable: 3),
      '/reaccept-terms': (controls: 5, reachable: 2),
      '/reset-password': (controls: 1, reachable: 1),
      '/notifications': (controls: 1, reachable: 1),
      '/sub/:id': (controls: 4, reachable: 2),
      '/paywall': (controls: 0, reachable: 0),
      '/manage-plan': (controls: 2, reachable: 2),
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
  GoRoute route,
) async {
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
  // 🔴 THE THREE SCREENS THAT CARRY ALL NINE OFF-ORBIT CONTROLS, NAMED — AND
  // THE TWO WHERE OFF-ORBIT DOES NOT MEAN INOPERABLE.
  //
  // The counts above go red if a dead control is fixed, but a count does not
  // convey WHICH control — `/sign-up` at `5 of 9` would also be satisfied by
  // deleting four controls, and deleting the consent checkbox is not a fix. So
  // each of the three screens gets a case that names what a keyboard cannot
  // reach on it, in the terms the screen itself uses.
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

    /// The Tab stops that lie inside [box].
    ///
    /// A `Checkbox` is not itself a focus node: `ToggleableStateMixin` builds
    /// one inside a `FocusableActionDetector`, so the orbit stop sits BENEATH
    /// the `Checkbox` element rather than on it. Identity, never a label.
    List<FocusNode> stopsInside(_Sweep s, Element box) => s.orbit
        .where((FocusNode n) => _isUnder(n.context as Element?, box))
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
          stopsInside(s, b),
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
      stopsInside(s, boxes.first).single.requestFocus();
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
      expect(
        s.dead.length,
        4,
        reason:
            'sign-up controls outside the Tab orbit: ${s.deadLabels}. FOUR are '
            'expected and they are NOT the consent boxes, which the assertions '
            'above prove a keyboard operates. They are the two inline legal '
            'links — genuinely keyboard-dead, so a keyboard user cannot open '
            'the documents they are agreeing to — and the two consent '
            'SENTENCES, which are duplicate hit targets for the boxes and cost '
            'no function. Only the links are a defect; the fix is the same '
            'hand-rolled Semantics + GestureDetector -> FocusableTap swap login '
            'took on 2026-08-25',
      );
      expect(
        s.controls.length - s.dead.length,
        5,
        reason:
            'sign-up reachable: the two text fields, the two consent boxes and '
            'the "Already have an account?" button. NOT the submit button — it '
            'is disabled at rest, so it is not a control this rig counts at '
            'all. Reaching ${s.controls.length - s.dead.length} instead means '
            'the split moved and the sentence above is stale',
      );
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
      final List<FocusNode> boxStops = stopsInside(s, box);
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
      expect(
        s.dead.length,
        3,
        reason:
            'reaccept-terms controls outside the Tab orbit: ${s.deadLabels}. '
            'THREE are expected: the two inline legal links, which are '
            'genuinely keyboard-dead — a user is being asked to agree to two '
            'documents a keyboard cannot open — and the consent SENTENCE, '
            'which is a duplicate hit target for the box the assertions above '
            'prove a keyboard ticks',
      );
    });

    testWidgets('/sub/:id · a keyboard cannot reach the app-bar actions', (
      WidgetTester tester,
    ) async {
      final _Sweep s = await _sweepRoute(tester, router, routeAt('/sub/:id'));
      expect(
        s.dead.length,
        2,
        reason:
            'detail keyboard-dead controls: ${s.deadLabels}. TWO are expected '
            '— "Back" and "More options", the app-bar pair. Home carried the '
            'identical defect until 2026-08-25: a keyboard user can read the '
            'screen and leave by no door on it',
      );
      // 🔴 THE POSITIONAL HALF, WHICH THE COUNT CANNOT SAY. Both dead controls
      // sit ABOVE every reachable one — they are the app bar. A screen whose
      // whole top row is keyboard-dead is a different failure from two dead
      // controls scattered through a list, and only this assertion tells them
      // apart.
      final double lowestDead = s.dead
          .map(
            (Element e) => tester
                .getRect(
                  find.byElementPredicate((Element x) => identical(x, e)),
                )
                .bottom,
          )
          .reduce((double a, double b) => a > b ? a : b);
      final double highestLive = s.orbit
          .map((FocusNode n) => n.rect.top)
          .reduce((double a, double b) => a < b ? a : b);
      expect(
        lowestDead,
        lessThanOrEqualTo(highestLive),
        reason:
            'the keyboard-dead controls on the detail screen are meant to be '
            'the app bar — everything a keyboard CAN reach sits below them. '
            'They no longer do, so the dead set is not the pair this case '
            'describes and the sentence above has stopped being true. Dead: '
            '${s.deadLabels}',
      );
    });
  });
}
