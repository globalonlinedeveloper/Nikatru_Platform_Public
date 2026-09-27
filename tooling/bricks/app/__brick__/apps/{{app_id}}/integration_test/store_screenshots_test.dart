// THE STORE BOARDS OF A STAMPED APP — stamped by the app brick
// (O-SCREENSHOT-DRIVER-IS-ONE-APPS, 10b).
//
// The capture lane (.github/workflows/store-screenshots.yml, dispatched per app)
// drives this file with `test_driver/store_screenshots.dart`, and
// tooling/store/capture-precheck.mjs refuses a lane pointed at an app without
// both. One board per brick screen a listing shows, from the brick's router
// (lib/core/router.dart):
//
//   01-home     `/`         HomeScreen
//   02-explore  `/explore`  ExploreScreen
//   03-paywall  `/paywall`  PaywallScreen
//
// NOT photographed, each for a reason a guard holds: SettingsScreen reads the
// signed-in address (`.email`), and tooling/store/capture-suite-scan.mjs fails a
// frame whose screen source does; ManagePlanScreen is one account's
// cancellation screen; the auth and first-run screens show no product.
//
// Every frame goes through `captureFrame` (store_capture_guard.dart), which
// refuses a frame showing the signed-in account, with the ONE shutter bound
// below (`storeShutter(`, store_frame_shutter.dart). The screen each frame
// photographs is asserted with `find.byType` on the line above it: that is how
// the static scan resolves a frame to its source.
//
// ⚠️ ANALYZED, NOT RUN. This suite has been compiled, never driven on a device
// or a browser. The first proof is this app's first `dry_run: true` capture.
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:integration_test/integration_test.dart';
import 'package:nikatru_chassis_screens/auth/sign_in_screen.dart';
import 'package:{{app_id.snakeCase()}}/features/home/home_screen.dart';
import 'package:{{app_id.snakeCase()}}/features/monetization/paywall_screen.dart';
import 'package:{{app_id.snakeCase()}}/main.dart' as app;

import 'store_capture_guard.dart';
import 'store_frame_shutter.dart';

/// Pumps frames for [d] without waiting for the tree to settle: a live app
/// animates, and `pumpAndSettle` would time out on it.
Future<void> pumpFor(WidgetTester tester, Duration d) async {
  final DateTime end = DateTime.now().add(d);
  while (DateTime.now().isBefore(end)) {
    await tester.pump(const Duration(milliseconds: 100));
  }
}

void main() {
  final IntegrationTestWidgetsFlutterBinding binding =
      IntegrationTestWidgetsFlutterBinding.ensureInitialized();

  testWidgets('captures the store boards', (WidgetTester tester) async {
    // The lane provisions a throwaway, pre-confirmed account and passes it in.
    const String email = String.fromEnvironment('E2E_EMAIL');
    const String password = String.fromEnvironment('E2E_PASSWORD');
    expect(
      email.isNotEmpty && password.isNotEmpty,
      isTrue,
      reason:
          'E2E_EMAIL and E2E_PASSWORD are not defined: the capture lane passes '
          'the throwaway account it provisioned, and a capture signed in as '
          'nobody has no identity to keep off the frames.',
    );

    // One shutter for every frame: the plugin on web, android and iOS; the
    // root layer at the imposed geometry on the desktops.
    final StoreShutterKind kind = currentStoreShutterKind();
    StoreViewGeometry? geometry;
    if (kind == StoreShutterKind.layer) {
      geometry = StoreViewGeometry.parse(
        const String.fromEnvironment('STORE_CAPTURE_VIEW'),
      );
      imposeStoreGeometry(tester, geometry);
    }
    final StoreShutter shutter = storeShutter(
      tester: tester,
      sink: BindingScreenshotSink(binding),
      kind: kind,
      geometry: geometry,
    );

    await app.main();
    await pumpFor(tester, const Duration(seconds: 3));

    // Signed out, the router sends every location to `/sign-in`.
    await tester.enterText(find.byKey(SignInView.emailField), email);
    await tester.enterText(find.byKey(SignInView.passwordField), password);
    await tester.tap(find.byKey(SignInView.submitButton));
    await pumpFor(tester, const Duration(seconds: 5));

    final Set<String> forbidden = accountIdentityNeedles(signedInWith: email);

    // ── the set, in listing order ──────────────────────────────────────────
    expect(find.byType(HomeScreen), findsWidgets);
    await captureFrame(take: shutter, frame: '01-home', forbidden: forbidden);

    await tester.tap(find.byIcon(Icons.explore_outlined).first);
    await pumpFor(tester, const Duration(seconds: 3));
    expect(find.byType(ExploreScreen), findsWidgets);
    await captureFrame(
      take: shutter,
      frame: '02-explore',
      forbidden: forbidden,
    );

    GoRouter.of(tester.element(find.byType(ExploreScreen).first))
        .go('/paywall');
    await pumpFor(tester, const Duration(seconds: 3));
    expect(find.byType(PaywallScreen), findsWidgets);
    await captureFrame(
      take: shutter,
      frame: '03-paywall',
      forbidden: forbidden,
    );
  });
}
