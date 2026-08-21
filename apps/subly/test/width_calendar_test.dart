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
  // ── THE PAGE · ContentPane.reading (AppBreakpoints.reading, 720) ───────────
  //
  // 🔴 THESE CASES WERE REWRITTEN 2026-08-21 BECAUSE THEY PINNED A CAP THAT
  // COULD NOT BIND. They asserted `kMaxBodyWidth` (1280) — but `AppScaffold`
  // gives the body `min(W - 361, 1280)`, so a 1440 px window offers 1079 and
  // 1280 is unreachable short of a maximised ultra-wide. Three of the four
  // cases were therefore green for a screen that stretched at every desktop
  // width anybody has; only the 1920 one measured the pane at all, and it
  // measured the one width where the old cap happened to be visible.
  //
  // With `.reading` the cap binds from 768 up, so the TABLET case — previously
  // a hand-written restatement of "no cap here" — becomes a case that can go
  // red. That is the point of the change: the assertion moved to where the
  // defect lives.
  group('calendar is capped at the reading width', () {
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

    // 🔴 THE CASE THAT NOW CARRIES THE CHANGE. Under the old 1280 cap this read
    // `expect(…, 768)` — the cap was a no-op and the tablet rendered as a wide
    // phone. 720 is the first width at which the pane does anything at all, and
    // it is a width real hardware ships at, unlike 1920.
    testWidgets('at 768 the cap BINDS — the tablet is not a wide phone', (
      WidgetTester tester,
    ) async {
      await pumpAt(tester, kTablet, const CalendarScreen());
      expect(
        offeredWidth(tester, inPane(ListView)),
        AppBreakpoints.reading,
        reason:
            'a seven-column month grid puts every extra pixel into cell WIDTH '
            'while mainAxisExtent holds the height at 44, so 768 would already '
            'be a row of letterboxes around 12 pt numerals',
      );
    });

    testWidgets('at 1280 the list is still at 720, not at the window', (
      WidgetTester tester,
    ) async {
      await pumpAt(tester, kDesktop, const CalendarScreen());
      expect(
        offeredWidth(tester, inPane(ListView)),
        AppBreakpoints.reading,
        reason:
            'the ordinary desktop window. Under the old default cap this was '
            'the width at which the assertion could not fail (1280 <= 1280 '
            'holds with the pane deleted); it is now 560 px of daylight.',
      );
    });

    testWidgets('at 1920 the list stops at AppBreakpoints.reading', (
      WidgetTester tester,
    ) async {
      await pumpAt(tester, kWide, const CalendarScreen());
      expect(
        offeredWidth(tester, inPane(ListView)),
        AppBreakpoints.reading,
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

    /// The day numeral inside the first BUILT cell.
    ///
    /// The dot is a `Container`, never a `Text`, so the first `Text` under the
    /// `GridView` is the numeral. (The weekday letters are OUTSIDE the
    /// `GridView` — they are a plain `Row` above it — so they cannot be picked
    /// up here.)
    Finder firstDayNumeral() => find
        .descendant(of: find.byType(GridView), matching: find.byType(Text))
        .first;

    /// [CalendarScreen] under a pinned [TextScaler].
    ///
    /// `Builder` + `MediaQuery.of(c).copyWith` rather than a bare `MediaQuery`:
    /// replacing the inherited data outright would drop the surface metrics that
    /// [pumpAt] just pinned, and the screen would lay out at the flutter_test
    /// default instead of at [kPhone].
    Future<void> pumpScaled(WidgetTester tester, Size size, double s) => pumpAt(
      tester,
      size,
      Builder(
        builder: (BuildContext c) => MediaQuery(
          data: MediaQuery.of(c).copyWith(textScaler: TextScaler.linear(s)),
          child: const CalendarScreen(),
        ),
      ),
    );

    // ── THE FIXED 44 px BOX vs TEXT THAT GROWS ────────────────────────────────
    //
    // 🔴 THE AUDIT SAID THIS CLIPS AT 1.3. IT DOES NOT — IT CLIPPED AT 2.0, AND
    // SIDEWAYS. Measured on the phone before the clamp landed, per scale:
    //   1.0 → numeral box 12.0 px, clean
    //   1.3 → 16.0 px, clean (22 px of headroom in the 44 px cell)
    //   1.5 → 18.0 px, clean
    //   2.0 → 24.0 px, and 22 of the month's cells OVERFLOW BY 10.0 px
    //   3.5 → 42.0 px, 31 cells overflow
    // The mechanism is horizontal, which is why a vertical reading of the
    // delegate missed it: a cell on a 375 phone is 41.3 px wide, a TWO-DIGIT day
    // at a scaled 12 pt outgrows that width and WRAPS, and two lines + the 2 px
    // gap + the 4 px dot is 54 px in a 44 px box. Single-digit days stay clean
    // until 3.5, which is why the count jumps from 22 to 31 rather than from 0
    // to 31 — that jump is the fingerprint of the wrap and is what identified
    // it.
    //
    // 2.0 is inside what both platforms ship (Android's largest font size with
    // the largest display size; iOS's accessibility sizes go further), so this
    // was a live clip, not a theoretical one.
    for (final double s in <double>[1.3, 2.0, 3.5]) {
      testWidgets('at textScaler $s the day cell does not clip', (
        WidgetTester tester,
      ) async {
        await pumpScaled(tester, kPhone, s);
        expect(
          tester.takeException(),
          isNull,
          reason:
              'the cell is a fixed 44 px box around text that scales, so the '
              'grid must be clamped (MediaQuery.withClampedTextScaling) rather '
              'than merely tall enough for the scale somebody tested at. '
              'Before the clamp this went red at 2.0 with 22 RenderFlex '
              'overflows of 10.0 px each.',
        );
        expect(
          tester.getSize(firstDayCell()).height,
          44,
          reason: 'the clamp must not be paid for by a taller cell',
        );
      });
    }

    // ⚠️ THE HALF THAT STOPS THE FIX BECOMING A FREEZE. Every assertion above is
    // also satisfied by `TextScaler.noScaling`, i.e. by ignoring the user's text
    // size outright — which is the cheap wrong fix and is invisible in a test
    // that only checks for overflow. The clamp is at 1.5, so 1.3 must still
    // GROW the numeral and 3.5 must land on exactly the 1.5 ceiling.
    testWidgets('the clamp is a ceiling, not a freeze', (
      WidgetTester tester,
    ) async {
      await pumpScaled(tester, kPhone, 1.0);
      final double at1 = tester.getSize(firstDayNumeral()).height;
      await pumpScaled(tester, kPhone, 1.3);
      final double at13 = tester.getSize(firstDayNumeral()).height;
      await pumpScaled(tester, kPhone, 3.5);
      final double at35 = tester.getSize(firstDayNumeral()).height;

      expect(
        at13,
        greaterThan(at1),
        reason:
            'below the 1.5 ceiling the numeral must follow the user setting '
            'exactly as it did before — a clamp that starts clamping at 1.0 is '
            'noScaling wearing a different name',
      );
      expect(
        at35,
        at1 * 1.5,
        reason:
            'above the ceiling it stops at 1.5×, which is the number the 44 px '
            'box was proved against: even a two-line wrap on a narrow 320 px '
            'phone is 2×18 + 2 + 4 = 42 <= 44',
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
