// ─────────────────────────────────────────────────────────────────────────────
// T20 · IN-12 — Insights › Share: a picture of the summary tiles, and a CSV of
// the month's charges, through the one export seam.
//
// 🔴 THE RED CONTROL: the share payload contains the month total. Before this
// train Insights had no Share and no month file, so the control below did not
// exist and the case failed at its first expectation.
// ─────────────────────────────────────────────────────────────────────────────
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/misc.dart' show Override;
import 'package:flutter_test/flutter_test.dart';
import 'package:nikatru_core/nikatru_core.dart' as core;
import 'package:subscriptiontracker/data/models/subscription.dart';
import 'package:subscriptiontracker/data/portability/month_charges.dart';
import 'package:subscriptiontracker/features/insights/insights_screen.dart';
import 'package:subscriptiontracker/features/insights/share_month.dart';
import 'package:subscriptiontracker/state/providers.dart';

import 'support/home_fixture.dart' show kHomeFixtureNow;
import 'support/st_polish_harness.dart';

Subscription _row(
  String id,
  String name,
  int minor,
  Cadence cycle,
  DateTime next, {
  SubscriptionStatus status = SubscriptionStatus.active,
}) => Subscription(
  id: id,
  name: name,
  category: 'Other',
  price: Money(minor, 'USD'),
  cycle: cycle,
  nextRenewal: next,
  status: status,
);

/// October 2026: a weekly plan from the 1st (five charges), a monthly one on
/// the 20th, a yearly one in November (none), and a PAUSED monthly (none).
List<Subscription> _october() => <Subscription>[
  _row('wk', 'Weekly Box', 100, Cadence.weekly, DateTime(2026, 10, 1)),
  _row('mo', 'Netflix', 1549, Cadence.monthly, DateTime(2026, 10, 20)),
  _row('yr', 'Adobe', 23988, Cadence.yearly, DateTime(2026, 11, 5)),
  _row(
    'ps',
    'Paused Gym',
    4000,
    Cadence.monthly,
    DateTime(2026, 10, 9),
    status: SubscriptionStatus.paused,
  ),
];

List<List<String>> _records(core.ExportFile f) =>
    const core.CsvReader().read(utf8.decode(f.bytes)).rows;

void main() {
  group('the month file', () {
    test('every CHARGE in the month: a weekly plan five times, a paused one '
        'never, a yearly one outside the month never', () {
      final List<MonthCharge> charges = monthCharges(
        _october(),
        DateTime(2026, 10, 14),
      );
      expect(
        <String>[
          for (final MonthCharge c in charges)
            '${Subscription.dateOnly(c.on)} ${c.sub.id}',
        ],
        <String>[
          '2026-10-01 wk',
          '2026-10-08 wk',
          '2026-10-15 wk',
          '2026-10-20 mo',
          '2026-10-22 wk',
          '2026-10-29 wk',
        ],
      );
      expect(
        monthChargesTotal(charges).byCurrency['USD'],
        const Money(2049, 'USD'),
      );
    });

    test(
      '🔴 the CSV carries the month total, in decimal and with its code',
      () {
        final core.ExportFile f = monthChargesCsvFile(
          _october(),
          DateTime(2026, 10, 14),
        );
        expect(f.fileName, 'charges-2026-10.csv');
        expect(f.mimeType, 'text/csv');
        final List<List<String>> rows = _records(f);
        expect(rows.last, <String>['', 'total', '', '20.49', 'USD']);
        expect(rows, hasLength(7), reason: 'six charges and one total');
      },
    );

    test('two currencies are two totals, never one converted figure', () {
      final List<Subscription> subs = <Subscription>[
        ..._october(),
        Subscription(
          id: 'inr',
          name: 'Hotstar',
          category: 'Streaming',
          price: const Money(29900, 'INR'),
          cycle: Cadence.monthly,
          nextRenewal: DateTime(2026, 10, 3),
        ),
      ];
      final List<List<String>> totals = _records(
        monthChargesCsvFile(subs, DateTime(2026, 10)),
      ).where((List<String> r) => r[1] == kMonthChargesTotalCell).toList();
      expect(totals.map((List<String> r) => r[4]).toSet(), <String>{
        'USD',
        'INR',
      });
    });
  });

  testWidgets('🔴 Insights › Share › CSV hands the exporter this month\'s '
      'file, and it contains the month total', (WidgetTester tester) async {
    final KeepingExporter exporter = KeepingExporter();
    // The harness pins nowProvider, and Insights reads its month from it
    // (T12), so this month is the harness's, not the wall clock's.
    final DateTime now = kHomeFixtureNow;
    final List<Subscription> rows = <Subscription>[
      _row(
        'wk',
        'Weekly Box',
        100,
        Cadence.weekly,
        DateTime(now.year, now.month),
      ),
      _row(
        'mo',
        'Netflix',
        1549,
        Cadence.monthly,
        DateTime(now.year, now.month, 20),
      ),
    ];
    await pumpPolish(
      tester,
      const InsightsScreen(),
      rows: rows,
      size: const Size(400, 2400),
      overrides: <Override>[fileExporterProvider.overrideWithValue(exporter)],
    );
    expect(find.byKey(ShareMonthKeys.open), findsOneWidget);
    await tester.tap(find.byKey(ShareMonthKeys.open));
    await settle(tester);
    await tester.tap(find.byKey(ShareMonthKeys.csv));
    await settle(tester);

    expect(exporter.files, hasLength(1), reason: 'nothing reached the seam');
    final core.ExportFile f = exporter.files.single;
    final core.MoneyBag total = monthChargesTotal(monthCharges(rows, now));
    final List<String> cells = core.CsvCodec.moneyCells(total.amounts.single);
    expect(_records(f).last, <String>['', 'total', '', ...cells]);
  });

  testWidgets('Share › picture hands the exporter a PNG of the tiles', (
    WidgetTester tester,
  ) async {
    final GlobalKey tiles = GlobalKey();
    await tester.pumpWidget(
      MaterialApp(
        home: RepaintBoundary(
          key: tiles,
          child: const SizedBox(width: 40, height: 20, child: Placeholder()),
        ),
      ),
    );
    final core.ExportFile? f = await tester.runAsync<core.ExportFile?>(
      () => summaryImageFile(tiles, DateTime(2026, 10, 14)),
    );
    expect(f, isNotNull);
    expect(f!.fileName, 'insights-2026-10.png');
    expect(f.mimeType, 'image/png');
    expect(f.bytes.take(4).toList(), <int>[0x89, 0x50, 0x4E, 0x47]);
  });

  testWidgets('with features.exports OFF there is no Share at all', (
    WidgetTester tester,
  ) async {
    await pumpPolish(
      tester,
      const InsightsScreen(),
      overrides: <Override>[
        appConfigProvider.overrideWith(
          (_) async => kAppDefaultConfig.copyWith(
            features: <String, bool>{
              ...kAppDefaultConfig.features,
              'exports': false,
            },
          ),
        ),
      ],
    );
    expect(find.byKey(ShareMonthKeys.open), findsNothing);
  });
}
