// AppSummaryCard — train ST-D1. One node for the figure and its meaning,
// tabular figures that scale down instead of overflowing, scheme-painted in
// both schemes with every word measured on its ground, and the three required
// windows.

import 'package:flutter/material.dart';
import 'package:flutter/semantics.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:nikatru_design_system/nikatru_design_system.dart';

const Size kPhone = Size(375, 812);
const Size kTablet = Size(768, 1024);
const Size kDesktop = Size(1280, 800);

double contrast(Color a, Color b) {
  final double la = a.computeLuminance();
  final double lb = b.computeLuminance();
  final double hi = la > lb ? la : lb;
  final double lo = la > lb ? lb : la;
  return (hi + 0.05) / (lo + 0.05);
}

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

const AppSummaryCard card = AppSummaryCard(
  label: 'MONTHLY SPEND',
  figure: r'$1,234.56',
  facts: <String>['6 active', r'$14,815 / yr'],
  stats: <SummaryStat>[
    SummaryStat(label: 'DUE IN 7 DAYS', value: r'$27.48'),
    SummaryStat(label: 'DUE IN 30 DAYS', value: r'$1,109.90'),
  ],
);

void main() {
  testWidgets('the figure is announced WITH its label, as one node', (
    WidgetTester tester,
  ) async {
    final SemanticsHandle handle = tester.ensureSemantics();
    await pumpAt(tester, kPhone, card);
    expect(
      find.bySemanticsLabel('MONTHLY SPEND\n\$1,234.56'),
      findsOneWidget,
      reason: 'a bare number with no meaning is what a reader heard before',
    );
    expect(find.bySemanticsLabel('DUE IN 7 DAYS\n\$27.48'), findsOneWidget);
    // Facts are read-only: no button role anywhere on the card.
    final SemanticsNode chip = tester.getSemantics(find.text('6 active'));
    expect(chip.flagsCollection.isButton, isFalse);
    handle.dispose();
  });

  testWidgets('the figures are tabular', (WidgetTester tester) async {
    await pumpAt(tester, kPhone, card);
    for (final String s in <String>[r'$1,234.56', r'$27.48']) {
      expect(
        tester.widget<Text>(find.text(s)).style!.fontFeatures,
        contains(const FontFeature.tabularFigures()),
      );
    }
  });

  testWidgets('200 % text on a 320 px phone scales the figure, never clips', (
    WidgetTester tester,
  ) async {
    tester.platformDispatcher.textScaleFactorTestValue = 2;
    addTearDown(tester.platformDispatcher.clearTextScaleFactorTestValue);
    await pumpAt(
      tester,
      const Size(320, 900),
      const AppSummaryCard(
        label: 'MONTHLY SPEND',
        figure: r'$12,345,678.90',
        stats: <SummaryStat>[
          SummaryStat(label: 'DUE IN 7 DAYS', value: r'$1,234,567.00'),
          SummaryStat(label: 'DUE IN 30 DAYS', value: r'$7,654,321.00'),
        ],
      ),
    );
    expect(tester.takeException(), isNull);
    // Every digit is still on the card.
    final Rect cardRect = tester.getRect(find.byType(AppCard));
    final Rect figure = tester.getRect(find.text(r'$12,345,678.90'));
    expect(cardRect.contains(figure.topLeft), isTrue);
    expect(figure.right, lessThanOrEqualTo(cardRect.right));
  });

  for (final Brightness b in Brightness.values) {
    testWidgets('${b.name}: every word clears AA on its own ground', (
      WidgetTester tester,
    ) async {
      await pumpAt(tester, kPhone, card, brightness: b);
      final ThemeData theme = Theme.of(tester.element(find.text('6 active')));
      final Color fill = AppCard.fillOf(theme);
      final Color chip = theme.colorScheme.secondaryContainer;
      final Map<String, Color> grounds = <String, Color>{
        'MONTHLY SPEND': fill,
        r'$1,234.56': fill,
        '6 active': chip,
        r'$14,815 / yr': chip,
        'DUE IN 7 DAYS': fill,
        r'$27.48': fill,
        'DUE IN 30 DAYS': fill,
        r'$1,109.90': fill,
      };
      grounds.forEach((String s, Color ground) {
        final Color ink = tester.widget<Text>(find.text(s)).style!.color!;
        expect(ink.a, 1.0);
        expect(
          contrast(ink, ground),
          greaterThanOrEqualTo(4.5),
          reason: '"$s" is $ink on $ground under ${b.name}',
        );
      });
      // The chip ground itself is drawn from the slot the test measured.
      expect(
        tester
            .widgetList<DecoratedBox>(
              find.ancestor(
                of: find.text('6 active'),
                matching: find.byType(DecoratedBox),
              ),
            )
            .map((DecoratedBox d) => (d.decoration as BoxDecoration).color)
            .first,
        chip,
      );
    });
  }

  for (final Size size in <Size>[kPhone, kTablet, kDesktop]) {
    testWidgets('spans the pane at ${size.width.toInt()}', (
      WidgetTester tester,
    ) async {
      await pumpAt(tester, size, card);
      expect(
        tester.getSize(find.byType(AppSummaryCard)).width,
        size.width - 2 * AppSpacing.lg,
      );
      expect(tester.takeException(), isNull);
    });
  }
}
