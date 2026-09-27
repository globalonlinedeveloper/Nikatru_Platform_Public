// THE STAMPED E2E SUITE — the scaffold requirement [3]S-2 owns
// (O-BRICK-STAMPS-NO-E2E-SUITE, 10b), driven by e2e.yml with
// `test_driver/integration_test.dart` and `--dart-define=E2E_APP_ID=<this app>`.
//
// [3]S-2, as the requirements ledger records it: the stamp wires "consent UI +
// analytics rail · lifecycle events post-consent · telemetry · money surfaces
// (S-2 wires, stage 5 owns the rail) · E2E scaffold (S-2 wires, [9]R-1 owns the
// workflow) · base content-pack wiring". This suite drives the ones a fresh app
// can show on its own screens, in one launch:
//
//   · the E2E scaffold — the lane's app id is this app's, and the launch path
//     reaches the sign-in screen;
//   · the auth wiring the other flows stand on — the throwaway account signs in
//     and lands on Home;
//   · money surfaces — `/paywall` renders the rail's screen.
//
// NOT stamped (FINDINGS, each with what it would need): the consent record and
// the analytics rail behind it, lifecycle events after consent, telemetry and the
// content pack are proven by READING THE BACKEND after the run — app #1's suite
// does it with the host's tooling (`tooling/e2e/*`) and its own keys. A fresh
// app has neither, and a flow that cannot be observed here is listed, never
// faked.
//
// ⚠️ ANALYZED, NOT RUN. The first proof is the first e2e run with two legs.
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:integration_test/integration_test.dart';
import 'package:nikatru_chassis_screens/auth/sign_in_screen.dart';
import 'package:{{app_id.snakeCase()}}/core/app_config.dart';
import 'package:{{app_id.snakeCase()}}/features/home/home_screen.dart';
import 'package:{{app_id.snakeCase()}}/features/monetization/paywall_screen.dart';
import 'package:{{app_id.snakeCase()}}/main.dart' as app;

/// Pumps frames for [d] without waiting for the tree to settle: a live app
/// animates, and `pumpAndSettle` would time out on it.
Future<void> pumpFor(WidgetTester tester, Duration d) async {
  final DateTime end = DateTime.now().add(d);
  while (DateTime.now().isBefore(end)) {
    await tester.pump(const Duration(milliseconds: 100));
  }
}

void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();

  testWidgets('launch, sign in, Home, and the paywall of THIS app', (
    WidgetTester tester,
  ) async {
    // ── the E2E scaffold: the lane names this app ───────────────────────────
    const String e2eAppId = String.fromEnvironment('E2E_APP_ID');
    expect(
      e2eAppId.replaceAll('-', '_'),
      AppConfig.appId,
      reason:
          'E2E_APP_ID is "$e2eAppId" and this binary is ${AppConfig.appId}: '
          'the e2e lane drove the wrong app, or passed no app at all.',
    );
    const String email = String.fromEnvironment('E2E_EMAIL');
    const String password = String.fromEnvironment('E2E_PASSWORD');
    expect(
      email.isNotEmpty && password.isNotEmpty,
      isTrue,
      reason: 'E2E_EMAIL / E2E_PASSWORD are not defined by the lane.',
    );

    // ── the launch path reaches sign-in ─────────────────────────────────────
    await app.main();
    await pumpFor(tester, const Duration(seconds: 3));
    expect(find.byKey(SignInView.emailField), findsOneWidget);

    // ── the auth wiring: the throwaway account signs in and lands on Home ───
    await tester.enterText(find.byKey(SignInView.emailField), email);
    await tester.enterText(find.byKey(SignInView.passwordField), password);
    await tester.tap(find.byKey(SignInView.submitButton));
    await pumpFor(tester, const Duration(seconds: 5));
    expect(find.byType(HomeScreen), findsWidgets);

    // ── money surfaces: the paywall renders the rail's screen ───────────────
    GoRouter.of(tester.element(find.byType(HomeScreen).first)).go('/paywall');
    await pumpFor(tester, const Duration(seconds: 3));
    expect(find.byType(PaywallScreen), findsWidgets);
  });
}
