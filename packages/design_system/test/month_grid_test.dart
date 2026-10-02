// MonthGrid and DateBadge — train ST-D2. The locale's week, the header read
// aloud, the fixed cell at every window, the text-scale ceiling, which cells
// are controls, and every fill pair measured in both schemes.

import 'dart:ui' show Tristate;

import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:intl/date_symbol_data_local.dart';
import 'package:nikatru_design_system/nikatru_design_system.dart';

const Size kPhone = Size(375, 812);
const Size kTablet = Size(768, 1024);
const Size kDesktop = Size(1280, 800);

/// September 2026: the 1st is a TUESDAY, which puts it in a different column
/// for a Sunday-first and a Monday-first week — the property under test.
final DateTime kMonth = DateTime(2026, 9, 1);

double contrast(Color a, Color b) {
  final double la = a.computeLuminance();
  final double lb = b.computeLuminance();
  final double hi = la > lb ? la : lb;
  final double lo = la > lb ? lb : la;
  return (hi + 0.05) / (lo + 0.05);
}

ThemeData themeFor(Brightness b) =>
    buildAppTheme(seed: const Color(0xFF6459F5), brightness: b);

Future<void> pumpAt(
  WidgetTester tester,
  Size size,
  Widget w, {
  double textScale = 1,
}) async {
  tester.view.physicalSize = size;
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.reset);
  await tester.pumpWidget(
    MaterialApp(
      theme: themeFor(Brightness.light),
      home: MediaQuery(
        data: MediaQueryData(
          size: size,
          textScaler: TextScaler.linear(textScale),
        ),
        child: Scaffold(
          body: ListView(
            padding: const EdgeInsets.all(AppSpacing.lg),
            children: <Widget>[AppCard(child: w)],
          ),
        ),
      ),
    ),
  );
}

/// The column (0-based) the cell for [day] sits in.
int columnOf(WidgetTester tester, int day) {
  final Rect grid = tester.getRect(find.byType(GridView));
  final Rect cell = tester.getRect(find.byKey(MonthGrid.dayKey(day)));
  final double pitch = (grid.width + MonthGrid.cellSpacing) / 7;
  return ((cell.left - grid.left) / pitch).round();
}

