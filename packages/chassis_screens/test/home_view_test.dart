import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:nikatru_chassis_screens/home/home_screen.dart';

import 'support/width_harness.dart';

/// `WelcomeView` and `CatchUpBannerView` — the two home bodies [ADR 067]
/// decision 2 moved out of the brick's `lib/features/home/home_screen.dart`.
///
/// 🏗️ The widget half only. WHEN the banner shows (the capability read, the
/// opt-out, the due/not-due boundary) and WHAT dismissing records stay in the
/// brick adapter `CatchUpNudgeBanner`, and the brick's
/// `chassis_properties_test.dart` still drives them through the stamped root.
void main() {
  const Gradient brand = LinearGradient(
    colors: <Color>[Color(0xFF000000), Color(0xFFFFFFFF)],
  );

  Widget welcome() => const WelcomeView(appName: 'Acme', brandGradient: brand);

  Widget banner({VoidCallback? onDismiss}) => Scaffold(
        body: Column(
          children: <Widget>[
            CatchUpBannerView(onDismiss: onDismiss ?? () {}),
          ],
        ),
      );

  // ── (1) THE WELCOME BODY, AT ALL THREE WINDOW CLASSES ─────────────────────
  //
  // It sits in `Expanded` under the banner and the promo card, so it must lay
  // out without overflow at every class; a flutter_test overflow is an
  // exception, and `pumpChassis` surfaces it as a failure.
  group('home: the welcome body lays out at every window class', () {
    testWidgets('kPhone', (WidgetTester tester) async {
      await pumpChassis(tester, kPhone, Scaffold(body: welcome()));
      expect(find.byType(WelcomeView), findsOneWidget);
      expect(find.textContaining('Acme'), findsOneWidget);
    });

    testWidgets('kTablet', (WidgetTester tester) async {
      await pumpChassis(tester, kTablet, Scaffold(body: welcome()));
      expect(find.byType(WelcomeView), findsOneWidget);
    });

    testWidgets('kDesktop', (WidgetTester tester) async {
      await pumpChassis(tester, kDesktop, Scaffold(body: welcome()));
      expect(find.byType(WelcomeView), findsOneWidget);
    });
  });

  // ── (2) THE BRAND MARK PAINTS WHAT IT IS GIVEN ────────────────────────────
  //
  // The adapter reads the token; this view must not substitute its own.
  testWidgets('home: the welcome mark paints the gradient it was given',
      (WidgetTester tester) async {
    await pumpChassis(tester, kPhone, Scaffold(body: welcome()));
    final Iterable<Container> marks = tester
        .widgetList<Container>(find.byType(Container))
        .where((Container c) =>
            c.decoration is BoxDecoration &&
            (c.decoration! as BoxDecoration).gradient == brand);
    expect(marks, hasLength(1));
  });

  // ── (3) THE CATCH-UP BANNER, AT ALL THREE WINDOW CLASSES ──────────────────
  group('home: the catch-up banner lays out at every window class', () {
    testWidgets('kPhone', (WidgetTester tester) async {
      await pumpChassis(tester, kPhone, banner());
      expect(find.byType(MaterialBanner), findsOneWidget);
    });

    testWidgets('kTablet', (WidgetTester tester) async {
      await pumpChassis(tester, kTablet, banner());
      expect(find.byType(MaterialBanner), findsOneWidget);
    });

    testWidgets('kDesktop', (WidgetTester tester) async {
      await pumpChassis(tester, kDesktop, banner());
      expect(find.byType(MaterialBanner), findsOneWidget);
    });
  });

  // ── (4) DISMISSING IS HANDED BACK, ONCE ───────────────────────────────────
  //
  // Recording the impression is the adapter's (`markShown`); the view's whole
  // job is to call back exactly once per tap.
  testWidgets('home: dismissing the banner calls back once',
      (WidgetTester tester) async {
    int dismissed = 0;
    await pumpChassis(tester, kPhone, banner(onDismiss: () => dismissed++));
    await tester.tap(find.byKey(CatchUpBannerView.dismissButton));
    await tester.pump();
    expect(dismissed, 1);
  });
}
