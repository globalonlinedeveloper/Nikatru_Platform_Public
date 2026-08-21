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
// and the distinguishing surface must be WIDER THAN THE CAP UNDER TEST — at a
// width at or below the cap the assertion is true whether or not the pane is
// there. That was "1920, not 1280" while these screens used the 1280 ceiling;
// since 2026-08-21 they cap at `reading` (720), so 768 is already distinguishing
// and 1920 remains so. The general rule is the one to keep: pick a surface the
// cap actually has to clamp.
// ─────────────────────────────────────────────────────────────────────────────
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:nikatru_design_system/nikatru_design_system.dart';
import 'package:subly/features/monetization/manage_plan_screen.dart';
import 'package:subly/features/settings/settings_screen.dart';

import 'support/width_harness.dart';

void main() {
  // ── SETTINGS · ContentPane.reading (720) ─────────────────────────────────
  //
  // 🔴 THESE NUMBERS MOVED ON 2026-08-21 AND THE OLD ONES WERE NEVER REACHABLE.
  // Both screens used the bare `ContentPane` default of 1280. `AppScaffold` hands
  // the body min(W - 361, 1280) — a 360px drawer plus a divider take the width
  // first — so at 1440 the body is 1079 and the 1280 "cap" never bound at any
  // real desktop size. Both now use `reading` (720), which does.
  //
  // This file kept asserting 1280 after the screens moved, which is exactly what
  // it is for: the change was made by an agent that did not own this file, and
  // the disagreement surfaced here as two red tests rather than as a silent
  // conflict.───
  group('settings is capped at the reading width', () {
    testWidgets('at 375 the cap is a no-op and nothing overflows', (
      WidgetTester tester,
    ) async {
      await pumpAt(tester, kPhone, const SettingsScreen());
      expect(offeredWidth(tester, inPane(ListView)), 375);
      expect(tester.takeException(), isNull);
    });

    testWidgets('at 768 the cap BINDS — 720, not the window', (
      WidgetTester tester,
    ) async {
      await pumpAt(tester, kTablet, const SettingsScreen());
      expect(offeredWidth(tester, inPane(ListView)), 720);
    });

    testWidgets('at 1280 the list is at the cap', (WidgetTester tester) async {
      await pumpAt(tester, kDesktop, const SettingsScreen());
      expect(
        offeredWidth(tester, inPane(ListView)),
        lessThanOrEqualTo(AppBreakpoints.reading),
      );
    });

    // 🔴 THE CASE THAT CAN ACTUALLY GO RED — see the harness header.
    testWidgets('at 1920 the list stops at AppBreakpoints.reading', (
      WidgetTester tester,
    ) async {
      await pumpAt(tester, kWide, const SettingsScreen());
      expect(
        offeredWidth(tester, inPane(ListView)),
        AppBreakpoints.reading,
        reason:
            'without the pane every ListTile here stretches the full display: '
            'the leading icon at one edge, the trailing chevron at the other, '
            'and the eye travelling between them for every row',
      );
    });
  });

  // ── MANAGE PLAN · ContentPane.reading (720) — see the note above ─────────
  group('manage-plan is capped at the reading width', () {
    testWidgets('at 375 the cap is a no-op and nothing overflows', (
      WidgetTester tester,
    ) async {
      await pumpAt(tester, kPhone, const ManagePlanScreen());
      expect(offeredWidth(tester, inPane(ListView)), 375);
      expect(tester.takeException(), isNull);
    });

    testWidgets('at 768 the cap BINDS — 720, not the window', (
      WidgetTester tester,
    ) async {
      await pumpAt(tester, kTablet, const ManagePlanScreen());
      expect(offeredWidth(tester, inPane(ListView)), 720);
    });

    testWidgets('at 1280 the list is at the cap', (WidgetTester tester) async {
      await pumpAt(tester, kDesktop, const ManagePlanScreen());
      expect(
        offeredWidth(tester, inPane(ListView)),
        lessThanOrEqualTo(AppBreakpoints.reading),
      );
    });

    testWidgets('at 1920 the list stops at AppBreakpoints.reading', (
      WidgetTester tester,
    ) async {
      await pumpAt(tester, kWide, const ManagePlanScreen());
      expect(
        offeredWidth(tester, inPane(ListView)),
        AppBreakpoints.reading,
        reason:
            'the screen whose entire job is "cancelling must be no harder than '
            'subscribing" had its cancel row spread across the whole display',
      );
    });
  });
}
