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
// 🔴 THIS SCREEN IS NO LONGER A `kMaxBodyWidth` SCREEN. `budget_screen.dart`
// now caps at `AppBreakpoints.reading` (720), which is why the 768 and 1280
// cases below became real assertions instead of no-ops. The harness's "1920,
// not 1280" rule was a consequence of the cap equalling the body ceiling: a
// 1280 cap cannot bind, because `AppScaffold` hands the body
// `min(W - 361, 1280)` and so 1280 is also the most it can ever offer. At 720
// every case from 768 upward is falsifiable on its own.
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
  // ── BUDGET · ContentPane.reading (720) ─────────────────────────────────────
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

    // 🔴 NO LONGER A NO-OP. Under the old `kMaxBodyWidth` default this case
    // asserted 768 and held with the wrapper deleted; at 720 it is the
    // narrowest surface where the cap takes width away, so it fails on its own.
    testWidgets('at 768 the cap binds', (WidgetTester tester) async {
      await pumpAt(tester, kTablet, const BudgetScreen());
      expect(offeredWidth(tester, inPane(ListView)), AppBreakpoints.reading);
    });

    testWidgets('at 1280 the list is at the cap', (WidgetTester tester) async {
      await pumpAt(tester, kDesktop, const BudgetScreen());
      expect(
        offeredWidth(tester, inPane(ListView)),
        AppBreakpoints.reading,
        reason:
            'the old `<= kMaxBodyWidth` here was true of the 1280 surface '
            'itself, so it could not fail; 720 is a number only the pane makes',
      );
    });

    // The widest surface. All three cases above now fail with the pane deleted
    // or re-widened — see the header for why that was not true before.
    testWidgets('at 1920 the list stops at AppBreakpoints.reading', (
      WidgetTester tester,
    ) async {
      await pumpAt(tester, kWide, const BudgetScreen());
      expect(
        offeredWidth(tester, inPane(ListView)),
        AppBreakpoints.reading,
        reason:
            'without the pane every category bar stretches the full display: '
            'the category name at one edge, the spend figure at the other, and '
            'a 1900 px progress meter between them',
      );
      // Pinned so a change to the design system's own number is a red test
      // here rather than a silent re-layout of this screen.
      expect(AppBreakpoints.reading, 720);
    });
  });
}
