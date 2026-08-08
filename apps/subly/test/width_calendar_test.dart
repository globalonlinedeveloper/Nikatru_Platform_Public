// ─────────────────────────────────────────────────────────────────────────────
// WIDTH — `/calendar`, plus the sq-grid regression the port exists to fix.
//
// The renewal calendar shipped with NO width decision and a delegate that tied
// cell HEIGHT to viewport WIDTH. Neither defect overflows, clips, throws, or
// fails any assertion that existed before this file — they are the
// `responsive_width_test.dart` class of defect, visible only to a MEASUREMENT.
// This file is that measurement.
//
// Every idiom here (surface pinning + `addTearDown(null)`, the provider seams,
// `offeredWidth` on `constraints` rather than `size`, `inPane` scoping through
// `ContentPane`, and 1920 as the desktop case that can actually go red) lives in
// `test/support/width_harness.dart` and carries its rationale there.
//
// 🔴 THE ONE RULE SPECIFIC TO THIS SCREEN: the grid assertion is on CELL
// HEIGHT, never on the grid's total height. `CalendarScreen.build` calls
// `DateTime.now()` directly, so the row count is 5 or 6 depending on which
// month the suite runs in — a total-height assertion would be green in
// September and red in November for reasons that have nothing to do with the
// code. A single cell's main-axis extent is month-independent AND, after the
// fix, width-independent, which is exactly the property under test. (Injecting
// a clock seam would make the total assertable; that is a refactor this port
// deliberately does not make.)
// ─────────────────────────────────────────────────────────────────────────────
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:nikatru_design_system/nikatru_design_system.dart';
import 'package:subly/features/calendar/calendar_screen.dart';

import 'support/width_harness.dart';

void main() {
  // ── THE PAGE · default ContentPane (kMaxBodyWidth, 1280) ───────────────────
  group('calendar is capped at the body width', () {
    testWidgets('at 375 the cap is a no-op and nothing overflows', (
      WidgetTester tester,
    ) async {
      await pumpAt(tester, kPhone, const CalendarScreen());
      expect(
        offeredWidth(tester, inPane(ListView)),
        375,
        reason:
            'below the cap a ConstrainedBox may only tighten within what it '
            'was handed, so a phone must render exactly as it did before the '
            'pane existed — and the gutters stay INSIDE the ListView, which is '
            'why this is 375 and not 375 less two gutters',
      );
      expect(
        tester.takeException(),
        isNull,
        reason:
            'the month grid, the weekday header and the renewal rows must all '
            'lay out clean on the narrowest phone',
      );
    });

    testWidgets('at 768 the cap is still a no-op', (WidgetTester tester) async {
      await pumpAt(tester, kTablet, const CalendarScreen());
      expect(offeredWidth(tester, inPane(ListView)), 768);
    });

    testWidgets('at 1280 the list is at the cap', (WidgetTester tester) async {
      await pumpAt(tester, kDesktop, const CalendarScreen());
      expect(
        offeredWidth(tester, inPane(ListView)),
        lessThanOrEqualTo(AppBreakpoints.kMaxBodyWidth),
        reason:
            'the ordinary desktop window — this pins the no-op boundary, it is '
            'NOT the case that can fail (1280 <= 1280 holds with the pane '
            'deleted). See the 1920 case.',
      );
    });

    // 🔴 THE CASE THAT CAN ACTUALLY GO RED — a 1280 cap measured on a 1280
    // surface is an assertion that cannot fail, so the pane needs a surface it
    // is distinguishable from.
    testWidgets('at 1920 the list stops at AppBreakpoints.kMaxBodyWidth', (
      WidgetTester tester,
    ) async {
      await pumpAt(tester, kWide, const CalendarScreen());
      expect(
        offeredWidth(tester, inPane(ListView)),
        AppBreakpoints.kMaxBodyWidth,
        reason:
            'without the pane the month card and every renewal row stretch the '
            'full display: a 1900 px row with a day numeral at one edge and a '
            'price at the other',
      );
    });
  });

  // ── THE SQ-GRID DEFECT · the delegate, not the pane ────────────────────────
  group('the month grid decouples cell height from viewport width', () {
    /// The first BUILT day cell.
    ///
    /// Indices before the month's first weekday return `SizedBox.shrink()`, not
    /// a `Container`, so the first `Container` under the `GridView` is a real
    /// day cell — and it precedes its own 4 px renewal-dot `Container` in the
    /// element walk, so `.first` is the tile and never the dot.
    Finder firstDayCell() => find
        .descendant(of: find.byType(GridView), matching: find.byType(Container))
        .first;

    testWidgets('at 1280 a day cell is 44 px tall, not ~170', (
      WidgetTester tester,
    ) async {
      await pumpAt(tester, kDesktop, const CalendarScreen());
      expect(
        tester.getSize(firstDayCell()).height,
        44,
        reason:
            'SliverGridDelegateWithFixedCrossAxisCount inherits '
            'childAspectRatio: 1.0 when no mainAxisExtent is given, which makes '
            'every day cell a SQUARE — so its height tracks the viewport. At '
            'the 1280 cap that is a ~170 px cell and a ~1035 px month card of '
            'mostly-empty tinted boxes around 12 pt numerals that do not '
            'scale. mainAxisExtent: 44 is what unties the two.',
      );
    });

    // The other half of "width-independent": the same number at phone width.
    // Together these two are the property — one alone could be satisfied by a
    // childAspectRatio that happens to land on 44 at one surface.
    testWidgets('at 375 the same cell is the same 44 px', (
      WidgetTester tester,
    ) async {
      await pumpAt(tester, kPhone, const CalendarScreen());
      expect(
        tester.getSize(firstDayCell()).height,
        44,
        reason:
            'the phone is the surface the 41 px square was designed on: 44 is '
            'within 3 px of it, so the fix must leave this rendering alone',
      );
    });
  });
}
