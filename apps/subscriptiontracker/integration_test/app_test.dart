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
import 'package:flutter/services.dart' show LogicalKeyboardKey;
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';
import 'package:nikatru_core/nikatru_core.dart' as core;
import 'package:nikatru_design_system/nikatru_design_system.dart'
    show ChassisL10nX, DataStateView, MonthGrid;
import 'package:supabase_flutter/supabase_flutter.dart' as sb;

import 'package:nikatru_chassis_screens/firstrun/setup_steps_view.dart'
    show SetupStepsView;
import 'package:nikatru_chassis_screens/shell/web_semantics.dart'
    show releaseWebSemantics;
import 'package:subscriptiontracker/core/e2e_keys.dart';
import 'package:subscriptiontracker/data/models/subscription.dart';
import 'package:subscriptiontracker/features/auth/legal_consent_fields.dart';
import 'package:subscriptiontracker/features/auth/reaccept_terms_screen.dart';
import 'package:subscriptiontracker/features/calendar/calendar_screen.dart';
import 'package:subscriptiontracker/features/home/home_screen.dart';
import 'package:subscriptiontracker/features/insights/budget_card.dart';
import 'package:subscriptiontracker/features/insights/budget_editor.dart';
import 'package:subscriptiontracker/features/insights/insights_screen.dart';
import 'package:subscriptiontracker/features/settings/settings_screen.dart';
import 'package:subscriptiontracker/features/shell/app_shell.dart';
import 'package:subscriptiontracker/l10n/app_localizations.dart';
import 'package:subscriptiontracker/main.dart' as app;
import 'package:subscriptiontracker/state/analytics_providers.dart'
    show kInstallIdKey;

import 'consent.dart';
import 'flow_steps.dart';
import 'import_steps.dart';
import 'magic_link_sign_in.dart';
import 'offline_read_steps.dart';

