// TWO-PANE NUMBERS PER WINDOW CLASS — train ST-D0.
//
// `two_pane_test.dart` pins the split as a function of the width TwoPane is
// GIVEN. This pins what it is given in the chassis: a TwoPane as the body of
// an AppScaffold, at one window per class, with the navigation control of that
// class (ADR 083: bar at compact, slim rail at medium, extended rail at
// expanded, slim rail from large up with the body capped at extra-large)
// taking its width first. The rail's width is READ OFF THE WIDGET, never
// assumed — it is whatever Material renders for the longest label.

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:nikatru_design_system/nikatru_design_system.dart';

const Key _list = Key('list');
const Key _detail = Key('detail');

Future<void> _pump(WidgetTester tester, double width) async {
  tester.view.physicalSize = Size(width, 900);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.reset);
  await tester.pumpWidget(
    MaterialApp(
      theme: buildAppTheme(seed: const Color(0xFF6459F5)),
      home: AppScaffold(
        destinations: const <AppDestination>[
          AppDestination(icon: Icons.home, label: 'Home'),
          AppDestination(icon: Icons.event, label: 'Calendar'),
          AppDestination(icon: Icons.settings, label: 'Settings'),
        ],
        selectedIndex: 0,
        onDestinationSelected: (_) {},
        body: const TwoPane(
          list: SizedBox.expand(key: _list),
          detail: SizedBox.expand(key: _detail),
          placeholder: SizedBox.shrink(),
        ),
      ),
    ),
  );
}

double _railWidth(WidgetTester tester) =>
    tester.getSize(find.byType(NavigationRail)).width;

void main() {
  testWidgets('COMPACT (390): one column, the whole window', (
    WidgetTester tester,
  ) async {
    await _pump(tester, 390);
    expect(find.byType(NavigationRail), findsNothing);
    expect(find.byKey(_detail), findsNothing);
    expect(tester.getSize(find.byKey(_list)).width, 390);
  });

  testWidgets('MEDIUM (700): one column beside the slim rail', (
    WidgetTester tester,
  ) async {
    await _pump(tester, 700);
    expect(find.byKey(_detail), findsNothing);
    expect(
      tester.getSize(find.byKey(_list)).width,
      700 - _railWidth(tester) - 1,
    );
  });

  testWidgets('EXPANDED (1024): STILL one column — the extended rail leaves '
      'the body under 840', (WidgetTester tester) async {
    await _pump(tester, 1024);
    final NavigationRail rail = tester.widget(find.byType(NavigationRail));
    expect(rail.extended, isTrue);
    final double body = 1024 - _railWidth(tester) - 1;
    expect(body, lessThan(AppBreakpoints.expanded));
    expect(find.byKey(_detail), findsNothing);
    expect(tester.getSize(find.byKey(_list)).width, body);
  });

  testWidgets('LARGE (1440): list 480 | detail 720 beside the slim rail', (
    WidgetTester tester,
  ) async {
    await _pump(tester, 1440);
    final NavigationRail rail = tester.widget(find.byType(NavigationRail));
    expect(rail.extended, isFalse);
    expect(tester.getSize(find.byKey(_list)).width, AppBreakpoints.pane);
    expect(tester.getSize(find.byKey(_detail)).width, AppBreakpoints.reading);
  });

  testWidgets('EXTRA-LARGE (1920): list 480 | detail 720 inside the 1280 cap', (
    WidgetTester tester,
  ) async {
    await _pump(tester, 1920);
    expect(tester.getSize(find.byKey(_list)).width, AppBreakpoints.pane);
    expect(tester.getSize(find.byKey(_detail)).width, AppBreakpoints.reading);
    // The pair is centred in the capped body: equal leftover either side.
    final double left = tester.getTopLeft(find.byKey(_list)).dx;
    final double right = tester.getTopRight(find.byKey(_detail)).dx;
    final double bodyLeft = _railWidth(tester) + 1;
    final double capLeft =
        bodyLeft + (1920 - bodyLeft - AppBreakpoints.kMaxBodyWidth) / 2;
    expect(left - capLeft, closeTo(capLeft + 1280 - right, 0.5));
  });

  testWidgets('the smallest window that splits is 840 + rail + 1', (
    WidgetTester tester,
  ) async {
    // Measured at the large class, whose slim rail is the one in play at the
    // boundary: 1200 is the first large window.
    await _pump(tester, AppBreakpoints.large);
    final double body = AppBreakpoints.large - _railWidth(tester) - 1;
    expect(body, greaterThanOrEqualTo(AppBreakpoints.expanded));
    expect(find.byKey(_detail), findsOneWidget);
    expect(
      tester.getSize(find.byKey(_list)).width +
          TwoPaneSplit.dividerWidth +
          tester.getSize(find.byKey(_detail)).width,
      lessThanOrEqualTo(body),
    );
  });
}
