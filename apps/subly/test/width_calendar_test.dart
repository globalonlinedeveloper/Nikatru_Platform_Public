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
// `offeredWidth` on `constraints` rather than `size`, `inPaneOf` scoping through
// a KEYED `ContentPane`, and 1920 as the desktop case that can actually go red)
// lives in `test/support/width_harness.dart` and carries its rationale there.
//
// 🔴 THE SHAPE CHANGED 2026-08-21 — THE SCREEN IS A `TwoPane` NOW, AND THE
// SINGLE-CAP CASES BELOW WERE REWRITTEN RATHER THAN DELETED. The month grid is
// the master, the selected day's renewals are the detail. Below
// `AppBreakpoints.expanded` (840) nothing moves: one column, capped at
// `AppBreakpoints.reading` (720), renewals under the grid — so the 375 and 768
// cases still assert the numbers they asserted this morning, and that is the
// point of keeping them.
//
// From 840 up there are TWO panes, so three things changed about how this file
// measures:
//   · `inPane` is AMBIGUOUS and is gone. `find.byType(ContentPane)` cannot tell
//     the grid pane from the day pane; every measurement goes through `inPaneOf`
//     and a `Key`, which is the rule `width_harness.dart` records and
//     `width_detail_test.dart` already follows.
//   · THE MASTER IS NO LONGER AT 720. `TwoPaneSplit` serves the detail first up
//     to `.reading` and floors the list at `.form` (420), capping it at `.pane`
//     (480) — so the grid column is offered 420 at the boundary and 480 from
//     1201 up, and the screen's own 720 cap never binds there again. Asserting
//     720 at 1280 would now be asserting a cap that cannot fire, which is the
//     exact defect the previous rewrite of this file was correcting.
//   · THE GRID GOT ITS *WIDTH* CAP FOR FREE, and it is worth its own case. Cell
//     HEIGHT was untied from the viewport by `mainAxisExtent: 44`; cell WIDTH
//     never was, and `crossAxisCount: 7` puts every extra pixel into it. The
//     480 list cap is what stops a 900 px window drawing 44 px-tall letterboxes.
//
// 🔴 THE ONE RULE SPECIFIC TO THIS SCREEN: the grid assertion is on CELL HEIGHT
// (and now cell WIDTH), never on the grid's total height. `CalendarScreen.build`
// calls `DateTime.now()` directly, so the row count is 5 or 6 depending on which
// month the suite runs in — a total-height assertion would be green in September
// and red in November for reasons that have nothing to do with the code. A
// single cell's extents are month-independent AND, after the fix,
// viewport-independent, which is exactly the property under test. (Injecting a
// clock seam would make the total assertable; that is a refactor this port
// deliberately does not make.)
//
// ⚠️ THE SAME CLOCK IS WHY THE SELECTION CASES BRING THEIR OWN REPOSITORY. The
// shipped seed data renews on FIXED absolute dates (`data/seed/demo_data.dart`
// — July, August and September 2026), so "which days have a dot" is a fact about
// the month the suite happens to run in: in October 2026 the month is empty and
// there is nothing to select. The width cases can live with that (a `ListView`
// is offered its width whether or not it has rows); a case that TAPS a day
// cannot, so those two pump a `_FixedRepository` whose renewals are computed
// from `DateTime.now()` and therefore land in whatever month it is.
// ─────────────────────────────────────────────────────────────────────────────
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:nikatru_design_system/nikatru_design_system.dart';
import 'package:subly/data/models/subscription.dart';
import 'package:subly/data/subscriptions/subscription_repository.dart';
import 'package:subly/features/calendar/calendar_screen.dart';
import 'package:subly/features/shared/widgets.dart' show SectionHeader;
import 'package:subly/state/providers.dart';

import 'support/width_harness.dart';

/// The two surfaces `AppBreakpoints.expanded` sits between.
///
/// Local to this file rather than added to the harness: they exist to pin ONE
/// widget's boundary, and a shared constant named for a breakpoint would invite
/// screens with a different breakpoint to reuse it. The height is [kDesktop]'s,
/// so the only variable between the pair is the one under test.
const Size kJustBelowSplit = Size(839, 900);
const Size kAtSplit = Size(840, 900);

