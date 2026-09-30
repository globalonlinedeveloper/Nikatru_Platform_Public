// ─────────────────────────────────────────────────────────────────────────────
// THE CALENDAR IN EVERY STATE, AT EVERY WINDOW CLASS — train ST-D2.
//
// Loading, empty, error, offline and populated, each at compact / medium /
// expanded / large, on the app's real theme. `data_states_test.dart` owns the
// cross-screen rule (the three data states are mutually exclusive, on every
// screen, at phone width); this file owns what the CALENDAR draws in each of
// them, including the two the shared file has no case for: OFFLINE (the
// chassis banner over a real month, not a failure screen) and POPULATED (the
// foundation components, the marked days, and the rows).
// ─────────────────────────────────────────────────────────────────────────────
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:nikatru_design_system/nikatru_design_system.dart';

import 'support/calendar_fixture.dart';

void main() {
  for (final MapEntry<String, Size> w in kCalendarWindows.entries) {
    final Size size = w.value;
    group('${w.key} (${size.width.toInt()})', () {
      testWidgets('loading: one loading state, no grid, no rows', (
        WidgetTester tester,
      ) async {
        await pumpCalendar(
          tester,
          size: size,
          repository: CalendarRepository.pending(),
        );
        expect(find.byKey(DataStateView.loadingKey), findsOneWidget);
        expect(find.byType(MonthGrid), findsNothing);
        expect(find.byType(AppListRow), findsNothing);
        expect(tester.takeException(), isNull);
      });

      testWidgets('empty: the ACCOUNT is empty, so the grid is replaced', (
        WidgetTester tester,
      ) async {
        await pumpCalendar(
          tester,
          size: size,
          repository: CalendarRepository.empty(),
        );
        expect(find.byKey(DataStateView.emptyKey), findsOneWidget);
        expect(find.byKey(DataStateView.retryKey), findsNothing);
        expect(find.byType(MonthGrid), findsNothing);
      });

      testWidgets('error: a failure with a retry that FETCHES AGAIN', (
        WidgetTester tester,
      ) async {
        final CalendarRepository repo = CalendarRepository.failing();
        await pumpCalendar(tester, size: size, repository: repo);
        expect(find.byKey(DataStateView.failedKey), findsOneWidget);
        expect(find.byType(MonthGrid), findsNothing);
        final int before = repo.fetches;
        await tester.tap(find.byKey(DataStateView.retryKey));
        for (int i = 0; i < 6; i++) {
          await tester.pump();
        }
        expect(
          repo.fetches,
          greaterThan(before),
          reason: 'a retry that re-runs nothing is a dead end with a button',
        );
      });

      testWidgets('offline: the banner sits over a REAL month, not a failure', (
        WidgetTester tester,
      ) async {
        await pumpCalendar(
          tester,
          size: size,
          repository: CalendarRepository.populated(),
          offline: true,
        );
        expect(find.byType(OfflineNotice), findsOneWidget);
        expect(find.byType(MonthGrid), findsOneWidget);
        expect(find.byKey(DataStateView.failedKey), findsNothing);
        expect(find.text('Netflix'), findsOneWidget);
        expect(tester.takeException(), isNull);
      });

      testWidgets('populated: the grid marks renewal days; rows are rows', (
        WidgetTester tester,
      ) async {
        await pumpCalendar(
          tester,
          size: size,
          repository: CalendarRepository.populated(),
        );
        expect(tester.takeException(), isNull);
        final MonthGrid grid = tester.widget<MonthGrid>(find.byType(MonthGrid));
        expect(grid.marks, <int, int>{10: 1, 11: 1, 15: 2, 24: 1});
        expect(grid.today, kCalendarNow());
        expect(
          find.byType(AppListRow),
          findsNWidgets(kCalendarSubs.length),
          reason: 'every renewal of the month, once — in whichever column',
        );
        // Tomorrow is urgent and says so in words AND in the warn tone.
        final AppListRow adobe = tester.widget<AppListRow>(
          find.widgetWithText(AppListRow, 'Adobe CC'),
        );
        expect(adobe.status, StatusKind.warn);
        expect(adobe.subtitle, isNotEmpty);
        final AppListRow gym = tester.widget<AppListRow>(
          find.widgetWithText(AppListRow, 'Gym'),
        );
        expect(gym.status, isNull, reason: 'in 14 days is not a warning');
        expect(find.byType(DateBadge), findsNWidgets(kCalendarSubs.length));
      });
    });
  }

  // The split is a window-class decision, so it is asserted per class: from
  // expanded up the grid's marked days are controls and a tap narrows the
  // detail; below it there is nowhere to put a selection.
  testWidgets('compact/medium: no day is a control', (
    WidgetTester tester,
  ) async {
    for (final String k in <String>['compact', 'medium']) {
      await pumpCalendar(
        tester,
        size: kCalendarWindows[k]!,
        repository: CalendarRepository.populated(),
      );
      expect(
        tester.widget<MonthGrid>(find.byType(MonthGrid)).onDayTap,
        isNull,
        reason: k,
      );
    }
  });

  testWidgets('large: tapping the 15th narrows the detail to its two rows', (
    WidgetTester tester,
  ) async {
    await pumpCalendar(
      tester,
      size: kCalendarWindows['large']!,
      repository: CalendarRepository.populated(),
    );
    expect(find.byType(AppListRow), findsNWidgets(kCalendarSubs.length));
    await tester.tap(find.byKey(MonthGrid.dayKey(15)));
    await tester.pump();
    expect(find.byType(AppListRow), findsNWidgets(2));
    expect(tester.widget<MonthGrid>(find.byType(MonthGrid)).selectedDay, 15);
    await tester.tap(find.byKey(MonthGrid.dayKey(15)));
    await tester.pump();
    expect(find.byType(AppListRow), findsNWidgets(kCalendarSubs.length));
  });
}
