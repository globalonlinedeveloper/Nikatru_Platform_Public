// CATEGORY NAMES BY ID — ST-X8 (audit C6).
//
// The stored category is an ID (the English word it was created under) and
// only its PAINT is translated. A Tamil reader saw "Other" in the Insights
// legend because the legend printed the id.
//
// MUTATION PROOF (run 2026-09-30 on this tree): drop the 'Other' arm from
// `categoryLabel` — the legend then prints the stored id, exactly the audit's
// finding — and this file goes red, both on `find.text('மற்றவை')` and on
// "every id the app can store has a name".

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:subscriptiontracker/core/format/category_label.dart';
import 'package:subscriptiontracker/core/format/money_format.dart';
import 'package:subscriptiontracker/core/format/sub_math.dart';
import 'package:subscriptiontracker/data/models/budget_info.dart';
import 'package:subscriptiontracker/data/seed/demo_data.dart';
import 'package:subscriptiontracker/features/insights/category_card.dart';
import 'package:subscriptiontracker/l10n/app_localizations.dart';

MoneyBag _inr(int minor) => MoneyBag.sum(<Money>[Money(minor, 'INR')]);

Future<void> _pump(WidgetTester tester, Locale locale) async {
  await tester.pumpWidget(
    MaterialApp(
      locale: locale,
      localizationsDelegates: AppLocalizations.localizationsDelegates,
      supportedLocales: AppLocalizations.supportedLocales,
      home: Scaffold(
        body: SingleChildScrollView(
          child: CategoryCard(
            categories: <CategoryTotal>[
              CategoryTotal('Streaming', _inr(30000)),
              CategoryTotal('Other', _inr(10000)),
            ],
            money: MoneyFormatter(
              locale.languageCode,
              emptyCurrencyCode: 'INR',
            ),
            currencyCode: 'INR',
            perYear: false,
          ),
        ),
      ),
    ),
  );
  await tester.pump();
}

void main() {
  final AppLocalizations en = lookupAppLocalizations(const Locale('en'));
  final AppLocalizations ta = lookupAppLocalizations(const Locale('ta'));

  testWidgets("in Tamil, the legend names 'Other' in Tamil", (
    WidgetTester tester,
  ) async {
    final SemanticsHandle h = tester.ensureSemantics();
    await _pump(tester, const Locale('ta'));
    expect(find.text('மற்றவை'), findsOneWidget);
    expect(find.text(ta.categoryStreaming), findsOneWidget);
    expect(
      find.text('Other'),
      findsNothing,
      reason: 'the stored id printed as the name is the defect',
    );
    // The row's one semantics node speaks the translated name too.
    expect(
      find.bySemanticsLabel(RegExp('^மற்றவை')),
      findsOneWidget,
      reason: 'a reader must hear the name the eye reads',
    );

    // And the table view.
    await tester.tap(find.byKey(CategoryCard.tableToggle));
    await tester.pump();
    expect(find.text('மற்றவை'), findsOneWidget);
    expect(find.text('Other'), findsNothing);
    h.dispose();
  });

  testWidgets('in English the name is the id, so nothing moved', (
    WidgetTester tester,
  ) async {
    await _pump(tester, const Locale('en'));
    expect(find.text('Other'), findsOneWidget);
    expect(find.text('Streaming'), findsOneWidget);
  });

  test('every id the app can store has a name in both languages', () {
    // The vocabulary the add sheet offers: the budget caps plus the fallback.
    final List<String> ids = <String>[
      ...DemoData.budget().categories.map((BudgetCap c) => c.name),
      'Other',
    ];
    expect(ids, hasLength(greaterThan(5)), reason: 'COVERAGE LOST — no ids');
    for (final String id in ids) {
      expect(
        categoryLabel(en, id),
        id,
        reason:
            'the English name of "$id" must be the id itself, or the '
            'English app would repaint every stored category',
      );
      expect(
        categoryLabel(ta, id),
        isNot(id),
        reason: '"$id" has no Tamil name: it would print the English id',
      );
    }
  });

  test('an id the vocabulary does not know is painted as stored', () {
    expect(categoryLabel(ta, 'My gym'), 'My gym');
  });
}
