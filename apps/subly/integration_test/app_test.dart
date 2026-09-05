// Subly — live end-to-end suite (runs against real Supabase auth + the live
// Cloudflare Worker + D1). Drives the REAL widget tree in a browser, so it works
// regardless of the Flutter web renderer (the UI is a canvas — no DOM to query,
// which is why Playwright can't do this and integration_test can).
//
// The app is flipped to LIVE mode purely by the SUPABASE_URL / SUPABASE_ANON_KEY
// / API_BASE_URL dart-defines (see AppConfig.isBackendLive) — no code change.
// Credentials for a throwaway, pre-confirmed user arrive via E2E_EMAIL /
// E2E_PASSWORD (the CI workflow provisions the user before this runs and purges
// it after).
//
// Run (see .github/workflows/e2e.yml):
//   chromedriver --port=4444 &
//   flutter drive \
//     --driver=test_driver/integration_test.dart \
//     --target=integration_test/app_test.dart \
//     -d web-server --browser-name=chrome \
//     --dart-define=SUPABASE_URL=... --dart-define=SUPABASE_ANON_KEY=... \
//     --dart-define=API_BASE_URL=... \
//     --dart-define=E2E_EMAIL=... --dart-define=E2E_PASSWORD=...

import 'dart:async';

import 'package:flutter/gestures.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';
import 'package:nikatru_platform_storage/nikatru_platform_storage.dart';
import 'package:go_router/go_router.dart';
import 'package:supabase_flutter/supabase_flutter.dart' as sb;

import 'package:subly/core/e2e_keys.dart';
import 'package:subly/features/auth/legal_consent_fields.dart';
import 'package:subly/features/auth/reaccept_terms_screen.dart';
import 'package:subly/features/budget/budget_screen.dart';
import 'package:subly/features/calendar/calendar_screen.dart';
import 'package:subly/features/home/home_screen.dart';
import 'package:subly/features/insights/insights_screen.dart';
import 'package:subly/features/settings/settings_screen.dart';
import 'package:subly/features/shell/app_shell.dart';
import 'package:subly/main.dart' as app;
import 'package:subly/state/analytics_providers.dart' show kInstallIdKey;

