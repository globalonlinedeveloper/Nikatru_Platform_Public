// ─────────────────────────────────────────────────────────────────────────────
// RESPONSIVE WIDTH — the three screens that had NO width decision at all.
//
// Onboarding was `Padding(symmetric horizontal: 32)`; settings and manage-plan
// were a bare `Scaffold` + `ListView`. None of the three overflowed, none of
// them clipped, and none of them failed a single existing assertion — because
// "the content grew to fill a 1920 px display" is a defect with no exception,
// no red pixel and no error line. It is only visible to a MEASUREMENT, which is
// what this file is.
//
// 📐 THE RIG LIVES IN `test/support/width_harness.dart`, and its header is the
// primary record for the three rules every case here obeys: the assertion is on
// incoming `constraints`, never on `size` (a shrink-wrapping `Column` would make
// a size assertion pass with the cap deleted); every case PINS the surface,
// because flutter_test's default 800×600 resolves to a rail nobody asked about;
// and the distinguishing surface for a `kMaxBodyWidth` screen is 1920, not 1280
// — at 1280 the assertion is true whether or not the pane is there.
// ─────────────────────────────────────────────────────────────────────────────
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:nikatru_design_system/nikatru_design_system.dart';
import 'package:subly/features/firstrun/onboarding_screen.dart';
import 'package:subly/features/monetization/manage_plan_screen.dart';
import 'package:subly/features/settings/settings_screen.dart';

import 'support/width_harness.dart';

void main() {
  // ── ONBOARDING · ContentPane.reading (720) ─────────────────────────────────
  //
  // The cap that can fail at 1280 without any help: 720 < 1280, so the ordinary
  // desktop window is already a distinguishing surface for this screen.
  group('onboarding is capped at reading width', () {
    testWidgets('at 375 the cap is a no-op and nothing overflows', (
      WidgetTester tester,
    ) async {
      await pumpAt(tester, kPhone, const OnboardingScreen());
      expect(
        offeredWidth(tester, inPane(Column)),
        375 - 64,
        reason:
            'below the cap a ConstrainedBox may only tighten within what it '
            'was handed, so a phone must render exactly as it did before the '
            'pane existed — 375 less the 32/32 gutters that were already there',
      );
      expect(
        tester.takeException(),
        isNull,
        reason: 'the carousel must lay out clean on the narrowest phone',
      );
    });

    // ⚠️ 768 IS ALREADY PAST THE CAP, and that asymmetry with the two
    // `ListView` screens below is the substance of choosing `.reading` here
    // rather than the default. 720 < 768, so a small tablet is the FIRST of
    // these three widths at which this screen stops growing — prose runs out of
    // useful line length long before a page runs out of useful width. Writing
    // `768 - 64` here (as the phone case writes `375 - 64`) is the mistake this
    // comment exists to stop the next reader from re-making.
    testWidgets('at 768 the reading cap has ALREADY engaged', (
      WidgetTester tester,
    ) async {
      await pumpAt(tester, kTablet, const OnboardingScreen());
      expect(
        offeredWidth(tester, inPane(Column)),
        AppBreakpoints.reading - 64,
        reason:
            'a tablet is wider than 720, so the pane is doing its job here '
            'already — the 32/32 gutters then come out of the cap, not out of '
            'the surface',
      );
    });

    testWidgets('at 1280 the body is capped at AppBreakpoints.reading', (
      WidgetTester tester,
    ) async {
      await pumpAt(tester, kDesktop, const OnboardingScreen());
      expect(
        offeredWidth(tester, inPane(Column)),
        lessThanOrEqualTo(AppBreakpoints.reading),
        reason:
            'unconstrained this ran 1216 px lines — roughly 200 characters, '
            'against the 45–75 the eye can track. AppBreakpoints.reading is '
            'the constant that says "this is prose"',
      );
      expect(AppBreakpoints.reading, 720);
    });
  });

  // ── SETTINGS · ContentPane (kMaxBodyWidth, 1280) ───────────────────────────
  group('settings is capped at the body width', () {
    testWidgets('at 375 the cap is a no-op and nothing overflows', (
      WidgetTester tester,
    ) async {
      await pumpAt(tester, kPhone, const SettingsScreen());
      expect(offeredWidth(tester, inPane(ListView)), 375);
      expect(tester.takeException(), isNull);
    });

    testWidgets('at 768 the cap is still a no-op', (WidgetTester tester) async {
      await pumpAt(tester, kTablet, const SettingsScreen());
      expect(offeredWidth(tester, inPane(ListView)), 768);
    });

    testWidgets('at 1280 the list is at the cap', (WidgetTester tester) async {
      await pumpAt(tester, kDesktop, const SettingsScreen());
      expect(
        offeredWidth(tester, inPane(ListView)),
        lessThanOrEqualTo(AppBreakpoints.kMaxBodyWidth),
      );
    });

    // 🔴 THE CASE THAT CAN ACTUALLY GO RED — see the harness header.
    testWidgets('at 1920 the list stops at AppBreakpoints.kMaxBodyWidth', (
      WidgetTester tester,
    ) async {
      await pumpAt(tester, kWide, const SettingsScreen());
      expect(
        offeredWidth(tester, inPane(ListView)),
        AppBreakpoints.kMaxBodyWidth,
        reason:
            'without the pane every ListTile here stretches the full display: '
            'the leading icon at one edge, the trailing chevron at the other, '
            'and the eye travelling between them for every row',
      );
    });
  });

  // ── MANAGE PLAN · ContentPane (kMaxBodyWidth, 1280) ───────────────────────
  group('manage-plan is capped at the body width', () {
    testWidgets('at 375 the cap is a no-op and nothing overflows', (
      WidgetTester tester,
    ) async {
      await pumpAt(tester, kPhone, const ManagePlanScreen());
      expect(offeredWidth(tester, inPane(ListView)), 375);
      expect(tester.takeException(), isNull);
    });

    testWidgets('at 768 the cap is still a no-op', (WidgetTester tester) async {
      await pumpAt(tester, kTablet, const ManagePlanScreen());
      expect(offeredWidth(tester, inPane(ListView)), 768);
    });

    testWidgets('at 1280 the list is at the cap', (WidgetTester tester) async {
      await pumpAt(tester, kDesktop, const ManagePlanScreen());
      expect(
        offeredWidth(tester, inPane(ListView)),
        lessThanOrEqualTo(AppBreakpoints.kMaxBodyWidth),
      );
    });

    testWidgets('at 1920 the list stops at AppBreakpoints.kMaxBodyWidth', (
      WidgetTester tester,
    ) async {
      await pumpAt(tester, kWide, const ManagePlanScreen());
      expect(
        offeredWidth(tester, inPane(ListView)),
        AppBreakpoints.kMaxBodyWidth,
        reason:
            'the screen whose entire job is "cancelling must be no harder than '
            'subscribing" had its cancel row spread across the whole display',
      );
    });
  });
}
