// ST-P5 (round-2 F36) — the month report, rendered by core's PdfReport and
// handed to the file exporter from the Pro card.
//
// Red control: on the base (fbe498ac) there is no PDF anywhere in the tree
// (`git grep pdf` in apps/subscriptiontracker: none) and no month_report.dart;
// this file does not compile there.
import 'dart:convert' show latin1;

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:nikatru_core/nikatru_core.dart' show ExportFile, ExportOutcome;
import 'package:subscriptiontracker/data/models/subscription.dart';
import 'package:subscriptiontracker/features/insights/month_report.dart';

import 'support/pro_card_harness.dart';

List<Subscription> _subs(DateTime now) => <Subscription>[
  Subscription(
    id: 'n',
    name: 'Netflix',
    category: 'Video',
    price: const Money(64900, 'INR'),
    cycle: BillingCycle.monthly,
    nextRenewal: DateTime(now.year, now.month, 28),
    shareNumerator: 1,
    shareDenominator: 2,
  ),
  Subscription(
    id: 'f',
    name: 'Figma (Pro)',
    category: 'Creative',
    price: const Money(120000, 'INR'),
    cycle: BillingCycle.yearly,
    nextRenewal: DateTime(now.year + 1, now.month, 2),
  ),
];

void main() {
  final DateTime now = DateTime(2026, 9, 10);

  test('RED CONTROL: a month report renders a PDF with totals', () {
    final String pdf = latin1.decode(
      monthReport(_subs(now), now, currencyCode: 'INR').render(),
    );
    expect(pdf, startsWith('%PDF-'));
    // Charged in the month: the whole Netflix price (a shared plan is billed
    // in full); per month: my half of it plus a twelfth of Figma.
    expect(pdf, contains('(Charged in September 2026: INR 649.00) Tj'));
    expect(pdf, contains('(Per month \\(your share\\): INR 424.50) Tj'));
    expect(pdf, contains('(Per year \\(your share\\): INR 5,094.00) Tj'));
    expect(pdf, contains('(Figma \\(Pro\\)) Tj'));
    expect(pdf, contains('(1/2) Tj'));
    expect(pdf, contains('(INR 100.00 a month for Figma \\(Pro\\)'));
  });

  test('the file is named for the month and typed as a PDF', () {
    final ExportFile f = monthReportFile(_subs(now), now, currencyCode: 'INR');
    expect(f.fileName, 'subscriptions-2026-09.pdf');
    expect(f.mimeType, 'application/pdf');
  });

  test('no ₹ or other glyph the PDF font lacks reaches the page', () {
    final String pdf = latin1.decode(
      monthReport(_subs(now), now, currencyCode: 'INR').render(),
    );
    expect(pdf.contains('?'), isFalse);
  });

  testWidgets('the Pro card exports it through the file exporter', (
    WidgetTester tester,
  ) async {
    final KeepingExporter exporter = KeepingExporter();
    await pumpProCard(tester, _subs(DateTime.now()), exporter: exporter);
    await tester.tap(find.byKey(const Key('insights.report.export')));
    await tester.pumpAndSettle();
    final ExportFile f = exporter.files.single;
    expect(f.mimeType, 'application/pdf');
    expect(latin1.decode(f.bytes), startsWith('%PDF-1.4'));
  });

  testWidgets('a platform that cannot export says so', (
    WidgetTester tester,
  ) async {
    await pumpProCard(
      tester,
      _subs(DateTime.now()),
      exporter: KeepingExporter(outcome: ExportOutcome.failed),
    );
    await tester.tap(find.byKey(const Key('insights.report.export')));
    await tester.pumpAndSettle();
    expect(find.text('Could not export the report.'), findsOneWidget);
  });
}
