// NAVIGATION BADGES ARE NEUTRAL — train ST-D0.
//
// A count on a destination, in the bar and in the rail alike, painted in the
// inverse-surface pair rather than Material's error red: a count is not an
// alarm. Its label is on the 12 px floor and its contrast is measured.

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:nikatru_design_system/nikatru_design_system.dart';

double contrast(Color a, Color b) {
  final double la = a.computeLuminance();
  final double lb = b.computeLuminance();
  final double hi = la > lb ? la : lb;
  final double lo = la > lb ? lb : la;
  return (hi + 0.05) / (lo + 0.05);
}

AppScaffold _scaffold({int? badge}) => AppScaffold(
  destinations: <AppDestination>[
    const AppDestination(icon: Icons.home, label: 'Home'),
    AppDestination(icon: Icons.event, label: 'Renewals', badgeCount: badge),
    const AppDestination(icon: Icons.settings, label: 'Settings'),
  ],
  selectedIndex: 0,
  onDestinationSelected: (_) {},
  body: const SizedBox.expand(),
);

Future<void> _pumpAt(WidgetTester tester, Widget w, double width) async {
  tester.view.physicalSize = Size(width, 900);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.reset);
  await tester.pumpWidget(
    MaterialApp(
      theme: buildAppTheme(seed: const Color(0xFF6459F5)),
      home: w,
    ),
  );
}

void main() {
  // 400 is the bar; 700, 1024 and 1440 the slim rail (ADR 083; 1024 was the
  // extended rail until §5, D-02). One builder serves both controls, so every
  // width shows the count.
  for (final double width in <double>[400, 700, 1024, 1440]) {
    testWidgets('a count renders at $width, in the neutral pair', (
      WidgetTester tester,
    ) async {
      await _pumpAt(tester, _scaffold(badge: 3), width);
      final Finder badge = find.byType(Badge);
      expect(badge, findsOneWidget);
      expect(find.text('3'), findsOneWidget);
      // The theme, not the widget, carries the colour: the badge's own
      // properties are null, so read what it RESOLVES to.
      final ThemeData theme = Theme.of(tester.element(badge));
      expect(
        theme.badgeTheme.backgroundColor,
        theme.colorScheme.inverseSurface,
      );
      expect(
        theme.badgeTheme.backgroundColor,
        isNot(theme.colorScheme.error),
        reason: 'a count is not an alarm',
      );
    });
  }

  testWidgets('zero and null render no badge at all', (
    WidgetTester tester,
  ) async {
    await _pumpAt(tester, _scaffold(badge: 0), 400);
    expect(find.byType(Badge), findsNothing);
    await _pumpAt(tester, _scaffold(), 1440);
    expect(find.byType(Badge), findsNothing);
  });

  testWidgets('past 99 reads 99+', (WidgetTester tester) async {
    await _pumpAt(tester, _scaffold(badge: 250), 700);
    expect(find.text('99+'), findsOneWidget);
  });

  test('a negative count is refused', () {
    expect(
      () => AppDestination(icon: Icons.home, label: 'x', badgeCount: -1),
      throwsAssertionError,
    );
  });

  for (final Brightness b in Brightness.values) {
    for (final Color seed in const <Color>[
      Color(0xFF6459F5),
      Color(0xFFE53935),
      Color(0xFF2E7D32),
      Color(0xFFFFB300),
    ]) {
      test(
        '${b.name}, seed $seed: the badge label clears AA, on the floor',
        () {
          final ThemeData theme = buildAppTheme(seed: seed, brightness: b);
          final BadgeThemeData badge = theme.badgeTheme;
          final double r = contrast(badge.textColor!, badge.backgroundColor!);
          expect(r, greaterThanOrEqualTo(4.5), reason: r.toStringAsFixed(2));
          expect(
            badge.textStyle!.fontSize,
            greaterThanOrEqualTo(AppTypeRamp.minimumSize),
          );
        },
      );
    }
  }
}