void main() {
  final IntegrationTestWidgetsFlutterBinding binding =
      IntegrationTestWidgetsFlutterBinding.ensureInitialized();

  const String email = String.fromEnvironment('E2E_EMAIL');
  const String password = String.fromEnvironment('E2E_PASSWORD');
  const String tokenHash = String.fromEnvironment('E2E_TOKEN_HASH');

  // 🔴 A SECOND, SEPARATE THROWAWAY USER, AND IT HAS TO BE SEPARATE.
  //
  // The delete leg destroys the account it signs in with. The first user's
  // subscription row is the subject of `tooling/e2e/verify_row.mjs`, which runs
  // AFTER the whole drive and asserts `COUNT(*) >= 1` — so deleting that account
  // from inside the app would turn leg 2's server-side proof red for the exact
  // reason leg 6 passed. Two users keep the two claims independent: one account
  // survives the run to prove the write landed, one is erased to prove the
  // erasure reaches. e2e.yml provisions both from the same
  // `tooling/e2e/provision_user.mjs`. [pipeline N-6 leg 6]
  const String deleteEmail = String.fromEnvironment('E2E_DELETE_EMAIL');
  const String deletePassword = String.fromEnvironment('E2E_DELETE_PASSWORD');
  const String deleteTokenHash = String.fromEnvironment(
    'E2E_DELETE_TOKEN_HASH',
  );

  // The app animates forever in places (scan progress ring/timer, loaders), so
  // pumpAndSettle() would hang. Advance a fixed wall-clock slice instead — this
  // still lets real network futures resolve on the live binding.
  //
  // 🔴 AND THE SLICE IS BOUNDED BY THE TEST, NOT ONLY BY THE CLOCK — ADDED
  // 2026-08-24 AFTER THREE RED NIGHTS (#362).
  //
  // 🔬 WHAT HAPPENED. Runs 32550453857 (08-22), 32616926238 (08-23) and
  // 32688913917 (08-24) all failed identically, and both reported stacks pass
  // through THIS loop: `app_test.dart 66:19` inside `app_test.dart 65:5
  // pumpFor` called from `app_test.dart 995:11` — the 4s slice after the "Done"
  // tap in leg 2's cancel flow. Test 2 reported `inTest is not true`
  // (flutter_test binding.dart:2996, the assert at the top of
  // LiveTestWidgetsFlutterBinding.pump) and test 3 reported `Guarded function
  // conflict`, with the SAME frames named as "when the first function was
  // called". One loop, two tests, two messages.
  //
  // 🔑 THE LOOP WAS AWAITED CORRECTLY AT EVERY CALL SITE; THAT WAS NEVER THE
  // DEFECT. It was bounded by `DateTime.now()` alone, so its lifetime was tied
  // to the wall clock and to nothing about the test that started it. When an
  // error reaches the test zone's `handleUncaughtError`
  // (binding.dart:1814-1832) the test COMPLETES IMMEDIATELY — the body's await
  // chain is not unwound, it keeps running — so this loop went on calling
  // `tester.pump()` into a finished test, and then into the NEXT one.
  //
  // 🔴 AND IT DESTROYED THE EVIDENCE, WHICH IS WHY THE CAUSE IS STILL UNNAMED.
  // integration_test.dart:90 is `results[testDescription] = Failure(...)` — a
  // Map keyed by the test's description, so the LAST exception reported for a
  // test overwrites every earlier one. The real failure of leg 2 was reported
  // first and then overwritten by this loop's `inTest is not true`. That is why
  // three nights of CI name a helper and never name the app defect, and why the
  // screenshots stop at `12-detail` with no assertion message to match.
  //
  // ⚠️ IT PARKS, IT DOES NOT `return`. Measured in a scratch
  // LiveTestWidgetsFlutterBinding harness on 2026-08-24: returning early lets
  // the abandoned body run its REMAINING statements — more taps, more
  // screenshots, more expects — inside a completed test, which fails on
  // `Zone.current == _parentZone` (binding.dart:1709) instead. Awaiting a future
  // that never completes suspends the abandoned body where it stands, which is
  // the only outcome that adds nothing to the run at all. The same harness
  // measured pumps-issued-after-the-owning-test-ended: 1 before this change, 0
  // after.
  //
  // ⚠️ THE TWO LIMBS ARE NOT REDUNDANT, AND EITHER CAN BE THE ONE THAT TRIPS.
  // `binding.inTest` goes false in `postTest`, which flutter_test registers with
  // `addTearDown` INSIDE the test body (widget_tester.dart:183) — so it is one
  // teardown among several and its order relative to the `tearDown` below is not
  // guaranteed. Limb 1 catches the binding leaving the test; limb 2 catches the
  // case limb 1 structurally cannot see — the NEXT test has started, so
  // `inTest` is true again and belongs to somebody else. That second case is
  // precisely the `Guarded function conflict`.
  //
  // ⚬ WHAT THIS STILL CANNOT DO, STATED. A `tester.pump()` already IN FLIGHT
  // when the test dies cannot be cancelled from here. On CI that window is not
  // the failure being seen — `postTest` ran to completion on all three nights
  // (it is what set `inTest` false, which is what the reported assert observed)
  // — but on the VM binding the scratch harness does fail
  // `_pendingFrame == null` in `postTest` from exactly that window, and this
  // change does not close it.
  final Future<void> untilTheIsolateEnds = Completer<void>().future;

  // Bumped on BOTH sides of the boundary between two tests, so a loop that
  // captured the old value sees the change at the earliest moment either hook
  // runs, whichever the framework runs first.
  int testEpoch = 0;
  setUp(() {
    testEpoch++;
  });
  tearDown(() {
    testEpoch++;
  });

  /// One frame — unless the test that started the loop calling this is over,
  /// in which case the caller is suspended here and never pumps again.
  ///
  /// [startedIn] is the value of [testEpoch] read when that loop began.
  ///
  /// 🔴 EVERY WALL-CLOCK LOOP IN THIS FILE GOES THROUGH HERE, NOT ONLY
  /// `pumpFor`. `waitFor`, `waitGone` and `exportConsentAnonId` are the same
  /// shape — `while (DateTime.now().isBefore(end)) { await tester.pump(); }` —
  /// and carried the identical defect; `pumpFor` is merely the one the app
  /// happened to die inside on 2026-08-22. Leaving the other three as they were
  /// would have left the same three red nights available to the next app-side
  /// crash, in a helper CI would then name instead.
  Future<void> guardedPump(
    WidgetTester tester,
    int startedIn,
    Duration step,
  ) async {
    // Limb 1 — the binding has left the test. The next `pump()` would be the
    // `inTest is not true` that CI reported for leg 2.
    if (!binding.inTest) await untilTheIsolateEnds;
    // Limb 2 — a DIFFERENT test now owns the tester. The next `pump()` would
    // be the `Guarded function conflict` that CI reported for leg 6.
    if (testEpoch != startedIn) await untilTheIsolateEnds;
    await tester.pump(step);
  }

  Future<void> pumpFor(WidgetTester tester, Duration total) async {
    final int startedIn = testEpoch;
    final DateTime end = DateTime.now().add(total);
    while (DateTime.now().isBefore(end)) {
      await guardedPump(tester, startedIn, const Duration(milliseconds: 100));
    }
  }

  // Poll for a finder to appear — SnackBars auto-dismiss at 4s, so we assert
  // the instant one shows instead of racing its timeout with a fixed pump.
  Future<bool> waitFor(
    WidgetTester tester,
    Finder f, {
    Duration timeout = const Duration(seconds: 12),
  }) async {
    final int startedIn = testEpoch;
    final DateTime end = DateTime.now().add(timeout);
    while (DateTime.now().isBefore(end)) {
      await guardedPump(tester, startedIn, const Duration(milliseconds: 200));
      if (f.evaluate().isNotEmpty) return true;
    }
    return false;
  }

  // Poll for a finder to DISAPPEAR — the mirror of waitFor, used to prove a
  // dismissed modal really left the tree before the next tap is attempted.
  Future<bool> waitGone(
    WidgetTester tester,
    Finder f, {
    Duration timeout = const Duration(seconds: 8),
  }) async {
    final int startedIn = testEpoch;
    final DateTime end = DateTime.now().add(timeout);
    while (DateTime.now().isBefore(end)) {
      await guardedPump(tester, startedIn, const Duration(milliseconds: 200));
      if (f.evaluate().isEmpty) return true;
    }
    return false;
  }

  Future<void> shot(String name) => binding.takeScreenshot(name);

  /// 🔴 TAP ONLY ONCE THE TAP WILL ACTUALLY REACH THE CONTROL.
  ///
  /// `tester.tap()` aims at a finder's CENTRE and delivers a real pointer event
  /// there. If something is drawn on top of that point the event goes to the
  /// thing on top — `warnIfMissed` prints a warning that nobody reads and the
  /// test carries on, failing several lines later on whatever the tap was
  /// supposed to produce. This suite already has `expectNothingCoveringTheApp`
  /// for one instance of that class (a modal `ModalBarrier`); this is the other,
  /// and it cost the nightly two red nights.
  ///
  /// 🔬 WHAT HAPPENED, 2026-08-03 → 2026-08-04. `app_shell.dart` DREW the
  /// navigation bar as a FLOATING `Positioned` inside a `Stack`, over the branch
  /// content — so the bottom ~86px of every scroll view was inside the viewport
  /// but underneath an opaque bar. `scrollUntilVisible` finishes with
  /// `Scrollable.ensureVisible`, which scrolls the MINIMUM needed to bring the
  /// target inside the viewport RECT and knows nothing about what is painted on
  /// top of it — so it parked "Log out" at the viewport's bottom edge, under the
  /// bar. The tap at (800, 827) landed on the `Insights` tab, `signOut()` was
  /// never called, and the suite reported "Sign-out did not return to the login
  /// screen" — a sign-out message for a hit-testing problem.
  ///
  /// It began the night the settings list grew two rows (the open-source
  /// licences tile above and Delete account below): the extra scroll extent is
  /// what let `ensureVisible` park the button at the very bottom instead of
  /// stopping short at max-scroll. Nothing about signing out changed, which is
  /// why `test/sign_out_destination_test.dart` stayed green throughout — it
  /// mounts a 1200x4000 surface where nothing is ever occluded.
  ///
  /// ⚠️ THAT PARTICULAR OCCLUDER IS GONE; THE CLASS OF FAILURE IS NOT. P2.6a
  /// (#217) docked the shell into the chassis `AppScaffold`, which delivers the
  /// pill through `bottomNavigationBar` — a layout SLOT, so the body is now
  /// measured above it and no scroll view ends underneath it. The FAB did not
  /// move: `Scaffold` still paints it over the body. This helper therefore stays,
  /// and stays a HIT TEST rather than a question about a widget type, which is
  /// the only reason it needed no edit when the bar changed shape.
  ///
  /// So: keep scrolling while the control is occluded, and if it can never be
  /// reached, SAY WHAT IS ON TOP OF IT rather than blaming the button.
  /// 🔴 HOISTED OUT OF [tapWhenHittable] ON 2026-08-08 SO THE DETECTOR CAN USE
  /// IT TOO. These two closures were the only shape-independent knowledge this
  /// suite had about "is the app actually reachable", and they were locked
  /// inside the tapper — so `expectNothingCoveringTheApp`, the guard written
  /// for precisely this failure, went on asking a question about a widget TYPE.
  /// See the note on that function.
  /// ⚠️ TESTER-FREE ON PURPOSE. `expectNothingCoveringTheApp` takes only a
  /// `String`, and its two call sites are REGISTER ANCHORS
  /// (`tooling/e2e-leg-register.json`, leg `anonymous`) that must stay
  /// byte-identical — so adding a `WidgetTester` parameter to reach the hit test
  /// would have meant editing the very lines that prove leg 1. The geometry is
  /// therefore taken from the render tree directly, and the view id from the
  /// target's own `BuildContext` (a `Finder`'s element IS one) rather than from
  /// `tester.view`.
  HitTestResult hitTestAtCentreOf(Finder finder) {
    final Element element = finder.evaluate().first;
    final RenderBox box = element.renderObject! as RenderBox;
    final HitTestResult result = HitTestResult();
    WidgetsBinding.instance.hitTestInView(
      result,
      box.localToGlobal(box.size.center(Offset.zero)),
      View.of(element).viewId,
    );
    return result;
  }

  List<String> occluders(Finder finder) {
    if (finder.evaluate().isEmpty) {
      return <String>['(the control is not in the tree)'];
    }
    return hitTestAtCentreOf(finder).path
        .map((HitTestEntry e) => e.target.runtimeType.toString())
        .take(6)
        .toList();
  }

  /// Would a `tester.tap()` aimed at [finder] actually land ON it?
  ///
  /// `tester.tap()` aims at the finder's centre and delivers a real pointer
  /// event there. If anything is painted over that point the event goes to the
  /// thing on top — SILENTLY. This is the only check in the suite that does not
  /// need to know what that thing IS.
  bool reaches(Finder finder) {
    if (finder.evaluate().isEmpty) return false;
    final RenderObject target = finder.evaluate().first.renderObject!;
    return hitTestAtCentreOf(
      finder,
    ).path.any((HitTestEntry e) => identical(e.target, target));
  }

  Future<void> tapWhenHittable(
    WidgetTester tester,
    Finder finder,
    String what, {
    Finder? scrollable,
  }) async {
    // A control resting under the FAB only needs the list driven a little
    // further — the scroll views carry enough bottom padding (108px on
    // Settings) to clear it, so this terminates on a real layout.
    if (!reaches(finder) && scrollable != null) {
      for (int i = 0; i < 15 && !reaches(finder); i++) {
        await tester.drag(scrollable, const Offset(0, -120));
        await pumpFor(tester, const Duration(milliseconds: 250));
      }
    }

    expect(
      reaches(finder),
      isTrue,
      reason:
          'A tap aimed at "$what" would NOT reach it — something is drawn on '
          'top of its centre point, and the tap would go there instead, '
          'silently. At that point the hit test finds: '
          '${occluders(finder).join(' → ')}. '
          'The usual cause is the FAB in app_shell.dart: Scaffold paints it '
          'OVER the body, so a control at the bottom of a scroll view can be '
          'inside the viewport and still not tappable. (The nav pill was the '
          'other cause until #217 handed it to AppScaffold as a '
          'bottomNavigationBar — a layout slot, not an overlay.)',
    );
    await tester.tap(finder);
  }

  /// WHAT IS ON SCREEN, for a failure message that would otherwise only say
  /// what is NOT.
  ///
  /// `findsNothing`-style failures name the widget that is missing and stop
  /// there, so "Sign-out did not return to the login screen" reads the same
  /// whether the user is still in Settings (the tap missed), stuck on a
  /// spinner (the round-trip hung) or in the onboarding carousel (the redirect
  /// was overridden). Those need three different fixes. Listing the text that
  /// IS rendered tells them apart from the run page alone, without another
  /// night's wait.
  String onScreen(WidgetTester tester) {
    final Iterable<String> texts = tester
        .widgetList<Text>(find.byType(Text))
        .map((Text t) => t.data ?? '')
        .where((String s) => s.trim().isNotEmpty)
        .take(25);
    return texts.isEmpty ? '(no Text widgets in the tree)' : texts.join(' | ');
  }

  /// 🔴 THE FAILURE THIS SUITE MUST NAME OUT LOUD — AND THE SECOND TIME IT GOT
  /// THROUGH, BECAUSE THIS FUNCTION WAS ASKING ABOUT A WIDGET TYPE.
  ///
  /// A modal covering the app swallows every `tester.tap()` aimed beneath it —
  /// no exception, no warning. The test then fails several lines later on
  /// whatever the tap was supposed to produce, naming the wrong thing.
  ///
  /// 🔬 2026-07-27, THE FIRST TIME. The DPDP consent prompt (`ConsentGate` —
  /// retired in the P2.6 merge, class deleted 2026-08-10) came up over
  /// onboarding as a `showDialog` ROUTE, `tap('Skip')` was swallowed, and both
  /// tests reported `Found 0 widgets with text "Welcome back"` — a login-screen
  /// error for a dialog problem. This function was written then, and it asked
  /// `find.byType(Dialog)`.
  ///
  /// 🔬 2026-08-08, THE SECOND TIME — IDENTICAL SYMPTOM, AND THIS GUARD PASSED
  /// THROUGH IT. The P2.6 chassis merge replaced that route dialog with the
  /// stamped `_ConsentPrompt` in `app.dart`, whose own comment states the
  /// change: *"Rendered INLINE rather than via showDialog"* — a `Positioned.fill`
  /// + opaque `ColoredBox` scrim inside the `MaterialApp.builder` Stack. It is
  /// not a route and it is not a `Dialog`, so `find.byType(Dialog)` matched
  /// NOTHING while the prompt sat on screen absorbing taps. All three tests
  /// failed with `Found 0 widgets with text "Welcome back"`, the run's only
  /// screenshot (`01-onboarding`) shows the prompt in the middle of the
  /// onboarding screen, and this assertion — the one written for exactly this —
  /// reported clean one line earlier.
  ///
  /// 🔑 SO IT NO LONGER ASKS WHAT THE MODAL IS. The limb that matters is a HIT
  /// TEST: if the control this suite is about to tap cannot be reached, the app
  /// is covered, whatever is doing the covering. That is shape-independent, and
  /// it is the only one of the three below that needed no edit when the modal
  /// changed type. The other two limbs stay because they can NAME the two known
  /// shapes, which turns a hit-test path into a diagnosis.
  ///
  /// ⚠️ It names `Skip` because both call sites pass 'the onboarding screen' and
  /// the next act at each is `tap(find.text('Skip'))`. That is honest coupling,
  /// not a generic function pretending to be general.
  void expectNothingCoveringTheApp(String where) {
    final Finder skip = find.text('Skip');
    final Finder consentDecline = find.text('No thanks');

    // Limb 1 — a route modal (the 2026-07-27 shape).
    expect(
      find.byType(Dialog),
      findsNothing,
      reason:
          'A modal dialog ROUTE is on screen at $where. Its ModalBarrier '
          'swallows every tap aimed at the app beneath it — silently — so the '
          'next failure would blame whatever that tap was meant to do. If a new '
          'first-run modal was added, this suite has to answer it (see '
          'answerConsentIfPrompted).',
    );

    // Limb 2 — the stamped inline scrim (the 2026-08-08 shape).
    expect(
      consentDecline,
      findsNothing,
      reason:
          'The analytics-consent prompt is STILL ON SCREEN at $where. It is not '
          'a route and not a Dialog — app.dart renders it inline as a '
          'Positioned.fill + opaque ColoredBox over the whole app — so it '
          'absorbs the tap on Skip and the app never leaves onboarding. '
          'answerConsentIfPrompted was supposed to have answered it.',
    );

    // Limb 3 — THE ONE THAT DOES NOT NEED TO KNOW THE SHAPE.
    if (skip.evaluate().isNotEmpty) {
      expect(
        reaches(skip),
        isTrue,
        reason:
            'Something is covering the app at $where: a tap aimed at "Skip" '
            'would NOT reach it, so it would be swallowed silently and the next '
            'assertion would blame the login screen. The hit test at that point '
            'finds: ${occluders(skip).join(' → ')}.',
      );
    }
  }

  /// Answers the DPDP analytics-consent prompt if it is up, and reports whether
  /// it was.
  ///
  /// 🔴 IT LOOKS FOR THE ANSWER CONTROL, NOT FOR A WIDGET TYPE — CORRECTED
  /// 2026-08-08 AFTER THIS EXACT MISTAKE COST A WHOLE RUN. This polled
  /// `find.byType(Dialog)`, which was right while the prompt was a `showDialog`
  /// route. The P2.6 chassis merge replaced it with the stamped `_ConsentPrompt`
  /// in `app.dart` — inline, by its own comment *"Rendered INLINE rather than
  /// via showDialog"*, because that gate sits in `MaterialApp.builder`, ABOVE
  /// the router's Navigator, where `showDialog` has no Navigator to push onto.
  /// A `Positioned.fill` + opaque `ColoredBox` is not a `Dialog`, so this
  /// returned false for ten seconds with the prompt plainly on screen, the
  /// first test failed its "the prompt never appeared" assertion, and the other
  /// two had their `tap('Skip')` eaten by the scrim.
  ///
  /// The decline control is the right thing to key on: it is the affordance the
  /// suite actually uses, it exists in BOTH shapes, and it survives the widget
  /// tree being restyled — which is precisely what happened.
  ///
  /// The prompt opens over whatever screen is showing the first time a LIVE
  /// build launches with no decision on disk — which is precisely this suite,
  /// and only this suite: the gate keys off `analyticsEnabledProvider`, which
  /// resolves to the compile-time `AppConfig.isBackendLive`, so no demo build
  /// takes this branch. (A widget test can, by overriding that provider —
  /// `test/consent_prompt_real_surface_test.dart` does exactly that. What no
  /// widget test can reach is the REAL first launch of a REAL live build, which
  /// is what this line is actually about.)
  ///
  /// Answering it is not a workaround. The prompt is a real first-run screen and
  /// this is the only automated proof it appears at all. **"No thanks" on
  /// purpose:** `applyConsentDecision` records and uploads the artifact for
  /// either answer, so denying exercises the same seam as allowing without
  /// pointing a nightly stream of CI analytics events at production.
  ///
  /// The decision persists to the browser's key-value store, so only the FIRST
  /// launch of a run is prompted. The hard assertion that the gate still appears
  /// therefore lives in the first test alone; the second calls this so that a
  /// reordering or a cleared store cannot wedge the suite, and does not assert
  /// on the result.
  Future<bool> answerConsentIfPrompted(
    WidgetTester tester, {
    Duration timeout = const Duration(seconds: 10),
  }) async {
    final Finder decline = find.text('No thanks');
    if (!await waitFor(tester, decline, timeout: timeout)) return false;
    // Still checked, but as a SECOND opinion rather than as the detector: the
    // prompt this suite knows carries both answers, side by side and equally
    // weighted (which is itself the DPDP dark-pattern rule the app is keeping).
    expect(
      find.text('Allow'),
      findsWidgets,
      reason:
          'Something offering "No thanks" came up on first launch, but it does '
          'not also offer "Allow" — that is not the consent prompt, and this '
          'suite only knows how to answer that one.',
    );
    await shot('00-consent');
    // 🔴 tapWhenHittable, NOT tester.tap. This control is the ONE thing on
    // screen that must be reachable at this moment, and if some later change
    // puts anything over it the run must say "the tap on No thanks would not
    // land" — not spend ten more seconds and then report that the prompt never
    // closed.
    await tapWhenHittable(tester, decline.first, 'No thanks');
    expect(
      await waitGone(tester, decline),
      isTrue,
      reason:
          'The consent prompt did not close after "No thanks" was tapped. It is '
          'an inline scrim over the whole app (app.dart `_ConsentPrompt`), so '
          'until it goes every tap beneath it is swallowed silently.',
    );
    return true;
  }

  /// Hands the harness the `anon_id` the consent artifact this run uploaded is
  /// keyed by, and returns it.
  ///
  /// 🔴 THE UPLOAD IS FIRE-AND-FORGET, SO A SILENTLY FAILING POST IS INVISIBLE
  /// FROM IN HERE, AND THAT IS WHY THIS EXISTS. `_ConsentPrompt._answer`
  /// (app.dart) does not await `recordAnalyticsConsent`, and
  /// `applyConsentDecision` (state/analytics_providers.dart) treats the consent
  /// transport as best-effort by contract — both correct for the user, whose
  /// choice must not look rejected because the network is down. The consequence
  /// is that the tap above proves a DECISION WAS TAKEN and proves nothing about
  /// the record reaching the server: a `POST /v1/consent` that 404s, 429s or
  /// never leaves the browser produces the identical green prompt-closes-and-
  /// the-run-continues. `tooling/e2e/verify_consent.mjs` re-reads platform_db
  /// after the drive, and `anon_id` is the ONLY key it can find the row by —
  /// `consent_artifacts` deliberately carries no user id.
  ///
  /// POLLED, BECAUSE THE WRITE RACES THE TAP. `installIdProvider` mints the id
  /// and persists it inside that same un-awaited chain, so it is normally on
  /// disk within a frame or two — and "normally" is not a schedule.
  ///
  /// `SharedPreferences.getInstance()` returns the SAME cached singleton the app
  /// is writing through, so this reads the app's store rather than a second copy
  /// of it that could never see the write.
  Future<String> exportConsentAnonId(
    WidgetTester tester, {
    Duration timeout = const Duration(seconds: 10),
  }) async {
    final PrefsKeyValueStore store = await PrefsKeyValueStore.create();
    String? id;
    final int startedIn = testEpoch;
    final DateTime end = DateTime.now().add(timeout);
    while (DateTime.now().isBefore(end)) {
      id = await store.read(kInstallIdKey);
      if (id != null && id.isNotEmpty) break;
      await guardedPump(tester, startedIn, const Duration(milliseconds: 200));
    }
    expect(
      id != null && id.isNotEmpty,
      isTrue,
      reason:
          'The consent prompt was answered but no install id was persisted under '
          '"$kInstallIdKey" within ${timeout.inSeconds}s. That id is the anon_id '
          'every consent artifact and every analytics event is keyed by, so '
          'without it the server-side half of this leg has nothing to look the '
          'row up by — and an install that re-mints its id on every launch is a '
          'defect in its own right (the analytics cohort and the feature-flag '
          'bucket stop joining). On screen: ${onScreen(tester)}',
    );

    // 🔴 MERGED INTO reportData, NEVER ASSIGNED OVER IT. `binding.takeScreenshot`
    // accumulates into this same map (integration_test.dart: `reportData
    // ??= {}` then `reportData['screenshots'] ??= []`), and `shot('00-consent')`
    // has already run — so `reportData = {…}` would throw the screenshot list
    // away on its way past.
    binding.reportData ??= <String, dynamic>{};
    binding.reportData!['consent_anon_id'] = id;

    // ⚠️ THIS LINE GOES TO THE BROWSER CONSOLE, NOT TO THE CI LOG, AND IT IS
    // KEPT ANYWAY. Measured against Flutter 3.44 on 2026-08-09: flutter_tools
    // does ask chromedriver for browser logs
    // (`goog:loggingPrefs` in drive/web_driver_service.dart), but nothing ever
    // reads them — flutter_driver consumes only the PERFORMANCE log, and only
    // for tracing — so this token cannot reach the tee'd drive log from inside
    // the app. It is here for a headed local run with devtools open. The
    // CI-visible copy of the same token is printed HOST-SIDE by
    // test_driver/integration_test.dart, out of the reportData set above.
    debugPrint('E2E_CONSENT_ANON_ID=$id');
    return id!;
  }

  /// Boots the real app, and hands back the one global it mutates.
  ///
  /// 🔴 `app.main()` CALLS `AppErrorScreen.install()` (`main.dart:65`), WHICH
  /// SETS `ErrorWidget.builder` — AND flutter_test FAILS ANY TEST THAT LEAVES IT
  /// SET. Measured in `flutter_test/src/binding.dart:_runTestBody`: the builder
  /// is snapshotted before the body, and `_verifyErrorWidgetBuilderUnset` is
  /// called immediately after it — BEFORE any `tearDown`, so `addTearDown` is
  /// too late to repair it. On 2026-08-08 this failed the first test with
  /// `The value of ErrorWidget.builder was changed by the test.` AFTER its body
  /// had passed and all four of its screenshots had been taken.
  ///
  /// 🔑 THE SAME SOURCE LINE EXPLAINS WHY THE OTHER TWO TESTS DID NOT REPORT IT:
  /// that whole verification block sits under `if (_pendingExceptionDetails ==
  /// null)`, so a test that has already failed is never checked. Restoring on
  /// the LAST line of a body is therefore exactly right — an early failure skips
  /// the restore and skips the check with it, and the real failure is what gets
  /// reported.
  ///
  /// The snapshot is taken per test rather than once for the suite: if one body
  /// fails before restoring, a suite-wide "pristine" value would no longer match
  /// the NEXT test's snapshot, and that test would fail this check on someone
  /// else's bug.
  Future<VoidCallback> launchApp(WidgetTester tester) async {
    final ErrorWidgetBuilder builderBeforeTest = ErrorWidget.builder;
    await app.main();
    await pumpFor(tester, const Duration(seconds: 3));
    return () => ErrorWidget.builder = builderBeforeTest;
  }

  /// Moves past first-run onboarding IF it is showing, and says whether it was.
  ///
  /// 🔴 CONDITIONAL SINCE 2026-08-08, AND THE THING THAT CHANGED IS THE APP, NOT
  /// THIS SUITE'S TASTE. Three tests each call `app.main()` and every one of
  /// them used to land on the carousel, so all three tapped Skip unconditionally
  /// and `router/router_provider.dart:26` still records that assumption in a
  /// comment. That worked for one reason only: **onboarding-seen was not
  /// persisted anywhere.**
  /// Measured against the last green nightly (`efabfb54`, 2026-08-08 04:30 UTC):
  /// `providers.dart` contained no `nikatru.onboarding_seen` key and no
  /// `OnboardingSeenController` at all, so a second `app.main()` in the same
  /// browser could not remember the first one.
  ///
  /// The P2.6 chassis merge added that controller — correctly, with a comment
  /// explaining that never showing onboarding is worse than showing it twice —
  /// and it writes to the browser's key-value store, which survives every
  /// relaunch inside ONE `flutter drive` session. So the moment the consent fix
  /// let the first test actually complete its walk, the flag was written, and
  /// tests two and three relaunched straight past the carousel into
  /// `Found 0 widgets with text "Skip"`. The suite had been depending on a bug.
  ///
  /// ⚠️ THIS WEAKENS NOTHING ABOUT WHERE THE APP LANDS. The router sends an
  /// already-onboarded signed-out user `/onboarding → /home → /sign-in`, so every
  /// caller still asserts the SAME destination afterwards; only the question
  /// "was the carousel in the way" became conditional. The unconditional
  /// first-run proof lives in the first test, which is the one launch that is
  /// genuinely a first run — and it is now an explicit `isTrue`, where before it
  /// was an incidental tap that happened not to throw.
  /// The scroll view that belongs to [screen], rather than whichever one the
  /// tree happens to list first.
  ///
  /// 🔴 `find.byType(Scrollable).first` IS A GUESS, AND ON 2026-08-08 IT COST A
  /// RUN. The app shell is a `StatefulShellRoute` and the settings body is a
  /// LAZY `ListView` inside a `ContentPane`, so "the first Scrollable" is
  /// whatever the element tree yields first — not necessarily the list holding
  /// the control being hunted. Scoping the search to the screen's own subtree
  /// removes the guess entirely.
  Finder scrollableWithin(Finder screen) =>
      find.descendant(of: screen, matching: find.byType(Scrollable));

  /// Scroll until [target] exists — and if it never does, SAY WHY.
  ///
  /// 🔬 WHAT THIS REPLACES, AND WHY A WRAPPER EARNS ITS KEEP. `tester
  /// .scrollUntilVisible` ends in `Scrollable.ensureVisible(finder.evaluate()
  /// .single)` (`flutter_test/src/controller.dart:2482`). When the target never
  /// appears, `.single` throws `Bad state: No element` — a message that names
  /// neither the widget, nor the screen, nor how far it scrolled. That is
  /// exactly what the 2026-08-08 run reported for `find.text('Log out')`, and it
  /// took the screenshot list (which stopped at `16-home-currency`) to work out
  /// which of the suite's five scroll sites had failed.
  ///
  /// This reports the target, the distance travelled, how many scroll views were
  /// in scope, and what text is actually on screen — the difference between "the
  /// control moved" and "we were dragging the wrong list".
  Future<void> scrollUntilFound(
    WidgetTester tester, {
    required Finder target,
    required Finder scrollable,
    required String what,
    int maxScrolls = 40,
    double delta = 160,
  }) async {
    final int views = scrollable.evaluate().length;
    expect(
      views,
      greaterThan(0),
      reason:
          'Nothing to scroll while looking for "$what": the scroll view it '
          'lives in is not in the tree. On screen: ${onScreen(tester)}',
    );
    for (int i = 0; i < maxScrolls && target.evaluate().isEmpty; i++) {
      await tester.drag(scrollable.first, Offset(0, -delta));
      await pumpFor(tester, const Duration(milliseconds: 120));
    }
    expect(
      target,
      findsWidgets,
      reason:
          '"$what" never appeared after scrolling ${maxScrolls * delta}px '
          'through ${views == 1 ? 'its scroll view' : '$views scroll views in '
                    'scope (dragging the first)'}. Either the control was removed or '
          'renamed, or the list being dragged is not the one it lives in. '
          'On screen: ${onScreen(tester)}',
    );
    // NOT pumpAndSettle: this app animates forever in places (the scan progress
    // ring, loaders), so settling never returns — the reason `pumpFor` exists at
    // the top of this file.
    await pumpFor(tester, const Duration(milliseconds: 200));
  }

  Future<bool> skipOnboardingIfShown(WidgetTester tester) async {
    if (find.text('Skip').evaluate().isEmpty) return false;
    expectNothingCoveringTheApp('the onboarding screen');
    await shot('01-onboarding');
    await tester.tap(find.text('Skip'));
    await pumpFor(tester, const Duration(seconds: 2));
    return true;
  }

  /// Signs out IF a session survived from an earlier test, and says whether one
  /// did.
  ///
  /// 🔴 THE THIRD PIECE OF INHERITED STATE, AND THE ONE THAT PROVED THE PATTERN
  /// IS STRUCTURAL. On 2026-08-08 the second test died at its `Log out` step, so
  /// it never signed out — and the third test then booted straight into
  /// `/home` as the SECOND test's user, with that user's subscription on screen,
  /// and reported "the app did not reach the login screen". One real defect,
  /// two red tests, and the second message pointed at the wrong test entirely.
  ///
  /// Three tests share ONE browser profile, so everything the app persists is
  /// the next test's precondition: the consent decision, the onboarding-seen
  /// flag, and the Supabase session. The first two were made conditional when
  /// they bit; this is the third, and it is handled the same way rather than by
  /// assuming the previous test succeeded. A test that depends on ANOTHER test's
  /// happy path cannot report its own result honestly.
  Future<bool> signOutIfSignedIn(WidgetTester tester) async {
    final Finder shell = find.byType(AppShell);
    if (shell.evaluate().isEmpty) return false;
    // …and CONFIRM it, because a redirect in flight can paint the shell for a
    // frame or two on the way to /sign-in. Acting on that frame would drive
    // Settings on a screen that is being torn down, and this helper would
    // manufacture the very failure it exists to prevent.
    await pumpFor(tester, const Duration(seconds: 2));
    if (shell.evaluate().isEmpty) return false;
    await tester.tap(find.text('More'));
    await pumpFor(tester, const Duration(seconds: 2));
    final Finder settings = find.byType(SettingsScreen);
    expect(
      settings,
      findsWidgets,
      reason:
          'A session survived into this test and the settings tab did not open, '
          'so it cannot be signed out. On screen: ${onScreen(tester)}',
    );
    await scrollUntilFound(
      tester,
      target: find.text('Log out'),
      scrollable: scrollableWithin(settings),
      what: 'Log out (clearing a session inherited from an earlier test)',
      maxScrolls: 30,
      delta: 200,
    );
    await tapWhenHittable(
      tester,
      find.text('Log out'),
      'Log out',
      scrollable: scrollableWithin(settings).first,
    );
    expect(
      await waitFor(tester, find.text('Welcome back')),
      isTrue,
      reason:
          'Signing out an inherited session did not return to the login '
          'screen. On screen: ${onScreen(tester)}',
    );
    return true;
  }

  /// Ticks and accepts the re-acceptance interstitial IF the router put us on
  /// it, and says whether it did.
  ///
  /// 🔴 EVERY SIGN-IN IN THIS SUITE NOW LANDS HERE FIRST, and leaving it out
  /// would have broken the nightly and the store-capture lane on the same day
  /// the legal gate shipped. The users this suite signs in as are minted through
  /// the SUPABASE ADMIN API (`tooling/e2e/provision_user.mjs`), so they have
  /// never seen a clickwrap and hold no acceptance record — which makes the
  /// interstitial not an edge case here but the guaranteed next screen after
  /// every successful sign-in.
  ///
  /// ⚠️ CONDITIONAL, LIKE ITS THREE SIBLINGS ABOVE, AND FOR THE SAME REASON.
  /// Three tests share one browser profile, so the acceptance the FIRST test
  /// records is still on disk for the second: asserting the screen is present
  /// would fail on every run after the first. `skipOnboardingIfShown`,
  /// `signOutIfSignedIn` and the consent decision are all handled this way, and
  /// this is the fourth piece of inherited state, not a special case.
  ///
  /// The gate itself is asserted where it can be asserted honestly — in
  /// `test/legal_gates_test.dart` and the `legal-reacceptance-gated` chassis
  /// property, both of which control the store. This helper's job is to get a
  /// live walk past a screen a real user also has to get past.
  /// Signs in WITHOUT the login form, by spending the single-use magic-link token
  /// the harness minted, and returns whether it did.
  ///
  /// 🔴 WHY THE FORM STOPS WORKING, MEASURED. Box A enforces Cloudflare Turnstile,
  /// and `token?grant_type=password` is one of the six gated routes — so the
  /// moment `SUPABASE_URL` moves there, typing credentials is refused with
  /// `captcha_failed` BEFORE the password is checked. A headless driver cannot
  /// solve a Turnstile challenge; that is the entire point of one.
  ///
  /// `/verify` is NOT gated (auth-cutover.md §4.7) and this is the path an emailed
  /// link takes, so the browser still genuinely authenticates and still receives a
  /// real session — it just does not type. Verified against Box A 2026-09-04:
  /// HTTP 200, correct user, refresh token present, and a REPLAY returns 403.
  ///
  /// ⚠️ SINGLE USE. One call per provisioned user; each leg signs in once.
  /// ⚠️ It goes through `Supabase.instance.client`, the same client the app holds,
  /// so `onAuthStateChange` fires and the router reacts exactly as it would after
  /// a form login. Nothing here reaches into app state directly.
  /// ⚠️ WHAT THIS GIVES UP: the login FORM is no longer exercised on this path.
  /// The keystrokes are still covered by the empty-field and wrong-password legs
  /// above; what is not covered post-cutover is a SUCCESSFUL form submit, which no
  /// headless driver can do against a live captcha.
  ///
  /// 🔴 AND IT NAVIGATES TO `/scan` ITSELF — THE NAVIGATION IS PART OF SIGNING IN
  /// ON THIS PATH, NOT SOMETHING THE CALLER REMEMBERS TO ADD. `/scan` has exactly
  /// one entry point in the app: `LoginScreen._submit`'s `context.go('/scan')`.
  /// Every other occurrence in the tree is a comment ABOUT it. So a sign-in that
  /// skips the form skips the navigation too, and the caller lands on the home
  /// shell instead.
  ///
  /// ⚠️ WHY IT LIVES HERE RATHER THAN AT THE CALL SITE, AND THE COST OF LEARNING
  /// THAT THE OTHER WAY. It was written at the call site first, in the full-walk
  /// test only. The full walk went green — 17 screenshots, /scan reached — and
  /// run 33844142953 still failed, because the DELETE-ACCOUNT test signs in the
  /// same way with its own token and never got the two lines. Its screen text was
  /// `Home | Calendar | Insights | Budget | More | Good morning` — the home shell,
  /// exactly the symptom the full walk had just stopped showing. Two call sites,
  /// one of them patched, and the diff looked complete. A helper that leaves out
  /// the step its own doc comment says is mandatory is a trap for the next caller
  /// as well as this one.
  ///
  /// ⚠️ A `Scaffold` IS THE CONTEXT, NOT `AppShell`. By this point the router has
  /// already put an authenticated user with no clickwrap record on the
  /// `/reaccept-terms` interstitial, where no `AppShell` exists.
  ///
  /// 🔴 BEFORE THE CLICKWRAP, NOT AFTER — the gate does not BLOCK the destination,
  /// it BANKS it. `_gateWithNext` stores `/scan` as `?next=` and the gate's exit
  /// hands it back via `_nextOr(state, '/home')`. Navigate after the interstitial
  /// is cleared and there is no gate left to bank anything, which is what run
  /// 33843443550 measured. Pinned locally, on the real router, by
  /// `test/scan_survives_the_gate_test.dart` — both halves: that asking for
  /// `/scan` while the gate is CLOSED banks `?next=%2Fscan`, and that clearing it
  /// the way a user clears it lands on `/scan`.
  Future<bool> signInWithMagicToken(
    WidgetTester tester,
    String tokenHash,
  ) async {
    if (tokenHash.isEmpty) return false;
    await sb.Supabase.instance.client.auth.verifyOTP(
      type: sb.OtpType.magiclink,
      tokenHash: tokenHash,
    );
    // The same settle the form path takes: GoTrue round trip + route change.
    await pumpFor(tester, const Duration(seconds: 10));
    // Stand in for `LoginScreen._submit`'s `context.go('/scan')`. See above.
    GoRouter.of(tester.firstElement(find.byType(Scaffold))).go('/scan');
    await pumpFor(tester, const Duration(seconds: 2));
    return true;
  }

  Future<bool> acceptTermsIfShown(WidgetTester tester) async {
    final Finder accept = find.byKey(ReacceptTermsScreen.acceptButton);
    if (accept.evaluate().isEmpty) return false;
    expectNothingCoveringTheApp('the re-acceptance interstitial');
    await shot('02b-reaccept-terms');
    await tester.tap(find.byKey(LegalConsentFields.termsCheckbox));
    await pumpFor(tester, const Duration(milliseconds: 300));
    expect(
      tester.widget<FilledButton>(accept).onPressed,
      isNotNull,
      reason:
          'the tick did not enable the accept button, so the clickwrap cannot '
          'be completed and nothing past this screen is reachable. On screen: '
          '${onScreen(tester)}',
    );
    await tester.tap(accept);
    // The acceptance is written and POSTed, then the router's gate re-runs and
    // replaces this page. Generous, because that round trip is a real network
    // call against the live Worker.
    //
    // 🔴 12s, NOT 6s, AND THE GATE'S `?next=` FIX IS WHY. This window now has
    // to cover TWO things where it used to cover one: the acceptance round
    // trip AND the screen the gate hands back. The user no longer lands on
    // /home but on the destination they were actually going to, and for the
    // sign-in leg that is /scan — whose progress timer needs 6 × 560ms =
    // 3.36s to reach `_done` and render 'Go to dashboard' (scan_screen.dart
    // `_stepCount = 5`). At 6s the assertion below rested on the live Worker
    // answering inside 2.64s, which is a coin toss wearing a test's clothes.
    await pumpFor(tester, const Duration(seconds: 12));
    expect(
      find.byKey(ReacceptTermsScreen.acceptButton),
      findsNothing,
      reason:
          'accepting did not move the user off the interstitial — the gate is '
          'a dead end rather than a door. On screen: ${onScreen(tester)}',
    );
    return true;
  }

  /// The login screen, waited for rather than assumed — then asserted.
  ///
  /// Polls first because the route change is asynchronous and this is reached
  /// from two different starting points now (straight off the carousel, or off
  /// the router's `/onboarding → /home → /sign-in` bounce for a returning user),
  /// then makes the SAME hard assertion as before. Strictly stronger than the
  /// fixed pump it replaces: nothing is accepted that was not accepted before.
  Future<void> expectLandedOnLogin(WidgetTester tester, String after) async {
    expect(
      await waitFor(tester, find.text('Welcome back')),
      isTrue,
      reason:
          'The app did not reach the login screen after $after. On screen: '
          '${onScreen(tester)}',
    );
    expect(find.text('Welcome back'), findsOneWidget);
  }

  testWidgets('login rejects empty + invalid credentials with clear messages', (
    WidgetTester tester,
  ) async {
    final VoidCallback restoreGlobals = await launchApp(tester);

    // First launch of the run: the consent gate MUST ask. If this ever goes
    // false the DPDP prompt has stopped appearing and the analytics rail is
    // silently fail-closed again — the defect the consent gate was built to fix,
    // and one that no other test in the tree can see (see assert-seams-wired.mjs).
    expect(
      await answerConsentIfPrompted(tester),
      isTrue,
      reason:
          'The analytics-consent prompt never appeared on a fresh live launch. '
          '`AnalyticsGate` in app.dart is the on-switch for the whole analytics '
          'rail; without the prompt the recorder stays fail-closed and discards '
          'every event, and nothing else in the suite would notice.',
    );

    // …and hand the harness the id that decision was recorded under. This is the
    // only launch of the run that answers the prompt, so it is the only launch
    // that uploads an artifact — the other two find the decision already on disk
    // and never call the route at all.
    await exportConsentAnonId(tester);

    // THE ONE LAUNCH THAT IS GENUINELY A FIRST RUN, so this is the one place
    // the carousel is REQUIRED rather than tolerated. If it is ever absent here,
    // a stranger is being dropped into the app with no introduction — leg 1 of
    // the golden path — and that must fail loudly rather than be skipped past.
    expect(
      await skipOnboardingIfShown(tester),
      isTrue,
      reason:
          'The FIRST launch of the run did not land on first-run onboarding. '
          'Either the router no longer starts at /onboarding, or the '
          'onboarding-seen flag survived from a previous run in the browser '
          'store. On screen: ${onScreen(tester)}',
    );
    await expectLandedOnLogin(tester, 'Skip on the first run');

    // Fields must start EMPTY — no demo credentials shipped to users.
    expect(find.text('alex@example.com'), findsNothing);
    await shot('00a-login-empty');

    // Empty submit → inline validation, no network round-trip.
    await tester.tap(find.byKey(E2EKeys.loginSubmit));
    expect(
      await waitFor(tester, find.textContaining('Enter your email')),
      isTrue,
      reason: 'empty-field validation message did not appear',
    );
    await shot('00b-empty-validation');

    // Wrong credentials → friendly message, stays on the login screen.
    final int ts = DateTime.now().millisecondsSinceEpoch;
    await tester.enterText(
      find.byKey(E2EKeys.loginEmail),
      'nobody-$ts@nikatru.com',
    );
    await tester.enterText(
      find.byKey(E2EKeys.loginPassword),
      'wrong-password-123',
    );
    await pumpFor(tester, const Duration(milliseconds: 300));
    await tester.tap(find.byKey(E2EKeys.loginSubmit));
    expect(
      await waitFor(tester, find.textContaining('Incorrect email or password')),
      isTrue,
      reason: 'friendly invalid-credentials message did not appear',
    );
    expect(find.text('Welcome back'), findsOneWidget);
    await shot('00c-invalid-credentials');
    restoreGlobals();
  });

  testWidgets('visits every page, creates a subscription, reads it back', (
    WidgetTester tester,
  ) async {
    expect(
      email,
      isNotEmpty,
      reason: 'E2E_EMAIL dart-define missing — CI must provision a user',
    );
    expect(password, isNotEmpty, reason: 'E2E_PASSWORD dart-define missing');

    int shellIndex() => tester
        .widget<AppShell>(find.byType(AppShell))
        .navigationShell
        .currentIndex;

    // ── Boot ───────────────────────────────────────────────────────────────
    final VoidCallback restoreGlobals = await launchApp(tester);

    // The first test already answered consent and the decision is persisted, so
    // this normally finds nothing. Called anyway so that reordering the tests,
    // or a store that failed to write, cannot wedge the run behind a modal
    // barrier; the assertion that the gate still ASKS lives in the first test,
    // which is the only one that launches with an undecided store.
    await answerConsentIfPrompted(tester, timeout: const Duration(seconds: 4));

    // ── 01 Onboarding, IF this launch still gets it ──────────────────────────
    // Not asserted here, and not because the carousel stopped mattering: the
    // first test already answered it, and answering it PERSISTS. The proof that
    // a stranger meets onboarding is unconditional in that test, where the
    // launch really is a first run. Asserting it again here would only assert
    // that the flag failed to save.
    await skipOnboardingIfShown(tester);
    // …and clear any session the previous test left behind, for the same reason.
    await signOutIfSignedIn(tester);

    // ── 02 Login ─────────────────────────────────────────────────────────────
    // Reached either straight off the carousel or, for a returning user, via the
    // router's `/onboarding → /home → /sign-in` bounce. Same destination, same
    // assertion, both ways.
    await expectLandedOnLogin(tester, 'the boot for the full-walk test');
    await shot('02-login');
    // Token first; the form is the fallback for a run with no token supplied
    // (a hosted target, or a hand-run drive).
    //
    // 🔴 NO `/scan` NAVIGATION HERE ANY MORE, AND ITS ABSENCE IS THE FIX. It
    // stood in this block until 2026-09-04, which made the walk green and left
    // the delete-account test — the only other caller — on the home shell. The
    // navigation is now inside `signInWithMagicToken`, where no caller can be
    // written without it. The form branch below needs none: `_submit` navigates.
    if (!await signInWithMagicToken(tester, tokenHash)) {
      await tester.enterText(find.byKey(E2EKeys.loginEmail), email);
      await tester.enterText(find.byKey(E2EKeys.loginPassword), password);
      await pumpFor(tester, const Duration(milliseconds: 500));
      await tester.tap(find.byKey(E2EKeys.loginSubmit));
      // GoTrue sign-in + navigation to /scan.
      await pumpFor(tester, const Duration(seconds: 10));
    }

    // ── 02b Re-acceptance ────────────────────────────────────────────────────
    // The admin-API user this suite signs in as holds no clickwrap record, so
    // the router's gate puts them here before anything else. See the helper.
    //
    // The result is CAPTURED rather than discarded, because it is the single
    // most load-bearing observation the scan assertion below can make: the
    // router serves this interstitial to an AUTHENTICATED user only, so `true`
    // here is the suite's own proof that sign-in succeeded.
    final bool sawReacceptance = await acceptTermsIfShown(tester);

    // ── 03 Scan ──────────────────────────────────────────────────────────────
    await shot('03-scan');
    // 🔴 THIS REASON REPORTS WHAT WAS OBSERVED AND DIAGNOSES NOTHING — AND
    // THAT IS THE WHOLE POINT OF IT. Until 2026-09-02 it read "sign-in likely
    // failed (bad/unconfirmed credentials or backend down)". That was a guess,
    // it was wrong, and it sent three separate investigations at Supabase
    // auth. Root-caused that day from three independent sources (the CI logs,
    // GlitchTip issues 24 and 25 tagged `service=subly-api`, and Supabase
    // `edge_logs`): the cause was a transient Cloudflare D1 fault —
    // `D1_ERROR: D1 DB storage operation exceeded timeout which caused
    // object to be reset` — which `services/subly-api/src/index.ts` maps to
    // `internal_error`/500, and nothing retried it. `POST /auth/v1/token`
    // returned 200 for this user ~25s earlier on EVERY red night. Sign-in
    // never failed. The retry now lives in `services/*/src/lib/d1.ts`.
    // Do not put a cause back into this string: the cause is already ON THE
    // SCREEN, and `onScreen` prints it.
    expect(
      find.text('Go to dashboard'),
      findsOneWidget,
      reason:
          'Timed out waiting for the scan screen to render "Go to dashboard": '
          '10s pumped after the login-submit tap, plus the 12s window inside '
          'acceptTermsIfShown. Post-sign-in clickwrap interstitial seen this '
          'run: $sawReacceptance — true means the session was already valid, '
          'because the router serves that screen to authenticated users only. '
          'Read the cause off the screen text below, do not infer it: '
          '"Could not load: ApiException(5xx)" is a backend failure (the '
          'Worker answered 5xx; look for `service=subly-api` in GlitchTip), '
          '"Could not load" with any other error is a client-side throw that '
          'may mean NO REQUEST WAS EVER SENT, and "Setting up your board" on '
          'its own means the scan was still running when the window expired. '
          'On screen: ${onScreen(tester)}',
    );
    await tester.tap(find.text('Go to dashboard'));
    await pumpFor(tester, const Duration(seconds: 4));

    // ── 04 Home ──────────────────────────────────────────────────────────────
    expect(find.byType(AppShell), findsOneWidget);
    expect(find.byType(HomeScreen), findsWidgets);
    expect(shellIndex(), 0);
    await shot('04-home');

    // ── 05 Calendar ──────────────────────────────────────────────────────────
    // 🔴 TAPPED BY ICON, NOT BY LABEL, AND ONLY THIS ONE OF THE FIVE.
    // P4·L3 gave home's "Upcoming renewals" section a `calendarLink` whose value
    // is the bare word "Calendar" — the old literal was 'Calendar →' and the arb
    // key drops the baked arrow, because a left-to-right glyph inside copy is
    // wrong in every RTL locale (it is an `Icons.arrow_forward` now, which
    // mirrors itself). The nav pill's second tab is `navCalendar`, also
    // "Calendar". Both render on /home, so `find.text('Calendar')` matches TWO
    // widgets here and `tester.tap` throws on an ambiguous finder.
    //
    // `Icons.calendar_month_rounded` is used in exactly one place in the app
    // (`app_shell.dart`'s tab spec), so it is the unambiguous handle. The other
    // four labels are untouched: no screen renders "Home", "Insights", "Budget"
    // or "More" alongside its tab. Pinned by
    // `test/l10n_group_home_test.dart` → '"Calendar" is now ambiguous on /home'.
    await tester.tap(find.byIcon(Icons.calendar_month_rounded));
    await pumpFor(tester, const Duration(seconds: 2));
    expect(shellIndex(), 1);
    expect(find.byType(CalendarScreen), findsWidgets);
    await shot('05-calendar');

    // ── 06 Insights ──────────────────────────────────────────────────────────
    await tester.tap(find.text('Insights'));
    await pumpFor(tester, const Duration(seconds: 2));
    expect(shellIndex(), 2);
    expect(find.byType(InsightsScreen), findsWidgets);
    await shot('06-insights');

    // ── 07 Budget (loads over the network first) ─────────────────────────────
    await tester.tap(find.text('Budget'));
    await pumpFor(tester, const Duration(seconds: 4));
    expect(shellIndex(), 3);
    expect(find.byType(BudgetScreen), findsWidgets);
    await shot('07-budget');

    // ── 08 Settings (the 5th tab is labelled "More") ─────────────────────────
    await tester.tap(find.text('More'));
    await pumpFor(tester, const Duration(seconds: 2));
    expect(shellIndex(), 4);
    expect(find.byType(SettingsScreen), findsWidgets);
    expect(find.text('CURRENCY'), findsWidgets);
    await shot('08-settings');

    // Back to Home for notifications + create.
    await tester.tap(find.text('Home'));
    await pumpFor(tester, const Duration(seconds: 2));
    expect(shellIndex(), 0);

    // ── 09 Notifications (bell on Home) ──────────────────────────────────────
    expect(
      await waitFor(tester, find.byIcon(Icons.notifications_none_rounded)),
      isTrue,
      reason: 'notifications bell did not render on Home',
    );
    await tester.tap(find.byIcon(Icons.notifications_none_rounded));
    await pumpFor(tester, const Duration(seconds: 2));
    expect(find.text('Notifications'), findsWidgets);
    await shot('09-notifications');
    expect(await waitFor(tester, find.byIcon(Icons.close)), isTrue);
    await tester.tap(find.byIcon(Icons.close));
    await pumpFor(tester, const Duration(seconds: 2));
    expect(shellIndex(), 0);

    // ── 10 Add-subscription sheet ────────────────────────────────────────────
    final String subName = 'E2E Probe ${DateTime.now().millisecondsSinceEpoch}';
    await tester.tap(find.byKey(E2EKeys.fabAdd));
    await pumpFor(tester, const Duration(seconds: 2));
    expect(find.text('Add subscription'), findsWidgets);
    await tester.enterText(find.byKey(E2EKeys.addName), subName);
    await tester.enterText(find.byKey(E2EKeys.addPrice), '12.34');
    await pumpFor(tester, const Duration(milliseconds: 500));
    await shot('10-add-sheet');
    await tester.tap(find.byKey(E2EKeys.addSubmit));
    // POST /v1/subscriptions → Worker → D1, then the sheet closes.
    await pumpFor(tester, const Duration(seconds: 8));

    // ── 11 Read-back on Home (proves the row round-tripped through D1) ────────
    // Home is a lazy ListView — scroll the new row into view before asserting.
    final Finder subFinder = find.text(subName);
    await scrollUntilFound(
      tester,
      target: subFinder.first,
      scrollable: find.byType(Scrollable),
      what: 'the subscription just created, on Home',
      maxScrolls: 40,
    );
    expect(
      subFinder,
      findsWidgets,
      reason:
          'The created subscription did not appear on Home — the POST or '
          'read-back failed',
    );
    await shot('11-home-after-create');

    // ── 12 Detail (subscription A) ───────────────────────────────────────────
    await tester.tap(subFinder.first);
    await pumpFor(tester, const Duration(seconds: 3));
    expect(
      find.text(subName),
      findsWidgets,
    ); // sub name shown in the detail header
    await shot('12-detail');

    // ── 13 Cancel/delete A (exercises DELETE /v1/subscriptions/:id) ───────────
    await scrollUntilFound(
      tester,
      target: find.text('Cancel plan'),
      scrollable: find.byType(Scrollable),
      what: 'the "Cancel plan" button on the subscription detail sheet',
      maxScrolls: 20,
      delta: 200,
    );
    await tester.tap(find.text('Cancel plan'));
    await pumpFor(tester, const Duration(seconds: 2));
    expect(find.text('Confirm cancel'), findsOneWidget);
    await tester.tap(find.text('Confirm cancel'));
    await pumpFor(tester, const Duration(seconds: 8)); // DELETE round-trip
    expect(
      find.text('Cancelled'),
      findsWidgets,
      reason: 'Cancel confirmation never appeared — DELETE likely failed',
    );
    await tester.tap(find.text('Done'));
    await pumpFor(
      tester,
      const Duration(seconds: 4),
    ); // sheet + detail pop → home
    expect(shellIndex(), 0);
    expect(
      find.text(subName),
      findsNothing,
      reason: 'Cancelled subscription still shows on Home — delete failed',
    );
    await shot('13-after-cancel');

    // ── 14 Create a SECOND subscription (left in D1 for the CI verify+purge) ──
    final String subNameB =
        'E2E Probe B ${DateTime.now().millisecondsSinceEpoch}';
    await tester.tap(find.byKey(E2EKeys.fabAdd));
    await pumpFor(tester, const Duration(seconds: 2));
    await tester.enterText(find.byKey(E2EKeys.addName), subNameB);
    await tester.enterText(find.byKey(E2EKeys.addPrice), '7.77');
    await pumpFor(tester, const Duration(milliseconds: 500));
    await tester.tap(find.byKey(E2EKeys.addSubmit));
    await pumpFor(tester, const Duration(seconds: 8));
    final Finder subFinderB = find.text(subNameB);
    await scrollUntilFound(
      tester,
      target: subFinderB.first,
      scrollable: find.byType(Scrollable),
      what: 'the SECOND subscription, on Home',
      maxScrolls: 40,
    );
    expect(
      subFinderB,
      findsWidgets,
      reason: 'Second subscription did not round-trip to Home',
    );
    await shot('14-second-sub');

    // ── 15 Settings: switch currency (client-state propagation) ──────────────
    await tester.tap(find.text('More'));
    await pumpFor(tester, const Duration(seconds: 2));
    expect(shellIndex(), 4);
    await tester.tap(find.text('€'));
    await pumpFor(tester, const Duration(seconds: 1));
    await shot('15-settings-currency');

    // ── 16 Home reflects the new currency ────────────────────────────────────
    await tester.tap(find.text('Home'));
    await pumpFor(tester, const Duration(seconds: 2));
    expect(shellIndex(), 0);
    expect(
      find.textContaining('€'),
      findsWidgets,
      reason: 'Currency change did not propagate to Home',
    );
    await shot('16-home-currency');

    // ── 17 Sign out → back to the login screen ───────────────────────────────
    await tester.tap(find.text('More'));
    await pumpFor(tester, const Duration(seconds: 2));
    // 🔬 THIS IS THE LINE THAT FAILED ON 2026-08-08, and it failed as
    // `Bad state: No element` — flutter_test's `scrollUntilVisible` ending in
    // `.single` on a finder that never matched. It named nothing: not the
    // control, not the screen, not the distance. Two things are different now:
    // the scroll view is the SETTINGS one by construction rather than "the first
    // Scrollable in the tree" (this screen is a lazy ListView inside a
    // StatefulShellRoute, so first-in-tree was always a guess), and a miss now
    // prints what is on screen.
    await scrollUntilFound(
      tester,
      target: find.text('Log out'),
      scrollable: scrollableWithin(find.byType(SettingsScreen)),
      what: 'Log out',
      maxScrolls: 30,
      delta: 200,
    );
    // 🔴 THE ONE MOMENT THIS SUITE NEVER PHOTOGRAPHED. Every failure from
    // 2026-08-03 onward was "Sign-out did not return to the login screen", and
    // the artifact stopped at 16-home-currency — so there was no evidence of
    // where the Log out control actually WAS, or what the screen looked like
    // after it was tapped. Two shots either side of the tap cost one frame each
    // and turn "the assertion said false" into a picture of why.
    await shot('17a-before-logout');
    await tapWhenHittable(
      tester,
      find.text('Log out'),
      'Log out',
      scrollable: scrollableWithin(find.byType(SettingsScreen)).first,
    );
    await pumpFor(tester, const Duration(seconds: 3));
    await shot('17b-after-logout-tap');
    // signOut() is an async round-trip to Supabase; the router then refreshes
    // and redirects. A signed-out user on a non-auth route (/settings) lands on
    // /sign-in — NOT first-run onboarding — per the core/router.dart redirect (a
    // signed-out user is only left on /onboarding|/sign-in|/scan; /login is a
    // redirect onto /sign-in since 2026-08-10). Poll for it.
    expect(
      await waitFor(tester, find.text('Welcome back')),
      isTrue,
      reason:
          'Sign-out did not return to the login screen. On screen instead: '
          '${onScreen(tester)} — see 17a-before-logout (was the control where '
          'the tap went?) and 17b-after-logout-tap in the e2e-screenshots '
          'artifact.',
    );

    // 🔴 AND THEN SETTLE AND RE-ASSERT — this second check is the point.
    //
    // `waitFor` polls every 200ms and returns the instant the finder matches
    // ONCE, so it can be satisfied by a frame the app is merely passing
    // THROUGH. It was: the settings screen used to fire its own
    // `context.go('/onboarding')` after the router had already redirected to
    // the auth route, and `/onboarding` is inside the router's `authFlow` allowlist so
    // nothing corrected it. This assertion passed on the transit frame while the
    // user ended up in the first-run carousel — the `17-signed-out` screenshot
    // from a GREEN run shows the carousel animating in over the login screen.
    //
    // The app-side fix is in settings_screen.dart (sign out, navigate nowhere,
    // let the router decide) and is covered on every push by
    // test/sign_out_destination_test.dart. This keeps the live suite honest too.
    await pumpFor(tester, const Duration(seconds: 3));
    expect(
      find.text('Welcome back'),
      findsOneWidget,
      reason:
          'Sign-out reached the login screen but did not STAY there — something '
          'navigated away after the redirect',
    );
    expect(
      find.text('Skip'),
      findsNothing,
      reason:
          'Sign-out landed in the first-run onboarding carousel. /onboarding is '
          'inside the router authFlow, so the redirect will not rescue the user',
    );
    await shot('17-signed-out');
    restoreGlobals();
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // LEG 6 OF N-6's GOLDEN PATH — "account delete purges".
  //
  // 🔴 WHAT THIS PROVES THAT NOTHING ELSE DID. `test/delete_account_test.dart`
  // already drives this dialog on every push, and it proves the CLIENT half
  // against a fake repository: the button reauths, calls the seam, and shows the
  // outcome the seam returned. It cannot prove that the seam reaches anything —
  // the whole [ADR 027] defect was a call chain whose terminal branch was an
  // unconditional refusal, with every widget assertion green.
  //
  // This test is the other half, and it is the only place the two meet:
  //
  //   in-app tap  →  DELETE {platform}/v1/account  (service-role precondition,
  //                  platform_db swept, RELAY to subly-api's own
  //                  DELETE /v1/account, identity deleted LAST)
  //                                                          ↓
  //   the app is told "Account deleted"                      ↓
  //   tooling/e2e/verify_purged.mjs re-reads live D1 AND the GoTrue admin API
  //
  // The app's word for it is checked HERE; whether the word was true is checked
  // by the workflow step, because a client can only ever report what it was
  // told. "Deleted" from a server that deleted nothing is the one failure a user
  // can never detect for themselves — which is why the leg's proof is split
  // across the two and neither half is allowed to stand alone.
  //
  // ⚠️ THE ROW IS CREATED FIRST, DELIBERATELY. Erasing an account that owns no
  // rows is a purge that cannot fail: every count is already zero, and
  // verify_purged.mjs would report "nothing left" over a user who never had
  // anything. So this walk writes a subscription through the live Worker and
  // reads it back off Home BEFORE deleting — the same round-trip leg 2 uses —
  // so the "0 rows" the verifier finds afterwards is a state the run itself put
  // there and then removed.
  // ═══════════════════════════════════════════════════════════════════════════
  testWidgets('deletes the account from inside the app, and lands signed out', (
    WidgetTester tester,
  ) async {
    expect(
      deleteEmail,
      isNotEmpty,
      reason:
          'E2E_DELETE_EMAIL dart-define missing — e2e.yml must provision a '
          'SECOND throwaway user for the leg that destroys one',
    );
    expect(deletePassword, isNotEmpty, reason: 'E2E_DELETE_PASSWORD missing');

    /// The sentence the login screen's deletion notice is carrying, if any.
    /// `findsNothing` on the notice reads the same whether the deletion failed,
    /// the redirect never happened, or the app is still sitting on the dialog —
    /// three different fixes, so print what is actually there.
    String noticeText() {
      final Finder f = find.byKey(const Key('accountDeletionNoticeText'));
      if (f.evaluate().isEmpty) return '(no deletion notice on screen)';
      return tester.widget<Text>(f.first).data ?? '(notice with no text)';
    }

    /// 🔴 THE TECHNICAL CAUSE, WHICH THE SENTENCE ABOVE CANNOT CARRY. One
    /// outcome — `unknown` — is reached by a 404, a 500, an unmodelled status,
    /// and by any client-side throw that means NO REQUEST WAS EVER SENT, and all
    /// of them render the identical sentence. On 2026-08-09 this leg printed
    /// that sentence (E2E run 31295025009 among others): the cause was a Riverpod
    /// `CircularDependencyError` inside the erasure closure, and proving it took
    /// Cloudflare's zone analytics showing zero `/v1/account` requests, because
    /// nothing the suite could read said so. This key is rendered by
    /// `_AccountDeletionNotice` in DEBUG builds only, which is what `flutter
    /// drive` builds. [ADR 027]
    String noticeDetail() {
      final Finder f = find.byKey(E2EKeys.accountDeletionNoticeDetail);
      if (f.evaluate().isEmpty) {
        return '(no technical detail — the outcome came back clean, or this is '
            'not a debug build)';
      }
      return tester.widget<Text>(f.first).data ?? '(detail with no text)';
    }

    // ── Boot + sign in as the sacrificial user ───────────────────────────────
    final VoidCallback restoreGlobals = await launchApp(tester);
    // Consent was answered and persisted by the first test; called anyway so a
    // cleared store cannot wedge this run behind a modal barrier.
    await answerConsentIfPrompted(tester, timeout: const Duration(seconds: 4));

    // Third boot of the run, so the carousel is normally already behind us —
    // and it is tolerated either way. Same reasoning as the second test.
    await skipOnboardingIfShown(tester);

    // 🔴 AND THE SESSION. This is the line that makes leg 6 report its OWN
    // result: on 2026-08-08 the second test died before its sign-out, this walk
    // booted as that test's user with their subscription on screen, and leg 6
    // went red for a defect that was not in it. Signing out here is not defence
    // in depth — it is the difference between a leg that is proven and a leg
    // that merely rode on the previous test finishing.
    await signOutIfSignedIn(tester);

    // POLLED, not a fixed pump then a hard expect. This is the third full boot
    // of the run and the route change is asynchronous; a 2s window that happens
    // to be enough twice is not a proof that it is enough. `Found 0 widgets
    // with text Welcome back` reads identically whether a tap was swallowed
    // (see expectNothingCoveringTheApp) or the redirect is merely slow.
    await expectLandedOnLogin(tester, 'the boot for the delete-leg walk');
    // Its OWN token: the tokens are single use, so the two legs cannot share one.
    if (!await signInWithMagicToken(tester, deleteTokenHash)) {
      await tester.enterText(find.byKey(E2EKeys.loginEmail), deleteEmail);
      await tester.enterText(find.byKey(E2EKeys.loginPassword), deletePassword);
      await pumpFor(tester, const Duration(milliseconds: 500));
      await tester.tap(find.byKey(E2EKeys.loginSubmit));
      await pumpFor(tester, const Duration(seconds: 10));
    }

    // The delete-leg user is a SECOND admin-API user with its own empty
    // acceptance record, so it meets the interstitial independently of whatever
    // the full-walk user accepted earlier in the same browser profile.
    //
    // Captured for the same reason as in the full-walk test: reaching this
    // screen at all is proof of a valid session, and the assertion below is
    // the one that used to guess about exactly that.
    final bool sawReacceptance = await acceptTermsIfShown(tester);

    // 🔴 SAME CORRECTION AS THE FULL-WALK SCAN ASSERTION, 2026-09-02 — the
    // long version of the evidence is written out there. This string used to
    // end "— sign-in likely failed", and it is the one the red nights of
    // 2026-08-28, 08-29 and 09-01 actually printed, which is why the wrong
    // guess travelled so far. Measured cause: a transient Cloudflare D1 reset
    // inside subly-api, surfacing to the app as `ApiException(500):
    // internal_error`. Supabase answered this user's `POST /auth/v1/token`
    // with 200 roughly 25s before every one of those failures. Never re-add a
    // cause to this sentence — print the evidence and let the reader judge.
    expect(
      find.text('Go to dashboard'),
      findsOneWidget,
      reason:
          'Timed out waiting for the delete-leg scan to render "Go to '
          'dashboard": 10s pumped after the login-submit tap, plus the 12s '
          'window inside acceptTermsIfShown. Post-sign-in clickwrap '
          'interstitial seen this run: $sawReacceptance — true means the '
          'session was already valid, so this is NOT an auth failure. The '
          'cause is in the screen text: an "ApiException(5xx)" there is the '
          'backend answering 5xx (join it to a GlitchTip event by request '
          'id), while "Setting up your board" on its own means the scan was '
          'still running when the window expired. '
          'On screen: ${onScreen(tester)}',
    );
    await tester.tap(find.text('Go to dashboard'));
    await pumpFor(tester, const Duration(seconds: 4));

    // ── 18 Give the account something to lose ────────────────────────────────
    final String doomed = 'E2E Doomed ${DateTime.now().millisecondsSinceEpoch}';
    await tester.tap(find.byKey(E2EKeys.fabAdd));
    await pumpFor(tester, const Duration(seconds: 2));
    await tester.enterText(find.byKey(E2EKeys.addName), doomed);
    await tester.enterText(find.byKey(E2EKeys.addPrice), '3.21');
    await pumpFor(tester, const Duration(milliseconds: 500));
    await tester.tap(find.byKey(E2EKeys.addSubmit));
    await pumpFor(tester, const Duration(seconds: 8));
    final Finder doomedFinder = find.text(doomed);
    await scrollUntilFound(
      tester,
      target: doomedFinder.first,
      scrollable: find.byType(Scrollable),
      what: 'the doomed subscription, on Home before account deletion',
      maxScrolls: 40,
    );
    expect(
      doomedFinder,
      findsWidgets,
      reason:
          'The subscription the deletion is supposed to erase never round-'
          'tripped through D1, so a later "0 rows" would prove nothing',
    );
    await shot('18-doomed-subscription');

    // ── 19 Settings → Delete account ─────────────────────────────────────────
    await tester.tap(find.text('More'));
    await pumpFor(tester, const Duration(seconds: 2));
    expect(find.byType(SettingsScreen), findsWidgets);
    final Finder deleteButton = find.byKey(E2EKeys.settingsDeleteAccount);
    // Same repair as step 17, applied BEFORE it bites: "Delete account" is the
    // last control in the same lazy settings list, so it was carrying the
    // identical `find.byType(Scrollable).first` guess and the identical
    // `Bad state: No element` failure mode. This walk has never reached this
    // line on CI, which is exactly why the latent version of a bug that already
    // cost one run should not be left sitting in it.
    await scrollUntilFound(
      tester,
      target: deleteButton,
      scrollable: scrollableWithin(find.byType(SettingsScreen)),
      what: 'Delete account',
      maxScrolls: 30,
      delta: 200,
    );
    await shot('19a-delete-control');
    // "Delete account" is the LAST control in this scroll view, which is the
    // position the FAB in app_shell.dart is painted over — `Scaffold` draws it
    // above the body, so a control can be inside the viewport and still not
    // tappable. Same class of failure that swallowed two nights of "Log out"
    // taps, different occluder: the nav pill was the cause then, and since #217
    // it arrives through `AppScaffold`'s `bottomNavigationBar`, a layout slot
    // that the body is measured above. Never a bare tester.tap() here.
    await tapWhenHittable(
      tester,
      deleteButton,
      'Delete account',
      scrollable: scrollableWithin(find.byType(SettingsScreen)).first,
    );
    await pumpFor(tester, const Duration(seconds: 2));

    expect(
      find.byKey(E2EKeys.deleteAccountPassword),
      findsOneWidget,
      reason:
          'The delete-account confirmation never opened. On screen: '
          '${onScreen(tester)}',
    );
    // The destructive button is INERT until a password is typed — asserted
    // before typing, so a dialog that had quietly dropped that guard would be
    // caught here rather than by a user on a borrowed phone.
    expect(
      tester
          .widget<FilledButton>(find.byKey(E2EKeys.deleteAccountConfirm))
          .onPressed,
      isNull,
      reason:
          'The irreversible button was enabled with an empty password field — '
          'a stray tap is then enough to destroy an account',
    );
    await shot('19b-delete-dialog');

    await tester.enterText(
      find.byKey(E2EKeys.deleteAccountPassword),
      deletePassword,
    );
    await pumpFor(tester, const Duration(milliseconds: 500));
    await tester.tap(find.byKey(E2EKeys.deleteAccountConfirm));

    // ── 20 The real round-trip: reauth → DELETE → identity gone → sign-out ────
    // Three network hops before the router moves, so this is the longest wait in
    // the suite. Polled rather than fixed: the notice is parked in a provider
    // and rendered by the LOGIN screen, so it survives the redirect that carries
    // the dialog away — it does not auto-dismiss and cannot be raced.
    expect(
      await waitFor(
        tester,
        find.byKey(E2EKeys.accountDeletionNotice),
        timeout: const Duration(seconds: 40),
      ),
      isTrue,
      reason:
          'No account-deletion outcome ever reached the login screen. Either '
          'the request is still in flight, or the app never left the dialog. '
          'On screen: ${onScreen(tester)}',
    );
    await pumpFor(tester, const Duration(seconds: 2));
    await shot('20-account-deleted');

    // THE ASSERTION THE WHOLE LEG IS FOR. `AccountDeletionOutcome.accountIsGone`
    // is false for every refusal — 501 (nothing deleted), 502 (rows gone, login
    // alive), couldNotReach, reauthFailed — and each of those renders "Not
    // deleted" here instead. So this distinguishes "the server did it" from "the
    // app asked", which is the distinction [ADR 027] exists for.
    expect(
      find.text('Account deleted'),
      findsWidgets,
      reason:
          'The app did NOT report the account as gone.\n'
          '  Its own words : "${noticeText()}"\n'
          '  Technical     : ${noticeDetail()}\n'
          'READ THE TECHNICAL LINE FIRST — it names the cause; the sentence '
          'above does not. It is the SERVER that refused when it reads '
          '`HTTP 501` (unconfigured / no APP_ERASURE_ENDPOINTS) or `HTTP 502` '
          '(the subly-api relay or the identity delete failed) — only then are '
          'the services/platform Worker logs the place to look. Anything else '
          '— `HTTP 0`, an unmodelled status, or a Dart exception such as '
          'CircularDependencyError — is a CLIENT defect and the Worker logs '
          'will show no request at all. [ADR 027]',
    );

    // …and the user really is signed out, on the login screen, and STAYS there.
    // Same second-look as leg 2's sign-out: waitFor returns on the first
    // matching frame, which a transit frame satisfies.
    expect(find.text('Welcome back'), findsOneWidget);
    await pumpFor(tester, const Duration(seconds: 3));
    expect(
      find.text('Welcome back'),
      findsOneWidget,
      reason:
          'The deletion reached the login screen but did not STAY there — '
          'something navigated away after the redirect',
    );
    expect(
      find.text('Skip'),
      findsNothing,
      reason:
          'Deletion landed in the first-run onboarding carousel. /onboarding is '
          'inside the router authFlow, so the redirect will not rescue the user',
    );
    await shot('21-signed-out-after-delete');

    // ⬜ WHAT THIS TEST CANNOT SEE, STATED. Everything above is the app's own
    // account of what happened, and a client can only report what it was told.
    // Whether subly_db and the identity record are ACTUALLY empty is asserted by
    // `tooling/e2e/verify_purged.mjs` in the step after this one — server-side,
    // through the D1 HTTP API and the GoTrue admin API, with no app in the loop.
    restoreGlobals();
  });
}
