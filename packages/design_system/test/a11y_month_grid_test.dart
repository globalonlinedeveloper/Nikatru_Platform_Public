// ─────────────────────────────────────────────────────────────────────────────
// a11y_month_grid_test.dart — the accessibility sweep for `MonthGrid` and
// `DateBadge` (train ST-D2), both schemes: labelled targets, the platform tap
// target (the marked cells are controls here), and text contrast over today,
// a marked day, a selected day and a plain day.
//
// ⚠️ Pumped at 480 wide — `AppBreakpoints.pane`, the width a two-pane master
// column is capped at — because that is where a screen hands the grid an
// `onDayTap`. On a 375 phone a cell is ~45.6 px wide, under 48, which is why a
// screen passes no `onDayTap` in one column (the calendar screen does not).
//
// Named `a11y_*_test.dart` on purpose: `assert-a11y-coverage.mjs` reads a
// corpus of exactly that shape, and credits a sweep to a surface only when the
// surface is CONSTRUCTED and the guideline CALLED in one `testWidgets` body.
// ─────────────────────────────────────────────────────────────────────────────
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:intl/date_symbol_data_local.dart';
import 'package:nikatru_design_system/nikatru_design_system.dart';

void main() {
  setUpAll(() => initializeDateFormatting('en'));

  for (final Brightness b in Brightness.values) {
    testWidgets('MonthGrid and DateBadge, ${b.name}', (
      WidgetTester tester,
    ) async {
      final SemanticsHandle handle = tester.ensureSemantics();
      await tester.binding.setSurfaceSize(const Size(480, 900));
      addTearDown(() => tester.binding.setSurfaceSize(null));
      await tester.pumpWidget(
        MaterialApp(
          theme: buildAppTheme(seed: const Color(0xFF6459F5), brightness: b),
          home: Scaffold(
            body: ListView(
              children: <Widget>[
                AppCard(
                  child: MonthGrid(
                    month: DateTime(2026, 9),
                    locale: 'en',
                    today: DateTime(2026, 9, 10),
                    marks: const <int, int>{10: 1, 15: 2, 20: 1},
                    selectedDay: 15,
                    onDayTap: (_) {},
                  ),
                ),
                AppCard(
                  padding: EdgeInsets.zero,
                  child: AppListRow(
                    leading: DateBadge(
                      date: DateTime(2026, 9, 15),
                      locale: 'en',
                    ),
                    title: 'Netflix',
                    subtitle: 'In 5 days',
                    onTap: () {},
                  ),
                ),
              ],
            ),
          ),
        ),
      );
      expect(find.bySemanticsLabel('Tuesday'), findsOneWidget);
      await expectLater(tester, meetsGuideline(labeledTapTargetGuideline));
      await expectLater(tester, meetsGuideline(androidTapTargetGuideline));
      await expectLater(tester, meetsGuideline(textContrastGuideline));
      handle.dispose();
    });
  }
}