void main() {
  // An app loads these through `GlobalMaterialLocalizations.delegate`; a bare
  // test has no delegate, so it loads the three locales it draws itself.
  setUpAll(() async {
    await initializeDateFormatting('en');
    await initializeDateFormatting('de');
    await initializeDateFormatting('ta');
  });

  group('the week is the locale\'s', () {
    testWidgets('en starts on Sunday: the 1st (a Tuesday) is column 2', (
      WidgetTester tester,
    ) async {
      await pumpAt(tester, kPhone, MonthGrid(month: kMonth, locale: 'en'));
      expect(columnOf(tester, 1), 2);
      expect(columnOf(tester, 6), 0, reason: '6 Sep 2026 is a Sunday');
    });

    testWidgets('de starts on Monday: the 1st is column 1', (
      WidgetTester tester,
    ) async {
      await pumpAt(tester, kPhone, MonthGrid(month: kMonth, locale: 'de'));
      expect(columnOf(tester, 1), 1);
      expect(columnOf(tester, 7), 0, reason: '7 Sep 2026 is a Monday');
    });

    testWidgets('the header paints narrow letters and SAYS full names', (
      WidgetTester tester,
    ) async {
      final SemanticsHandle handle = tester.ensureSemantics();
      await pumpAt(tester, kPhone, MonthGrid(month: kMonth, locale: 'en'));
      expect(find.text('T'), findsNWidgets(2));
      for (final String day in <String>[
        'Sunday',
        'Monday',
        'Tuesday',
        'Wednesday',
        'Thursday',
        'Friday',
        'Saturday',
      ]) {
        expect(
          find.bySemanticsLabel(day),
          findsOneWidget,
          reason:
              '"T" twice is Tuesday and Thursday to the eye and nothing to '
              'the ear — each column must be its own node with its full name',
        );
      }
      handle.dispose();
    });

    testWidgets('numerals are the locale\'s own digits', (
      WidgetTester tester,
    ) async {
      await pumpAt(tester, kPhone, MonthGrid(month: kMonth, locale: 'en'));
      expect(find.text('30'), findsOneWidget);
      expect(find.text('31'), findsNothing, reason: 'September has 30 days');
    });
  });

  group('the cell is fixed at every window', () {
    for (final Size size in <Size>[kPhone, kTablet, kDesktop]) {
      testWidgets('${size.width.toInt()}: cellExtent tall, 1/7 of the grid', (
        WidgetTester tester,
      ) async {
        await pumpAt(tester, size, MonthGrid(month: kMonth, locale: 'en'));
        expect(tester.takeException(), isNull);
        final Size cell = tester.getSize(find.byKey(MonthGrid.dayKey(1)));
        final double grid = tester.getSize(find.byType(GridView)).width;
        expect(cell.height, MonthGrid.cellExtent);
        expect(
          cell.width,
          closeTo((grid - 6 * MonthGrid.cellSpacing) / 7, 0.01),
        );
      });
    }
  });

  group('text scale has a ceiling, not a freeze', () {
    Finder numeral() => find
        .descendant(
          of: find.byKey(MonthGrid.dayKey(28)),
          matching: find.byType(Text),
        )
        .first;

    for (final double s in <double>[1.3, 2.0, 3.5]) {
      testWidgets('at $s nothing overflows and the cell keeps its extent', (
        WidgetTester tester,
      ) async {
        await pumpAt(
          tester,
          kPhone,
          MonthGrid(
            month: kMonth,
            locale: 'en',
            marks: const <int, int>{28: 1},
          ),
          textScale: s,
        );
        expect(tester.takeException(), isNull);
        expect(
          tester.getSize(find.byKey(MonthGrid.dayKey(28))).height,
          MonthGrid.cellExtent,
        );
      });
    }

    testWidgets('1.3 grows the numeral; 3.5 stops at maxTextScale', (
      WidgetTester tester,
    ) async {
      final MonthGrid grid = MonthGrid(month: kMonth, locale: 'en');
      await pumpAt(tester, kPhone, grid);
      final double at1 = tester.getSize(numeral()).height;
      await pumpAt(tester, kPhone, grid, textScale: 1.3);
      final double at13 = tester.getSize(numeral()).height;
      await pumpAt(tester, kPhone, grid, textScale: 3.5);
      final double at35 = tester.getSize(numeral()).height;
      expect(at13, greaterThan(at1));
      expect(at35, at1 * MonthGrid.maxTextScale);
    });
  });

  group('only a marked day is a control, and only with onDayTap', () {
    testWidgets('no onDayTap: no cell is a button', (
      WidgetTester tester,
    ) async {
      final SemanticsHandle handle = tester.ensureSemantics();
      await pumpAt(
        tester,
        kPhone,
        MonthGrid(month: kMonth, locale: 'en', marks: const <int, int>{15: 2}),
      );
      expect(find.byType(InkWell), findsNothing);
      handle.dispose();
    });

    testWidgets('with onDayTap: the marked day taps, the plain day does not', (
      WidgetTester tester,
    ) async {
      final SemanticsHandle handle = tester.ensureSemantics();
      final List<int> taps = <int>[];
      await pumpAt(
        tester,
        kDesktop,
        MonthGrid(
          month: kMonth,
          locale: 'en',
          marks: const <int, int>{15: 2, 20: 0},
          selectedDay: 15,
          onDayTap: taps.add,
        ),
      );
      expect(
        find.byType(InkWell),
        findsOneWidget,
        reason: 'a zero count is not a mark',
      );
      await tester.tap(find.byKey(MonthGrid.dayKey(15)));
      await tester.tap(find.byKey(MonthGrid.dayKey(16)));
      await tester.tap(find.byKey(MonthGrid.dayKey(20)));
      expect(taps, <int>[15]);

      final SemanticsNode node = tester.getSemantics(
        find.descendant(
          of: find.byKey(MonthGrid.dayKey(15)),
          matching: find.byType(InkWell),
        ),
      );
      expect(node.flagsCollection.isButton, isTrue);
      expect(node.flagsCollection.isSelected, Tristate.isTrue);
      expect(node.label, '15');
      handle.dispose();
    });

    testWidgets('a selection on an unmarked day draws no ring', (
      WidgetTester tester,
    ) async {
      await pumpAt(
        tester,
        kPhone,
        MonthGrid(month: kMonth, locale: 'en', selectedDay: 9),
      );
      final Container cell = tester.widget<Container>(
        find.byKey(MonthGrid.dayKey(9)),
      );
      expect(cell.foregroundDecoration, isNull);
    });
  });

  group('every fill is opaque, from the scheme, and measured', () {
    for (final Brightness b in Brightness.values) {
      test('${b.name}: numeral on each ground clears 4.5:1, ring 3:1', () {
        final ThemeData theme = themeFor(b);
        final ColorScheme s = theme.colorScheme;
        final Color card = AppCard.fillOf(theme);
        expect(contrast(s.onPrimary, s.primary), greaterThanOrEqualTo(4.5));
        expect(
          contrast(s.onPrimaryContainer, s.primaryContainer),
          greaterThanOrEqualTo(4.5),
        );
        expect(contrast(s.onSurface, card), greaterThanOrEqualTo(4.5));
        expect(
          contrast(s.onSurfaceVariant, card),
          greaterThanOrEqualTo(4.5),
          reason: 'the weekday letters',
        );
        expect(
          contrast(s.onSurface, s.primaryContainer),
          greaterThanOrEqualTo(3),
          reason: 'the selection ring on a marked cell (WCAG 1.4.11)',
        );
        expect(contrast(s.onSurface, card), greaterThanOrEqualTo(3));
        expect(s.primary.a, 1.0);
        expect(s.primaryContainer.a, 1.0);
      });
    }

    testWidgets('today is primary / onPrimary; a marked day primaryContainer', (
      WidgetTester tester,
    ) async {
      await pumpAt(
        tester,
        kPhone,
        MonthGrid(
          month: kMonth,
          locale: 'en',
          today: DateTime(2026, 9, 10, 15, 30),
          marks: const <int, int>{12: 1},
        ),
      );
      final ColorScheme s = themeFor(Brightness.light).colorScheme;
      BoxDecoration fillOf(int day) =>
          tester
                  .widget<Container>(find.byKey(MonthGrid.dayKey(day)))
                  .decoration!
              as BoxDecoration;
      expect(fillOf(10).color, s.primary);
      expect(fillOf(12).color, s.primaryContainer);
      expect(fillOf(11).color, isNull);
      final Text today = tester.widget<Text>(
        find.descendant(
          of: find.byKey(MonthGrid.dayKey(10)),
          matching: find.byType(Text),
        ),
      );
      expect(today.style?.color, s.onPrimary);
      expect(
        today.style!.fontSize,
        greaterThanOrEqualTo(AppTypeRamp.minimumSize),
      );
    });

    testWidgets('today outside the drawn month marks nothing', (
      WidgetTester tester,
    ) async {
      await pumpAt(
        tester,
        kPhone,
        MonthGrid(month: kMonth, locale: 'en', today: DateTime(2026, 10, 10)),
      );
      final BoxDecoration d =
          tester.widget<Container>(find.byKey(MonthGrid.dayKey(10))).decoration!
              as BoxDecoration;
      expect(d.color, isNull);
    });
  });

  group('DateBadge', () {
    for (final Size size in <Size>[kPhone, kTablet, kDesktop]) {
      testWidgets('${size.width.toInt()}: fits the list-row leading slot', (
        WidgetTester tester,
      ) async {
        await pumpAt(
          tester,
          size,
          AppListRow(
            leading: DateBadge(date: DateTime(2026, 9, 15), locale: 'en'),
            title: 'Netflix',
            subtitle: 'In 3 days',
          ),
        );
        expect(tester.takeException(), isNull);
        expect(find.text('15'), findsOneWidget);
        expect(
          find.text('Sep'),
          findsOneWidget,
          reason: 'intl\'s abbreviation, NOT upper-cased (locale-blind)',
        );
        final Size badge = tester.getSize(find.byType(DateBadge));
        expect(badge.width, lessThanOrEqualTo(AppListRow.leadingSize));
        expect(badge.height, lessThanOrEqualTo(AppListRow.leadingSize));
      });
    }

    testWidgets('at 2× text it scales down into the slot, never overflows', (
      WidgetTester tester,
    ) async {
      await pumpAt(
        tester,
        kPhone,
        AppListRow(
          leading: DateBadge(date: DateTime(2026, 9, 15), locale: 'en'),
          title: 'Netflix',
        ),
        textScale: 2,
      );
      expect(tester.takeException(), isNull);
    });

    testWidgets('ta: the month is the locale\'s own word', (
      WidgetTester tester,
    ) async {
      await pumpAt(
        tester,
        kPhone,
        DateBadge(date: DateTime(2026, 9, 15), locale: 'ta'),
      );
      expect(find.text('Sep'), findsNothing);
      expect(find.text('15'), findsOneWidget);
    });

    test('both parts are on the ramp, at or above the floor', () {
      final TextTheme t = themeFor(Brightness.light).textTheme;
      expect(t.titleMedium!.fontSize, greaterThanOrEqualTo(12));
      expect(t.labelSmall!.fontSize, greaterThanOrEqualTo(12));
    });
  });

  group('T12 · a chosen week start and deadlines (CA-04, CA-05)', () {
    testWidgets('a chosen Monday start overrides en\'s Sunday', (
      WidgetTester tester,
    ) async {
      await pumpAt(
        tester,
        kPhone,
        MonthGrid(month: kMonth, locale: 'en', firstDayOfWeek: 0),
      );
      // Tuesday the 1st is the SECOND column of a Monday week.
      expect(columnOf(tester, 1), 1);
    });

    testWidgets('a trial ending on the 14th marks the 14th, in words', (
      WidgetTester tester,
    ) async {
      final SemanticsHandle h = tester.ensureSemantics();
      await pumpAt(
        tester,
        kPhone,
        MonthGrid(
          month: kMonth,
          locale: 'en',
          deadlines: const <int, String>{14: 'trial ends'},
        ),
      );
      expect(find.bySemanticsLabel('14, trial ends'), findsOneWidget);
      expect(find.bySemanticsLabel('13, trial ends'), findsNothing);
      h.dispose();
    });
  });
}
