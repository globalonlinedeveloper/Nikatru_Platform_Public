// AppListGroup — train ST-D1. One card, a hairline between each pair of rows,
// inset by the row gutter; the three required windows.

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:nikatru_design_system/nikatru_design_system.dart';

const Size kPhone = Size(375, 812);
const Size kTablet = Size(768, 1024);
const Size kDesktop = Size(1280, 800);

Future<void> pumpAt(
  WidgetTester tester,
  Size size,
  Widget w, {
  Brightness brightness = Brightness.light,
}) async {
  tester.view.physicalSize = size;
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.reset);
  await tester.pumpWidget(
    MaterialApp(
      theme: buildAppTheme(
        seed: const Color(0xFF6459F5),
        brightness: brightness,
      ),
      home: Scaffold(
        body: ListView(
          padding: const EdgeInsets.all(AppSpacing.lg),
          children: <Widget>[w],
        ),
      ),
    ),
  );
}

List<Widget> rows(int n) => <Widget>[
  for (int i = 0; i < n; i++)
    AppListRow(title: 'Row $i', figure: '$i', onTap: () {}),
];

void main() {
  for (final Brightness b in Brightness.values) {
    testWidgets('${b.name}: n rows, n - 1 inset hairlines, one card', (
      WidgetTester tester,
    ) async {
      await pumpAt(
        tester,
        kPhone,
        AppListGroup(children: rows(3)),
        brightness: b,
      );
      expect(find.byType(AppCard), findsOneWidget);
      final List<Divider> dividers = tester
          .widgetList<Divider>(find.byType(Divider))
          .toList();
      expect(dividers, hasLength(2));
      final ThemeData theme = Theme.of(tester.element(find.text('Row 0')));
      for (final Divider d in dividers) {
        expect(d.indent, AppSpacing.lg);
        expect(d.endIndent, AppSpacing.lg);
        expect(d.color, theme.colorScheme.outlineVariant);
      }
      // The rows' ink reaches the card edge: the card adds no inset (its
      // hairline is the shape's side, drawn over the fill, not a padding).
      expect(
        tester.getSize(find.byType(AppListRow).first).width,
        tester.getSize(find.byType(AppCard)).width,
      );
    });
  }

  testWidgets('one row is still a group, with no divider at all', (
    WidgetTester tester,
  ) async {
    await pumpAt(tester, kPhone, AppListGroup(children: rows(1)));
    expect(find.byType(Divider), findsNothing);
    expect(find.byType(AppListRow), findsOneWidget);
  });

  test('an empty group is refused', () {
    expect(
      () => AppListGroup(children: const <Widget>[]),
      throwsAssertionError,
    );
  });

  for (final Size size in <Size>[kPhone, kTablet, kDesktop]) {
    testWidgets('spans the pane at ${size.width.toInt()}', (
      WidgetTester tester,
    ) async {
      await pumpAt(tester, size, AppListGroup(children: rows(4)));
      expect(
        tester.getSize(find.byType(AppListGroup)).width,
        size.width - 2 * AppSpacing.lg,
      );
      expect(tester.takeException(), isNull);
    });
  }
}
