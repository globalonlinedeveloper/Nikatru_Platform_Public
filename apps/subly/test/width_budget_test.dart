// ─────────────────────────────────────────────────────────────────────────────
// BUDGET · WIDTH — the measurement that the layout branch in
// `budget_screen.dart` exists to satisfy.
//
// Everything structural lives in `support/width_harness.dart`: why the
// assertion is on incoming `BoxConstraints` rather than on `getSize` (a
// shrink-wrapping child makes a size assertion un-failable) and why every case
// pins the surface. Read that header before adding a case here.
//
// 🔴 THIS SCREEN IS NO LONGER A `kMaxBodyWidth` SCREEN AT EVERY WIDTH — IT IS
// TWO SHAPES. Below `AppBreakpoints.large` (1200) it is one column capped at
// `AppBreakpoints.reading` (720), which is why the 768 case is a real assertion
// and not a no-op. At 1200 and above the category bars go TWO-UP and the cap
// moves to the default `kMaxBodyWidth` (1280), which puts each COLUMN at 617 —
// narrower than the 684 a bar gets today at 768, so the 720 argument (a
// progress meter is a length the eye judges against a track, and past ~800px a
// 3% overspend and a 6% one look identical) is honoured harder, not relaxed.
//
// ⚠️ THE 1200 IS A BODY WIDTH, NOT A WINDOW WIDTH, and this harness measures
// the screen WITHOUT `AppScaffold` around it, so here the two coincide. In the
// running app they do not: the chassis takes 361px for the drawer first
// (`min(W - 361, 1280)`), so the second column appears at a WINDOW width of
// 1561. `budget_screen.dart`'s `_twoUp` carries that arithmetic.
//
// 🔴 THE RING CARD IS NOT PART OF THE GRID, AND THAT IS MEASURED HERE TOO.
// It is the page's one summary and there is no second card to sit beside it, so
// the two-up layout holds it at `reading` rather than stretching it across
// 1244. `budget.summary` is the key it carries for exactly that assertion —
// without it, dropping the hold would change no other number in this file.
//
// 🔴 THE ONE THING THIS SCREEN ADDS OVER ITS SIBLINGS: AN ASYNC GATE.
// `BudgetScreen` returns a bare `Center(CircularProgressIndicator)` while
// `budgetProvider` is unresolved, and there is NO `ListView` in that frame. So
// the pump count is load-bearing here in a way it is not for settings or
// manage-plan: `pumpAt` runs 12 `pump()`s, which is what carries
// `budgetProvider` (→ `subscriptionRepositoryProvider` → `SeedApiClient`)
// through to data. The harness deliberately leaves that repository
// un-overridden so the screen renders its POPULATED branch — the seed's ten
// categories are the bars the grid deals out, and a budget page with no bars is
// a width nobody cares about.
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

/// The two columns of the wide layout, and the summary card that stays out of
/// them — by the keys `budget_screen.dart` puts on them.
final Finder _leftColumn = find.byKey(const Key('budget.bars.left'));
final Finder _rightColumn = find.byKey(const Key('budget.bars.right'));
final Finder _summary = find.byKey(const Key('budget.summary'));

/// Just under `AppBreakpoints.large`, so the boundary is `>=` and not `>`.
///
/// One pixel below the breakpoint is the only surface that can tell those two
/// apart, and a screen that went two-up at 1201 instead of 1200 would otherwise
/// look correct everywhere this file measures.
const Size kJustBelowLarge = Size(1199, 900);

/// The page gutters (`AppSpacing.gutterCompact`, both sides) come off the pane
/// before anything on the page sees a pixel.
const double _gutters = 18 * 2;

