// ─────────────────────────────────────────────────────────────────────────────
// RESPONSIVE WIDTH — the `kMaxBodyWidth` screens that had NO width decision.
//
// Settings and manage-plan were a bare `Scaffold` + `ListView`. Neither
// overflowed, neither clipped, and neither failed a single existing assertion —
// because "the content grew to fill a 1920 px display" is a defect with no
// exception, no red pixel and no error line. It is only visible to a
// MEASUREMENT, which is what this file is.
//
// 🔴 THIS FILE ONCE HELD A THIRD GROUP, AND ITS DELETION IS THE POINT. That
// group pumped `features/firstrun/onboarding_screen.dart` — the STAMPED twin,
// an unrouted copy of the chassis carousel that no Subly user could reach.
// `core/router.dart` sends a fresh install to `features/onboarding/`, so the
// screen with the width cap had no user and the screen with the user had no
// width cap: a green measurement that measured nothing anybody would ever see.
// The twin is now deleted from this app (it lives on in the brick, where it
// belongs and where `assert-stamp-properties.mjs` still holds it), and the
// onboarding cases moved to `test/width_onboarding_test.dart` against the
// ROUTED screen. Coverage did not shrink — it re-pointed at the shipping
// widget, and the arithmetic changed with it (30/30 gutters, not 32/32).
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
import 'package:subly/features/monetization/manage_plan_screen.dart';
import 'package:subly/features/settings/settings_screen.dart';

import 'support/width_harness.dart';

void main() {
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
