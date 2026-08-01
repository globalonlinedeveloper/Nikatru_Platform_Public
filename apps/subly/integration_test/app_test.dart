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
    await tester.tap(find.text('Log out'));
    // signOut() is an async round-trip to Supabase; the router then refreshes
    // and redirects. A signed-out user on a non-auth route (/settings) lands on
    // /login — NOT first-run onboarding — per the app_router redirect (a
    // signed-out user is only left on /onboarding|/login|/scan). Poll for it.
    expect(
      await waitFor(tester, find.text('Welcome back')),
      isTrue,
      reason: 'Sign-out did not return to the login screen',
    );
    await shot('17-signed-out');
  });
}
