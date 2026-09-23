import 'package:flutter/material.dart';
import 'package:flutter/semantics.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:nikatru_chassis_screens/home/home_screen.dart';

import 'support/a11y_harness.dart';
import 'support/width_harness.dart';

/// A11Y — THE TWO HOME BODIES [ADR 067] decision 2 moved out of the brick.
///
/// `WelcomeView` is what a fresh stamp shows its first user, and
/// `CatchUpBannerView` is the nudge above it, so both are on the most-reached
/// screen every stamped app has. They arrived (O-CHASSIS-PHASE-2B, 2026-09-22)
/// with a width suite (`home_view_test.dart`) and no sweep, which left this
/// root — swept end to end since 2026-09-07 — with an owed list for the first
/// time. These cases close it. See `a11y_auth_test.dart`'s header for what each
/// guideline asserts and why.
///
/// The subject counts are MEASURED off this rig, not predicted: the welcome
/// body has no control at all, so its sweep is a CONTRAST sweep over its two
/// lines, and `tappable: 0` records that rather than hiding it.
///
/// 🔴 EACH BODY IS CONSTRUCTED INSIDE ITS OWN `testWidgets` BLOCK, never in a
/// helper above them. `assert-a11y-coverage.mjs` credits a sweep to a surface
/// only when the block that sweeps also CONSTRUCTS it; a shared `welcome()`
/// builder made all four cases read as sweeps of nothing (2026-09-23).
void main() {
  const Gradient brand = LinearGradient(
    colors: <Color>[Color(0xFF000000), Color(0xFFFFFFFF)],
  );

  // ── WelcomeView ───────────────────────────────────────────────────────────
  group('a11y: home-welcome', () {
    testWidgets('light, kPhone', (WidgetTester tester) async {
      final SemanticsHandle handle = tester.ensureSemantics();
      try {
        await pumpForA11y(
          tester,
          kPhone,
          const Scaffold(
            body: WelcomeView(appName: 'Probe', brandGradient: brand),
          ),
        );
        expectSweepHadSubjects(
          tester,
          'home-welcome',
          tappable: 0,
          labelled: 2,
        );
        await expectLater(tester, meetsGuideline(androidTapTargetGuideline));
        await expectLater(tester, meetsGuideline(labeledTapTargetGuideline));
        await expectLater(tester, meetsGuideline(textContrastGuideline));
      } finally {
        handle.dispose();
      }
    });

    testWidgets('dark, kDesktop', (WidgetTester tester) async {
      final SemanticsHandle handle = tester.ensureSemantics();
      try {
        await pumpForA11y(
          tester,
          kDesktop,
          const Scaffold(
            body: WelcomeView(appName: 'Probe', brandGradient: brand),
          ),
          brightness: Brightness.dark,
        );
        expectSweepHadSubjects(
          tester,
          'home-welcome (dark, kDesktop)',
          tappable: 0,
          labelled: 2,
        );
        await expectLater(tester, meetsGuideline(androidTapTargetGuideline));
        await expectLater(tester, meetsGuideline(labeledTapTargetGuideline));
        await expectLater(tester, meetsGuideline(textContrastGuideline));
      } finally {
        handle.dispose();
      }
    });
  });

  // ── CatchUpBannerView ─────────────────────────────────────────────────────
  group('a11y: home-catch-up-banner', () {
    testWidgets('light, kPhone — the dismiss control is sized and named', (
      WidgetTester tester,
    ) async {
      final SemanticsHandle handle = tester.ensureSemantics();
      try {
        await pumpForA11y(
          tester,
          kPhone,
          Scaffold(
            body: Column(
              children: <Widget>[CatchUpBannerView(onDismiss: () {})],
            ),
          ),
        );
        expectSweepHadSubjects(
          tester,
          'home-catch-up-banner',
          tappable: 1,
          labelled: 3,
        );
        await expectLater(tester, meetsGuideline(androidTapTargetGuideline));
        await expectLater(tester, meetsGuideline(labeledTapTargetGuideline));
        await expectLater(tester, meetsGuideline(textContrastGuideline));
      } finally {
        handle.dispose();
      }
    });

    testWidgets('dark, kDesktop', (WidgetTester tester) async {
      final SemanticsHandle handle = tester.ensureSemantics();
      try {
        await pumpForA11y(
          tester,
          kDesktop,
          Scaffold(
            body: Column(
              children: <Widget>[CatchUpBannerView(onDismiss: () {})],
            ),
          ),
          brightness: Brightness.dark,
        );
        expectSweepHadSubjects(
          tester,
          'home-catch-up-banner (dark, kDesktop)',
          tappable: 1,
          labelled: 3,
        );
        await expectLater(tester, meetsGuideline(androidTapTargetGuideline));
        await expectLater(tester, meetsGuideline(labeledTapTargetGuideline));
        await expectLater(tester, meetsGuideline(textContrastGuideline));
      } finally {
        handle.dispose();
      }
    });
  });
}
