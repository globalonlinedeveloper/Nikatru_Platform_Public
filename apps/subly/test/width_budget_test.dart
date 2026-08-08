// ─────────────────────────────────────────────────────────────────────────────
// BUDGET · WIDTH — the measurement that the `ContentPane` in
// `budget_screen.dart` exists to satisfy.
//
// Everything structural lives in `support/width_harness.dart`: why the
// assertion is on incoming `BoxConstraints` rather than on `getSize` (a
// shrink-wrapping child makes a size assertion un-failable), why every case
// pins the surface, and why 1920 — not 1280 — is the desktop case for a
// `kMaxBodyWidth` screen. Read that header before adding a case here.
//
// 🔴 THE ONE THING THIS SCREEN ADDS OVER ITS SIBLINGS: AN ASYNC GATE.
// `BudgetScreen` returns a bare `Center(CircularProgressIndicator)` while
// `budgetProvider` is unresolved, and there is NO `ListView` in that frame. So
// the pump count is load-bearing here in a way it is not for settings or
// manage-plan: `pumpAt` runs 12 `pump()`s, which is what carries
// `budgetProvider` (→ `subscriptionRepositoryProvider` → `SeedApiClient`)
// through to data. The harness deliberately leaves that repository
// un-overridden so the screen renders its POPULATED branch — category bars are
// the full-width element the cap is here to bound, and a budget page with no
// bars is a width nobody cares about.
//
// If the resolution ever stops fitting in 12 pumps, `inPane(ListView)` fails on
// its `findsWidgets` guard with the harness's named reason ("this screen has no
// ContentPane at all…"). That message is then WRONG about the cause — it will
// be the spinner still on screen, not a deleted pane. Check the pump count
// before believing it.
// ─────────────────────────────────────────────────────────────────────────────
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:nikatru_design_system/nikatru_design_system.dart';
import 'package:subly/features/budget/budget_screen.dart';

import 'support/width_harness.dart';

void main() {
  // ── BUDGET · ContentPane (kMaxBodyWidth, 1280) ─────────────────────────────
  group('budget is capped at the body width', () {
    testWidgets('at 375 the cap is a no-op and nothing overflows', (
      WidgetTester tester,
    ) async {
      await pumpAt(tester, kPhone, const BudgetScreen());
      expect(
        offeredWidth(tester, inPane(ListView)),
        375,
        reason:
            'below the cap a ConstrainedBox may only tighten within what it '
            'was handed, so a phone must render exactly as it did before the '
            'pane existed',
      );
      // The ring is a fixed 168x168 and the `_stat` row is `spaceEvenly`, so
      // the narrowest phone is where either would first complain. Nothing else
      // in this file would notice if they did.
      expect(
        tester.takeException(),
        isNull,
        reason:
            'the ring card and the category bars must lay out clean on the '
            'narrowest phone',
      );
    });

    testWidgets('at 768 the cap is still a no-op', (WidgetTester tester) async {
      await pumpAt(tester, kTablet, const BudgetScreen());
      expect(offeredWidth(tester, inPane(ListView)), 768);
    });

    testWidgets('at 1280 the list is at the cap', (WidgetTester tester) async {
      await pumpAt(tester, kDesktop, const BudgetScreen());
      expect(
        offeredWidth(tester, inPane(ListView)),
        lessThanOrEqualTo(AppBreakpoints.kMaxBodyWidth),
      );
    });

    // 🔴 THE CASE THAT CAN ACTUALLY GO RED — see the harness header. At 1280
    // the assertion above holds with the pane deleted; this one does not.
    testWidgets('at 1920 the list stops at AppBreakpoints.kMaxBodyWidth', (
      WidgetTester tester,
    ) async {
      await pumpAt(tester, kWide, const BudgetScreen());
      expect(
        offeredWidth(tester, inPane(ListView)),
        AppBreakpoints.kMaxBodyWidth,
        reason:
            'without the pane every category bar stretches the full display: '
            'the category name at one edge, the spend figure at the other, and '
            'a 1900 px progress meter between them',
      );
    });
  });
}
