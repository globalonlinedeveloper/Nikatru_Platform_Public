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

import 'package:flutter/gestures.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';

import 'package:subly/core/e2e_keys.dart';
import 'package:subly/features/budget/budget_screen.dart';
import 'package:subly/features/calendar/calendar_screen.dart';
import 'package:subly/features/home/home_screen.dart';
import 'package:subly/features/insights/insights_screen.dart';
import 'package:subly/features/settings/settings_screen.dart';
import 'package:subly/features/shell/app_shell.dart';
import 'package:subly/main.dart' as app;

void main() {
  final IntegrationTestWidgetsFlutterBinding binding =
      IntegrationTestWidgetsFlutterBinding.ensureInitialized();

  const String email = String.fromEnvironment('E2E_EMAIL');
  const String password = String.fromEnvironment('E2E_PASSWORD');

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

  // The app animates forever in places (scan progress ring/timer, loaders), so
  // pumpAndSettle() would hang. Advance a fixed wall-clock slice instead — this
  // still lets real network futures resolve on the live binding.
  Future<void> pumpFor(WidgetTester tester, Duration total) async {
    final DateTime end = DateTime.now().add(total);
    while (DateTime.now().isBefore(end)) {
      await tester.pump(const Duration(milliseconds: 100));
    }
  }

  // Poll for a finder to appear — SnackBars auto-dismiss at 4s, so we assert
  // the instant one shows instead of racing its timeout with a fixed pump.
  Future<bool> waitFor(
    WidgetTester tester,
    Finder f, {
    Duration timeout = const Duration(seconds: 12),
  }) async {
    final DateTime end = DateTime.now().add(timeout);
    while (DateTime.now().isBefore(end)) {
      await tester.pump(const Duration(milliseconds: 200));
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
    final DateTime end = DateTime.now().add(timeout);
    while (DateTime.now().isBefore(end)) {
      await tester.pump(const Duration(milliseconds: 200));
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
  /// 🔬 WHAT HAPPENED, 2026-08-03 → 2026-08-04. `app_shell.dart` draws the
  /// navigation bar as a FLOATING `Positioned` inside a `Stack`, over the branch
  /// content — so the bottom ~86px of every scroll view is inside the viewport
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
  /// So: keep scrolling while the control is occluded, and if it can never be
  /// reached, SAY WHAT IS ON TOP OF IT rather than blaming the button.
  Future<void> tapWhenHittable(
    WidgetTester tester,
    Finder finder,
    String what, {
    Finder? scrollable,
  }) async {
    List<String> occluders() {
      if (finder.evaluate().isEmpty) {
        return <String>['(the control is not in the tree)'];
      }
      final HitTestResult result = HitTestResult();
      WidgetsBinding.instance.hitTestInView(
        result,
        tester.getCenter(finder),
        tester.view.viewId,
      );
      return result.path
          .map((HitTestEntry e) => e.target.runtimeType.toString())
          .take(6)
          .toList();
    }

    bool reaches() {
      if (finder.evaluate().isEmpty) return false;
      final RenderObject target = tester.renderObject(finder);
      final HitTestResult result = HitTestResult();
      WidgetsBinding.instance.hitTestInView(
        result,
        tester.getCenter(finder),
        tester.view.viewId,
      );
      return result.path.any((HitTestEntry e) => identical(e.target, target));
    }

    // A control resting under the floating bar only needs the list driven a
    // little further — the scroll views carry enough bottom padding (108px on
    // Settings) to clear it, so this terminates on a real layout.
    if (!reaches() && scrollable != null) {
      for (int i = 0; i < 15 && !reaches(); i++) {
        await tester.drag(scrollable, const Offset(0, -120));
        await pumpFor(tester, const Duration(milliseconds: 250));
      }
    }

    expect(
      reaches(),
      isTrue,
      reason:
          'A tap aimed at "$what" would NOT reach it — something is drawn on '
          'top of its centre point, and the tap would go there instead, '
          'silently. At that point the hit test finds: ${occluders().join(' → ')}. '
          'The usual cause is the floating navigation bar or FAB in '
          'app_shell.dart: they are Positioned siblings ABOVE the branch '
          'content in a Stack, so the bottom ~86px of any scroll view is inside '
          'the viewport but not tappable.',
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

  /// 🔴 THE FAILURE THIS SUITE MUST NAME OUT LOUD.
  ///
  /// A modal route installs a `ModalBarrier` over everything below it, so a
  /// `tester.tap()` aimed at a widget behind it hits the barrier and SILENTLY
  /// DOES NOTHING — no exception, no warning. The test then fails several lines
  /// later on whatever the tap was supposed to produce, naming the wrong thing.
  ///
  /// That is exactly how the nightly died for six consecutive nights from
  /// 2026-07-27: the DPDP consent dialog (added 2026-07-26, `ConsentGate`) came
  /// up over onboarding, `tap('Skip')` was swallowed, and both tests reported
  /// `Found 0 widgets with text "Welcome back"` — a login-screen error for a
  /// dialog problem. Assert the absence of the modal HERE, where the message can
  /// say what is actually wrong.
  void expectNothingCoveringTheApp(String where) {
    expect(
      find.byType(Dialog),
      findsNothing,
      reason:
          'A modal dialog is on screen at $where. Its barrier swallows every '
          'tap aimed at the app beneath it — silently — so the next failure '
          'would blame whatever that tap was meant to do. If a new first-run '
          'modal was added to the app, this suite has to answer it (see '
          'answerConsentIfPrompted).',
    );
  }

  /// Answers the DPDP analytics-consent dialog if it is up, and reports whether
  /// it was.
  ///
  /// The prompt opens over whatever screen is showing the first time a LIVE
  /// build launches with no decision on disk — which is precisely this suite,
  /// and only this suite: `ConsentGate` keys off `backendLiveProvider`, so no
  /// demo build and no widget test ever takes this branch.
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
    final Finder dialog = find.byType(Dialog);
    if (!await waitFor(tester, dialog, timeout: timeout)) return false;
    expect(
      find.text('No thanks'),
      findsOneWidget,
      reason:
          'A modal came up on first launch but it is not the consent prompt — '
          'this suite only knows how to answer that one.',
    );
    await shot('00-consent');
    await tester.tap(find.text('No thanks'));
    expect(
      await waitGone(tester, dialog),
      isTrue,
      reason: 'The consent dialog did not close after "No thanks" was tapped',
    );
    return true;
  }

  testWidgets('login rejects empty + invalid credentials with clear messages', (
    WidgetTester tester,
  ) async {
    await app.main();
    await pumpFor(tester, const Duration(seconds: 3));

    // First launch of the run: the consent gate MUST ask. If this ever goes
    // false the DPDP prompt has stopped appearing and the analytics rail is
    // silently fail-closed again — the defect ConsentGate was built to fix, and
    // one that no other test in the tree can see (see assert-seams-wired.mjs).
    expect(
      await answerConsentIfPrompted(tester),
      isTrue,
      reason:
          'The analytics-consent prompt never appeared on a fresh live launch. '
          'ConsentGate is the on-switch for the whole analytics rail; without '
          'the dialog the recorder stays fail-closed and discards every event, '
          'and nothing else in the suite would notice.',
    );

    expectNothingCoveringTheApp('the onboarding screen');
    await tester.tap(find.text('Skip'));
    await pumpFor(tester, const Duration(seconds: 2));
    expect(find.text('Welcome back'), findsOneWidget);

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
    await app.main();
    await pumpFor(tester, const Duration(seconds: 3));

    // The first test already answered consent and the decision is persisted, so
    // this normally finds nothing. Called anyway so that reordering the tests,
    // or a store that failed to write, cannot wedge the run behind a modal
    // barrier; the assertion that the gate still ASKS lives in the first test,
    // which is the only one that launches with an undecided store.
    await answerConsentIfPrompted(tester, timeout: const Duration(seconds: 4));

    // ── 01 Onboarding ────────────────────────────────────────────────────────
    expectNothingCoveringTheApp('the onboarding screen');
    expect(
      find.text('Skip'),
      findsOneWidget,
      reason: 'App did not land on the onboarding screen',
    );
    await shot('01-onboarding');
    await tester.tap(find.text('Skip'));
    await pumpFor(tester, const Duration(seconds: 2));

    // ── 02 Login ─────────────────────────────────────────────────────────────
    expect(find.text('Welcome back'), findsOneWidget);
    await shot('02-login');
    await tester.enterText(find.byKey(E2EKeys.loginEmail), email);
    await tester.enterText(find.byKey(E2EKeys.loginPassword), password);
    await pumpFor(tester, const Duration(milliseconds: 500));
    await tester.tap(find.byKey(E2EKeys.loginSubmit));
    // GoTrue sign-in + navigation to /scan.
    await pumpFor(tester, const Duration(seconds: 10));

    // ── 03 Scan ──────────────────────────────────────────────────────────────
    await shot('03-scan');
    expect(
      find.text('Go to dashboard'),
      findsOneWidget,
      reason:
          'Scan never finished — sign-in likely failed (bad/unconfirmed '
          'credentials or backend down)',
    );
    await tester.tap(find.text('Go to dashboard'));
    await pumpFor(tester, const Duration(seconds: 4));

    // ── 04 Home ──────────────────────────────────────────────────────────────
    expect(find.byType(AppShell), findsOneWidget);
    expect(find.byType(HomeScreen), findsWidgets);
    expect(shellIndex(), 0);
    await shot('04-home');

    // ── 05 Calendar ──────────────────────────────────────────────────────────
    await tester.tap(find.text('Calendar'));
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
    await tester.scrollUntilVisible(
      subFinder.first,
      160,
      scrollable: find.byType(Scrollable).first,
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
    await tester.scrollUntilVisible(
      find.text('Cancel plan'),
      200,
      scrollable: find.byType(Scrollable).first,
      maxScrolls: 20,
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
    await tester.scrollUntilVisible(
      subFinderB.first,
      160,
      scrollable: find.byType(Scrollable).first,
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
    await tester.scrollUntilVisible(
      find.text('Log out'),
      200,
      scrollable: find.byType(Scrollable).first,
      maxScrolls: 20,
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
      scrollable: find.byType(Scrollable).first,
    );
    await pumpFor(tester, const Duration(seconds: 3));
    await shot('17b-after-logout-tap');
    // signOut() is an async round-trip to Supabase; the router then refreshes
    // and redirects. A signed-out user on a non-auth route (/settings) lands on
    // /login — NOT first-run onboarding — per the core/router.dart redirect (a
    // signed-out user is only left on /onboarding|/login|/scan). Poll for it.
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
    // /login, and `/onboarding` is inside the router's `authFlow` allowlist so
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

    // ── Boot + sign in as the sacrificial user ───────────────────────────────
    await app.main();
    await pumpFor(tester, const Duration(seconds: 3));
    // Consent was answered and persisted by the first test; called anyway so a
    // cleared store cannot wedge this run behind a modal barrier.
    await answerConsentIfPrompted(tester, timeout: const Duration(seconds: 4));

    expectNothingCoveringTheApp('the onboarding screen');
    await tester.tap(find.text('Skip'));
    await pumpFor(tester, const Duration(seconds: 2));

    expect(find.text('Welcome back'), findsOneWidget);
    await tester.enterText(find.byKey(E2EKeys.loginEmail), deleteEmail);
    await tester.enterText(find.byKey(E2EKeys.loginPassword), deletePassword);
    await pumpFor(tester, const Duration(milliseconds: 500));
    await tester.tap(find.byKey(E2EKeys.loginSubmit));
    await pumpFor(tester, const Duration(seconds: 10));

    expect(
      find.text('Go to dashboard'),
      findsOneWidget,
      reason:
          'Scan never finished for the delete-leg user — sign-in likely failed. '
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
    await tester.scrollUntilVisible(
      doomedFinder.first,
      160,
      scrollable: find.byType(Scrollable).first,
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
    await tester.scrollUntilVisible(
      deleteButton,
      200,
      scrollable: find.byType(Scrollable).first,
      maxScrolls: 25,
    );
    await shot('19a-delete-control');
    // The floating navigation bar in app_shell.dart sits OVER the bottom ~86px
    // of this scroll view, and "Delete account" is the last control in it — the
    // exact geometry that swallowed two nights of "Log out" taps. Never a bare
    // tester.tap() here.
    await tapWhenHittable(
      tester,
      deleteButton,
      'Delete account',
      scrollable: find.byType(Scrollable).first,
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
          'The app did NOT report the account as gone. Its own words: '
          '"${noticeText()}". A "Not deleted" here means the deployed erasure '
          'route refused (501 = unconfigured/no APP_ERASURE_ENDPOINTS, 502 = '
          'the subly-api relay or the identity delete failed) — check the '
          'services/platform Worker logs for this run, not this test.',
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
  });
}