void main() {
  final IntegrationTestWidgetsFlutterBinding binding =
      IntegrationTestWidgetsFlutterBinding.ensureInitialized();

  const String email = String.fromEnvironment('E2E_EMAIL');
  const String password = String.fromEnvironment('E2E_PASSWORD');
  const String tokenHash = String.fromEnvironment('E2E_TOKEN_HASH');

  // ── WHAT THIS RUN EXPECTS ──────────────────────────────────────────────────
  //
  // 🔴 THE SAME SUITE, TWO FACTS, AND NEITHER OF THEM SKIPS ANYTHING. Until
  // 2026-09-07 this file could only ever describe the auth project it happened
  // to be pointed at, so "does the live suite still pass on the self-hosted
  // GoTrue" was a question that could first be asked INSIDE the cutover window.
  //
  // ⏱ 2026-09-25 — TWO REQUIRED FACTS, NOT A TARGET NAME. `e2e.yml` derives
  // them from the run's SUPABASE_URL and tooling/platform-register.json (step
  // "Derive what this run expects") and passes each as a dart-define that is
  // exactly `yes` or `no`, with NO default: an unset or unknown one fails every
  // test at its start (`requireDecidedExpectations`), because a default would
  // grade the run against the other expectation, where a finding can read as a
  // pass.
  //   · E2E_EXPECT_CAPTCHA_GATE — a wrong password. The hosted project checks
  //     the password and answers `invalid_credentials` (`no`). The self-hosted
  //     GoTrue on Box C enforces Turnstile on `token?grant_type=password` and
  //     refuses at the captcha BEFORE the password is looked at
  //     (auth-cutover.md §4.5 row 3; `yes`), so the copy the user sees is a
  //     different one — and `authErrorText` maps it deliberately, on the
  //     reasoning in that file's own comment that "Incorrect email or password"
  //     would be an outright lie to a user whose credentials were fine.
  //   · E2E_EXPECT_WORKERS_TRUST — everything behind the Worker. The Workers
  //     trust exactly one issuer (auth-cutover.md Phase 5), the register's
  //     vars.SUPABASE_URL. `yes`: this run's issuer is that one and the suite
  //     walks the app. `no`: a session this run mints is refused 401, and that
  //     refusal is the EXPECTED outcome, not a failure — see
  //     `expectOneIssuerRefusal` below.
  const String expectCaptchaGate = String.fromEnvironment(
    'E2E_EXPECT_CAPTCHA_GATE',
  );
  const String expectWorkersTrust = String.fromEnvironment(
    'E2E_EXPECT_WORKERS_TRUST',
  );
  // ⏱ 2026-10-01 · EN-08 (train st-e2e-parity): HOW THE FULL WALK SIGNS IN,
  // decided by tooling/e2e/sign_in_via.mjs and never defaulted. `form`: the
  // real front door — the form, its Turnstile widget (a sandbox stack's always-
  // pass TEST key, or a stack with no gate), GoTrue. `token`: the harness-minted
  // one-time token, for a stack whose real Turnstile key a headless browser
  // cannot solve. The walk prints which (`NK_E2E step=sign-in via=…`), and the
  // same script grades the drive log: a `form` run whose session came from the
  // harness token is red.
  const String signInVia = String.fromEnvironment('E2E_SIGN_IN');
  // `run` walks the 14d changed flows; `skip` parks them, said (the dispatch
  // input pending_flows; tooling/e2e/native_auth_proof.mjs PENDING_FLOWS_ROW).
  const String pendingFlows = String.fromEnvironment('E2E_PENDING_FLOWS');
  const bool captchaGateOn = expectCaptchaGate == 'yes';
  const bool workersTrustIssuer = expectWorkersTrust == 'yes';

  /// Fails the calling test at its start unless both facts arrived as exactly
  /// `yes` or `no`. Called as the first line of every test: a failure inside
  /// a test body is reported against that test, where a `setUpAll` failure
  /// would leave no test result behind for the driver to count.
  void requireDecidedExpectations() {
    final List<String> undecided = <String>[];
    if (expectCaptchaGate != 'yes' && expectCaptchaGate != 'no') {
      undecided.add('E2E_EXPECT_CAPTCHA_GATE="$expectCaptchaGate"');
    }
    if (expectWorkersTrust != 'yes' && expectWorkersTrust != 'no') {
      undecided.add('E2E_EXPECT_WORKERS_TRUST="$expectWorkersTrust"');
    }
    if (signInVia != 'form' && signInVia != 'token') {
      undecided.add('E2E_SIGN_IN="$signInVia"');
    }
    if (pendingFlows != 'run' && pendingFlows != 'skip') {
      undecided.add('E2E_PENDING_FLOWS="$pendingFlows"');
    }
    if (undecided.isNotEmpty) {
      fail(
        'could not decide what to expect: --dart-define '
        '${undecided.join(' and ')} (an unset define reads as ""), and each '
        'must be exactly "yes" or "no" (e2e.yml derives them in its step '
        '"Derive what this run expects"). A default would grade this run '
        'against the other expectation, where a finding reads as a pass.',
      );
    }
  }

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

  // The app animates forever in places (progress indicators, loaders), so
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

  /// Submit the add sheet — and PROVE it closed, which is what a saved row does.
  ///
  /// 🔬 LIVE E2E 36513585035 (600cc6dc, #1045 ST-T3b), BOTH TESTS RED. T3b grew
  /// the sheet (currency, trial, category, plan, website, notes), and at this
  /// suite's 430x932 window the submit button now lays out at y 1153-1205,
  /// below the viewport: measured with the real sheet, not inferred. The bare
  /// `tester.tap(addSubmit)` it replaced therefore missed, silently
  /// (`warnIfMissed` is a print nobody reads), and the sheet stayed open.
  ///
  /// 🔴 AND THE READ-BACK AFTER IT STILL PASSED, which is why the failure
  /// surfaced three steps later as `Found 0 widgets with text "Remove"`.
  /// `find.text` also matches an `EditableText`, so "the subscription just
  /// created, on Home" was found in the still-open sheet's OWN NAME FIELD —
  /// no POST, no D1 row, a green round-trip assertion. The same miss in the
  /// delete test left the sheet over the shell, so `tap('More')` never opened
  /// Settings (`Found 0 widgets with type "SettingsScreen"`). The
  /// `findsNothing` below closes that hole: the sheet pops only after the
  /// POST succeeds (`_save` in add_subscription_sheet.dart), and while it is
  /// up nothing downstream may read its fields as evidence.
  ///
  /// The sheet scrolls on purpose (its note on the button row says so, and
  /// `add_sheet_t3b_test.dart` makes the same `ensureVisible` call), so this
  /// is the suite catching up with the app, not the app regressing.
  Future<void> submitAddSheet(WidgetTester tester, String what) async {
    final Finder submit = find.byKey(E2EKeys.addSubmit);
    await tester.ensureVisible(submit);
    await pumpFor(tester, const Duration(milliseconds: 500));
    await tapWhenHittable(
      tester,
      submit,
      'the add sheet\'s submit button ($what)',
      scrollable: find
          .ancestor(of: submit, matching: find.byType(Scrollable))
          .first,
    );
    // POST /v1/subscriptions → Worker → D1, then the sheet closes.
    await pumpFor(tester, const Duration(seconds: 8));
    expect(
      submit,
      findsNothing,
      reason:
          'The add sheet is still open 8s after its submit was tapped for '
          '$what: the sheet pops only once the POST succeeds, so either the '
          'save failed (a SnackBar says which) or the button was disabled. '
          'On screen: ${onScreen(tester)}',
    );
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
  /// The poll and the reportData write live in `consent.dart`, shared with the
  /// store capture (store_screenshots_test.dart), so the two live drives read
  /// the install id one way and publish it under one key.
  Future<String> exportConsentAnonId(
    WidgetTester tester, {
    Duration timeout = const Duration(seconds: 10),
  }) async {
    final int startedIn = testEpoch;
    final String? id = await pollInstallId(
      pump: () =>
          guardedPump(tester, startedIn, const Duration(milliseconds: 200)),
      timeout: timeout,
    );
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

    // Merged into reportData (never assigned over it: `shot('00-consent')` has
    // already put its screenshot list there) — consent.dart says why.
    publishConsent(binding, id: id);
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
  ///
  /// 🔴 AND THE SEMANTICS HANDLE, IN THE SAME CALLBACK AND FOR THE SAME REASON.
  /// On web `app.main()` forces semantics on by holding a `SemanticsHandle`
  /// (`chassis_screens/lib/shell/web_semantics.dart`), and `_verifySemanticsHandlesWereDisposed`
  /// runs in the very post-body block described above. While `main()` dropped
  /// that handle, nightly run 34453685391 and every run after it failed the
  /// first test with `A SemanticsHandle was active at the end of the test.` —
  /// after its body had passed. The handle is now owned, and released here.
  Future<VoidCallback> launchApp(WidgetTester tester) async {
    final ErrorWidgetBuilder builderBeforeTest = ErrorWidget.builder;
    await app.main();
    await pumpFor(tester, const Duration(seconds: 3));
    return () {
      ErrorWidget.builder = builderBeforeTest;
      releaseWebSemantics();
    };
  }

  /// Moves past first-run onboarding IF it is showing, and says whether it was.
  ///
  /// 🔴 CONDITIONAL SINCE 2026-08-08, AND THE THING THAT CHANGED IS THE APP, NOT
  /// THIS SUITE'S TASTE. Three tests each call `app.main()` and every one of
  /// them used to land on the carousel, so all three tapped Skip unconditionally
  /// and `router/router_provider.dart:30` still records that assumption in a
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
    // NOT pumpAndSettle: this app animates forever in places (progress
    // indicators, loaders), so settling never returns — the reason `pumpFor` exists at
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
    // ⏱ 2026-09-12 · THE SECOND PLACE A SESSION CAN BE STRANDED, AND THE
    // `boxa` RUN IS WHAT FOUND IT. `AppShell` is not the only screen a SIGNED-IN
    // user can be sitting on. The re-acceptance gate holds them on
    // `/reaccept-terms`, which is not the shell — so the check below read a live
    // session as "nobody is signed in", returned false, and `expectLandedOnLogin`
    // then failed on the interstitial. Verbatim, e2e run 34668296014 (#103,
    // auth_target=boxa): "The app did not reach the login screen after the boot
    // for the delete-leg walk. On screen: We have updated our Terms of Service
    // and Privacy Policy … | Sign out | Our terms have changed".
    //
    // 🔴 WHY ONLY `boxa` SAW IT, which is the part worth keeping. Against
    // `hosted` the previous leg ends INSIDE the shell, so the shell check was
    // always true and this branch was unreachable. Against `boxa` the Workers
    // refuse a Box A-minted session by design (see `expectOneIssuerRefusal`), so
    // the acceptance POST cannot complete and the interstitial is exactly where
    // the previous leg ends. The bug was never in Box A's auth — the session was
    // real, which is why the delete leg found a signed-in app at all.
    //
    // The interstitial carries its OWN sign-out (`ReacceptTermsScreen.signOutButton`,
    // whose action is a GoTrue call and not a Worker call), so this path works on
    // both targets. Confirmed after a pump for the same reason the shell is: a
    // redirect in flight can paint either screen for a frame.
    final Finder strandedSignOut = find.byKey(
      ReacceptTermsScreen.signOutButton,
    );
    if (strandedSignOut.evaluate().isNotEmpty) {
      await pumpFor(tester, const Duration(seconds: 2));
      if (strandedSignOut.evaluate().isNotEmpty) {
        await shot('00-stranded-on-reacceptance');
        await tester.tap(strandedSignOut);
        await pumpFor(tester, const Duration(seconds: 2));
        expect(
          await waitFor(tester, find.byKey(E2EKeys.loginHeading)),
          isTrue,
          reason:
              'A session survived into this test on the re-acceptance '
              'interstitial, and its own sign-out did not return to the login '
              'screen. On screen: ${onScreen(tester)}',
        );
        return true;
      }
    }
    final Finder shell = find.byType(AppShell);
    if (shell.evaluate().isEmpty) return false;
    // …and CONFIRM it, because a redirect in flight can paint the shell for a
    // frame or two on the way to /sign-in. Acting on that frame would drive
    // Settings on a screen that is being torn down, and this helper would
    // manufacture the very failure it exists to prevent.
    await pumpFor(tester, const Duration(seconds: 2));
    if (shell.evaluate().isEmpty) return false;
    await tester.tap(find.text('Settings'));
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
      await waitFor(tester, find.byKey(E2EKeys.loginHeading)),
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
    // trip AND the screen the gate hands back. The user lands on the
    // destination they were actually going to — Home, since IM-07 (it was
    // /scan, whose 3.36s timer this window was first sized for) — and Home's
    // list is one more live Worker round trip before the landing is asserted.
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

  /// The add sheet's PICK step is up — asserted by its heading and its search,
  /// with "Add by hand" offered.
  ///
  /// ⏱ 2026-10-02 · ST-T9 (AD-03, #1130). An ADD now opens on a pick step — a
  /// search over the bundled catalogue, "Add by hand" and "Import instead" —
  /// and the form that carries `E2EKeys.addName` / `addPrice` is one tap
  /// further. E2E run 36951615260 failed `Bad state: No element` on
  /// `addName` in both legs for exactly that.
  Future<void> expectAddPickStep(WidgetTester tester, String what) async {
    final Finder search = find.byKey(E2EKeys.addSearch);
    expect(
      await waitFor(tester, search, timeout: const Duration(seconds: 6)),
      isTrue,
      reason:
          '$what did not open the add sheet on its pick step (no catalogue '
          'search). On screen: ${onScreen(tester)}',
    );
    final AppLocalizations l10n = AppLocalizations.of(tester.element(search));
    expect(
      find.text(l10n.addSubscriptionTitle),
      findsWidgets,
      reason: 'the pick step has no "${l10n.addSubscriptionTitle}" heading',
    );
    expect(
      find.text(l10n.addPickSearchLabel),
      findsOneWidget,
      reason:
          'the pick step\'s search is not labelled '
          '"${l10n.addPickSearchLabel}"',
    );
    expect(
      find.byKey(E2EKeys.addByHand),
      findsOneWidget,
      reason: 'the pick step offers no "${l10n.addPickByHand}"',
    );
  }

  /// "+" → the pick step → "Add by hand" → the form, ready to type into.
  ///
  /// The walk types a unique name and a price, which no catalogue pick
  /// supplies, so it goes the way a user with an unlisted plan goes.
  Future<void> openAddFormByHand(
    WidgetTester tester,
    String what, {
    String? pickShot,
  }) async {
    await tester.tap(find.byKey(E2EKeys.fabAdd));
    await pumpFor(tester, const Duration(seconds: 2));
    await expectAddPickStep(tester, 'the "+" ($what)');
    if (pickShot != null) await shot(pickShot);
    await tapWhenHittable(
      tester,
      find.byKey(E2EKeys.addByHand),
      'Add by hand ($what)',
    );
    expect(
      await waitFor(tester, find.byKey(E2EKeys.addName)),
      isTrue,
      reason:
          '"Add by hand" did not open the add form for $what. On screen: '
          '${onScreen(tester)}',
    );
    await pumpFor(tester, const Duration(milliseconds: 500));
  }

  /// Swipes every SnackBar away, the way a user clears one.
  ///
  /// 🔴 A SNACKBAR WITH AN ACTION NEVER TIMES OUT: Flutter 3.47's
  /// `SnackBar.persist` defaults to `action != null`, and #1130 gave pause
  /// and remove an Undo (DE-09, DE-10). The messenger QUEUES, so a persistent
  /// Undo stays current and every later SnackBar waits behind it — step 13's
  /// removal would have shown 12c's PAUSE Undo, and tapping it would have
  /// undone the wrong write.
  Future<void> swipeAwaySnackBars(WidgetTester tester, String after) async {
    final Finder bar = find.byType(SnackBar);
    for (int i = 0; i < 6 && bar.evaluate().isNotEmpty; i++) {
      await tester.fling(bar.first, const Offset(0, 300), 1500);
      await pumpFor(tester, const Duration(milliseconds: 1500));
    }
    expect(
      bar,
      findsNothing,
      reason:
          'a SnackBar is still up after swiping it away ($after). On screen: '
          '${onScreen(tester)}',
    );
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
      await waitFor(tester, find.byKey(E2EKeys.loginHeading)),
      isTrue,
      reason:
          'The app did not reach the login screen after $after. On screen: '
          '${onScreen(tester)}',
    );
    expect(find.byKey(E2EKeys.loginHeading), findsOneWidget);
  }

  /// True when the signed-in HOME is on screen with the list LOADED: neither
  /// the skeleton nor the failed state. What ScanScreen's "Go to dashboard"
  /// used to stand in for (it rendered only once the list had loaded).
  bool listLoadedOnHome(WidgetTester tester) =>
      find.byType(HomeScreen).evaluate().isNotEmpty &&
      find.byKey(DataStateView.failedKey).evaluate().isEmpty &&
      find.byKey(DataStateView.loadingKey).evaluate().isEmpty;

  /// IM-07 — where a sign-in lands: Home, list loaded.
  ///
  /// 🔴 THE REASON REPORTS WHAT WAS OBSERVED AND DIAGNOSES NOTHING, for the
  /// reason recorded 2026-09-02: the old "sign-in likely failed" guess sent
  /// three investigations at Supabase auth when the cause was a transient D1
  /// fault inside subscriptiontracker-api. The cause is ON THE SCREEN, and
  /// `onScreen` prints it.
  void expectLandedOnHome(
    WidgetTester tester,
    String leg,
    bool sawReacceptance,
  ) {
    expect(
      listLoadedOnHome(tester),
      isTrue,
      reason:
          'Timed out waiting for $leg to land on Home with the list loaded: '
          '10s pumped after sign-in, plus the 12s window inside '
          'acceptTermsIfShown. Post-sign-in clickwrap interstitial seen this '
          'run: $sawReacceptance — true means the session was already valid, '
          'because the router serves that screen to authenticated users only. '
          'Read the cause off the screen text below, do not infer it: '
          '"Could not load: ApiException(5xx)" is a backend failure (the '
          'Worker answered 5xx; look for `service=subscriptiontracker-api` in '
          'GlitchTip), "Could not load" with any other error is a client-side '
          'throw that may mean NO REQUEST WAS EVER SENT, and the loading '
          'skeleton on its own means the list was still loading when the '
          'window expired. On screen: ${onScreen(tester)}',
    );
    expect(find.byType(AppShell), findsOneWidget);
  }

  /// Walks the after-sign-in setup IF it is showing, and says whether it was.
  ///
  /// ⏱ 2026-10-02 · ST-T9 (EN-18, #1130). Home sends a signed-in account whose
  /// list loads EMPTY to `/setup` — three steps (home currency, reminder
  /// channels, "pick what you pay for"), a full ROUTE, not a dialog — and the
  /// account is marked seen when it finishes or skips, ONCE PER ACCOUNT
  /// (`setupSeenProvider`, keyed by the account id in the device store). Every
  /// leg here signs in a fresh admin-API user, so it meets the setup every run;
  /// the first E2E after #1130 (run 36948740532) timed out on its step 1 in BOTH
  /// legs because nothing here knew it existed.
  ///
  /// The suite VISITS every page, so this WALKS all three steps with Next,
  /// accepting the defaults (nothing picked on step 3, so no row is added), and
  /// asserts each step's heading from the arb before advancing. A setup that is
  /// NOT shown (a returning account, a list that was not empty) is not a
  /// failure — the same contract as [skipOnboardingIfShown] — and the landing
  /// assertion after it is unchanged.
  ///
  /// 🔴 THE REDIRECT IS AFTER A FRAME, so "Home with the list loaded" can be
  /// true for a moment before `/setup` replaces it. This waits for the setup's
  /// advance button, and only gives up on it once Home has held its loaded list
  /// for two seconds.
  Future<bool> walkSetupIfShown(WidgetTester tester, String leg) async {
    final Finder advance = find.byKey(SetupStepsView.advanceButton);
    final int startedIn = testEpoch;
    final DateTime end = DateTime.now().add(const Duration(seconds: 15));
    DateTime? homeSince;
    while (DateTime.now().isBefore(end) && advance.evaluate().isEmpty) {
      await guardedPump(tester, startedIn, const Duration(milliseconds: 200));
      if (listLoadedOnHome(tester)) {
        homeSince ??= DateTime.now();
        if (DateTime.now().difference(homeSince) > const Duration(seconds: 2)) {
          break;
        }
      } else {
        homeSince = null;
      }
    }
    if (advance.evaluate().isEmpty) return false;

    final AppLocalizations l10n = AppLocalizations.of(tester.element(advance));
    final List<String> titles = <String>[
      l10n.setupCurrencyTitle,
      l10n.setupRemindersTitle,
      l10n.setupPickTitle,
    ];
    for (int i = 0; i < titles.length; i++) {
      final bool last = i == titles.length - 1;
      expect(
        await waitFor(tester, find.text(titles[i])),
        isTrue,
        reason:
            '$leg: setup step ${i + 1} of ${titles.length} ("${titles[i]}") '
            'never showed. On screen: ${onScreen(tester)}',
      );
      expectNothingCoveringTheApp('setup step ${i + 1}');
      await shot('03s-setup-step-${i + 1}');
      expect(
        find.descendant(
          of: advance,
          matching: find.text(last ? l10n.setupFinish : l10n.setupNext),
        ),
        findsOneWidget,
        reason:
            '$leg: setup step ${i + 1} does not offer '
            '"${last ? l10n.setupFinish : l10n.setupNext}". On screen: '
            '${onScreen(tester)}',
      );
      // A ROUTE, not a dialog — but the step change animates, so settle the
      // frame before the tap rather than tapping a control mid-transition.
      await pumpFor(tester, const Duration(milliseconds: 400));
      await tapWhenHittable(
        tester,
        advance,
        last ? l10n.setupFinish : l10n.setupNext,
      );
      await pumpFor(tester, const Duration(milliseconds: 600));
    }
    // Done saves the currency, marks the account seen and routes to Home,
    // whose list is one more live Worker read.
    expect(
      await waitGone(tester, advance, timeout: const Duration(seconds: 12)),
      isTrue,
      reason:
          '$leg: "${l10n.setupFinish}" did not leave the setup. On screen: '
          '${onScreen(tester)}',
    );
    final DateTime homeBy = DateTime.now().add(const Duration(seconds: 12));
    while (DateTime.now().isBefore(homeBy) && !listLoadedOnHome(tester)) {
      await guardedPump(tester, startedIn, const Duration(milliseconds: 200));
    }
    return true;
  }

  /// The `E2E_EXPECT_WORKERS_TRUST=no` half of every Worker-dependent leg — a
  /// POSITIVE expectation, not a skip.
  ///
  /// 🔴 WHY THESE LEGS CANNOT PASS WITHOUT TRUST, BY CONSTRUCTION.
  /// `runbooks/auth-cutover.md` Phase 5: "there is no dual-issuer path in the
  /// code — the Workers trust exactly one issuer", the register's
  /// vars.SUPABASE_URL. So a session any other issuer minted — the self-hosted
  /// GoTrue on Box C before the switch commit — is refused 401 by
  /// `services/platform` and `services/subscriptiontracker-api` alike, and everything past the
  /// login screen in this suite goes through one of them — the re-acceptance
  /// gate first of all.
  ///
  /// ⚠️ SKIPPING WOULD BE THE WRONG ANSWER AND IT IS WORTH SAYING WHY. A skipped
  /// test is a green tick over a question nobody asked, and this file's whole
  /// history is failures that looked like passes. So the run asserts what IS
  /// true without trust, in two halves that fail for different reasons:
  ///   1. The stack really did authenticate a browser. `currentSession` is
  ///      non-null, which means `admin/generate_link` → `/verify` worked end to
  ///      end through a real Chrome against the self-hosted GoTrue. That is the
  ///      half the cutover actually needs proving, and it is proven here BEFORE
  ///      the window rather than inside it.
  ///   2. …and the deployed Worker did not let that session through, so the app
  ///      never reaches the authenticated shell. If it ever does, the Workers
  ///      have gained a second issuer that nothing in `services/` implements and
  ///      nobody decided — a security finding, and this expectation is what
  ///      turns it into a red line instead of a surprise.
  ///
  /// ⚬ WHAT THIS DELIBERATELY DOES NOT CLAIM. It does not read an HTTP status;
  /// a widget test cannot. The precise `401` is asserted server-side, in the
  /// same run, by `tooling/e2e/assert_one_issuer.mjs` — which also asserts the
  /// mirror-image `200` when the Workers trust the issuer, so neither direction
  /// is a comment.
  Future<void> expectOneIssuerRefusal(WidgetTester tester, String leg) async {
    final sb.Session? session = sb.Supabase.instance.client.auth.currentSession;
    expect(
      session,
      isNotNull,
      reason:
          'E2E_EXPECT_WORKERS_TRUST=no and $leg could not even sign in: the '
          'self-hosted GoTrue minted no session for the magic-link token. That '
          'is an auth failure on Box C, not the one-issuer refusal this leg '
          'expects. On screen: ${onScreen(tester)}',
    );
    // The same window the trusted path gets before it asserts it has arrived.
    await pumpFor(tester, const Duration(seconds: 12));
    expect(
      listLoadedOnHome(tester),
      isFalse,
      reason:
          'E2E_EXPECT_WORKERS_TRUST=no and $leg reached the authenticated app. '
          'The Workers are configured for ONE issuer and it is not this one, '
          'so this session must be refused until the register and the '
          'Workers move SUPABASE_URL to it. Reaching the dashboard means they '
          'now accept two issuers — treat it as a security finding, not a '
          'flaky test. On screen: ${onScreen(tester)}',
    );
    await shot('$leg-one-issuer-refusal');
  }

  testWidgets('login rejects empty + invalid credentials with clear messages', (
    WidgetTester tester,
  ) async {
    requireDecidedExpectations();
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
    // 🔴 THE EXPECTED COPY COMES FROM THE ARB, NEVER FROM A LITERAL, AND IT
    // DEPENDS ON THE CAPTCHA FACT. Without the gate (the hosted project) the
    // password is checked and `authErrorText` returns `authIncorrect`; with it
    // (the self-hosted GoTrue on Box C) the request is refused at the captcha
    // first and it returns `authCaptchaFailed`. Reading
    // both out of AppLocalizations means this assertion cannot drift from the
    // shipped words — a test that hardcodes English is a test that passes on a
    // build whose copy changed underneath it, and it would have to be edited
    // twice more the day the Tamil locale is the one under the driver.
    final AppLocalizations l10n = AppLocalizations.of(
      tester.element(find.byKey(E2EKeys.loginSubmit)),
    );
    final String expectedRefusal = captchaGateOn
        ? l10n.authCaptchaFailed
        : l10n.authIncorrect;
    // ⏱ 2026-09-28 — A VALID SUBMIT NOW WAITS FOR THE CAPTCHA, AND NEVER SENDS
    // WITHOUT A TOKEN (the ST-T1 property, kept). This run builds with the site
    // key, so the Turnstile widget renders; in a headless browser it usually
    // never answers, and then NO REQUEST IS SENT: after
    // `CaptchaTokenController.defaultWait` the screen says
    // `authCaptchaUnavailable` instead. That is the app behaving correctly, not
    // the server refusing — so it is accepted beside the server's refusal, and
    // the reason names which one appeared. Before this, #1022 disabled the
    // button outright and the empty-field leg above went red (E2E live run
    // 36379673890).
    final String captchaUnavailable = tester
        .element(find.byKey(E2EKeys.loginSubmit))
        .chassisL10n
        .authCaptchaUnavailable;
    bool shows(String sentence) =>
        find.textContaining(sentence).evaluate().isNotEmpty;
    expect(
      await waitFor(
        tester,
        find.byWidgetPredicate(
          (Widget w) =>
              w is Text &&
              ((w.data?.contains(expectedRefusal) ?? false) ||
                  (w.data?.contains(captchaUnavailable) ?? false)),
        ),
        timeout: const Duration(seconds: 40),
      ),
      isTrue,
      reason:
          'neither the friendly refusal nor the captcha-wait sentence appeared. '
          'E2E_EXPECT_CAPTCHA_GATE=$expectCaptchaGate, so the server refusal '
          'is "$expectedRefusal"; with no token the app says '
          '"$captchaUnavailable". On screen: ${onScreen(tester)}',
    );
    debugPrint(
      '00c: ${shows(expectedRefusal) ? 'the server refused ("$expectedRefusal")' : 'no captcha token in this browser, so nothing was sent ("$captchaUnavailable")'}',
    );
    expect(find.byKey(E2EKeys.loginHeading), findsOneWidget);
    await shot('00c-invalid-credentials');
    restoreGlobals();
  });

  testWidgets('visits every page, creates a subscription, reads it back', (
    WidgetTester tester,
  ) async {
    requireDecidedExpectations();
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
    // NO NAVIGATION HERE, AND SINCE IM-07 NONE IN THE HELPER EITHER: the
    // session appearing is the whole of signing in, and the router lands it on
    // Home (`afterSignInDestination`). The form branch below needs none.
    // ⏱ 2026-10-01 · EN-08: `form` never touches the token; `token` is said.
    if (signInVia == 'form' ||
        !await signInWithMagicToken(tester, tokenHash, pumpFor: pumpFor)) {
      await tester.enterText(find.byKey(E2EKeys.loginEmail), email);
      await tester.enterText(find.byKey(E2EKeys.loginPassword), password);
      // The Turnstile widget answers before the button is worth tapping.
      await pumpFor(tester, const Duration(seconds: 3));
      await tester.tap(find.byKey(E2EKeys.loginSubmit));
      // GoTrue sign-in; the router then lands the session on Home.
      await pumpFor(tester, const Duration(seconds: 10));
      e2eLine(binding, 'NK_E2E step=sign-in via=form');
    } else {
      e2eLine(binding, 'NK_E2E step=sign-in via=harness-token');
    }

    // Every screen past this point reads or writes through the deployed
    // Workers, starting with the re-acceptance gate. When they do not trust
    // this run's issuer they refuse the session, and that refusal is the
    // assertion. See `expectOneIssuerRefusal`.
    if (!workersTrustIssuer) {
      await expectOneIssuerRefusal(tester, '22-full-walk');
      restoreGlobals();
      return;
    }

    // ── 02b Re-acceptance ────────────────────────────────────────────────────
    // The admin-API user this suite signs in as holds no clickwrap record, so
    // the router's gate puts them here before anything else. See the helper.
    //
    // The result is CAPTURED rather than discarded, because it is the single
    // most load-bearing observation the landing assertion below can make: the
    // router serves this interstitial to an AUTHENTICATED user only, so `true`
    // here is the suite's own proof that sign-in succeeded.
    final bool sawReacceptance = await acceptTermsIfShown(tester);

    // ── 03s After-sign-in setup (ST-T9, EN-18) ───────────────────────────────
    // A fresh account whose list loads empty meets it; see the helper.
    final bool sawSetup = await walkSetupIfShown(tester, 'the full walk');
    debugPrint('E2E full walk: after-sign-in setup shown = $sawSetup');

    // ── 03 Landing ───────────────────────────────────────────────────────────
    // ⏱ 2026-10-01 · IM-07 (ADR 077 §2.2): this was "03 Scan", a timed loader
    // the helper forced the walk onto and nothing in the app navigated to. A
    // signed-in user lands on HOME now — the same place a person lands — and
    // the assertion is that the list LOADED there, which is what "Go to
    // dashboard" used to stand in for. The evidence rules of the old block
    // (2026-09-02: print what is on screen, never a guessed cause) hold.
    await shot('03-landing');
    expectLandedOnHome(tester, 'the full walk', sawReacceptance);

    // ── 04 Home ──────────────────────────────────────────────────────────────
    expect(find.byType(AppShell), findsOneWidget);
    expect(find.byType(HomeScreen), findsWidgets);
    expect(shellIndex(), 0);
    await shot('04-home');

    // ── 04b Import, and 04c restore (IM-07) ─────────────────────────────────
    // The product's way in, walked through the deployed Workers and READ BACK
    // from them: a 3-row CSV through the add sheet's "Import instead", then a
    // backup of those rows restored after one is deleted. Both clean up.
    final String importStamp = '${DateTime.now().millisecondsSinceEpoch}';
    await importCsvAndReadBack(
      tester,
      stamp: importStamp,
      pumpFor: pumpFor,
      onScreen: onScreen,
    );
    await shot('04b-imported');
    await restoreBackupAndReadBack(
      tester,
      stamp: importStamp,
      pumpFor: pumpFor,
      onScreen: onScreen,
    );
    await shot('04c-restored');
    expect(shellIndex(), 0);

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
    // three labels are untouched: no screen renders "Home", "Insights" or
    // "Settings" alongside its tab. Pinned by
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

    // ── 07 Budget: MOVED to 11b, after the first subscription exists ────────
    // 🔬 ST-D3 put the budget card INSIDE Insights' subscription builder, so a
    // fresh account (no subscriptions yet, as here) gets Insights' EMPTY state
    // and no budget card at all. Runs 36698011430, 36699356737 and 36700658677
    // all failed here for that reason ("Nothing to scroll ... On screen: No
    // subscriptions"). The budget is exercised at 11b, once one row exists.

    // ── 08 Settings (the 4th tab, named) ─────────────────────────────────────
    await tester.tap(find.text('Settings'));
    await pumpFor(tester, const Duration(seconds: 2));
    expect(shellIndex(), 3);
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
    await openAddFormByHand(
      tester,
      'the first subscription',
      pickShot: '10p-add-pick',
    );
    expect(find.text('Add subscription'), findsWidgets);
    await tester.enterText(find.byKey(E2EKeys.addName), subName);
    await tester.enterText(find.byKey(E2EKeys.addPrice), '12.34');
    await pumpFor(tester, const Duration(milliseconds: 500));
    await shot('10-add-sheet');
    await submitAddSheet(tester, 'the first subscription');

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

    // ── 11a Find (T8 · HO-03, SH-02): search for the plan just added, filter
    // by status, and N opens the add sheet. Back to the top first: the search
    // leads the list, and a lazy list does not build what it scrolled past.
    await tester.drag(find.byType(Scrollable).first, const Offset(0, 20000));
    await pumpFor(tester, const Duration(milliseconds: 500));
    await tester.enterText(find.byKey(HomeScreen.searchFieldKey), subName);
    await pumpFor(tester, const Duration(seconds: 1));
    expect(
      find.descendant(
        of: find.byKey(HomeScreen.allKey),
        matching: find.text(subName),
      ),
      findsOneWidget,
      reason: 'searching for the plan just added did not list it',
    );
    await tester.enterText(find.byKey(HomeScreen.searchFieldKey), '');
    // Esc leaves the field, so the shell's keys (N below) are live again —
    // inside a field N types an n, by design.
    await tester.sendKeyEvent(LogicalKeyboardKey.escape);
    await pumpFor(tester, const Duration(milliseconds: 500));
    await tester.tap(find.byKey(HomeScreen.filterKey));
    await pumpFor(tester, const Duration(milliseconds: 500));
    // A new plan is ACTIVE: filtered to Paused it is gone, to Active it is
    // back.
    await tester.tap(find.widgetWithText(FilterChip, 'Paused'));
    await pumpFor(tester, const Duration(milliseconds: 500));
    expect(
      find.descendant(
        of: find.byKey(HomeScreen.allKey),
        matching: find.text(subName),
      ),
      findsNothing,
      reason: 'filtered to Paused, an active plan still listed',
    );
    await tester.tap(find.widgetWithText(FilterChip, 'Paused'));
    await tester.tap(find.widgetWithText(FilterChip, 'Active'));
    await pumpFor(tester, const Duration(milliseconds: 500));
    expect(find.text(subName), findsWidgets);
    // Closing the chips clears them.
    await tester.tap(find.byKey(HomeScreen.filterKey));
    await pumpFor(tester, const Duration(milliseconds: 500));
    // N — the shell's primary action — opens the add sheet; Cancel closes it.
    await tester.sendKeyEvent(LogicalKeyboardKey.keyN);
    await pumpFor(tester, const Duration(seconds: 2));
    // ST-T9: it opens on the pick step, as the "+" does.
    await expectAddPickStep(tester, 'pressing N');
    await tester.tap(find.byKey(E2EKeys.addCancel));
    await pumpFor(tester, const Duration(seconds: 2));
    expect(find.byKey(E2EKeys.addSearch), findsNothing);

    // ── 11b Budget: the editor on Insights (ST-D3: no Budget tab) ────────────
    // Only now does Insights render its card stack (one subscription exists).
    await tester.tap(find.text('Insights'));
    await pumpFor(tester, const Duration(seconds: 2));
    expect(shellIndex(), 2);
    // Insights is a LAZY ListView: at the E2E viewport (430x932) the header and
    // summary tiles can push the budget card below the fold, unbuilt. Scroll to
    // `insights.budget`, which keys the card while loading and when loaded.
    await scrollUntilFound(
      tester,
      target: find.byKey(const Key('insights.budget')),
      scrollable: scrollableWithin(find.byType(InsightsScreen)),
      what: 'the Insights budget card',
      maxScrolls: 20,
      delta: 200,
    );
    // Then wait for the button itself, never a fixed pump: BudgetCard renders no
    // Edit until the budget request HAS A VALUE (a load or an error both hide it).
    expect(
      await waitFor(
        tester,
        find.byKey(BudgetCard.editButton),
        timeout: const Duration(seconds: 30),
      ),
      isTrue,
      reason:
          'the Insights budget card never offered Edit within 30 s: '
          'the budget request is still loading or FAILED',
    );
    await tester.ensureVisible(find.byKey(BudgetCard.editButton));
    await tester.tap(find.byKey(BudgetCard.editButton));
    await pumpFor(tester, const Duration(seconds: 2));
    expect(find.byType(BudgetEditor), findsWidgets);
    await shot('07-budget');
    await tester.tap(find.byTooltip('Close'));
    await pumpFor(tester, const Duration(seconds: 2));
    expect(find.byType(BudgetEditor), findsNothing);

    // Back to Home, and the row back into view, for the detail step.
    await tester.tap(find.text('Home'));
    await pumpFor(tester, const Duration(seconds: 2));
    expect(shellIndex(), 0);
    await scrollUntilFound(
      tester,
      target: subFinder.first,
      scrollable: find.byType(Scrollable),
      what: 'the subscription just created, back on Home',
      maxScrolls: 40,
    );

    // ── 12 Detail (subscription A) ───────────────────────────────────────────
    await tester.tap(subFinder.first);
    await pumpFor(tester, const Duration(seconds: 3));
    expect(
      find.text(subName),
      findsWidgets,
    ); // sub name shown in the detail header
    await shot('12-detail');

    // ── 12b Mark as paid (DE-04: POST /v1/subscriptions/:id/payments) ────────
    // The amount is prefilled from the plan; Save posts ONE payment with ONE
    // Idempotency-Key, and the history card gains its row.
    await scrollUntilFound(
      tester,
      target: find.byKey(E2EKeys.detailMarkPaid),
      scrollable: find.byType(Scrollable),
      what: 'the "Mark as paid" action on the detail history heading',
      maxScrolls: 20,
      delta: 200,
    );
    await tester.ensureVisible(find.byKey(E2EKeys.detailMarkPaid));
    await pumpFor(tester, const Duration(milliseconds: 300));
    await tester.tap(find.byKey(E2EKeys.detailMarkPaid));
    await pumpFor(tester, const Duration(seconds: 2));
    expect(find.byKey(E2EKeys.markPaidAmount), findsOneWidget);
    await tester.tap(find.byKey(E2EKeys.markPaidSave));
    expect(
      await waitFor(
        tester,
        find.text('Payment recorded'),
        timeout: const Duration(seconds: 15),
      ),
      isTrue,
      reason:
          'no "Payment recorded" snackbar 15 s after Save: the POST to '
          '/payments failed or never returned',
    );
    await shot('12b-marked-paid');

    // ── 12c Pause → Resume (DE-09: asks once, Undo offered) ─────────────────
    await tester.tap(find.byKey(E2EKeys.detailMoreOptions));
    await pumpFor(tester, const Duration(seconds: 2));
    await tester.tap(find.text('Pause'));
    await pumpFor(tester, const Duration(seconds: 2));
    await tester.tap(find.byKey(E2EKeys.confirmYes));
    await pumpFor(tester, const Duration(seconds: 5)); // PATCH round-trip
    expect(
      find.textContaining('Paused'),
      findsWidgets,
      reason: 'the header does not say Paused after confirming Pause',
    );
    await swipeAwaySnackBars(tester, 'pausing at 12c');
    await tester.tap(find.byKey(E2EKeys.detailMoreOptions));
    await pumpFor(tester, const Duration(seconds: 2));
    await tester.tap(find.text('Resume'));
    await pumpFor(tester, const Duration(seconds: 5));
    expect(
      find.textContaining('Paused'),
      findsNothing,
      reason: 'the header still says Paused after Resume',
    );

    // ── 12d Mark cancelled THROUGH THE STOP FLOW (DE-07) ────────────────────
    // 🔴 BACK TO THE TOP FIRST. 12b scrolled DOWN to the history heading, and
    // "Stop or remove" sits ABOVE it in a lazy list; `scrollUntilFound` only
    // drags one way, so from there it could never come back to the button.
    Future<void> scrollToStopOrRemove() async {
      await tester.drag(find.byType(Scrollable).first, const Offset(0, 20000));
      await pumpFor(tester, const Duration(milliseconds: 500));
      await scrollUntilFound(
        tester,
        target: find.byKey(E2EKeys.detailCancelPlan),
        scrollable: find.byType(Scrollable),
        what: 'the "Stop or remove" button on the subscription detail',
        maxScrolls: 20,
        delta: 200,
      );
      await tester.ensureVisible(find.byKey(E2EKeys.detailCancelPlan));
      await pumpFor(tester, const Duration(milliseconds: 300));
    }

    await scrollToStopOrRemove();
    await tester.tap(find.byKey(E2EKeys.detailCancelPlan));
    await pumpFor(tester, const Duration(seconds: 2));
    await tester.tap(find.byKey(E2EKeys.stopChoiceCancelled));
    await pumpFor(tester, const Duration(seconds: 2));
    await tester.tap(find.byKey(E2EKeys.stopItWorked));
    await pumpFor(tester, const Duration(seconds: 5)); // PATCH round-trip
    expect(
      find.byKey(E2EKeys.stopDone),
      findsOneWidget,
      reason:
          'the stop flow never reached "done" after "Yes, mark it cancelled"',
    );
    await tester.tap(find.byKey(E2EKeys.stopDone));
    await pumpFor(tester, const Duration(seconds: 2));
    expect(find.textContaining('Cancelled'), findsWidgets);
    await shot('12d-marked-cancelled');

    // ── 13 Remove → Undo → remove (DE-07 / DE-10: a soft delete, undoable) ──
    Future<void> removeThroughStopFlow() async {
      await scrollToStopOrRemove();
      await tester.tap(find.byKey(E2EKeys.detailCancelPlan));
      await pumpFor(tester, const Duration(seconds: 2));
      await tester.tap(find.byKey(E2EKeys.stopChoiceRemove));
      await pumpFor(tester, const Duration(seconds: 6)); // the write round-trip
    }

    await removeThroughStopFlow();
    expect(shellIndex(), 0);
    expect(
      find.byKey(E2EKeys.snackUndo),
      findsOneWidget,
      reason:
          'no Undo on the removal snackbar: the soft delete is not undoable',
    );
    await tester.tap(find.byKey(E2EKeys.snackUndo));
    await pumpFor(tester, const Duration(seconds: 6)); // PATCH deleted_at: null
    await scrollUntilFound(
      tester,
      target: subFinder.first,
      scrollable: find.byType(Scrollable),
      what: 'the subscription Undo brought back, on Home',
      maxScrolls: 40,
    );

    // And removed for good, which is what the CI verify step expects of A.
    await tester.tap(subFinder.first);
    await pumpFor(tester, const Duration(seconds: 3));
    await removeThroughStopFlow();
    expect(shellIndex(), 0);
    // Past the snackbar's own life, so the Undo cannot be what is on screen.
    await pumpFor(tester, const Duration(seconds: 6));
    expect(
      find.text(subName),
      findsNothing,
      reason: 'Removed subscription still shows on Home — the removal failed',
    );
    await swipeAwaySnackBars(tester, 'the removal at 13');
    await shot('13-after-cancel');

    // ── 14 Create a SECOND subscription (left in D1 for the CI verify+purge) ──
    final String subNameB =
        'E2E Probe B ${DateTime.now().millisecondsSinceEpoch}';
    await openAddFormByHand(tester, 'the SECOND subscription');
    await tester.enterText(find.byKey(E2EKeys.addName), subNameB);
    await tester.enterText(find.byKey(E2EKeys.addPrice), '7.77');
    await pumpFor(tester, const Duration(milliseconds: 500));
    await submitAddSheet(tester, 'the SECOND subscription');
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

    // ── 14b The list survives with the network off (AB-O1-05) ────────────────
    // The row above went to the live Worker and was mirrored into this
    // browser's localStorage by the app's own cache client; a second client
    // over a dead transport must still read it (offline_read_steps.dart).
    await tester.runAsync(() => expectListSurvivesOffline(subNameB));

    // ── 14c A WEEKLY plan: every charge on the calendar, then paused ─────────
    // ST truth pass (2026-10-01, CA-01 / HO-01 / HO-02). The calendar drew ONE
    // dot per row, from its stored date, so a weekly plan showed once a month;
    // and a paused row still counted as "active" and looked charging on Home.
    // Dated the 1st of THIS month (a past start is allowed, ST-E4), so the
    // month holds four or five of its charges whatever day the run lands on.
    final String weeklyName =
        'E2E Weekly ${DateTime.now().millisecondsSinceEpoch}';
    final DateTime firstOfMonth = DateTime(
      DateTime.now().year,
      DateTime.now().month,
    );
    int activeShown() {
      final Finder f = find.textContaining(RegExp(r'^\d+ active$'));
      expect(f, findsOneWidget, reason: 'the "N active" fact on Home');
      final String t = tester.widget<Text>(f).data!;
      return int.parse(t.split(' ').first);
    }

    await openAddFormByHand(tester, 'the WEEKLY subscription');
    await tester.enterText(find.byKey(E2EKeys.addName), weeklyName);
    await tester.enterText(find.byKey(E2EKeys.addPrice), '2.50');
    // The cadence: the dropdown reads its value ("Monthly") until changed.
    await tester.tap(find.text('Monthly').last);
    await pumpFor(tester, const Duration(seconds: 1));
    await tester.tap(find.text('Weekly').last);
    await pumpFor(tester, const Duration(seconds: 1));
    // The date: the picker's own text-entry mode, in its own locale's format.
    await tester.ensureVisible(find.byKey(E2EKeys.addRenewal));
    await tester.tap(find.byKey(E2EKeys.addRenewal));
    await pumpFor(tester, const Duration(seconds: 1));
    await tester.tap(find.byIcon(Icons.edit_outlined));
    await pumpFor(tester, const Duration(seconds: 1));
    final Finder dateField = find.descendant(
      of: find.byType(DatePickerDialog),
      matching: find.byType(TextField),
    );
    await tester.enterText(
      dateField,
      MaterialLocalizations.of(
        tester.element(dateField),
      ).formatCompactDate(firstOfMonth),
    );
    await tester.tap(
      find.descendant(
        of: find.byType(DatePickerDialog),
        matching: find.text('OK'),
      ),
    );
    await pumpFor(tester, const Duration(seconds: 1));
    await submitAddSheet(tester, 'the WEEKLY subscription');
    final int activeBefore = activeShown();

    await tester.tap(find.byIcon(Icons.calendar_month_rounded));
    await pumpFor(tester, const Duration(seconds: 2));
    expect(shellIndex(), 1);
    final Map<int, int> marks = tester
        .widget<MonthGrid>(find.byType(MonthGrid))
        .marks;
    final List<int> weeklyDays = <int>[
      for (int d = 1; d <= 31; d += 7)
        if (DateTime(firstOfMonth.year, firstOfMonth.month, d).month ==
            firstOfMonth.month)
          d,
    ];
    expect(
      weeklyDays.where((int d) => (marks[d] ?? 0) > 0).length,
      greaterThanOrEqualTo(4),
      reason:
          'the weekly plan dated the 1st must mark every one of its days this '
          'month ($weeklyDays); the grid marked ${marks.keys.toList()..sort()}',
    );
    await shot('14c-calendar-weekly');

    // Pause it from the detail's More options, and read Home again.
    await tester.tap(find.text('Home'));
    await pumpFor(tester, const Duration(seconds: 2));
    final Finder weeklyRow = find.text(weeklyName);
    await scrollUntilFound(
      tester,
      target: weeklyRow.first,
      scrollable: find.byType(Scrollable),
      what: 'the weekly subscription, on Home',
      maxScrolls: 40,
    );
    await tester.tap(weeklyRow.first);
    await pumpFor(tester, const Duration(seconds: 3));
    await tester.tap(find.byKey(E2EKeys.detailMoreOptions));
    await pumpFor(tester, const Duration(seconds: 1));
    await tester.tap(find.text('Pause'));
    await pumpFor(tester, const Duration(seconds: 2));
    // DE-09 (#1130): Pause asks once, as at 12c.
    await tester.tap(find.byKey(E2EKeys.confirmYes));
    await pumpFor(tester, const Duration(seconds: 4)); // PATCH round-trip
    await swipeAwaySnackBars(tester, 'pausing the weekly plan at 14c');
    await tester.tap(find.byKey(E2EKeys.detailBack));
    await pumpFor(tester, const Duration(seconds: 2));
    expect(shellIndex(), 0);
    expect(
      activeShown(),
      activeBefore - 1,
      reason: 'a paused plan is not "active": the count must drop by one',
    );
    await scrollUntilFound(
      tester,
      target: find.text('Other · Paused'),
      scrollable: find.byType(Scrollable),
      what: 'the paused weekly row\'s status on Home',
      maxScrolls: 40,
    );
    await shot('14c-home-paused');

    // Leave nothing behind: Delete from tracker (a soft delete).
    await tester.tap(weeklyRow.first);
    await pumpFor(tester, const Duration(seconds: 3));
    await tester.tap(find.byKey(E2EKeys.detailMoreOptions));
    await pumpFor(tester, const Duration(seconds: 1));
    await tester.tap(find.text('Delete from tracker'));
    await pumpFor(tester, const Duration(seconds: 4));
    expect(shellIndex(), 0);
    await swipeAwaySnackBars(tester, 'deleting the weekly plan at 14c');

    // ── 14d EVERY CHANGED FLOW, read back from the server (train
    // st-e2e-parity) ─────────────────────────────────────────────────────────
    // Each leg taps the real control and asserts the row, the prefs or the
    // feed the deployed Workers answer (flow_steps.dart), never presence.
    // tooling/e2e-leg-register.json `flows` anchors each one here.
    //
    // ⏱ 2026-10-02 · PARKED unless E2E_PENDING_FLOWS=run (lead ruling on
    // #1143): web E2E 36987311361 went red at the edit sheet's submit (not
    // hit-testable). Skipped and SAID, so main's nightly cannot go red on a
    // leg not yet proven; tooling/e2e-leg-register.json grades each pending.
    if (pendingFlows != 'run') {
      e2eLine(binding, kWebFlowsPendingLine);
    } else {
      // EDIT a price, read it back — on B, which survives to verify_row.
      await openRowOnHome(tester, pumpFor, subNameB);
      await editPriceAndReadBack(
        tester,
        pumpFor,
        name: subNameB,
        newPrice: '8.88',
        expectMinorUnits: 888,
      );
      // PAUSE → RESUME, each read back.
      await statusAndReadBack(
        tester,
        pumpFor,
        name: subNameB,
        action: 'Pause',
        want: SubscriptionStatus.paused,
        chip: 'Paused',
      );
      await statusAndReadBack(
        tester,
        pumpFor,
        name: subNameB,
        action: 'Resume',
        want: SubscriptionStatus.active,
      );
      await backToHome(tester, pumpFor);
      await shot('14d-edited-resumed');

      // MARK CANCELLED, then DELETE → UNDO → DELETE, on a plan of their own.
      final String flowName =
          'E2E Flow ${DateTime.now().millisecondsSinceEpoch}';
      await addPlanThroughSheet(tester, pumpFor, name: flowName, price: '3.10');
      await openRowOnHome(tester, pumpFor, flowName);
      await statusAndReadBack(
        tester,
        pumpFor,
        name: flowName,
        action: 'Mark as cancelled',
        want: SubscriptionStatus.cancelled,
        chip: 'Cancelled',
      );
      await deleteUndoThenDelete(tester, pumpFor, name: flowName);
      await backToHome(tester, pumpFor);
      await shot('14d-delete-undo');

      // SAVE A BUDGET, read it back (GET /v1/budget).
      await tester.tap(find.text('Insights'));
      await pumpFor(tester, const Duration(seconds: 2));
      await scrollUntilFound(
        tester,
        target: find.byKey(BudgetCard.editButton),
        scrollable: scrollableWithin(find.byType(InsightsScreen)),
        what: 'the Insights budget card\'s Edit',
        maxScrolls: 20,
        delta: 200,
      );
      await saveBudgetAndReadBack(
        tester,
        pumpFor,
        amount: '123',
        expectMinorUnits: 12300,
      );
      await shot('14d-budget-saved');

      // E-MAIL REMINDER PREFS PUT, then the CALENDAR FEED minted, fetched and
      // rotated — both on Settings, both read back from the platform Worker.
      await tester.tap(find.text('Settings'));
      await pumpFor(tester, const Duration(seconds: 2));
      await scrollUntilFound(
        tester,
        target: find.byKey(const Key('settings.reminder.email')),
        scrollable: scrollableWithin(find.byType(SettingsScreen)),
        what: 'the e-mail reminders switch',
        maxScrolls: 30,
        delta: 200,
      );
      await toggleEmailRemindersAndReadBack(tester, pumpFor);
      await mintFetchAndRotateCalendarFeed(tester, pumpFor);
      await shot('14d-reminders-feed');

      // EXPORT CSV: the row taps the real exporter, the browser downloads the
      // file, and tooling/e2e/verify_export_csv.mjs reads it off the runner's
      // disk after the drive — the rows the server held when it was tapped.
      final List<Subscription> exported = await serverRows(tester);
      await scrollUntilFound(
        tester,
        target: find.byKey(const Key('settings.data.export')),
        scrollable: scrollableWithin(find.byType(SettingsScreen)),
        what: 'the Export (CSV) row',
        maxScrolls: 30,
        delta: 200,
      );
      await tapWhenHittable(
        tester,
        find.byKey(const Key('settings.data.export')),
        'Export (CSV)',
        scrollable: scrollableWithin(find.byType(SettingsScreen)).first,
      );
      await pumpFor(tester, const Duration(seconds: 4));
      e2eLine(
        binding,
        'NK_E2E step=export rows=${exported.length} name=$subNameB '
        'price=8.88',
      );
      await tester.tap(find.text('Home'));
      await pumpFor(tester, const Duration(seconds: 2));
      expect(shellIndex(), 0);
    }

    // ── 15 Settings: switch currency (client-state propagation) ──────────────
    await tester.tap(find.text('Settings'));
    await pumpFor(tester, const Duration(seconds: 2));
    expect(
      shellIndex(),
      3,
    ); // ST-D3: Settings is the 4th tab (index 3); 'More' is gone
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
    await tester.tap(find.text('Settings'));
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
    // signed-out user is only left on /onboarding|/sign-in|…; /login is a
    // redirect onto /sign-in since 2026-08-10). Poll for it.
    expect(
      await waitFor(tester, find.byKey(E2EKeys.loginHeading)),
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
      find.byKey(E2EKeys.loginHeading),
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
  //                  platform_db swept, RELAY to subscriptiontracker-api's own
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
    requireDecidedExpectations();
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
    if (!await signInWithMagicToken(
      tester,
      deleteTokenHash,
      pumpFor: pumpFor,
    )) {
      await tester.enterText(find.byKey(E2EKeys.loginEmail), deleteEmail);
      await tester.enterText(find.byKey(E2EKeys.loginPassword), deletePassword);
      await pumpFor(tester, const Duration(milliseconds: 500));
      await tester.tap(find.byKey(E2EKeys.loginSubmit));
      await pumpFor(tester, const Duration(seconds: 10));
    }

    // Everything below this line goes through the deployed Workers — the
    // erasure route most of all. When they do not trust this run's issuer they
    // refuse the session, and that refusal is what this run asserts. See
    // `expectOneIssuerRefusal`.
    if (!workersTrustIssuer) {
      await expectOneIssuerRefusal(tester, '22-account-delete');
      restoreGlobals();
      return;
    }

    // The delete-leg user is a SECOND admin-API user with its own empty
    // acceptance record, so it meets the interstitial independently of whatever
    // the full-walk user accepted earlier in the same browser profile.
    //
    // Captured for the same reason as in the full-walk test: reaching this
    // screen at all is proof of a valid session, and the assertion below is
    // the one that used to guess about exactly that.
    final bool sawReacceptance = await acceptTermsIfShown(tester);

    // ST-T9 (EN-18): the delete-leg user is fresh too, so it meets the setup.
    final bool sawSetup = await walkSetupIfShown(tester, 'the delete leg');
    debugPrint('E2E delete leg: after-sign-in setup shown = $sawSetup');

    // ⏱ 2026-10-01 · IM-07: the delete leg lands on Home like the full walk;
    // see `expectLandedOnHome` for the evidence rules (2026-09-02).
    expectLandedOnHome(tester, 'the delete leg', sawReacceptance);

    // ── 18 Give the account something to lose ────────────────────────────────
    final String doomed = 'E2E Doomed ${DateTime.now().millisecondsSinceEpoch}';
    await openAddFormByHand(tester, 'the doomed subscription');
    await tester.enterText(find.byKey(E2EKeys.addName), doomed);
    await tester.enterText(find.byKey(E2EKeys.addPrice), '3.21');
    await pumpFor(tester, const Duration(milliseconds: 500));
    await submitAddSheet(tester, 'the doomed subscription');
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
    await tester.tap(find.text('Settings'));
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

    // ── 20g On a captcha-gated stack the reauth is REFUSED, and that is the pass ─
    // 🔴 MEASURED 2026-09-26, E2E live #145 (run 36220597628), the first run
    // after the switch to Box C. The dialog re-authenticates with
    // `signInWithEmail` before it deletes, which is `token?grant_type=password`
    // — Turnstile-gated on Box C — and a headless browser gets no captcha
    // token. Box C's GoTrue answered 400 `captcha_failed`, the app mapped the
    // AuthFailure to `reauthFailed` and showed "Not deleted" IN THE DIALOG, and
    // the 40s wait below for a login-screen notice expired over it. Nothing
    // reached the Worker. Sign-in moved to the ungated `/verify` for exactly
    // this reason (`signInWithMagicToken`); the delete reauth, the one other
    // gated call on the golden path, was never given an equivalent.
    //
    // So on a gated stack this leg asserts what IS true: the gate covers
    // erasure, the refusal is the provider's (`reauthFailed`, not
    // `couldNotReach`), and nothing was destroyed — the dialog says so and the
    // session is still live. The erasure itself runs after the drive, in
    // `tooling/e2e/delete_headless.mjs`: a session minted through the same
    // ungated `/verify`, sent to the same deployed DELETE /v1/account, after a
    // server-side read that this account and its row are still there. Then
    // `verify_purged.mjs` audits it exactly as it audits the in-app deletion.
    if (captchaGateOn) {
      final Finder resultTitle = find.byKey(E2EKeys.deleteAccountResultTitle);
      expect(
        await waitFor(
          tester,
          resultTitle,
          timeout: const Duration(seconds: 20),
        ),
        isTrue,
        reason:
            'E2E_EXPECT_CAPTCHA_GATE=yes and the delete dialog showed no '
            'outcome: the reauth is still in flight, or the dialog went away. '
            'On screen: ${onScreen(tester)}',
      );
      final AppLocalizations l10n = AppLocalizations.of(
        tester.element(resultTitle),
      );
      expect(
        tester.widget<Text>(resultTitle).data,
        l10n.deleteAccountResultNotDeleted,
        reason:
            'E2E_EXPECT_CAPTCHA_GATE=yes, so the password grant the reauth '
            'uses is Turnstile-gated and a headless browser has no token: the '
            'account must NOT be deletable from here. Anything but "Not '
            'deleted" means the gate did not refuse the reauth.',
      );
      expect(
        tester.widget<Text>(find.byKey(E2EKeys.deleteAccountResult)).data,
        core.AccountDeletionOutcome.reauthFailed.plainMessage,
        reason:
            'The dialog refused, but not as the auth provider refusing the '
            'reauth (`reauthFailed`). `couldNotReach` or `unknown` here is a '
            'network or client fault, not the captcha gate, and says nothing '
            'about whether the gate covers erasure.',
      );
      await shot('20-delete-reauth-refused');
      expect(
        sb.Supabase.instance.client.auth.currentSession,
        isNotNull,
        reason:
            'The refused reauth signed the user out. `reauthFailed` leaves the '
            'session untouched, because nothing was sent and nothing deleted.',
      );
      expect(
        find.byKey(E2EKeys.accountDeletionNotice),
        findsNothing,
        reason:
            'An account-deletion outcome was parked for the login screen, so '
            'the app believes a deletion request was sent past a refused '
            'reauth.',
      );
      restoreGlobals();
      return;
    }

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
          '(the subscriptiontracker-api relay or the identity delete failed) — only then are '
          'the services/platform Worker logs the place to look. `HTTP 0` is '
          'NOT proof that no request arrived: on web the Dio connectTimeout '
          'is a deadline for the FIRST RESPONSE HEADER, so a server slower '
          'than 15 s reads as `HTTP 0` while it goes on to finish. Read the '
          'platform Worker wall time for DELETE /v1/account in Cloudflare '
          'observability before blaming the client '
          '(O-ERASURE-WALK-ROUND-TRIPS, 2026-09-18). An unmodelled status or '
          'a Dart exception such as CircularDependencyError is a CLIENT '
          'defect, and the Worker logs will show no request. [ADR 027]',
    );

    // …and the user really is signed out, on the login screen, and STAYS there.
    // Same second-look as leg 2's sign-out: waitFor returns on the first
    // matching frame, which a transit frame satisfies.
    expect(find.byKey(E2EKeys.loginHeading), findsOneWidget);
    await pumpFor(tester, const Duration(seconds: 3));
    expect(
      find.byKey(E2EKeys.loginHeading),
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
    // Whether subscriptiontracker_db and the identity record are ACTUALLY empty is asserted by
    // `tooling/e2e/verify_purged.mjs` in the step after this one — server-side,
    // through the D1 HTTP API and the GoTrue admin API, with no app in the loop.
    restoreGlobals();
  });
}