void main() {
  Finder gridPane() => find.byKey(const Key('calendar-grid-pane'));
  Finder dayPane() => find.byKey(const Key('calendar-day-pane'));

  /// The heading of the renewals section inside [pane] — read off the widget
  /// rather than matched as text.
  ///
  /// ⚠️ DELIBERATELY NOT `find.text('By date')`. The default heading is an arb
  /// string, so a text matcher would turn a copy edit into a red behaviour test
  /// — the same disarm-by-editing-an-.arb failure `width_harness.dart`'s header
  /// records for `getSize` vs `constraints`. Reading `SectionHeader.title` lets
  /// the assertions below compare headings to EACH OTHER, which is a property of
  /// the layout and not of the copy.
  String headingIn(WidgetTester tester, Finder pane) => tester
      .widget<SectionHeader>(
        find.descendant(of: pane, matching: find.byType(SectionHeader)),
      )
      .title;

  /// The first BUILT day cell.
  ///
  /// Indices before the month's first weekday return `SizedBox.shrink()`, not a
  /// `Container`, so the first `Container` under the `GridView` is a real day
  /// cell — and it precedes its own 4 px renewal-dot `Container` in the element
  /// walk, so `.first` is the tile and never the dot. (The `Material`/`InkWell`
  /// the two-pane mode wraps a tappable cell's CONTENT in is neither, so it does
  /// not come between them.)
  Finder firstDayCell() => find
      .descendant(of: find.byType(GridView), matching: find.byType(Container))
      .first;

  // ── BELOW 840 · one column, ContentPane.reading (AppBreakpoints.reading) ───
  //
  // 🔴 THESE CASES PIN "NOTHING MOVED". They were rewritten once already, on
  // 2026-08-21, because they asserted `kMaxBodyWidth` (1280) — a cap that could
  // not bind, since `AppScaffold` gives the body `min(W - 361, 1280)`, so a 1440
  // px window offers 1079. The numbers below are the ones that replaced it, and
  // the `TwoPane` adoption must not move them: single column is the whole point
  // of the phone and the small tablet.
  group('below the split the calendar is one capped column', () {
    testWidgets('at 375 the cap is a no-op and nothing overflows', (
      WidgetTester tester,
    ) async {
      await pumpAt(tester, kPhone, const CalendarScreen());
      expect(
        offeredWidth(tester, inPaneOf(gridPane(), ListView)),
        375,
        reason:
            'below the cap a ConstrainedBox may only tighten within what it '
            'was handed, so a phone must render exactly as it did before the '
            'pane existed — and the gutters stay INSIDE the ListView, which is '
            'why this is 375 and not 375 less two gutters',
      );
      expect(
        dayPane(),
        findsNothing,
        reason:
            'TwoPane does not BUILD the detail below the breakpoint, even '
            'though this screen always passes a non-null one — building it '
            'off-screen would render every renewal row twice and pay for a '
            'second ListView nobody can see',
      );
      expect(
        tester.takeException(),
        isNull,
        reason:
            'the month grid, the weekday header and the renewal rows must all '
            'lay out clean on the narrowest phone',
      );
    });

    // 🔴 THE CASE THAT CARRIED THE PREVIOUS CHANGE. Under the old 1280 cap this
    // read `expect(…, 768)` — the cap was a no-op and the tablet rendered as a
    // wide phone. 720 is the first width at which the pane does anything at all,
    // and it is a width real hardware ships at, unlike 1920.
    testWidgets('at 768 the cap BINDS — the tablet is not a wide phone', (
      WidgetTester tester,
    ) async {
      await pumpAt(tester, kTablet, const CalendarScreen());
      expect(
        offeredWidth(tester, inPaneOf(gridPane(), ListView)),
        AppBreakpoints.reading,
        reason:
            'a seven-column month grid puts every extra pixel into cell WIDTH '
            'while mainAxisExtent holds the height at 44, so 768 would already '
            'be a row of letterboxes around 12 pt numerals',
      );
      expect(dayPane(), findsNothing);
    });

    // ⚠️ THE HALF THAT KEEPS THE SPLIT FROM CREEPING DOWNWARD. 839 is the widest
    // single column this screen can be asked for, and it is a width the SHELL
    // actually produces: `AppScaffold` hands the body `min(W - 361, 1280)`, so a
    // 1200 px window is 839 px of body. Without this case an off-by-one in the
    // breakpoint would only show up on a window nobody in the suite pins.
    testWidgets('at 839 there is still exactly one column', (
      WidgetTester tester,
    ) async {
      await pumpAt(tester, kJustBelowSplit, const CalendarScreen());
      expect(
        offeredWidth(tester, inPaneOf(gridPane(), ListView)),
        AppBreakpoints.reading,
      );
      expect(dayPane(), findsNothing);
      expect(
        find.byType(SectionHeader),
        findsOneWidget,
        reason:
            'one column means the renewals are still the TAIL of the grid '
            'column — one heading, in the master, exactly as on the phone',
      );
    });

    testWidgets('at 375 the renewals are inside the grid column', (
      WidgetTester tester,
    ) async {
      await pumpAt(tester, kPhone, const CalendarScreen());
      expect(
        find.descendant(of: gridPane(), matching: find.byType(SectionHeader)),
        findsOneWidget,
        reason:
            'the shipped phone layout is grid THEN renewals in one scroll '
            'view; the adoption must not lift them out of it',
      );
    });
  });

  // ── AT/ABOVE 840 · TwoPane, and the widths come from TwoPaneSplit ──────────
  group('at the split the grid and the day sit side by side', () {
    // The boundary itself. `TwoPaneSplit` serves the detail first —
    // min(840 - 420 form floor - 1 divider, 720) = 419 — and the list takes what
    // is left, 420. Restated from the constants rather than as two literals, so
    // this case moves with the split's own test rather than drifting from it.
    testWidgets('at 840 the split happens and the list keeps its floor', (
      WidgetTester tester,
    ) async {
      await pumpAt(tester, kAtSplit, const CalendarScreen());
      expect(
        offeredWidth(tester, inPaneOf(gridPane(), ListView)),
        AppBreakpoints.form,
        reason:
            'the list is FLOORED at AppBreakpoints.form: at the boundary the '
            'month grid may be no narrower than a large phone, or the split '
            'would have bought a detail column by making the master unusable',
      );
      expect(
        offeredWidth(tester, inPaneOf(dayPane(), ListView)),
        AppBreakpoints.expanded -
            AppBreakpoints.form -
            TwoPaneSplit.dividerWidth,
        reason:
            'the detail is served first but never out of the list floor, so at '
            'exactly 840 it gets 419 — the one width on this screen where the '
            'detail is NARROWER than the master',
      );
    });

    testWidgets('at 1280 the grid is 480 and the day is 720', (
      WidgetTester tester,
    ) async {
      await pumpAt(tester, kDesktop, const CalendarScreen());
      expect(
        offeredWidth(tester, inPaneOf(gridPane(), ListView)),
        AppBreakpoints.pane,
        reason:
            'the ordinary desktop window. The screen\'s own ContentPane.reading '
            'cap (720) can no longer bind on this column — TwoPane caps it at '
            'AppBreakpoints.pane (480) first — and that is the whole reason the '
            'month card stops being a letterbox here',
      );
      expect(
        offeredWidth(tester, inPaneOf(dayPane(), ListView)),
        AppBreakpoints.reading,
        reason:
            'the renewal rows are the reading column: 44 px date + rule + '
            'name/due + price, capped where prose is capped',
      );
    });

    testWidgets('at 1920 neither column grows — the leftover is split', (
      WidgetTester tester,
    ) async {
      await pumpAt(tester, kWide, const CalendarScreen());
      expect(
        offeredWidth(tester, inPaneOf(gridPane(), ListView)),
        AppBreakpoints.pane,
        reason:
            'past TwoPaneSplit.maxTotalWidth (1201) the PAIR stops growing. '
            'Without the pane caps this is the case that goes red: a 1900 px '
            'row with a day numeral at one edge and a price at the other',
      );
      expect(
        offeredWidth(tester, inPaneOf(dayPane(), ListView)),
        AppBreakpoints.reading,
      );
    });

    testWidgets('the renewals move to the detail column, they are not copied', (
      WidgetTester tester,
    ) async {
      await pumpAt(tester, kDesktop, const CalendarScreen());
      expect(
        find.descendant(of: gridPane(), matching: find.byType(SectionHeader)),
        findsNothing,
        reason:
            'the master keeps the title, the caption and the grid; leaving the '
            'by-date section in it as well would render every renewal row '
            'twice, once in each column',
      );
      expect(
        find.descendant(of: dayPane(), matching: find.byType(SectionHeader)),
        findsOneWidget,
      );
    });

    testWidgets('with nothing selected the detail is the whole month', (
      WidgetTester tester,
    ) async {
      await pumpAt(tester, kPhone, const CalendarScreen());
      final String phone = headingIn(tester, gridPane());
      await pumpAt(tester, kDesktop, const CalendarScreen());
      expect(
        headingIn(tester, dayPane()),
        phone,
        reason:
            'a cold start on a wide window must not show an empty column with '
            'a "select something" prompt: the unselected detail IS the list '
            'that sat under the grid on the phone, under the same heading. '
            'That is also why TwoPane.placeholder is unreachable here.',
      );
    });
  });

  // ── THE CELL'S WIDTH · the half `mainAxisExtent` could not fix ─────────────
  //
  // `mainAxisExtent: 44` unties cell HEIGHT from the viewport. Nothing unties
  // the width: `crossAxisCount: 7` is semantic, so the cell is
  // (column − 36 gutter − 32 card padding − 18 crossAxisSpacing) / 7 at every
  // width. The list cap is therefore the ONLY thing standing between a wide
  // window and a 44 px-tall letterbox, and it is worth measuring directly —
  // a screen that dropped TwoPane and kept ContentPane.reading would pass every
  // height assertion in this file.
  group('the day cell stays legible as the window grows', () {
    // (720 − 36 − 32 − 18) / 7 and (480 − 36 − 32 − 18) / 7. Written as the
    // arithmetic rather than as 90.57/56.29 so that a gutter or card-padding
    // change shows up as a red case with a readable diff instead of a mystery
    // decimal.
    const double singleColumnCell = (AppBreakpoints.reading - 36 - 32 - 18) / 7;
    const double twoPaneCell = (AppBreakpoints.pane - 36 - 32 - 18) / 7;

    testWidgets('at 768 the single column gives it ~90.6 px', (
      WidgetTester tester,
    ) async {
      await pumpAt(tester, kTablet, const CalendarScreen());
      expect(
        tester.getSize(firstDayCell()).width,
        closeTo(singleColumnCell, 0.01),
        reason:
            'the shipped one-column shape: already a 2:1 box around a 12 pt '
            'numeral, which is why 720 was chosen as the cap and not 960',
      );
    });

    testWidgets('at 1280 the two-pane grid is NARROWER, not wider', (
      WidgetTester tester,
    ) async {
      await pumpAt(tester, kDesktop, const CalendarScreen());
      final double w = tester.getSize(firstDayCell()).width;
      expect(w, closeTo(twoPaneCell, 0.01));
      expect(
        w,
        lessThan(singleColumnCell),
        reason:
            'THE POINT OF PUTTING THE GRID IN THE MASTER COLUMN. Handing the '
            'calendar the whole 1280 would draw ~171 x 44 cells; handing it 720 '
            'draws ~91 x 44. The 480 list cap draws ~56 x 44, which is within '
            '15 px of the ~41 the design was actually drawn at.',
      );
    });

    testWidgets('at 1920 it is the same cell as at 1280', (
      WidgetTester tester,
    ) async {
      await pumpAt(tester, kWide, const CalendarScreen());
      expect(
        tester.getSize(firstDayCell()).width,
        closeTo(twoPaneCell, 0.01),
        reason:
            'past 1201 TwoPane splits the leftover between the outer edges '
            'rather than donating it to a column, so no window width can widen '
            'this cell again',
      );
    });
  });

  // ── SELECTION · the master-detail behaviour the split exists for ───────────
  //
  // See the file header for why these two cases pump their own repository.
  group('selecting a day narrows the detail column', () {
    final DateTime now = DateTime.now();
    Subscription on(String id, String name, int day) => Subscription(
      id: id,
      name: name,
      category: 'Streaming',
      price: 10,
      cycle: BillingCycle.monthly,
      nextRenewal: DateTime(now.year, now.month, day),
    );

    // Two days that every month has, far enough apart that neither cell can be
    // mistaken for the other, and both computed from `now` so the month under
    // test is always the month the screen renders.
    final List<Override> fixed = <Override>[
      subscriptionRepositoryProvider.overrideWithValue(
        _FixedRepository(<Subscription>[
          on('a', 'Netflix', 15),
          on('b', 'Spotify', 20),
        ]),
      ),
    ];

    /// The day-15 cell, scoped through the `GridView` so a price or a due
    /// phrase containing "15" in the other column cannot be tapped by mistake.
    Finder dayCell(String numeral) => find.descendant(
      of: find.byType(GridView),
      matching: find.text(numeral),
    );

    testWidgets('tapping a day with renewals filters the detail to it', (
      WidgetTester tester,
    ) async {
      await pumpAt(tester, kDesktop, const CalendarScreen(), overrides: fixed);
      expect(find.text('Netflix'), findsOneWidget);
      expect(
        find.text('Spotify'),
        findsOneWidget,
        reason: 'unselected, the detail column carries the whole month',
      );
      final String monthHeading = headingIn(tester, dayPane());

      await tester.tap(dayCell('15'));
      await tester.pump();
      await tester.pump();

      expect(find.text('Netflix'), findsOneWidget);
      expect(
        find.text('Spotify'),
        findsNothing,
        reason:
            'the 20th is not the selected day, so its row belongs to the '
            'month view the user just left',
      );
      final String dayHeading = headingIn(tester, dayPane());
      expect(dayHeading, isNot(monthHeading));
      expect(
        dayHeading,
        contains('15'),
        reason:
            'the heading for one day is that DATE, formatted from the same '
            'symbol table as the grid numerals — asserting it contains the day '
            'rather than matching "August 15, 2026" keeps the case honest in a '
            'locale that orders or spells the parts differently',
      );

      // The toggle back. It is the only route to the whole month, so if it
      // stops working the user is stranded on one day until they restart.
      await tester.tap(dayCell('15'));
      await tester.pump();
      await tester.pump();
      expect(find.text('Spotify'), findsOneWidget);
      expect(headingIn(tester, dayPane()), monthHeading);
    });

    testWidgets('below the split a day tap changes nothing', (
      WidgetTester tester,
    ) async {
      await pumpAt(tester, kPhone, const CalendarScreen(), overrides: fixed);
      expect(find.text('Netflix'), findsOneWidget);
      expect(find.text('Spotify'), findsOneWidget);

      await tester.tap(dayCell('15'));
      await tester.pump();
      await tester.pump();

      expect(
        find.text('Spotify'),
        findsOneWidget,
        reason:
            'ONE COLUMN HAS NOWHERE TO PUT A SELECTION. A phone that filtered '
            'its own list on a grid tap would hide 11 of 12 renewals behind a '
            'gesture with no visible affordance and no way back that the user '
            'could see — so the cell is not a control at all below 840.',
      );
      expect(
        tester.takeException(),
        isNull,
        reason: 'and tapping a non-control must not throw',
      );
    });
  });

  // ── THE SQ-GRID DEFECT · the delegate, not the pane ────────────────────────
  group('the month grid decouples cell height from viewport width', () {
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
    //
    // ⚠️ THESE STAY ON THE PHONE, and that is now a deliberate choice rather
    // than the only option: 375 is both the narrowest cell (41.3 px) and the
    // single-column path, so it remains the worst case for the wrap. The
    // two-pane cell is ~56 px wide and cannot reach it.
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

/// The subscriptions the selection cases need, and nothing else.
///
/// Copied in shape from `reminder_plan_test.dart`'s: `implements` plus a
/// throwing `noSuchMethod`, so a screen that starts calling `budget()` or
/// `entitlements()` fails LOUDLY here rather than being handed a plausible
/// empty answer that quietly changes what these cases measure.
class _FixedRepository implements SubscriptionRepository {
  _FixedRepository(this.subs);
  final List<Subscription> subs;

  @override
  Future<List<Subscription>> fetchAll() async => subs;

  @override
  dynamic noSuchMethod(Invocation invocation) =>
      throw UnimplementedError('${invocation.memberName} is not under test');
}