void main() {
  // ── ONE COLUMN, BELOW `AppBreakpoints.large` ───────────────────────────────
  group('below large, budget is one column capped at reading', () {
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
      expect(
        offeredWidth(tester, _summary),
        375 - _gutters,
        reason:
            'in one column the ring card takes the page, exactly as it always '
            'has — the hold at `reading` is a two-up-only thing',
      );
      expect(
        _leftColumn,
        findsNothing,
        reason: 'a phone is one column; two columns of 170px would be a bug',
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

    // 🔴 NOT A NO-OP. Under the old `kMaxBodyWidth` default this case asserted
    // 768 and held with the wrapper deleted; at 720 it is the narrowest surface
    // where the cap takes width away, so it fails on its own.
    testWidgets('at 768 the cap binds and there is still one column', (
      WidgetTester tester,
    ) async {
      await pumpAt(tester, kTablet, const BudgetScreen());
      expect(offeredWidth(tester, inPane(ListView)), AppBreakpoints.reading);
      expect(offeredWidth(tester, _summary), AppBreakpoints.reading - _gutters);
      expect(_leftColumn, findsNothing);
    });

    // 🔴 THE BOUNDARY. This is the only case that can tell `>= large` from
    // `> large`, and it is also what stops the two-column layout drifting down
    // into the expanded window class, where 1199 less the gutters and the gap
    // would leave 576px columns.
    testWidgets('at 1199 — one pixel below large — it is still one column', (
      WidgetTester tester,
    ) async {
      await pumpAt(tester, kJustBelowLarge, const BudgetScreen());
      expect(
        offeredWidth(tester, inPane(ListView)),
        AppBreakpoints.reading,
        reason: 'the two-column branch must not start until 1200',
      );
      expect(_leftColumn, findsNothing);
      expect(_rightColumn, findsNothing);
      // Pinned so a change to the design system's own numbers is a red test
      // here rather than a silent re-layout of this screen.
      expect(AppBreakpoints.large, 1200);
      expect(AppBreakpoints.reading, 720);
    });
  });

  // ── TWO COLUMNS, AT `AppBreakpoints.large` AND ABOVE ───────────────────────
  group('at large and above, budget lays its category bars out two-up', () {
    // 1280 less the page gutters leaves 1244 for the Row; less the 10px column
    // gap leaves 1234, split evenly. Written as the arithmetic rather than as a
    // bare 617 so a change to the gutter or the gap shows up here as a wrong
    // SUM rather than as a mystery constant.
    const double columnAt1280 =
        (AppBreakpoints.kMaxBodyWidth - _gutters - 10) / 2;

    testWidgets('at 1280 the bars are side by side and the ring card is not', (
      WidgetTester tester,
    ) async {
      await pumpAt(tester, kDesktop, const BudgetScreen());

      expect(
        offeredWidth(tester, inPane(ListView)),
        AppBreakpoints.kMaxBodyWidth,
        reason:
            'the two-up arm caps at kMaxBodyWidth, not at reading — this case '
            'goes red if the two-column branch is deleted and 720 comes back',
      );
      expect(
        offeredWidth(tester, _leftColumn),
        columnAt1280,
        reason:
            'every meter must stay inside `reading`; 617 is the number the '
            'grid produces and nothing else on this screen does',
      );
      expect(offeredWidth(tester, _rightColumn), columnAt1280);
      expect(
        offeredWidth(tester, _summary),
        AppBreakpoints.reading,
        reason:
            'the ring card is one card, not a stack, so the wide layout holds '
            'it at reading instead of spreading a 168px ring and three stats '
            'across the full 1244',
      );

      // 🔴 THE DEAL ORDER IS PART OF THE CONTRACT, not an implementation
      // detail. Bars are dealt alternately so the widget tree is in reading
      // order — bar 0 left, bar 1 right, bar 2 left. A screen reader walks the
      // tree, so halving the list instead would read the first five categories
      // down one column and the last five back up the other, and no width
      // measurement would notice.
      //
      // ⚠️ BAR 0 AND BAR 1 ARE NOT THE FIRST TWO ROWS OF THE SEED FILE.
      // `SubMath.categoryTotals` sorts by monthly total DESCENDING, so the
      // order on screen is Fitness (255.00) then Creative (59.99), not the
      // Streaming/Music order `data/seed/demo_data.dart` is written in.
      // Measured — asserting the file order instead put Music in the left
      // column and this case red for the wrong reason.
      expect(
        find.descendant(of: _leftColumn, matching: find.text('Fitness')),
        findsOneWidget,
        reason: 'bar 0 — the largest category — belongs in the LEFT column',
      );
      expect(
        find.descendant(of: _rightColumn, matching: find.text('Creative')),
        findsOneWidget,
        reason: 'bar 1 belongs in the RIGHT column, beside bar 0 and not under',
      );
    });

    testWidgets('at 1920 the body is still capped at exactly kMaxBodyWidth', (
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
      expect(offeredWidth(tester, _leftColumn), columnAt1280);
      expect(offeredWidth(tester, _rightColumn), columnAt1280);
      expect(offeredWidth(tester, _summary), AppBreakpoints.reading);
      expect(AppBreakpoints.kMaxBodyWidth, 1280);
    });
  });
}
