// INSIGHTS' WIDTH DECISION — train ST-D3, label D3-7 (canvas v2
// `DesktopInsights`).
//
// Below a 1200 px BODY the page is one column held at `AppBreakpoints.reading`
// (720). From 1200 up it is a grid capped at `kMaxBodyWidth`: the summary
// tiles in one row, then budget + by-category on the LEFT and worth-a-look +
// the Pro forecast on the RIGHT — the alternating deal `_twoColumnCards` makes
// of the four cards, which is the artboard's layout.
//
// "The content grew to fill a 1920 px display" raises no exception and clips no
// pixel, so only a measurement sees it: the pane AND a column are measured,
// because the pane alone cannot fail at 1280 — 1280 is the surface.
//
// MUTATION PROOF: make `_twoUp` return false and the 1280 case goes red on the
// missing left column; cap the two-up arm at `reading` and it goes red on the
// pane width.

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:nikatru_design_system/nikatru_design_system.dart';
import 'package:subscriptiontracker/features/insights/insights_screen.dart';
import 'package:subscriptiontracker/features/insights/summary_tiles.dart';

import 'support/width_harness.dart';

final Finder _leftColumn = find.byKey(const Key('insights.cards.left'));
final Finder _rightColumn = find.byKey(const Key('insights.cards.right'));

const Size kJustBelowLarge = Size(1199, 900);

Finder _in(Finder column, String key) =>
    find.descendant(of: column, matching: find.byKey(Key(key)));

void main() {
  group('below large, insights is one column capped at reading', () {
    testWidgets('at 375 the cap is a no-op and the tiles sit two by two', (
      WidgetTester tester,
    ) async {
      await pumpAt(tester, kPhone, const InsightsScreen());
      expect(offeredWidth(tester, inPane(ListView)), 375);
      expect(_leftColumn, findsNothing);
      final Rect month = tester.getRect(
        find.byKey(const Key('insights.tile.month')),
      );
      final Rect next30 = tester.getRect(
        find.byKey(const Key('insights.tile.next30')),
      );
      expect(
        next30.top,
        greaterThan(month.bottom),
        reason: 'a phone is 2 × 2: the third tile starts a second row',
      );
      expect(tester.takeException(), isNull);
    });

    testWidgets('at 768 the cap binds, one column, tiles in one row', (
      WidgetTester tester,
    ) async {
      await pumpAt(tester, kTablet, const InsightsScreen());
      expect(offeredWidth(tester, inPane(ListView)), AppBreakpoints.reading);
      expect(_leftColumn, findsNothing);
      final Rect month = tester.getRect(
        find.byKey(const Key('insights.tile.month')),
      );
      final Rect biggest = tester.getRect(
        find.byKey(const Key('insights.tile.biggest')),
      );
      expect(
        biggest.top,
        month.top,
        reason:
            'from a $kSummaryOneRowFrom px column the four tiles are one row',
      );
    });

    // ⏱ 2026-10-01 · train P39 (SYN-X1 C-17): the EXPANDED class proper,
    // not only its upper edge (1199) below.
    testWidgets('at 1024 (expanded) one column capped at reading', (
      WidgetTester tester,
    ) async {
      await pumpAt(tester, kExpanded, const InsightsScreen());
      expect(offeredWidth(tester, inPane(ListView)), AppBreakpoints.reading);
      expect(_leftColumn, findsNothing);
      expect(_rightColumn, findsNothing);
      expect(tester.takeException(), isNull);
    });

    testWidgets('at 1199 — one pixel below large — it is still one column', (
      WidgetTester tester,
    ) async {
      await pumpAt(tester, kJustBelowLarge, const InsightsScreen());
      expect(offeredWidth(tester, inPane(ListView)), AppBreakpoints.reading);
      expect(_leftColumn, findsNothing);
      expect(_rightColumn, findsNothing);
    });
  });

  group('at large and above, the DesktopInsights grid', () {
    const double columnAt1280 =
        (AppBreakpoints.kMaxBodyWidth -
            AppSpacing.gutterCompact -
            AppSpacing.gutterCompact -
            AppSpacing.lg) /
        2;

    testWidgets('at 1280: budget + category LEFT, signals + forecast RIGHT', (
      WidgetTester tester,
    ) async {
      await pumpAt(tester, kDesktop, const InsightsScreen());
      expect(
        offeredWidth(tester, inPane(ListView)),
        AppBreakpoints.kMaxBodyWidth,
        reason: 'the grid caps at kMaxBodyWidth, not at reading',
      );
      expect(offeredWidth(tester, _leftColumn), columnAt1280);
      expect(offeredWidth(tester, _rightColumn), columnAt1280);
      expect(_in(_leftColumn, 'insights.budget'), findsOneWidget);
      expect(_in(_leftColumn, 'insights.category'), findsOneWidget);
      expect(_in(_rightColumn, 'insights.signals'), findsOneWidget);
      expect(_in(_rightColumn, 'insights.forecast'), findsOneWidget);
      expect(tester.takeException(), isNull);
    });

    testWidgets('at 1920 the body is still capped at exactly kMaxBodyWidth', (
      WidgetTester tester,
    ) async {
      await pumpAt(tester, kWide, const InsightsScreen());
      expect(
        offeredWidth(tester, inPane(ListView)),
        AppBreakpoints.kMaxBodyWidth,
      );
      expect(offeredWidth(tester, _leftColumn), columnAt1280);
      expect(
        offeredWidth(tester, _leftColumn),
        lessThanOrEqualTo(AppBreakpoints.reading),
        reason: 'each column must land inside reading',
      );
    });
  });
}
