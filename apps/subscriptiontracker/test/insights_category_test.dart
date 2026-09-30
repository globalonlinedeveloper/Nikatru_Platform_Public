// BY CATEGORY — train ST-D3, label D3-5. Ranked bars read as one sentence per
// row, the same numbers as a table, and no share claimed for a currency the
// total is not in.
//
// MUTATION PROOF: drop `excludeSemantics: true` from a row in
// `category_card.dart` and "each row is ONE node" goes red on the name heard
// twice; delete the table arm and "the table view" goes red.

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:subscriptiontracker/core/format/money_format.dart';
import 'package:subscriptiontracker/core/format/sub_math.dart';
import 'package:subscriptiontracker/features/insights/category_card.dart';
import 'package:subscriptiontracker/l10n/app_localizations.dart';

MoneyBag _usd(int minor) => MoneyBag.sum(<Money>[Money(minor, 'USD')]);

Future<void> _pump(WidgetTester tester, List<CategoryTotal> cats) async {
  await tester.pumpWidget(
    MaterialApp(
      localizationsDelegates: AppLocalizations.localizationsDelegates,
      supportedLocales: AppLocalizations.supportedLocales,
      home: Scaffold(
        body: SingleChildScrollView(
          child: CategoryCard(
            categories: cats,
            money: const MoneyFormatter('en', emptyCurrencyCode: 'USD'),
            currencyCode: 'USD',
            perYear: false,
          ),
        ),
      ),
    ),
  );
  await tester.pump();
}

void main() {
  final List<CategoryTotal> cats = <CategoryTotal>[
    CategoryTotal('Video', _usd(3000)),
    CategoryTotal('Music', _usd(1000)),
  ];

  testWidgets('each row is ONE node: name, amount, share', (
    WidgetTester tester,
  ) async {
    final SemanticsHandle h = tester.ensureSemantics();
    await _pump(tester, cats);
    expect(
      find.bySemanticsLabel('Video: \$30, 75% of the total'),
      findsOneWidget,
    );
    expect(
      find.bySemanticsLabel('Music: \$10, 25% of the total'),
      findsOneWidget,
    );
    expect(
      find.bySemanticsLabel('Video'),
      findsNothing,
      reason: 'the name heard on its own is the row split into fragments',
    );
    h.dispose();
  });

  testWidgets('bars are ranked and relative to the largest', (
    WidgetTester tester,
  ) async {
    await _pump(tester, cats);
    final List<double?> values = tester
        .widgetList<LinearProgressIndicator>(
          find.byType(LinearProgressIndicator),
        )
        .map((LinearProgressIndicator p) => p.value)
        .toList();
    expect(values, <double>[1, 1 / 3]);
  });

  testWidgets('the table view holds the same numbers, with headers', (
    WidgetTester tester,
  ) async {
    await _pump(tester, cats);
    expect(find.byKey(CategoryCard.table), findsNothing);
    await tester.tap(find.byKey(CategoryCard.tableToggle));
    await tester.pump();
    expect(find.byKey(CategoryCard.table), findsOneWidget);
    for (final String t in <String>[
      'Category',
      'Amount',
      'Share',
      'Video',
      r'$30',
      '75%',
    ]) {
      expect(
        find.descendant(
          of: find.byKey(CategoryCard.table),
          matching: find.text(t),
        ),
        findsOneWidget,
        reason: '"$t" is missing from the table',
      );
    }
    expect(find.byType(LinearProgressIndicator), findsNothing);
  });

  testWidgets('a category in another currency claims no share', (
    WidgetTester tester,
  ) async {
    final SemanticsHandle h = tester.ensureSemantics();
    await _pump(tester, <CategoryTotal>[
      CategoryTotal('Video', _usd(3000)),
      CategoryTotal('Cloud', MoneyBag.sum(const <Money>[Money(9900, 'INR')])),
    ]);
    expect(find.bySemanticsLabel(RegExp(r'^Cloud: ₹99$')), findsOneWidget);
    expect(find.text('0%'), findsNothing);
    h.dispose();
  });
}
